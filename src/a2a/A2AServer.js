/**
 * A2A (Agent2Agent) Server
 * Exposes one of Open-Chat's local agents/bots to the wider A2A network so that
 * any A2A client (LangGraph, CrewAI, Semantic Kernel, Google ADK, another
 * Open-Chat, ...) can discover it via its Agent Card and delegate tasks to it.
 *
 * This module is transport-agnostic: it builds a spec-compliant Agent Card and
 * turns JSON-RPC requests (SendMessage / GetTask / CancelTask) into responses,
 * streaming task updates via Server-Sent Events. A host (the Electron main
 * process, a Node http server, or a cloud function) mounts these handlers.
 *
 * A2A concepts mapped here:
 *  - Agent Card  -> describes the bot (name, skills, capabilities, interfaces)
 *  - Task        -> a stateful unit of delegated work (id + lifecycle)
 *  - Message     -> {messageId, role, parts[]} sent by the client
 *  - Artifact    -> the bot's output (text parts) streamed back
 */

import { uuid } from "../utils/helpers.js";

/** A2A task lifecycle statuses. */
export const A2A_STATUS = {
  SUBMITTED: "submitted",
  WORKING: "working",
  INPUT_REQUIRED: "input-required",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELED: "canceled",
};

/** Well-known path for A2A agent cards. */
export const AGENT_CARD_PATH = "/.well-known/agent-card.json";

/**
 * Build an A2A Agent Card describing a bot.
 * @param {Object} options
 * @param {string} options.name
 * @param {string} [options.description]
 * @param {string} [options.version='1.0.0']
 * @param {string} [options.baseUrl] - The URL this agent is reachable at.
 * @param {Array<Object>} [options.skills=[]]
 * @param {string} [options.protocolBinding='JSONRPC']
 * @param {boolean} [options.streaming=true]
 * @param {boolean} [options.pushNotifications=false]
 * @param {string} [options.iconUrl]
 * @returns {Object} The Agent Card.
 */
export function buildAgentCard({
  name,
  description = "",
  version = "1.0.0",
  baseUrl = "",
  skills = [],
  protocolBinding = "JSONRPC",
  streaming = true,
  pushNotifications = false,
  iconUrl,
} = {}) {
  return {
    name: String(name || "Open-Chat Agent"),
    description: String(description || ""),
    version: String(version || "1.0.0"),
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    capabilities: {
      streaming: !!streaming,
      pushNotifications: !!pushNotifications,
    },
    supportedInterfaces: [
      {
        protocolBinding,
        url: baseUrl ? String(baseUrl).replace(/\/$/, "") : "",
        protocolVersion: "1.0",
      },
    ],
    skills: Array.isArray(skills) ? skills : [],
    ...(iconUrl ? { iconUrl } : {}),
  };
}

/**
 * A2A Server
 * Holds a task store and an executor that runs delegated work against a bot.
 * @param {Object} options
 * @param {Function} options.executor - async ({text, taskId, onChunk, signal}) => string
 */
export class A2AServer {
  constructor({
    name,
    description,
    version,
    baseUrl,
    skills,
    executor,
    streaming = true,
  }) {
    this.agentCard = buildAgentCard({
      name,
      description,
      version,
      baseUrl,
      skills,
      streaming,
    });
    this.executor = executor || (async ({ text }) => String(text || ""));
    this.tasks = {}; // taskId -> { id, status, message, artifacts, history }
    this._onCancel = null;
  }

  /**
   * Get the Agent Card for discovery.
   * @returns {Object}
   */
  getAgentCard() {
    return this.agentCard;
  }

  /**
   * Return a handler for the well-known agent card endpoint.
   * @returns {{status: number, contentType: string, body: string}}
   */
  handleAgentCard() {
    return {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(this.agentCard),
    };
  }

  /**
   * Handle a JSON-RPC request body.
   * @param {Object} payload - The parsed JSON-RPC request.
   * @param {Object} [opts]
   * @param {boolean} [opts.stream=true] - Whether the client wants SSE.
   * @returns {Promise<{status: number, contentType: string, body: string|ReadableStream}>}
   */
  async handleJsonRpc(payload, { stream = true } = {}) {
    if (!payload || typeof payload !== "object") {
      return this._jsonError(payload?.id, -32700, "Parse error");
    }
    const { id, method, params } = payload;
    switch (method) {
      case "SendMessage":
        return this._handleSendMessage(id, params, stream);
      case "GetTask":
        return this._handleGetTask(id, params);
      case "CancelTask":
        return this._handleCancelTask(id, params);
      default:
        return this._jsonError(id, -32601, `Method not found: ${method}`);
    }
  }

  /**
   * Handle a SendMessage request, creating a task and running the executor.
   * @private
   */
  async _handleSendMessage(id, params, stream) {
    const message = params?.message;
    if (!message || !Array.isArray(message.parts)) {
      return this._jsonError(id, -32602, "Invalid message");
    }
    const text = message.parts
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .join("");
    const taskId = `task-${uuid()}`;
    this.tasks[taskId] = {
      id: taskId,
      status: A2A_STATUS.SUBMITTED,
      message,
      artifacts: [],
      history: [],
    };

    // submitted + working events
    const workingEvent = this._statusEvent(taskId, A2A_STATUS.WORKING);

    if (stream) {
      const body = this._streamTask(taskId, text, workingEvent);
      return {
        status: 200,
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
        body,
      };
    }

    // Non-streaming: run synchronously and return the completed task.
    try {
      const output = await this._runExecutor(taskId, text);
      this.tasks[taskId].artifacts = [{ parts: [{ text: output, mediaType: "text/plain" }] }];
      this.tasks[taskId].status = A2A_STATUS.COMPLETED;
      return this._jsonOk(id, { event: this._taskEvent(this.tasks[taskId]) });
    } catch (error) {
      this.tasks[taskId].status = A2A_STATUS.FAILED;
      return this._jsonOk(id, { event: this._taskEvent(this.tasks[taskId]) });
    }
  }

  /**
   * Build an SSE ReadableStream that runs the executor and streams updates.
   * @private
   */
  _streamTask(taskId, text, workingEvent) {
    const encoder = new TextEncoder();
    const server = this;
    return new ReadableStream({
      async start(controller) {
        const emit = (eventObj) => {
          const data = JSON.stringify({ jsonrpc: "2.0", result: { event: eventObj } });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        };
        emit(workingEvent);
        try {
          const output = await server._runExecutor(taskId, text, (chunk) => {
            if (!chunk) return;
            emit({
              id: taskId,
              status: A2A_STATUS.WORKING,
              artifacts: [
                { parts: [{ text: chunk, mediaType: "text/plain" }] },
              ],
            });
          });
          server.tasks[taskId].artifacts = [
            { parts: [{ text: output, mediaType: "text/plain" }] },
          ];
          server.tasks[taskId].status = A2A_STATUS.COMPLETED;
          emit(server._taskEvent(server.tasks[taskId]));
        } catch (error) {
          server.tasks[taskId].status = A2A_STATUS.FAILED;
          emit(server._taskEvent(server.tasks[taskId]));
        } finally {
          controller.close();
        }
      },
    });
  }

  /**
   * Run the executor and capture chunks.
   * @private
   */
  async _runExecutor(taskId, text, onChunk) {
    return this.executor({
      text,
      taskId,
      onChunk: onChunk || (() => {}),
    });
  }

  /**
   * Handle GetTask.
   * @private
   */
  _handleGetTask(id, params) {
    const task = this.tasks[params?.id];
    if (!task) return this._jsonError(id, -32602, `Task not found: ${params?.id}`);
    return this._jsonOk(id, { task: this._taskEvent(task) });
  }

  /**
   * Handle CancelTask.
   * @private
   */
  _handleCancelTask(id, params) {
    const task = this.tasks[params?.id];
    if (!task) return this._jsonError(id, -32602, `Task not found: ${params?.id}`);
    task.status = A2A_STATUS.CANCELED;
    this._onCancel?.(params.id);
    return this._jsonOk(id, { task: this._taskEvent(task) });
  }

  /**
   * Set a cancellation callback (e.g. to abort the underlying executor).
   * @param {Function} fn
   */
  onCancel(fn) {
    this._onCancel = fn;
  }

  /**
   * Build the A2A task event object (status + artifacts + message).
   * @private
   */
  _taskEvent(task) {
    return {
      id: task.id,
      status: task.status,
      message: task.message,
      artifacts: task.artifacts || [],
    };
  }

  /**
   * Build a minimal status event.
   * @private
   */
  _statusEvent(taskId, status) {
    return { id: taskId, status };
  }

  /**
   * Build a JSON-RPC success response.
   * @private
   */
  _jsonOk(id, result) {
    return {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }),
    };
  }

  /**
   * Build a JSON-RPC error response.
   * @private
   */
  _jsonError(id, code, message) {
    return {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: id ?? null,
        error: { code, message },
      }),
    };
  }
}
