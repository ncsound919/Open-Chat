import { uuid } from "../utils/helpers.js";

/**
 * OpenClaw WebSocket client
 * Handles connection, authentication, and message streaming
 */
export class OpenClawClient {
  constructor(host, port, token) {
    this.url = `ws://${host}:${port}`;
    this.token = token;
    this.ws = null;
    this.pendingReqs = new Map(); // id → {resolve, reject, onChunk, runId}
    this.onStatusChange = null;
    this._destroyed = false;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this.deviceToken = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this._destroyed) {
        return reject(new Error("Client destroyed"));
      }

      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this._reconnectAttempts = 0; // Reset on successful connection

        // Send handshake
        const connectReq = {
          type: "req",
          id: uuid(),
          method: "connect",
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            role: "operator",
            scopes: ["chat"],
            client: {
              id: "openchat",
              version: "1.0.0",
              platform: "web",
              mode: "operator",
            },
            ...(this.token ? { auth: { token: this.token } } : {}),
          },
        };

        this.ws.send(JSON.stringify(connectReq));
      };

      this.ws.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }

        // Hello-ok → connected
        if (msg.type === "res" && msg.payload?.type === "hello-ok") {
          if (msg.payload.auth?.deviceToken) {
            this.deviceToken = msg.payload.auth.deviceToken;
          }
          this.onStatusChange?.("connected");
          resolve();
          return;
        }

        // Error on connect
        if (msg.type === "res" && msg.error) {
          this.onStatusChange?.("error");
          reject(new Error(msg.error?.message || "Connection failed"));
          return;
        }

        // Streaming agent event (delta)
        if (msg.type === "event" && msg.event === "agent") {
          const delta = msg.payload?.delta ?? msg.payload?.text ?? "";
          const runId = msg.payload?.runId;

          // Find pending request by runId
          for (const [, req] of this.pendingReqs) {
            if (req.runId === runId || !req.runId) {
              req.runId = runId;
              req.onChunk?.(delta);
              break;
            }
          }
          return;
        }

        // Final agent response
        if (msg.type === "res" && msg.method === "agent") {
          const reqEntry = this.pendingReqs.get(msg.id);
          if (reqEntry) {
            this.pendingReqs.delete(msg.id);
            reqEntry.resolve(msg.payload?.summary || "");
          }
          return;
        }

        // Chat.send ack
        if (msg.type === "res" && msg.method === "chat.send") {
          const reqEntry = this.pendingReqs.get(msg.id);
          if (reqEntry) {
            reqEntry.runId = msg.payload?.runId;
          }
        }
      };

      this.ws.onclose = () => {
        this.onStatusChange?.("disconnected");

        // Auto-reconnect with exponential backoff
        if (!this._destroyed) {
          const delay = Math.min(5000 * Math.pow(1.5, this._reconnectAttempts), 30000);
          this._reconnectAttempts++;

          this._reconnectTimer = setTimeout(() => {
            if (!this._destroyed) {
              this.onStatusChange?.("connecting");
              this.connect().catch(() => {
                // Will retry again via onclose
              });
            }
          }, delay);
        }
      };

      this.ws.onerror = () => {
        this.onStatusChange?.("error");
        reject(new Error("WebSocket error"));
      };
    });
  }

  send(text, onChunk) {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        reject(new Error("Not connected - check Settings"));
        return;
      }

      const id = uuid();
      this.pendingReqs.set(id, { resolve, reject, onChunk, runId: null });

      this.ws.send(
        JSON.stringify({
          type: "req",
          id,
          method: "chat.send",
          params: { text, idempotencyKey: uuid() },
        })
      );
    });
  }

  disconnect() {
    this._destroyed = true;
    clearTimeout(this._reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.pendingReqs.clear();
  }
}
