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
 */

/** Connection timeout in milliseconds */
const CONNECT_TIMEOUT_MS = 30_000;

/** Polling interval for workflow status (ms) */
const WORKFLOW_POLL_INTERVAL_MS = 1_000;

/** Event stream reconnect delay (ms) */
const EVENT_STREAM_RECONNECT_DELAY_MS = 3_000;

/**
 * Draymond Orchestrator Client
 * Manages connection to orchestrator, agent discovery, and workflow coordination
 */
export class DraymondOrchestratorClient {
  constructor(host, port, token) {
    this.host = host;
    this.port = port;
    this.token = token;
    this.baseUrl = `http://${host}:${port}`;

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
      this._connectEventStream();

      this._setStatus("connected");
      this.reconnectAttempts = 0;

      return agents;
    } catch (error) {
      console.error("Failed to connect to Draymond Orchestrator:", error);
      this._setStatus("error");
      throw error;
    }
  }

  /**
   * Disconnect from orchestrator
   */
  disconnect() {
    this._setStatus("disconnecting");

    // Close event stream
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Clear active workflows
    this.activeWorkflows = {};

    this._setStatus("disconnected");
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

    const combinedSignal = signal
      ? AbortSignal.any
        ? AbortSignal.any([signal, timeoutController.signal])
        : (() => {
            const merged = new AbortController();
            signal.addEventListener("abort", () => merged.abort());
            timeoutController.signal.addEventListener("abort", () =>
              merged.abort()
            );
            return merged.signal;
          })()
      : timeoutController.signal;

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

    // Start polling workflow status in background
    this._pollWorkflowStatus(workflowId, onPhaseUpdate, onToolExecution);

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
        console.warn("Failed to parse SSE data:", e);
      }

      return false;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
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
        this.activeWorkflows[workflowId].status = "cancelled";
      }
    } catch (error) {
      console.warn("Failed to cancel workflow:", error);
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
      console.warn("Failed to discover agents:", error);
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

    const url = `${this.baseUrl}/v1/events${
      this.token ? `?token=${encodeURIComponent(this.token)}` : ""
    }`;

    try {
      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => {
        console.log("Event stream connected");
        this.reconnectAttempts = 0;
      };

      this.eventSource.onerror = () => {
        console.warn("Event stream error");
        this.eventSource?.close();
        this.eventSource = null;

        // Reconnect with backoff
        if (
          this.status === "connected" &&
          this.reconnectAttempts < this.maxReconnectAttempts
        ) {
          this.reconnectAttempts++;
          setTimeout(() => {
            if (this.status === "connected") {
              this._connectEventStream();
            }
          }, EVENT_STREAM_RECONNECT_DELAY_MS * this.reconnectAttempts);
        }
      };

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleEvent(data);
        } catch (e) {
          console.warn("Failed to parse event:", e);
        }
      };
    } catch (error) {
      console.warn("Failed to connect event stream:", error);
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
  _pollWorkflowStatus(workflowId, onPhaseUpdate, onToolExecution) {
    const poll = async () => {
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

        // Continue polling if still active
        if (status.status === "in_progress") {
          setTimeout(poll, WORKFLOW_POLL_INTERVAL_MS);
        }
      }
    };

    // Start polling after initial delay
    setTimeout(poll, WORKFLOW_POLL_INTERVAL_MS);
  }

  /**
   * Set status and notify callback
   * @private
   */
  _setStatus(status) {
    this.status = status;
    this.onStatusChange?.(status);
  }
}
