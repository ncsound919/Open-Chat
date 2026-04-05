import React, { useState, useRef, useEffect, useCallback } from "react";
import { Inbox } from "./components/Inbox.jsx";
import { Chat } from "./components/Chat.jsx";
import { Settings } from "./components/Settings.jsx";
import { OpenClawClient } from "./protocols/OpenClawClient.js";
import { hermesStream, hermesHealthCheck } from "./protocols/HermesClient.js";
import { UpliftBridgeClient } from "./protocols/UpliftBridgeClient.js";
import { subTeamStream, subTeamHealthCheck } from "./protocols/SubTeamClient.js";
import { DraymondOrchestratorClient } from "./protocols/DraymondOrchestratorClient.js";
import {
  loadHist,
  saveHist,
  loadBots,
  saveBots,
  loadWorkflows,
  saveWorkflows,
  loadAgentRegistry,
  saveAgentRegistry,
  loadToolLog,
  saveToolLog,
  loadMode,
  saveMode,
} from "./utils/storage.js";
import { uuid, ts, markAllSeen } from "./utils/helpers.js";

/**
 * Main App component
 * Manages state and orchestrates all sub-components
 */
export default function App() {
  // Core state
  const [bots, setBots] = useState(loadBots);
  const [history, setHistory] = useState(loadHist);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [statuses, setStatuses] = useState({});
  const [search, setSearch] = useState("");

  // Orchestrator state
  const [workflows, setWorkflows] = useState(loadWorkflows);
  const [agentRegistry, setAgentRegistry] = useState(loadAgentRegistry);
  const [toolLog, setToolLog] = useState(loadToolLog);

  // UI state
  const [showCfg, setShowCfg] = useState(false);
  const [cfgBot, setCfgBot] = useState(null);
  const [isNewBot, setIsNewBot] = useState(false);
  const [mode, setMode] = useState(loadMode);

  // Refs
  const clawRefs = useRef({}); // botId → OpenClawClient | UpliftBridgeClient
  const orchestratorRefs = useRef({}); // botId → DraymondOrchestratorClient
  const abortRef = useRef(null); // Hermes AbortController
  const streamBuf = useRef("");

  const bot = bots.find((b) => b.id === activeId);
  const messages = history[activeId] || [];

  // ── Persist state to localStorage ──────────────────────────────────────────
  useEffect(() => {
    saveHist(history);
  }, [history]);

  useEffect(() => {
    saveBots(bots);
  }, [bots]);

  useEffect(() => {
    saveWorkflows(workflows);
  }, [workflows]);

  useEffect(() => {
    saveAgentRegistry(agentRegistry);
  }, [agentRegistry]);

  useEffect(() => {
    saveToolLog(toolLog);
  }, [toolLog]);

  useEffect(() => {
    saveMode(mode);
  }, [mode]);

  // ── Status management ───────────────────────────────────────────────────────
  const setStatus = useCallback((id, status) => {
    setStatuses((prev) => ({ ...prev, [id]: status }));
  }, []);

  // ── OpenClaw connection ─────────────────────────────────────────────────────
  const connectClaw = useCallback(
    async (bot) => {
      // Disconnect existing client
      if (clawRefs.current[bot.id]) {
        clawRefs.current[bot.id].disconnect();
        delete clawRefs.current[bot.id];
      }

      const client = new OpenClawClient(bot.host, bot.port, bot.token);
      client.onStatusChange = (status) => setStatus(bot.id, status);
      clawRefs.current[bot.id] = client;

      setStatus(bot.id, "connecting");
      try {
        await client.connect();
      } catch (e) {
        console.error(`Failed to connect to ${bot.name}:`, e);
        setStatus(bot.id, "error");
      }
    },
    [setStatus]
  );

  // ── Uplift Bridge connection ────────────────────────────────────────────────
  const connectUpliftBridge = useCallback(
    async (bot) => {
      // Disconnect existing client
      if (clawRefs.current[bot.id]) {
        clawRefs.current[bot.id].disconnect();
        delete clawRefs.current[bot.id];
      }

      const client = new UpliftBridgeClient(bot.host, bot.port, bot.token);
      client.onStatusChange = (status) => setStatus(bot.id, status);
      clawRefs.current[bot.id] = client;

      setStatus(bot.id, "connecting");
      try {
        await client.connect();
      } catch (e) {
        console.error(`Failed to connect to ${bot.name}:`, e);
        setStatus(bot.id, "error");
      }
    },
    [setStatus]
  );

  // ── Draymond Orchestrator connection ────────────────────────────────────────
  const connectDraymond = useCallback(
    async (bot) => {
      // Disconnect existing client
      if (orchestratorRefs.current[bot.id]) {
        orchestratorRefs.current[bot.id].disconnect();
        delete orchestratorRefs.current[bot.id];
      }

      const client = new DraymondOrchestratorClient(
        bot.host,
        bot.port,
        bot.token
      );

      // Set up callbacks
      client.onStatusChange = (status) => setStatus(bot.id, status);
      client.onWorkflowUpdate = (workflow) => {
        setWorkflows((prev) => ({ ...prev, [workflow.id]: workflow }));
      };
      client.onAgentDiscovered = (agent) => {
        setAgentRegistry((prev) => ({ ...prev, [agent.id]: agent }));
      };
      client.onToolExecution = (execution) => {
        setToolLog((prev) => [...prev, execution].slice(-1000));
      };

      orchestratorRefs.current[bot.id] = client;

      setStatus(bot.id, "connecting");
      try {
        await client.connect();
      } catch (e) {
        console.error(`Failed to connect to ${bot.name}:`, e);
        setStatus(bot.id, "error");
      }
    },
    [setStatus]
  );

  // ── Auto-connect bots on mount and when bots list changes ──────────────────
  useEffect(() => {
    // Connect OpenClaw bots
    bots
      .filter((b) => b.protocol === "openclaw")
      .forEach((b) => {
        if (!clawRefs.current[b.id]) {
          connectClaw(b);
        }
      });

    // Connect Uplift Bridge bots
    bots
      .filter((b) => b.protocol === "uplift-bridge")
      .forEach((b) => {
        if (!clawRefs.current[b.id]) {
          connectUpliftBridge(b);
        }
      });

    // Health check Hermes bots
    bots
      .filter((b) => b.protocol === "hermes")
      .forEach((b) => {
        setStatus(b.id, "connecting");
        hermesHealthCheck(b.host, b.port, b.token)
          .then((ok) => setStatus(b.id, ok ? "connected" : "error"))
          .catch(() => setStatus(b.id, "disconnected"));
      });

    // Health check SubTeam bots
    bots
      .filter((b) => b.protocol === "subteam")
      .forEach((b) => {
        setStatus(b.id, "connecting");
        subTeamHealthCheck(b.host, b.port, b.token)
          .then((ok) => setStatus(b.id, ok ? "connected" : "error"))
          .catch(() => setStatus(b.id, "disconnected"));
      });

    // Connect Draymond Orchestrator bots
    bots
      .filter((b) => b.protocol === "draymond")
      .forEach((b) => {
        if (!orchestratorRefs.current[b.id]) {
          connectDraymond(b);
        }
      });
  }, [bots, connectClaw, connectUpliftBridge, connectDraymond, setStatus]);

  // ── Disconnect all clients on unmount ───────────────────────────────────────
  useEffect(() => {
    return () => {
      // Empty deps [] is intentional — this cleanup runs only when the component
      // unmounts. clawRefs.current is read at that point to reach every client
      // registered during the component's lifetime, including those added after mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      Object.values(clawRefs.current).forEach((client) => client.disconnect());
      // eslint-disable-next-line react-hooks/exhaustive-deps
      Object.values(orchestratorRefs.current).forEach((client) =>
        client.disconnect()
      );
    };
  }, []);

  // ── Message management ──────────────────────────────────────────────────────
  function addMessage(botId, msg) {
    setHistory((prev) => ({
      ...prev,
      [botId]: [...(prev[botId] || []), msg],
    }));
  }

  function updateLastMessage(botId, patch) {
    setHistory((prev) => {
      const msgs = [...(prev[botId] || [])];
      if (!msgs.length) return prev;
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], ...patch };
      return { ...prev, [botId]: msgs };
    });
  }

  function deleteMessage(botId, msgId) {
    setHistory((prev) => ({
      ...prev,
      [botId]: (prev[botId] || []).filter((m) => m.id !== msgId),
    }));
  }

  function clearChat(botId) {
    setHistory((prev) => ({ ...prev, [botId]: [] }));
  }

  // ── Send message ────────────────────────────────────────────────────────────
  async function sendMessage() {
    const text = input.trim();
    if (!text || !bot || streaming) return;

    setInput("");
    setStreaming(true);
    streamBuf.current = "";

    // Add user message
    const userMsg = { id: uuid(), role: "user", text, time: ts(), read: false };
    addMessage(bot.id, userMsg);

    // Add placeholder bot message
    const botMsgId = uuid();
    addMessage(bot.id, {
      id: botMsgId,
      role: "bot",
      text: "",
      time: ts(),
      streaming: true,
    });

    try {
      if (bot.protocol === "openclaw") {
        // OpenClaw WebSocket
        const client = clawRefs.current[bot.id];
        if (!client || client.ws?.readyState !== WebSocket.OPEN) {
          throw new Error("Not connected — check Settings");
        }

        const finalText = await client.send(text, (delta) => {
          streamBuf.current += delta;
          updateLastMessage(bot.id, {
            text: streamBuf.current,
            streaming: true,
          });
        });

        updateLastMessage(bot.id, {
          text: streamBuf.current || finalText || "✓",
          streaming: false,
        });

        // Mark user message as read
        setHistory((prev) => ({
          ...prev,
          [bot.id]: (prev[bot.id] || []).map((m) =>
            m.id === userMsg.id ? { ...m, read: true } : m
          ),
        }));
      } else if (bot.protocol === "hermes") {
        // Hermes HTTP/SSE
        abortRef.current = new AbortController();

        const prior = (history[bot.id] || [])
          .filter((m) => m.role === "user" || (m.role === "bot" && !m.streaming))
          .slice(-20)
          .map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.text,
          }));
        prior.push({ role: "user", content: text });

        await hermesStream(
          bot.host,
          bot.port,
          bot.token,
          prior,
          (delta) => {
            streamBuf.current += delta;
            updateLastMessage(bot.id, {
              text: streamBuf.current,
              streaming: true,
            });
          },
          abortRef.current.signal
        );

        updateLastMessage(bot.id, {
          text: streamBuf.current,
          streaming: false,
        });

        // Mark user message as read
        setHistory((prev) => ({
          ...prev,
          [bot.id]: (prev[bot.id] || []).map((m) =>
            m.id === userMsg.id ? { ...m, read: true } : m
          ),
        }));
      } else if (bot.protocol === "uplift-bridge") {
        // Uplift Bridge
        const client = clawRefs.current[bot.id];
        if (!client || !client.sessionId) {
          throw new Error("Not connected — check Settings");
        }

        abortRef.current = new AbortController();

        const finalText = await client.send(
          text,
          (delta) => {
            streamBuf.current += delta;
            updateLastMessage(bot.id, {
              text: streamBuf.current,
              streaming: true,
            });
          },
          abortRef.current.signal
        );

        updateLastMessage(bot.id, {
          text: streamBuf.current || finalText || "✓",
          streaming: false,
        });

        // Mark user message as read
        setHistory((prev) => ({
          ...prev,
          [bot.id]: (prev[bot.id] || []).map((m) =>
            m.id === userMsg.id ? { ...m, read: true } : m
          ),
        }));
      } else if (bot.protocol === "subteam") {
        // SubTeam HTTP/SSE
        abortRef.current = new AbortController();

        const prior = (history[bot.id] || [])
          .filter((m) => m.role === "user" || (m.role === "bot" && !m.streaming))
          .slice(-20)
          .map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.text,
          }));
        prior.push({ role: "user", content: text });

        await subTeamStream(
          bot.host,
          bot.port,
          bot.token,
          prior,
          (delta) => {
            streamBuf.current += delta;
            updateLastMessage(bot.id, {
              text: streamBuf.current,
              streaming: true,
            });
          },
          abortRef.current.signal
        );

        updateLastMessage(bot.id, {
          text: streamBuf.current,
          streaming: false,
        });

        // Mark user message as read
        setHistory((prev) => ({
          ...prev,
          [bot.id]: (prev[bot.id] || []).map((m) =>
            m.id === userMsg.id ? { ...m, read: true } : m
          ),
        }));
      } else if (bot.protocol === "draymond") {
        // Draymond Orchestrator
        const client = orchestratorRefs.current[bot.id];
        if (!client || client.status !== "connected") {
          throw new Error("Orchestrator not connected — check Settings");
        }

        abortRef.current = new AbortController();

        const workflowId = uuid();
        const result = await client.orchestrate(
          {
            workflowId,
            task: text,
            onPhaseUpdate: (phase) => {
              // Update message with current phase info
              updateLastMessage(bot.id, {
                text: streamBuf.current,
                streaming: true,
                workflowId,
                currentPhase: phase,
              });
            },
            onToolExecution: () => {
              // Tool executions are handled elsewhere; avoid logging raw payloads here.
            },
            onChunk: (delta) => {
              streamBuf.current += delta;
              updateLastMessage(bot.id, {
                text: streamBuf.current,
                streaming: true,
                workflowId,
              });
            },
          },
          abortRef.current.signal
        );

        updateLastMessage(bot.id, {
          text: streamBuf.current || result.text || "✓",
          streaming: false,
          workflowId,
        });

        // Mark user message as read
        setHistory((prev) => ({
          ...prev,
          [bot.id]: (prev[bot.id] || []).map((m) =>
            m.id === userMsg.id ? { ...m, read: true } : m
          ),
        }));
      }
    } catch (e) {
      const errText =
        e.name === "AbortError" ? "[interrupted]" : `⚠ ${e.message}`;
      updateLastMessage(bot.id, {
        text: errText,
        streaming: false,
        error: true,
      });
    } finally {
      setStreaming(false);
    }
  }

  function interruptMessage() {
    // Only OpenClaw streaming uses a separate transport and can't be aborted
    // via AbortController; all other protocols (hermes, uplift-bridge, subteam)
    // use abortRef.
    if (!bot || bot.protocol === "openclaw") return;
    abortRef.current?.abort();
    setStreaming(false);
  }

  // ── Open chat ───────────────────────────────────────────────────────────────
  function openChat(id) {
    setActiveId(id);
    setHistory((prev) => markAllSeen(prev, id));
  }

  // ── Bot management ──────────────────────────────────────────────────────────
  function addBot() {
    const newBot = {
      id: uuid(),
      name: "",
      avatar: "🤖",
      color: "#818cf8",
      tagline: "Custom agent",
      protocol: "hermes",
      host: "127.0.0.1",
      port: 8642,
      token: "",
    };
    setCfgBot(newBot);
    setIsNewBot(true);
    setShowCfg(true);
  }

  function saveBot(updated) {
    if (isNewBot) {
      // Add new bot
      setBots((prev) => [...prev, updated]);
      setIsNewBot(false);
    } else {
      // Update existing bot
      setBots((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    }

    // Reconnect if needed
    if (updated.protocol === "openclaw") {
      connectClaw(updated);
    } else if (updated.protocol === "uplift-bridge") {
      connectUpliftBridge(updated);
    } else if (updated.protocol === "subteam") {
      setStatus(updated.id, "connecting");
      subTeamHealthCheck(updated.host, updated.port, updated.token)
        .then((ok) => setStatus(updated.id, ok ? "connected" : "error"))
        .catch(() => setStatus(updated.id, "disconnected"));
    } else {
      setStatus(updated.id, "connecting");
      hermesHealthCheck(updated.host, updated.port, updated.token)
        .then((ok) => setStatus(updated.id, ok ? "connected" : "error"))
        .catch(() => setStatus(updated.id, "disconnected"));
    }

    setCfgBot(null);
    setShowCfg(false);
  }

  function deleteBot(botId) {
    if (!confirm("Delete this bot and all its messages?")) return;

    // Disconnect if OpenClaw
    if (clawRefs.current[botId]) {
      clawRefs.current[botId].disconnect();
      delete clawRefs.current[botId];
    }

    // Remove bot and its history
    setBots((prev) => prev.filter((b) => b.id !== botId));
    setHistory((prev) => {
      const next = { ...prev };
      delete next[botId];
      return next;
    });

    setCfgBot(null);
    setShowCfg(false);
    if (activeId === botId) setActiveId(null);
  }

  function openSettings(botToEdit) {
    setCfgBot(botToEdit || bot);
    setIsNewBot(false);
    setShowCfg(true);
    setActiveId(null);
  }

  function toggleMode() {
    setMode((prev) => (prev === "basic" ? "dev" : "basic"));
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        maxWidth: 430,
        height: "100vh",
        margin: "0 auto",
        position: "relative",
        overflow: "hidden",
        boxShadow: "0 0 80px #00000080",
      }}
    >
      {/* Inbox */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: activeId || showCfg ? "translateX(-100%)" : "translateX(0)",
          transition: "transform .28s cubic-bezier(.4,0,.2,1)",
        }}
      >
        <Inbox
          bots={bots}
          history={history}
          statuses={statuses}
          search={search}
          onSearch={setSearch}
          onOpenChat={openChat}
          onOpenSettings={openSettings}
          onAddBot={addBot}
          mode={mode}
          onToggleMode={toggleMode}
        />
      </div>

      {/* Chat */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform:
            activeId && !showCfg ? "translateX(0)" : "translateX(100%)",
          transition: "transform .28s cubic-bezier(.4,0,.2,1)",
        }}
      >
        {bot && !showCfg && (
          <Chat
            bot={bot}
            messages={messages}
            status={statuses[bot.id] || "disconnected"}
            input={input}
            streaming={streaming}
            onInputChange={setInput}
            onSend={sendMessage}
            onInterrupt={interruptMessage}
            onBack={() => setActiveId(null)}
            onOpenSettings={() => openSettings(bot)}
            onDeleteMessage={(msgId) => deleteMessage(bot.id, msgId)}
            onClearChat={() => clearChat(bot.id)}
          />
        )}
      </div>

      {/* Settings */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: showCfg ? "translateX(0)" : "translateX(100%)",
          transition: "transform .28s cubic-bezier(.4,0,.2,1)",
        }}
      >
        {showCfg && cfgBot && (
          <Settings
            bot={cfgBot}
            isNew={isNewBot}
            onSave={saveBot}
            onDelete={() => deleteBot(cfgBot.id)}
            onBack={() => {
              setCfgBot(null);
              setShowCfg(false);
            }}
            mode={mode}
          />
        )}
      </div>
    </div>
  );
}
