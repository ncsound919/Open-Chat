/**
 * A2A (Agent2Agent) Protocol Client
 * Connects Open-Chat to any A2A-compliant remote agent (Linux Foundation standard, v1.0).
 *
 * A2A is the open standard for agent-to-agent communication. An agent exposes an
 * "Agent Card" at a well-known URI (/.well-known/agent-card.json) that describes its
 * identity, capabilities, skills, supported interfaces, and security requirements.
 * Communication happens over JSON-RPC 2.0 on the advertised interface, with
 * Server-Sent Events (SSE) for streaming task updates.
 *
 * This client:
 *  - Discovers an agent by fetching its Agent Card
 *  - Delegates work by creating Tasks and sending Messages
 *  - Streams TaskStatusUpdateEvent / TaskArtifactUpdateEvent updates in real time
 *  - Cancels / polls tasks
 *
 * Endpoints:
 *  - GET  {agentCardUrl}                - Agent Card (self-describing manifest)
 *  - POST {interface.url}               - JSON-RPC (SendMessage / GetTask / CancelTask ...)
 */

import { uuid } from "../utils/helpers.js";
import { isSafeUrl, isValidMessageSize, safeLog } from "../utils/security.js";

/** Connection / request timeout in milliseconds. */
const CONNECT_TIMEOUT_MS = 30_000;

/** Maximum accumulated streaming payload in bytes (1 MB). */
const MAX_STREAM_BYTES = 1_048_576;

/** Maximum number of queued tasks we keep track of. */
const MAX_ACTIVE_TASKS = 200;

/**
 * Task statuses defined by the A2A spec.
 */
export const TASK_STATUS = {
  SUBMITTED: "submitted",
  WORKING: "working",
  INPUT_REQUIRED: "input-required",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELED: "canceled",
};

/**
 * A2A Protocol Client
 * @param {string} agentCardUrl - URL of the agent's Agent Card
 *   (e.g. "https://agent.example.com/.well-known/agent-card.json" or a base URL
 *    that this client will resolve to /.well-known/agent-card.json).
 * @param {string} [token] - Optional bearer/API key used to authenticate.
 */
export class A2AClient {
  constructor(agentCardUrl, token) {
    this.agentCardUrl = agentCardUrl || "";
    this.token = token || "";

    // Agent card + discovery state
    this.agentCard = null;
    this.skills = [];
    this.jsonRpcUrl = null;

    // Connection state
    this.status = "disconnected";
    this._destroyed = false;

    // Task tracking
    this.activeTasks = {};
    this._requestId = 0;

    // Callbacks
    this.onStatusChange = null;
    this.onAgentDiscovered = null;
    this.onTaskUpdate = null;
  }

  /**
   * Discover the remote agent by fetching its Agent Card and selecting the
   * preferred (JSON-RPC) interface.
   * @returns {Promise<Object>} The parsed Agent Card.
   */
  async connect() {
    this._setStatus("connecting");
    try {
      const card = await this._fetchAgentCard();
      this.agentCard = card;
      this.skills = Array.isArray(card.skills) ? card.skills : [];
      this.jsonRpcUrl = this._selectInterface(card);
      this._setStatus("connected");
      this.onAgentDiscovered?.(card);
      return card;
    } catch (error) {
      this._setStatus("error");
      throw error;
    }
  }

  /**
   * Disconnect and clear all tracked tasks.
   */
  disconnect() {
    this._destroyed = true;
    this.activeTasks = {};
    this._setStatus("disconnected");
  }

  /**
   * Get the resolved Agent Card URL.
   * @private
   */
  _resolveAgentCardUrl() {
    const trimmed = String(this.agentCardUrl || "").trim();
    if (!trimmed) throw new Error("Agent Card URL is required");
    const url = /\/agent-card\.json$/i.test(trimmed)
      ? trimmed
      : `${trimmed.replace(/\/$/, "")}/.well-known/agent-card.json`;
    if (!isSafeUrl(url)) {
      throw new Error("Agent Card URL must use http(s)");
    }
    return url;
  }

  /**
   * Fetch and validate the Agent Card.
   * @private
   */
  async _fetchAgentCard() {
    const url = this._resolveAgentCardUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: this._authHeaders(),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const card = await res.json();
      if (!card || typeof card !== "object" || !card.name) {
        throw new Error("Invalid Agent Card: missing name");
      }
      return card;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Pick the preferred interface from the Agent Card.
   * Prefers the JSON-RPC protocol binding, falling back to the first listed.
   * @private
   */
  _selectInterface(card) {
    const interfaces = Array.isArray(card.supportedInterfaces)
      ? card.supportedInterfaces
      : [];
    if (interfaces.length === 0) {
      // No explicit interface — assume JSON-RPC at the card's base origin.
      return this._cardOrigin();
    }
    const preferred =
      interfaces.find((i) => /jsonrpc/i.test(i.protocolBinding || "")) ||
      interfaces[0];
    const url = preferred?.url;
    if (!url) return this._cardOrigin();
    if (!isSafeUrl(url)) throw new Error("Agent interface URL must use http(s)");
    return url.replace(/\/$/, "");
  }

  /**
   * Derive the base origin from the Agent Card URL as a default interface.
   * @private
   */
  _cardOrigin() {
    try {
      const u = new URL(this._resolveAgentCardUrl());
      return `${u.origin}/a2a/jsonrpc`;
    } catch {
      return this.agentCardUrl;
    }
  }

  /**
   * Build auth headers from the configured token (Bearer by default).
   * @private
   */
  _authHeaders() {
    if (!this.token) return {};
    return { Authorization: `Bearer ${this.token}` };
  }

  /**
   * Send a user message to the remote agent, creating a Task and streaming
   * the agent's updates back via SSE.
   * @param {string} text
   * @param {Function} [onChunk] - Called with each streamed text artifact chunk.
   * @param {Object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{text: string, taskId: string, status: string}>}
   */
  async send(text, onChunk, { signal } = {}) {
    if (this._destroyed) {
      throw new Error("Client destroyed");
    }
    if (!this.jsonRpcUrl) {
      throw new Error("Not connected - connect() first");
    }

    const taskId = `task-${uuid()}`;
    const message = {
      messageId: uuid(),
      role: "user",
      parts: [{ text: String(text ?? ""), mediaType: "text/plain" }],
    };

    const requestId = ++this._requestId;
    const body = {
      jsonrpc: "2.0",
      id: requestId,
      method: "SendMessage",
      params: { message },
    };

    this.activeTasks[taskId] = { id: taskId, status: TASK_STATUS.SUBMITTED };

    const controller = new AbortController();
    let combinedSignal = controller.signal;
    if (signal) {
      combinedSignal = AbortSignal.any
        ? AbortSignal.any([signal, controller.signal])
        : signal;
    }

    try {
      const res = await fetch(this.jsonRpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "A2A-Version": "1.0",
          ...this._authHeaders(),
        },
        body: JSON.stringify(body),
        signal: combinedSignal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      if (!res.body) {
        // Some servers reply with a plain JSON-RPC response instead of SSE.
        const json = await res.json();
        return this._handleSyncResult(taskId, json, onChunk);
      }

      const result = await this._consumeStream(taskId, res.body, onChunk, combinedSignal);
      return result;
    } catch (error) {
      if (this.activeTasks[taskId]) {
        this.activeTasks[taskId].status = TASK_STATUS.FAILED;
      }
      throw error;
    } finally {
      controller.abort();
    }
  }

  /**
   * Handle a non-streaming JSON-RPC result (or final response envelope).
   * @private
   */
  _handleSyncResult(taskId, json, onChunk) {
    const result = json?.result;
    const event = result?.event || result;
    const finalText = this._extractTextFromEvent(event);
    if (finalText) onChunk?.(finalText);
    const status = event?.status || this.activeTasks[taskId]?.status || TASK_STATUS.COMPLETED;
    this._updateTask(taskId, { status, ...event });
    this._finalizeTask(taskId, status);
    return { text: finalText, taskId, status };
  }

  /**
   * Consume an SSE stream of A2A events.
   * @private
   */
  async _consumeStream(taskId, body, onChunk, signal) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let byteCount = 0;
    let finalStatus = this.activeTasks[taskId]?.status || TASK_STATUS.SUBMITTED;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (signal?.aborted) break;

        buffer += decoder.decode(value, { stream: true });
        byteCount += value?.byteLength || 0;
        if (byteCount > MAX_STREAM_BYTES) {
          throw new Error("Stream too large");
        }

        const events = this._extractSseEvents(buffer);
        buffer = events.remainder;
        for (const data of events.events) {
          if (!isValidMessageSize(data)) continue;
          const chunk = this._handleStreamEvent(taskId, data);
          if (chunk) {
            fullText += chunk;
            onChunk?.(chunk);
          }
          const task = this.activeTasks[taskId];
          if (task && this._isTerminal(task.status)) {
            finalStatus = task.status;
            reader.cancel().catch(() => {});
            return this._finalize(taskId, fullText, finalStatus);
          }
        }
      }

      buffer += decoder.decode();
      for (const data of this._extractSseEvents(buffer, true).events) {
        const chunk = this._handleStreamEvent(taskId, data);
        if (chunk) {
          fullText += chunk;
          onChunk?.(chunk);
        }
      }
    } finally {
      reader.releaseLock();
    }

    const task = this.activeTasks[taskId];
    if (task) finalStatus = task.status;
    return this._finalize(taskId, fullText, finalStatus);
  }

  /**
   * Handle a single SSE event payload (JSON-RPC result envelope).
   * @returns {string} Any streamed text artifact chunk.
   * @private
   */
  _handleStreamEvent(taskId, data) {
    let event;
    try {
      const parsed = JSON.parse(data);
      event = parsed?.result?.event || parsed?.result || parsed;
    } catch {
      return "";
    }
    if (!event || typeof event !== "object") return "";

    // Task status updates carry status + optional message/artifacts.
    if (event.status) {
      this._updateTask(taskId, event);
    }
    // Artifact updates carry the agent's output artifacts.
    return this._extractTextFromEvent(event);
  }

  /**
   * Extract text parts from an A2A event (status or artifact update).
   * @private
   */
  _extractTextFromEvent(event) {
    const parts = [];
    if (Array.isArray(event.artifacts)) {
      for (const artifact of event.artifacts) {
        if (Array.isArray(artifact.parts)) parts.push(...artifact.parts);
      }
    }
    if (event.message && Array.isArray(event.message.parts)) {
      parts.push(...event.message.parts);
    }
    let text = "";
    for (const part of parts) {
      if (part && typeof part.text === "string") text += part.text;
    }
    return text;
  }

  /**
   * Update tracked task state and notify listeners.
   * @private
   */
  _updateTask(taskId, patch) {
    const existing = this.activeTasks[taskId] || { id: taskId };
    const next = { ...existing, ...patch };
    this.activeTasks[taskId] = next;
    this.onTaskUpdate?.(next);
  }

  /**
   * Mark a task terminal and return a normalized result.
   * @private
   */
  _finalize(taskId, text, status) {
    this._finalizeTask(taskId, status);
    return { text, taskId, status };
  }

  /**
   * Remove/prune terminal tasks from the tracking map.
   * @private
   */
  _finalizeTask(taskId, status) {
    if (this._isTerminal(status)) {
      delete this.activeTasks[taskId];
    }
    const keys = Object.keys(this.activeTasks);
    if (keys.length > MAX_ACTIVE_TASKS) {
      const toRemove = keys.slice(0, keys.length - MAX_ACTIVE_TASKS);
      for (const k of toRemove) delete this.activeTasks[k];
    }
  }

  /**
   * Get the current status of a tracked task.
   * @param {string} taskId
   * @returns {Promise<Object|null>}
   */
  async getTask(taskId) {
    if (!this.jsonRpcUrl) throw new Error("Not connected");
    const body = {
      jsonrpc: "2.0",
      id: ++this._requestId,
      method: "GetTask",
      params: { id: taskId },
    };
    try {
      const res = await fetch(this.jsonRpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this._authHeaders(),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const task = json?.result?.task || json?.result;
      if (task) this._updateTask(taskId, task);
      return task || null;
    } catch (error) {
      safeLog("Failed to get task", error);
      return null;
    }
  }

  /**
   * Cancel a running task.
   * @param {string} taskId
   * @returns {Promise<Object|null>}
   */
  async cancelTask(taskId) {
    if (!this.jsonRpcUrl) throw new Error("Not connected");
    const body = {
      jsonrpc: "2.0",
      id: ++this._requestId,
      method: "CancelTask",
      params: { id: taskId },
    };
    try {
      const res = await fetch(this.jsonRpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this._authHeaders(),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const task = json?.result?.task || json?.result;
      if (task) this._updateTask(taskId, task);
      return task || null;
    } catch (error) {
      safeLog("Failed to cancel task", error);
      return null;
    }
  }

  /**
   * Get the list of discovered skills (from the Agent Card).
   * @returns {Array<Object>}
   */
  getSkills() {
    return this.skills;
  }

  /**
   * True when the given status is terminal.
   * @private
   */
  _isTerminal(status) {
    return (
      status === TASK_STATUS.COMPLETED ||
      status === TASK_STATUS.FAILED ||
      status === TASK_STATUS.CANCELED
    );
  }

  /**
   * Split an SSE byte-stream buffer into complete event payloads.
   * @private
   */
  _extractSseEvents(buffer, flush = false) {
    const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const events = [];
    let cursor = 0;
    while (true) {
      const idx = normalized.indexOf("\n\n", cursor);
      if (idx === -1) break;
      const block = normalized.slice(cursor, idx);
      cursor = idx + 2;
      const data = this._sseBlockData(block);
      if (data) events.push(data);
    }
    let remainder = normalized.slice(cursor);
    if (flush) {
      const data = this._sseBlockData(remainder);
      if (data) events.push(data);
      remainder = "";
    }
    return { events, remainder };
  }

  /**
   * Pull the "data:" line out of a single SSE event block.
   * @private
   */
  _sseBlockData(block) {
    const lines = block.split("\n");
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^\s/, ""));
      }
    }
    if (dataLines.length === 0) return null;
    return dataLines.join("\n");
  }

  /**
   * Set status and notify the callback.
   * @private
   */
  _setStatus(status) {
    this.status = status;
    this.onStatusChange?.(status);
  }
}
