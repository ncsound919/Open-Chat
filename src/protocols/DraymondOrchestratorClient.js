/**
 * Draymond Orchestrator Protocol Client
 * Deep integration with Draymond multi-agent orchestrator
 *
 * Architecture:
 * - Agent discovery and capability registration
 * - Multi-agent task coordination
 * - Workflow state tracking across agent boundaries
 * - Real-time event stream via SSE
 * - Tool execution monitoring
 *
 * Endpoints:
 * - GET /v1/agents - List registered agents
 * - POST /v1/orchestrate - Submit task for multi-agent coordination
 * - GET /v1/workflows/{id} - Get workflow status
 * - GET /v1/events - Real-time SSE event stream
 * - GET /v1/health - Health check
 * - GET /v1/messages - Load chat history
 * - POST /v1/messages - Sync chat messages
 * - GET /v1/chains - List chains/pipelines
 * - POST /v1/chains - Execute a chain
 * - GET /v1/schedules - List scheduled jobs
 * - PATCH /v1/schedules - Enable/disable a schedule
 * - GET /v1/status - Get server status
 * - POST /v1/status - Report client status
 */

import { Preferences } from '@capacitor/preferences';
import { isNative } from '../utils/platform.js';

/** Connection timeout in milliseconds */
const CONNECT_TIMEOUT_MS = 30_000;

const LOCALHOST_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** Polling interval for workflow status (ms) */
const WORKFLOW_POLL_INTERVAL_MS = 1_000;

/** Event stream reconnect delay (ms) */
const EVENT_STREAM_RECONNECT_DELAY_MS = 3_000;

/** Maximum queued commands when offline */
const MAX_OFFLINE_QUEUE = 100;

/** localStorage key for offline command queue */
const OFFLINE_QUEUE_KEY = "openchat_draymond_queue_v1";

/**
 * Draymond Orchestrator Client
 * Manages connection to orchestrator, agent discovery, and workflow coordination
 */
export class DraymondOrchestratorClient {
  constructor(host, port, token) {
    this.host = host;
    this.port = port;
    this.token = token;

    // Support three forms:
    //   1. Full URL  — "https://xxxx.trycloudflare.com"  → use as-is
    //   2. Hostname with no port — "xxxx.trycloudflare.com" → prefix https://
    //   3. Local host + port   — "127.0.0.1", 8644         → http://<host>:<port>
    //
    // Next.js App Router serves all API routes under /api, so v1 endpoints
    // live at /api/v1/*, not /v1/*.
    const trimmedHost = String(host || "").trim();
    const isFullUrl = /^https?:\/\//i.test(trimmedHost);
    const isRemoteHost = isFullUrl || !LOCALHOST_HOSTS.has(trimmedHost.toLowerCase());

    if (isFullUrl) {
      // Already a full URL
      this.baseUrl = `${trimmedHost.replace(/\/$/, "")}/api`;
    } else if (isRemoteHost) {
      // Remote hostname — prefer HTTPS tunnel URL even if a stale port is still saved.
      this.baseUrl = `https://${trimmedHost}/api`;
    } else {
      // Classic local host:port
      this.baseUrl = `http://${trimmedHost}:${port}/api`;
    }

    // Callbacks
    this.onStatusChange = null;
    this.onWorkflowUpdate = null;
    this.onAgentDiscovered = null;
    this.onToolExecution = null;
    this.onEvent = null;

    // State
    this.status = "disconnected";
    this.registeredAgents = {};
    this.activeWorkflows = {};
    this.eventSource = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this._reconnectTimerId = null;
    this._shouldReconnect = false;
    this._pollTimerIds = new Set();

    // Offline command queue
    this._offlineQueue = this._loadOfflineQueue();
    this._flushing = false;

    // New callbacks
    this.onNotification = null;
    this.onChainUpdate = null;
    this.onScheduleUpdate = null;

    // Client ID for status reporting
    this._clientId = `openchat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Connect to orchestrator and discover agents
   */
  async connect() {
    this._setStatus("connecting");

    try {
      // Health check
      const healthy = await this._healthCheck();
      if (!healthy) {
        throw new Error("Orchestrator health check failed");
      }

      // Discover agents
      const agents = await this._discoverAgents();
      this.registeredAgents = agents;

      // Start event stream
      this._shouldReconnect = true;
      this._connectEventStream();

      this._setStatus("connected");
      this.reconnectAttempts = 0;

      // Report online status to Draymond
      this.reportStatus("connect").catch(() => {});

      // Flush any queued offline commands
      if (this._offlineQueue.length > 0) {
        this.flushOfflineQueue().catch(() => {});
      }

      return agents;
    } catch (error) {
      console.error("Failed to connect to Draymond Orchestrator");
      this._setStatus("error");
      throw error;
    }
  }

  /**
   * Disconnect from orchestrator
   */
  disconnect() {
    this._setStatus("disconnecting");

    // Stop any pending reconnect
    this._shouldReconnect = false;
    if (this._reconnectTimerId !== null) {
      clearTimeout(this._reconnectTimerId);
      this._reconnectTimerId = null;
    }

    // Cancel all workflow poll timers
    for (const timerId of this._pollTimerIds) {
      clearTimeout(timerId);
    }
    this._pollTimerIds.clear();

    // Close event stream
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Clear active workflows
    this.activeWorkflows = {};

    this._setStatus("disconnected");

    // Report disconnect to Draymond (best-effort)
    this.reportStatus("disconnect").catch(() => {});
  }

  /**
   * Orchestrate a task across multiple agents
   * @param {Object} options - Orchestration options
   * @param {string} options.workflowId - Unique workflow ID
   * @param {string} options.task - Task description
   * @param {Function} options.onPhaseUpdate - Callback for phase updates
   * @param {Function} options.onToolExecution - Callback for tool executions
   * @param {Function} options.onChunk - Callback for streaming text chunks
   * @param {AbortSignal} signal - Abort signal for cancellation
   * @returns {Promise<Object>} - Workflow result
   */
  async orchestrate(options, signal) {
    const {
      workflowId,
      task,
      onPhaseUpdate,
      onToolExecution,
      onChunk,
    } = options;

    const url = `${this.baseUrl}/v1/orchestrate`;

    // Combine abort signal with connection timeout
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
      () => timeoutController.abort(),
      CONNECT_TIMEOUT_MS
    );

    // Polyfill AbortSignal.any — use a merged controller to avoid event listener leaks
    let mergedController = null;
    let combinedSignal;
    if (signal && AbortSignal.any) {
      combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
    } else if (signal) {
      mergedController = new AbortController();
      const onAbort = () => mergedController.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      timeoutController.signal.addEventListener("abort", onAbort, { once: true });
      combinedSignal = mergedController.signal;
    } else {
      combinedSignal = timeoutController.signal;
    }

    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        signal: combinedSignal,
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({
          workflow_id: workflowId,
          task,
          stream: true,
          metadata: {
            client: "open-chat",
            version: "1.0.0",
          },
        }),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    // Track workflow
    this.activeWorkflows[workflowId] = {
      id: workflowId,
      status: "in_progress",
      startTime: Date.now(),
      phases: [],
      agents: [],
    };

    // Cancel workflow and stop polling when the caller aborts
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          this.cancelWorkflow(workflowId).catch(() => {
            // Swallow — already aborting
          });
        },
        { once: true }
      );
    }

    // Start polling workflow status in background (tied to abort signal)
    this._pollWorkflowStatus(workflowId, onPhaseUpdate, onToolExecution, signal);

    // Stream response
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";
    let eventDataLines = [];

    const processEventData = () => {
      if (eventDataLines.length === 0) return false;

      const data = eventDataLines.join("\n").trim();
      eventDataLines = [];

      if (!data) return false;
      if (data === "[DONE]") {
        return true;
      }

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content || "";

        if (delta) {
          fullText += delta;
          onChunk?.(delta);
        }

        // Extract workflow metadata if present
        if (parsed.workflow) {
          this._updateWorkflow(workflowId, parsed.workflow);
        }
      } catch (e) {
        console.warn("Failed to parse SSE data");
      }

      return false;
    };

    try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Message size validation — prevent memory exhaustion
      if (buffer.length > 1_048_576) {
        throw new Error("Response too large");
      }

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line === "") {
          if (processEventData()) {
            this.activeWorkflows[workflowId].status = "completed";
            return { text: fullText, workflowId };
          }
          continue;
        }

        if (line.startsWith("data:")) {
          const data = line.slice(5).replace(/^\s/, "");
          eventDataLines.push(data);
        }
      }
    }

    // Process trailing data
    buffer += decoder.decode();
    const trailingLines = buffer.split(/\r?\n/);

    for (const line of trailingLines) {
      if (line === "") {
        if (processEventData()) {
          this.activeWorkflows[workflowId].status = "completed";
          return { text: fullText, workflowId };
        }
        continue;
      }

      if (line.startsWith("data:")) {
        const data = line.slice(5).replace(/^\s/, "");
        eventDataLines.push(data);
      }
    }

    if (processEventData()) {
      this.activeWorkflows[workflowId].status = "completed";
    }

    return { text: fullText, workflowId };
    } catch (err) {
      reader.cancel().catch(() => {});
      throw err;
    }
  }

  /**
   * Get workflow status
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<Object>} - Workflow status
   */
  async getWorkflowStatus(workflowId) {
    const url = `${this.baseUrl}/v1/workflows/${workflowId}`;

    try {
      const res = await fetch(url, {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      return await res.json();
    } catch (error) {
      console.warn("Failed to get workflow status:", error);
      return null;
    }
  }

  /**
   * Cancel a workflow
   * @param {string} workflowId - Workflow ID
   */
  async cancelWorkflow(workflowId) {
    const url = `${this.baseUrl}/v1/workflows/${workflowId}`;

    try {
      const res = await fetch(url, {
        method: "DELETE",
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      });

      if (res.ok) {
        if (!this.activeWorkflows[workflowId]) {
          this.activeWorkflows[workflowId] = { status: "cancelled" };
        } else {
          this.activeWorkflows[workflowId].status = "cancelled";
        }
      }
    } catch (error) {
      console.warn("Failed to cancel workflow");
    }
  }

  /**
   * Get registered agents
   * @returns {Object} - Agent registry
   */
  getAgents() {
    return this.registeredAgents;
  }

  /**
   * Get active workflows
   * @returns {Object} - Active workflows
   */
  getActiveWorkflows() {
    return this.activeWorkflows;
  }

  // ── Messages API ────────────────────────────────────────────────────────

  /**
   * Sync messages to Draymond for persistent chat history
   * @param {string} sessionId - Chat session identifier
   * @param {Array<{role: string, content: string, metadata?: object}>} messages
   * @returns {Promise<{ok: boolean, inserted: number}>}
   */
  async syncMessages(sessionId, messages) {
    const url = `${this.baseUrl}/v1/messages`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ session_id: sessionId, messages }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      if (!this._flushing) {
        this._enqueueOffline({ type: "syncMessages", sessionId, messages });
        console.warn("Failed to sync messages — queued for retry");
      }
      return { ok: false, error: error.message };
    }
  }

  /**
   * Load message history from Draymond
   * @param {string} sessionId
   * @param {object} [options]
   * @param {number} [options.limit=100]
   * @param {string} [options.before] - ISO timestamp for pagination
   * @returns {Promise<{ok: boolean, messages: Array}>}
   */
  async loadMessages(sessionId, options = {}) {
    const params = new URLSearchParams({ session_id: sessionId });
    if (options.limit) params.set("limit", String(options.limit));
    if (options.before) params.set("before", options.before);

    const url = `${this.baseUrl}/v1/messages?${params}`;
    try {
      const res = await fetch(url, {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      console.warn("Failed to load messages:", error.message);
      return { ok: false, messages: [] };
    }
  }

  // ── Chains API ──────────────────────────────────────────────────────────

  /**
   * List available chains/pipelines
   * @param {object} [filters]
   * @param {boolean} [filters.is_template]
   * @param {string} [filters.status]
   * @param {number} [filters.limit]
   * @returns {Promise<{ok: boolean, chains: Array}>}
   */
  async listChains(filters = {}) {
    const params = new URLSearchParams();
    if (filters.is_template !== undefined) params.set("is_template", String(filters.is_template));
    if (filters.status) params.set("status", filters.status);
    if (filters.limit) params.set("limit", String(filters.limit));

    const url = `${this.baseUrl}/v1/chains?${params}`;
    try {
      const res = await fetch(url, {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      console.warn("Failed to list chains:", error.message);
      return { ok: false, chains: [] };
    }
  }

  /**
   * Execute a chain by slug
   * @param {string} chainSlug
   * @param {object} [input={}]
   * @param {string} [agentId]
   * @returns {Promise<object>}
   */
  async executeChain(chainSlug, input = {}, agentId) {
    const url = `${this.baseUrl}/v1/chains`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ chain_slug: chainSlug, input, agent_id: agentId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      if (!this._flushing) {
        this._enqueueOffline({ type: "executeChain", chainSlug, input, agentId });
        console.warn("Failed to execute chain — queued for retry");
      }
      return { ok: false, error: error.message };
    }
  }

  // ── Schedules API ───────────────────────────────────────────────────────

  /**
   * List scheduled jobs
   * @param {object} [filters]
   * @returns {Promise<{ok: boolean, schedules: Array}>}
   */
  async listSchedules(filters = {}) {
    const params = new URLSearchParams();
    if (filters.is_enabled !== undefined) params.set("is_enabled", String(filters.is_enabled));
    if (filters.job_type) params.set("job_type", filters.job_type);
    if (filters.limit) params.set("limit", String(filters.limit));

    const url = `${this.baseUrl}/v1/schedules?${params}`;
    try {
      const res = await fetch(url, {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      console.warn("Failed to list schedules:", error.message);
      return { ok: false, schedules: [] };
    }
  }

  /**
   * Enable or disable a scheduled job
   * @param {string} jobId
   * @param {'enable'|'disable'} action
   * @returns {Promise<object>}
   */
  async toggleSchedule(jobId, action) {
    const url = `${this.baseUrl}/v1/schedules`;
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ id: jobId, action }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      if (!this._flushing) {
        this._enqueueOffline({ type: "toggleSchedule", jobId, action });
        console.warn("Failed to toggle schedule — queued for retry");
      }
      return { ok: false, error: error.message };
    }
  }

  // ── Status API ──────────────────────────────────────────────────────────

  /**
   * Report client status to Draymond (heartbeat / connect / disconnect)
   * @param {'connect'|'disconnect'|'heartbeat'} action
   * @returns {Promise<object>}
   */
  async reportStatus(action = "heartbeat") {
    const url = `${this.baseUrl}/v1/status`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({
          client_id: this._clientId,
          action,
          version: "1.0.0",
          platform: "open-chat",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      console.warn("Failed to report status:", error.message);
      return { ok: false };
    }
  }

  /**
   * Get Draymond server status
   * @returns {Promise<object>}
   */
  async getServerStatus() {
    const url = `${this.baseUrl}/v1/status`;
    try {
      const res = await fetch(url, {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      console.warn("Failed to get server status:", error.message);
      return { ok: false, status: "unreachable" };
    }
  }

  // ── Orchestrate with entity/chain routing ───────────────────────────────

  /**
   * Invoke a specific entity through Draymond
   * @param {string} entitySlug
   * @param {string} action
   * @param {object} input
   * @param {object} options - Same as orchestrate() options
   * @param {AbortSignal} signal
   * @returns {Promise<object>}
   */
  async invokeEntity(entitySlug, action, input = {}, options = {}, signal) {
    return this.orchestrate(
      {
        ...options,
        workflowId: options.workflowId || `entity-${entitySlug}-${Date.now()}`,
        task: `Invoke entity: ${entitySlug}`,
        metadata: { entity_slug: entitySlug, action, input },
      },
      signal,
    );
  }

  /**
   * Trigger a chain through the orchestrate endpoint
   * @param {string} chainSlug
   * @param {object} input
   * @param {object} options - Same as orchestrate() options
   * @param {AbortSignal} signal
   * @returns {Promise<object>}
   */
  async triggerChain(chainSlug, input = {}, options = {}, signal) {
    return this.orchestrate(
      {
        ...options,
        workflowId: options.workflowId || `chain-${chainSlug}-${Date.now()}`,
        task: `Execute chain: ${chainSlug}`,
        metadata: { chain_slug: chainSlug, input },
      },
      signal,
    );
  }

  // ── Offline Queue ───────────────────────────────────────────────────────

  /**
   * Get the current offline queue size
   * @returns {number}
   */
  getOfflineQueueSize() {
    return this._offlineQueue.length;
  }

  /**
   * Flush the offline queue — retry all queued commands
   * @returns {Promise<{succeeded: number, failed: number}>}
   */
  async flushOfflineQueue() {
    if (this._offlineQueue.length === 0) return { succeeded: 0, failed: 0 };

    this._flushing = true;
    const queue = [...this._offlineQueue];
    this._offlineQueue = [];
    this._saveOfflineQueue();

    let succeeded = 0;
    let failed = 0;

    for (const cmd of queue) {
      try {
        switch (cmd.type) {
          case "syncMessages":
            await this.syncMessages(cmd.sessionId, cmd.messages);
            break;
          case "executeChain":
            await this.executeChain(cmd.chainSlug, cmd.input, cmd.agentId);
            break;
          case "toggleSchedule":
            await this.toggleSchedule(cmd.jobId, cmd.action);
            break;
          default:
            console.warn(`Unknown queued command type: ${cmd.type}`);
        }
        succeeded++;
      } catch {
        // Re-queue on failure
        this._offlineQueue.push(cmd);
        failed++;
      }
    }

    this._flushing = false;
    this._saveOfflineQueue();
    return { succeeded, failed };
  }

  // ── Private methods ──────────────────────────────────────────────────────

  /**
   * Health check
   * @private
   */
  async _healthCheck() {
    const url = `${this.baseUrl}/v1/health`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(url, {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return res.ok;
    } catch (e) {
      clearTimeout(timeout);
      return false;
    }
  }

  /**
   * Discover agents
   * @private
   */
  async _discoverAgents() {
    const url = `${this.baseUrl}/v1/agents`;

    try {
      const res = await fetch(url, {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      const agents = {};

      // Convert array to map
      if (Array.isArray(data.agents)) {
        for (const agent of data.agents) {
          agents[agent.id] = {
            id: agent.id,
            name: agent.name,
            capabilities: agent.capabilities || [],
            status: agent.status || "unknown",
            lastHeartbeat: agent.last_heartbeat,
          };

          // Notify callback
          this.onAgentDiscovered?.(agents[agent.id]);
        }
      }

      return agents;
    } catch (error) {
      console.warn("Failed to discover agents");
      return {};
    }
  }

  /**
   * Connect to event stream
   * @private
   */
  _connectEventStream() {
    if (this.eventSource) {
      this.eventSource.close();
    }

    const url = `${this.baseUrl}/v1/events`;
    const controller = new AbortController();
    const connection = {
      close: () => controller.abort(),
    };

    this.eventSource = connection;

    const headers = this.token
      ? { Authorization: `Bearer ${this.token}` }
      : {};

    const handleStreamError = () => {
      if (controller.signal.aborted) {
        return;
      }

      console.warn("Event stream disconnected");
      this.eventSource?.close();
      this.eventSource = null;

      // Reconnect with backoff
      if (
        this._shouldReconnect &&
        this.reconnectAttempts < this.maxReconnectAttempts
      ) {
        this.reconnectAttempts++;
        this._reconnectTimerId = setTimeout(() => {
          // Clear the timer ID before calling _connectEventStream so that
          // disconnect() cannot clearTimeout an already-fired timer, and any
          // new timer set by _connectEventStream gets its own fresh ID.
          this._reconnectTimerId = null;
          if (this._shouldReconnect) {
            this._connectEventStream();
          }
        }, EVENT_STREAM_RECONNECT_DELAY_MS * this.reconnectAttempts);
      }
    };

    (async () => {
      try {
        const res = await fetch(url, {
          headers,
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        if (!res.body) {
          throw new Error("Event stream response body is not available");
        }

        // Event stream connected — reset reconnect counter
        this.reconnectAttempts = 0;

        await this._consumeEventStream(res.body, controller.signal);

        if (!controller.signal.aborted) {
          handleStreamError(new Error("Event stream closed"));
        }
      } catch (error) {
        handleStreamError(error);
      }
    })();
  }

  /**
   * Consume an SSE response body
   * @private
   * @param {ReadableStream} body
   * @param {AbortSignal} signal
   */
  async _consumeEventStream(body, signal) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        if (signal.aborted) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        buffer = this._processEventStreamBuffer(buffer);
      }

      buffer += decoder.decode();
      this._processEventStreamBuffer(buffer, true);
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Process buffered SSE data and return any incomplete trailing chunk
   * @private
   * @param {string} buffer
   * @param {boolean} flush
   * @returns {string}
   */
  _processEventStreamBuffer(buffer, flush = false) {
    const normalizedBuffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const delimiter = "\n\n";
    const lastDelimiter = normalizedBuffer.lastIndexOf(delimiter);

    if (lastDelimiter === -1) {
      if (flush && normalizedBuffer.trim()) {
        this._handleEventStreamChunk(normalizedBuffer);
      }
      return flush ? "" : normalizedBuffer;
    }

    const complete = normalizedBuffer.slice(0, lastDelimiter);
    const remainder = normalizedBuffer.slice(lastDelimiter + delimiter.length);

    for (const chunk of complete.split(delimiter)) {
      this._handleEventStreamChunk(chunk);
    }

    return flush ? "" : remainder;
  }

  /**
   * Handle a single SSE event chunk
   * @private
   * @param {string} chunk
   */
  _handleEventStreamChunk(chunk) {
    const dataLines = [];

    for (const line of chunk.split("\n")) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) {
      return;
    }

    try {
      const data = JSON.parse(dataLines.join("\n"));
      this._handleEvent(data);
    } catch (e) {
      console.warn("Failed to parse event data");
    }
  }

  /**
   * Handle event from stream
   * @private
   */
  _handleEvent(event) {
    const { type, data } = event;

    switch (type) {
      case "agent.registered":
      case "agent.updated":
        if (data.agent) {
          this.registeredAgents[data.agent.id] = {
            id: data.agent.id,
            name: data.agent.name,
            capabilities: data.agent.capabilities || [],
            status: data.agent.status || "unknown",
            lastHeartbeat: data.agent.last_heartbeat,
          };
          this.onAgentDiscovered?.(this.registeredAgents[data.agent.id]);
        }
        break;

      case "workflow.started":
      case "workflow.updated":
        if (data.workflow) {
          this._updateWorkflow(data.workflow.id, data.workflow);
        }
        break;

      case "phase.completed":
        if (data.workflow_id && data.phase) {
          const workflow = this.activeWorkflows[data.workflow_id];
          if (workflow) {
            workflow.currentPhase = data.phase.name;
            workflow.phases.push(data.phase);
            this.onWorkflowUpdate?.(workflow);
          }
        }
        break;

      case "tool.executed":
        if (data.execution) {
          this.onToolExecution?.(data.execution);
        }
        break;

      case "workflow.completed":
      case "workflow.failed":
        if (data.workflow_id) {
          const workflow = this.activeWorkflows[data.workflow_id];
          if (workflow) {
            workflow.status = type === "workflow.completed" ? "completed" : "failed";
            workflow.endTime = Date.now();
            this.onWorkflowUpdate?.(workflow);
          }
        }
        break;

      case "chain.started":
      case "chain.step_completed":
      case "chain.step_failed":
      case "chain.completed":
      case "chain.failed":
        this.onChainUpdate?.(event);
        break;

      case "scheduler.job_started":
      case "scheduler.job_completed":
      case "scheduler.job_failed":
        this.onScheduleUpdate?.(event);
        break;

      case "notification.sent":
      case "notification.failed":
        this.onNotification?.(event);
        break;

      case "monitor.site_down":
      case "monitor.site_recovered":
      case "monitor.health_check_complete":
        this.onNotification?.(event);
        break;

      default:
        // Pass through to generic callback
        this.onEvent?.(event);
    }
  }

  /**
   * Update workflow state
   * @private
   */
  _updateWorkflow(workflowId, workflowData) {
    if (!this.activeWorkflows[workflowId]) {
      this.activeWorkflows[workflowId] = {
        id: workflowId,
        status: "in_progress",
        startTime: Date.now(),
        phases: [],
        agents: [],
      };
    }

    const workflow = this.activeWorkflows[workflowId];
    Object.assign(workflow, workflowData);

    this.onWorkflowUpdate?.(workflow);
  }

  /**
   * Poll workflow status
   * @private
   */
  _pollWorkflowStatus(workflowId, onPhaseUpdate, onToolExecution, signal) {
    const poll = async () => {
      // Stop if caller aborted
      if (signal?.aborted) return;

      const workflow = this.activeWorkflows[workflowId];
      if (!workflow || workflow.status === "completed" || workflow.status === "failed") {
        return;
      }

      const status = await this.getWorkflowStatus(workflowId);
      if (status) {
        this._updateWorkflow(workflowId, status);

        // Notify phase updates
        if (status.current_phase) {
          onPhaseUpdate?.(status.current_phase);
        }

        // Notify tool executions
        if (status.recent_executions) {
          for (const execution of status.recent_executions) {
            onToolExecution?.(execution);
          }
        }

        // Continue polling if still active and not aborted
        if (status.status === "in_progress" && !signal?.aborted) {
          const tid = setTimeout(poll, WORKFLOW_POLL_INTERVAL_MS);
          this._pollTimerIds.add(tid);
        }
      }
    };

    // Start polling after initial delay
    const initialTid = setTimeout(poll, WORKFLOW_POLL_INTERVAL_MS);
    this._pollTimerIds.add(initialTid);
  }

  /**
   * Set status and notify callback
   * @private
   */
  _setStatus(status) {
    this.status = status;
    this.onStatusChange?.(status);
  }

  // ── Offline queue persistence ──────────────────────────────────────────

  /** @private */
  _enqueueOffline(command) {
    if (this._offlineQueue.length >= MAX_OFFLINE_QUEUE) {
      this._offlineQueue.shift(); // drop oldest
    }
    this._offlineQueue.push({ ...command, queued_at: new Date().toISOString() });
    this._saveOfflineQueue();
  }

  /** @private */
  _saveOfflineQueue() {
    try {
      const value = JSON.stringify(this._offlineQueue);
      if (isNative) {
        Preferences.set({ key: OFFLINE_QUEUE_KEY, value }).catch(() => {});
      } else {
        localStorage.setItem(OFFLINE_QUEUE_KEY, value);
      }
    } catch {
      // Non-fatal
    }
  }

  /** @private */
  _loadOfflineQueue() {
    try {
      if (isNative) {
        // On native, load asynchronously then merge (queue starts empty on cold boot)
        Preferences.get({ key: OFFLINE_QUEUE_KEY }).then(({ value }) => {
          if (!value) return;
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed) && parsed.length > 0 && this._offlineQueue.length === 0) {
            this._offlineQueue = parsed;
          }
        }).catch(() => {});
        return [];
      }
      const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
