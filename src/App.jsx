import React, { useState, useRef, useEffect, useCallback } from "react";
import { Inbox } from "./components/Inbox.jsx";
import { AgentsScreen } from "./components/AgentsScreen.jsx";
import { ModelsScreen } from "./components/ModelsScreen.jsx";
import { WorkScreen } from "./components/WorkScreen.jsx";
import { HomeScreen } from "./components/HomeScreen.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { Chat } from "./components/Chat.jsx";
import { SearchResults } from "./components/SearchResults.jsx";
import { Settings } from "./components/Settings.jsx";
import { AuditLog } from "./components/AuditLog.jsx";
import { ToolExecutionConsole } from "./components/ToolExecutionConsole.jsx";
import { DeveloperPanel } from "./components/DeveloperPanel.jsx";
import { TeamPanel } from "./components/TeamPanel.jsx";
import { AutomationScheduler } from "./components/AutomationScheduler.jsx";
import { OpenClawClient } from "./protocols/OpenClawClient.js";
import { hermesStream, hermesHealthCheck } from "./protocols/HermesClient.js";
import { UpliftBridgeClient } from "./protocols/UpliftBridgeClient.js";
import { subTeamStream, subTeamHealthCheck } from "./protocols/SubTeamClient.js";
import { DraymondOrchestratorClient } from "./protocols/DraymondOrchestratorClient.js";
import { LocalModelClient } from "./protocols/LocalModelClient.js";
import { NtfyClient } from "./protocols/NtfyClient.js";
import { syncMessagesToDraymond, lastLocalExchange } from "./utils/draymondSync.js";
import { syncBenchmarksViaDraymond } from "./utils/benchmarks.js";
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
  loadTeams,
  saveTeams,
  loadSchedules,
  saveSchedules,
  searchMessages,
} from "./utils/storage.js";
import { uuid, ts, markAllSeen } from "./utils/helpers.js";
import { isNative } from "./utils/platform.js";
import { notifyLocal, requestNotificationPermission } from "./utils/notifications.js";
import { useVoice } from "./hooks/useVoice.js";

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
  const [searchMode, setSearchMode] = useState("bots");

  const searchResults =
    searchMode === "messages" ? searchMessages(history, search) : [];

  // Orchestrator state
  const [workflows, setWorkflows] = useState(loadWorkflows);
  const [agentRegistry, setAgentRegistry] = useState(loadAgentRegistry);
  const [toolLog, setToolLog] = useState(loadToolLog);

  // UI state
  const [showCfg, setShowCfg] = useState(false);
  const [cfgBot, setCfgBot] = useState(null);
  const [isNewBot, setIsNewBot] = useState(false);
  const [mode, setMode] = useState(loadMode);
  const [screen, setScreen] = useState(() => {
    try {
      return localStorage.getItem("openchat_screen_v1") || "home";
    } catch {
      return "home";
    }
  }); // home | chats | agents | models | work
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Remember the last visited screen across launches.
  useEffect(() => {
    try {
      localStorage.setItem("openchat_screen_v1", screen);
    } catch {
      /* ignore */
    }
  }, [screen]);

  // Phase 4 & 5 state
  const [teams, setTeams] = useState(loadTeams);
  const [schedules, setSchedules] = useState(loadSchedules);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showToolConsole, setShowToolConsole] = useState(false);
  const [showDevPanel, setShowDevPanel] = useState(false);
  const [showTeamPanel, setShowTeamPanel] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);

  // Draymond real-time state (populated from SSE callbacks)
  const [draymondNotifications, setDraymondNotifications] = useState([]);
  const [draymondChains, setDraymondChains] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  // Worker screen state (queued Draymond tasks + local skill cache)
  const [workerTasks] = useState([]);
  const [localSkillKeys] = useState([]);

  // Refs
  const clawRefs = useRef({}); // botId â†’ OpenClawClient | UpliftBridgeClient
  const orchestratorRefs = useRef({}); // botId â†’ DraymondOrchestratorClient
  const ntfyRefs = useRef({}); // botId â†’ NtfyClient
  const localRefs = useRef({}); // botId â†’ LocalModelClient
  const seenNtfyIds = useRef(new Set()); // ntfy message ids already rendered
  const abortRef = useRef(null); // Hermes AbortController
  const streamBuf = useRef("");
  const streamMsgIdRef = useRef(null); // id of the streaming placeholder message

  const bot = bots.find((b) => b.id === activeId);
  const messages = history[activeId] || [];

  // Voice: push-to-talk + auto-speak for the active bot.
  const lastBotMessage = (messages || [])
    .filter((m) => m.role === "bot")
    .slice(-1)[0];
  const lastBotText = lastBotMessage?.text || "";
  const lastBotStreaming = lastBotMessage?.streaming === true;
  const {
    micActive,
    speakEnabled,
    micError,
    setSpeakEnabled,
    startListening,
    stopAndTranscribe,
    cancelListening,
  } = useVoice(
    bot
      ? {
          host: bot.host,
          port: bot.port,
          token: bot.token,
          voiceBackend: bot.voiceBackend,
          voiceEnabled: bot.voiceEnabled,
          aetherdeskApiKey: bot.aetherdeskApiKey,
          aetherdeskBaseUrl: bot.aetherdeskBaseUrl,
          lastMessageText: lastBotText,
          lastMessageStreaming: lastBotStreaming,
        }
      : null
  );

  // â”€â”€ Persist state to localStorage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  useEffect(() => {
    saveTeams(teams);
  }, [teams]);

  useEffect(() => {
    saveSchedules(schedules);
  }, [schedules]);

  // â”€â”€ Status management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const setStatus = useCallback((id, status) => {
    setStatuses((prev) => ({ ...prev, [id]: status }));
  }, []);

  // â”€â”€ OpenClaw connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Uplift Bridge connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const connectUpliftBridge = useCallback(
    async (bot) => {
      // Disconnect existing client
      if (clawRefs.current[bot.id]) {
        clawRefs.current[bot.id].disconnect();
        delete clawRefs.current[bot.id];
      }

      const client = new UpliftBridgeClient(bot.host, bot.port, bot.token);
      client.onStatusChange = (status) => setStatus(bot.id, status);
      client.onInboundMessage = (m) => {
        addMessage(bot.id, {
          id: uuid(),
          role: "bot",
          text: m.content || "",
          time: ts(),
        });
      };
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

  // â”€â”€ Draymond Orchestrator connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        // Auto-populate a pinned chat bot per discovered fleet agent so every
        // agent is reachable from the Chats list. Skips the orchestrator's own
        // "openchat"/"draymond" records and anything already represented.
        const agentId = agent.id ?? agent.slug;
        if (!agentId) return;
        const systemIds = new Set(["openchat", "draymond", "draymond-orchestrator", "open-chat"]);
        if (systemIds.has(String(agentId).toLowerCase())) return;
        setBots((prev) => {
          const exists = prev.some((b) => b.agentRef === agentId);
          if (exists) {
            return prev.map((b) =>
              b.agentRef === agentId
                ? {
                    ...b,
                    tagline: `Agent Â· ${agent.status ?? "unknown"}`,
                    avatarUrl: agent.avatarUrl || b.avatarUrl || `/avatars/${agentId}.png`,
                    avatar: "",
                  }
                : b
            );
          }
          const shell = {
            id: `agent-${agentId}`,
            name: agent.name ?? agentId,
            avatar: "",
            avatarUrl: agent.avatarUrl || `/avatars/${agentId}.png`,
            color: "#22d3ee",
            tagline: `Agent Â· ${agent.status ?? "unknown"}`,
            protocol: "draymond",
            host: bot.host,
            port: bot.port,
            token: bot.token,
            agentRef: agentId,
            autoPopulated: true,
            manualConnect: true, // don't stream events until opened
            pinned: true,
          };
          return [...prev, shell];
        });
      };
      client.onToolExecution = (execution) => {
        setToolLog((prev) => [...prev, execution].slice(-1000));
      };
      client.onNotification = (notification) => {
        setDraymondNotifications((prev) =>
          [...prev, { ...notification, receivedAt: Date.now() }].slice(-200)
        );
        setUnreadNotifications((prev) => prev + 1);
      };
      client.onChainUpdate = (chainEvent) => {
        setDraymondChains((prev) => {
          const idx = prev.findIndex((c) => c.chain_instance_id === chainEvent.chain_instance_id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], ...chainEvent };
            return updated;
          }
          return [...prev, chainEvent].slice(-100);
        });
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

  // â”€â”€ ntfy subscription connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const connectNtfy = useCallback(
    async (bot) => {
      // Disconnect existing client
      if (ntfyRefs.current[bot.id]) {
        ntfyRefs.current[bot.id].disconnect();
        delete ntfyRefs.current[bot.id];
      }

      const client = new NtfyClient(bot.host, bot.port, bot.token, bot.topic);
      client.onStatusChange = (status) => setStatus(bot.id, status);
      client.onMessage = (parsed) => {
        // Dedupe by ntfy message id (belt-and-suspenders â€” the stream
        // can redeliver on reconnect).
        if (seenNtfyIds.current.has(parsed.id)) return;
        seenNtfyIds.current.add(parsed.id);
        if (seenNtfyIds.current.size > 500) {
          const toDelete = Array.from(seenNtfyIds.current).slice(0, seenNtfyIds.current.size - 500);
          toDelete.forEach((id) => seenNtfyIds.current.delete(id));
        }

        addMessage(bot.id, {
          id: uuid(),
          role: "bot",
          text: [parsed.title, parsed.message].filter(Boolean).join("\n\n"),
          time: ts(),
          ntfyId: parsed.id,
          actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        });

        // Auto-speak Draymond phase recaps (evening recap â†’ spoken on the
        // phone) for bots that have voice-calling enabled. Recaps arrive via
        // ntfy with a "recap" tag from Draymond's communicator.
        const isRecap =
          (Array.isArray(parsed.tags) && parsed.tags.includes("recap")) ||
          /recap/i.test(parsed.title || parsed.message || "");
        if (isRecap && bot.voiceCallEnabled === true && ("speechSynthesis" in window)) {
          const text = [parsed.title, parsed.message].filter(Boolean).join(" â€” ");
          window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(text);
          window.speechSynthesis.speak(u);
        }

        // Fire a native notification so approval requests alert the phone
        // even when the app is backgrounded (ntfy handles web/Electron).
        const hasActions = Array.isArray(parsed.actions) && parsed.actions.length > 0;
        if (hasActions) {
          const title = parsed.title || bot.name || "Approval requested";
          const body = parsed.message || "Tap to review.";
          notifyLocal(title, body).catch(() => {});
        }
      };
      ntfyRefs.current[bot.id] = client;

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

  // â”€â”€ Local on-device chat connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const connectLocal = useCallback(
    async (bot) => {
      if (localRefs.current[bot.id]) {
        localRefs.current[bot.id].disconnect();
        delete localRefs.current[bot.id];
      }

      const client = new LocalModelClient(bot, {
        onToolCall: (call, resultValue) => {
          setToolLog((prev) =>
            [
              ...prev,
              {
                executionId: `local-tool-${Date.now()}`,
                timestamp: Date.now(),
                toolName: call.name,
                parameters: call.args,
                agentId: bot.id,
                status: "completed",
                result: resultValue,
              },
            ].slice(-1000)
          );
        },
      });
      client.onStatusChange = (status) => setStatus(bot.id, status);
      localRefs.current[bot.id] = client;

      setStatus(bot.id, "connecting");
      try {
        await client.connect();
      } catch (e) {
        console.error(`Failed to connect local model for ${bot.name}:`, e);
        setStatus(bot.id, "error");
      }
    },
    [setStatus]
  );

  // â”€â”€ Execute an ntfy action button (e.g. Draymond approve/reject) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleNtfyAction = useCallback(async (botId, action) => {
    const client = ntfyRefs.current[botId];
    if (!client) return { ok: false, error: "ntfy not connected" };
    return client.executeAction(action);
  }, []);

  // â”€â”€ Auto-connect bots on mount and when bots list changes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // Connect ntfy subscription bots
    bots
      .filter((b) => b.protocol === "ntfy")
      .forEach((b) => {
        if (!ntfyRefs.current[b.id]) {
          connectNtfy(b);
        }
      });

    // Connect local on-device chat bots (skips auto-populated agent shells)
    bots
      .filter((b) => b.protocol === "local" && !b.manualConnect)
      .forEach((b) => {
        if (!localRefs.current[b.id]) {
          connectLocal(b);
        }
      });

    // Native notification permission (approval alerts on the phone).
    if (isNative) {
      requestNotificationPermission().catch(() => {});
    }
  }, [bots, connectClaw, connectUpliftBridge, connectDraymond, connectNtfy, connectLocal, setStatus]);

  // â”€â”€ Disconnect all clients on unmount â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    return () => {
      // Empty deps [] is intentional â€” this cleanup runs only when the component
      // unmounts. clawRefs.current is read at that point to reach every client
      // registered during the component's lifetime, including those added after mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      Object.values(clawRefs.current).forEach((client) => client.disconnect());
      // eslint-disable-next-line react-hooks/exhaustive-deps
      Object.values(orchestratorRefs.current).forEach((client) =>
        client.disconnect()
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
      Object.values(ntfyRefs.current).forEach((client) => client.disconnect());
      // eslint-disable-next-line react-hooks/exhaustive-deps
      Object.values(localRefs.current).forEach((client) => client.disconnect());
    };
  }, []);

  // â”€â”€ Android hardware back button â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!isNative) return;

    let cancelled = false;
    let removeListener;
    (async () => {
      try {
        const { App: CapApp } = await import("@capacitor/app");
        const handle = await CapApp.addListener("backButton", () => {
          // Navigate: Settings â†’ Chat/Inbox, Chat â†’ Inbox
          if (showCfg) {
            setCfgBot(null);
            setShowCfg(false);
          } else if (activeId) {
            setActiveId(null);
          }
          // At inbox level â€” do nothing (Capacitor default would minimize)
        });
        removeListener = handle.remove;
        if (cancelled) removeListener();
      } catch {
        // Plugin not available â€” ignore
      }
    })();

    return () => {
      cancelled = true;
      if (removeListener) removeListener();
    };
  }, [showCfg, activeId]);

  // â”€â”€ Network change detection (native) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!isNative) return;

    let removeListener;
    (async () => {
      try {
        const { Network } = await import("@capacitor/network");
        const handle = await Network.addListener("networkStatusChange", (status) => {
          if (status.connected) {
            console.log("[OpenChat] Network restored â€” flushing offline queues");
            // Flush offline queues for all Draymond clients
            Object.values(orchestratorRefs.current).forEach((client) => {
              if (client.flushOfflineQueue) client.flushOfflineQueue();
            });
          }
        });
        removeListener = handle.remove;
      } catch {
        // Plugin not available â€” ignore
      }
    })();

    return () => {
      if (removeListener) removeListener();
    };
  }, []);

  // â”€â”€ Message management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      // Target the streaming placeholder by id when one is in flight; inbound
      // messages appended during streaming must not shift the target.
      const targetId = streamMsgIdRef.current;
      const idx = targetId
        ? msgs.findIndex((m) => m.id === targetId)
        : msgs.length - 1;
      if (idx === -1) return prev;
      msgs[idx] = { ...msgs[idx], ...patch };
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

  // â”€â”€ Send message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    streamMsgIdRef.current = botMsgId;
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
          throw new Error("Not connected â€” check Settings");
        }

        const finalText = await client.send(text, (delta) => {
          streamBuf.current += delta;
          updateLastMessage(bot.id, {
            text: streamBuf.current,
            streaming: true,
          });
        });

        updateLastMessage(bot.id, {
          text: streamBuf.current || finalText || "âœ“",
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
          abortRef.current.signal,
          bot.model
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
          throw new Error("Not connected â€” check Settings");
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
          text: streamBuf.current || finalText || "âœ“",
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
        let client = orchestratorRefs.current[bot.id];
        if (!client && bot.manualConnect) {
          await connectDraymond(bot);
          client = orchestratorRefs.current[bot.id];
        }
        if (!client || client.status !== "connected") {
          throw new Error("Orchestrator not connected â€” check Settings");
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
          text: streamBuf.current || result.text || "âœ“",
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
      } else if (bot.protocol === "ntfy") {
        // ntfy publish â€” forward the message to the subscribed topic
        const client = ntfyRefs.current[bot.id];
        if (!client || client.status !== "connected") {
          throw new Error("ntfy not connected â€” check Settings");
        }

        const ok = await client.publish({
          title: `${bot.name} Â· ${new Date().toLocaleTimeString()}`,
          message: text,
        });

        updateLastMessage(bot.id, {
          text: ok
            ? "âœ“ Published"
            : "âš  Publish failed â€” check ntfy connection",
          streaming: false,
        });

        // Mark user message as read
        setHistory((prev) => ({
          ...prev,
          [bot.id]: (prev[bot.id] || []).map((m) =>
            m.id === userMsg.id ? { ...m, read: true } : m
          ),
        }));
      } else if (bot.protocol === "local") {
        // Private on-device chat (Gemma / Nano / WebLLM) + phone control
        let client = localRefs.current[bot.id];
        if (!client) {
          await connectLocal(bot);
          client = localRefs.current[bot.id];
        }
        if (!client || (client.status !== "connected" && client.status !== "no-model")) {
          throw new Error("Local model not ready â€” check Models");
        }

        abortRef.current = new AbortController();

        // Pass recent context so private chat is multi-turn.
        const prior = (history[bot.id] || [])
          .filter((m) => m.role === "user" || (m.role === "bot" && !m.streaming))
          .slice(-12)
          .map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.text,
          }));
        prior.pop(); // drop the just-added user message; send() re-appends it

        const finalText = await client.send(
          text,
          (delta) => {
            streamBuf.current += delta;
            updateLastMessage(bot.id, {
              text: streamBuf.current,
              streaming: true,
            });
          },
          abortRef.current.signal,
          prior
        );

        updateLastMessage(bot.id, {
          text: streamBuf.current || finalText || "âœ“",
          streaming: false,
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
        e.name === "AbortError" ? "[interrupted]" : `âš  ${e.message}`;
      updateLastMessage(bot.id, {
        text: errText,
        streaming: false,
        error: true,
      });
    } finally {
      streamMsgIdRef.current = null;
      setStreaming(false);
    }
  }

  const handleMicPointerDown = async () => {
    await startListening();
  };

  const handleMicPointerUp = async () => {
    const text = await stopAndTranscribe();
    if (text) {
      setInput(text);
    }
  };

  const handleMicCancel = () => {
    cancelListening();
  };

  function interruptMessage() {
    // Only OpenClaw streaming uses a separate transport and can't be aborted
    // via AbortController; all other protocols (hermes, uplift-bridge, subteam)
    // use abortRef.
    if (!bot || bot.protocol === "openclaw") return;
    abortRef.current?.abort();
    setStreaming(false);
  }

  // â”€â”€ Open chat â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function openChat(id) {
    setActiveId(id);
    setHistory((prev) => markAllSeen(prev, id));
    setSearchMode("bots");
  }

  // â”€â”€ Sidebar / screen navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const totalUnread = Object.values(history).reduce(
    (sum, msgs) =>
      sum + (Array.isArray(msgs) ? msgs.filter((m) => m.role === "bot" && !m.read).length : 0),
    0
  );

  const localModelStatus =
    statuses["local"] === "connected" ? "Gemma ready" : "No model loaded";

  /** Navigate via the sidebar. 'settings'/'local' are actions, not screens. */
  function navigate(id, chatId) {
    setSidebarOpen(false);
    if (id === "settings") {
      if (bots[0]) openSettings(bots[0]);
      return;
    }
    if (id === "local") {
      openChat("local");
      return;
    }
    setScreen(id);
    if (chatId) openChat(chatId);
  }

  /** Push benchmark rows into the connected Draymond orchestrator. */
  async function handleSyncBenchmarks(rows) {
    const draymondBot = bots.find(
      (b) => b.protocol === "draymond" && orchestratorRefs.current[b.id]?.status === "connected"
    );
    if (!draymondBot) return { ok: false, error: "no connected Draymond bot" };
    const baseUrl = `${draymondBot.host?.includes("://") ? "" : "http://"}${draymondBot.host}${
      draymondBot.host?.includes("://") ? "" : `:${draymondBot.port || 3444}`
    }/api`;
    return syncBenchmarksViaDraymond({ baseUrl, token: draymondBot.token, rows });
  }

  /** Select the model used by the Private Local bot. */
  function handleSelectLocalModel(entry) {
    const modelKey =
      entry?.id === "gemma-e2b"
        ? "gemma_e2b"
        : entry?.provider === "mediapipe"
          ? "gemma_e4b"
          : "auto";
    setBots((prev) =>
      prev.map((b) => (b.id === "local" ? { ...b, model: modelKey } : b))
    );
  }

  /** Push the last private local exchange into the connected Draymond store. */
  async function handleSyncLocalToDraymond() {
    const draymondBot = bots.find(
      (b) => b.protocol === "draymond" && orchestratorRefs.current[b.id]?.status === "connected"
    );
    if (!draymondBot) return false;
    const localMessages = history["local"] || [];
    const exchange = lastLocalExchange(localMessages);
    if (!exchange.length) return false;
    const res = await syncMessagesToDraymond({
      baseUrl: `${draymondBot.host?.includes("://") ? "" : "http://"}${draymondBot.host}${
        draymondBot.host?.includes("://") ? "" : `:${draymondBot.port || 3444}`
      }/api`,
      token: draymondBot.token,
      sessionId: `open-chat-local-${new Date().toISOString().slice(0, 10)}`,
      messages: exchange,
    });
    return res?.ok === true;
  }

  // â”€â”€ Worker screen stubs (real worker loop wiring is a later task) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function handleProposeSkill() {
    console.log("[work] propose skill");
  }

  function handleRunTask(task) {
    console.log("[work] run task", task);
  }

  // â”€â”€ Bot management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function addBot() {
    const newBot = {
      id: uuid(),
      name: "",
      avatar: "ðŸ¤–",
      color: "#818cf8",
      tagline: "Custom agent",
      protocol: "hermes",
      host: "127.0.0.1",
      port: 8642,
      token: "",
      topic: "",
    };
    setCfgBot(newBot);
    setIsNewBot(true);
    setShowCfg(true);
  }

  // Disconnect every persistent client for a bot id (any protocol), so a
  // protocol change on save doesn't leave stale sockets/open listeners.
  function disconnectBotClients(botId) {
    if (clawRefs.current[botId]) {
      clawRefs.current[botId].disconnect();
      delete clawRefs.current[botId];
    }
    if (orchestratorRefs.current[botId]) {
      orchestratorRefs.current[botId].disconnect();
      delete orchestratorRefs.current[botId];
    }
    if (ntfyRefs.current[botId]) {
      ntfyRefs.current[botId].disconnect();
      delete ntfyRefs.current[botId];
    }
    if (localRefs.current[botId]) {
      localRefs.current[botId].disconnect();
      delete localRefs.current[botId];
    }
  }

  // (Re)connect the client for a bot based on its current protocol config.
  function reconnectBot(updated) {
    if (updated.protocol === "openclaw") {
      connectClaw(updated);
    } else if (updated.protocol === "uplift-bridge") {
      connectUpliftBridge(updated);
    } else if (updated.protocol === "draymond") {
      connectDraymond(updated);
    } else if (updated.protocol === "ntfy") {
      connectNtfy(updated);
    } else if (updated.protocol === "local") {
      connectLocal(updated);
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
  }

  function saveBot(updated) {
    if (isNewBot) {
      // Add new bot
      setBots((prev) => [...prev, updated]);
      setIsNewBot(false);
    } else {
      // Update existing bot
      setBots((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
      // Protocol/host/token may have changed â€” tear down any previous client.
      disconnectBotClients(updated.id);
    }

    // Reconnect if needed
    reconnectBot(updated);

    setCfgBot(null);
    setShowCfg(false);
  }

  function deleteBot(botId) {
    if (!confirm("Delete this bot and all its messages?")) return;

    // Disconnect persistent clients (any protocol)
    disconnectBotClients(botId);

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

  /** Clear notification badge count (called when user views notifications) */
  function clearUnreadNotifications() {
    setUnreadNotifications(0);
  }

  // â”€â”€ Phase 4 & 5 handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Tool execution
  function handleExecuteTool(toolName, parameters) {
    const execution = {
      executionId: uuid(),
      timestamp: Date.now(),
      toolName,
      parameters,
      agentId: bot?.id || "manual",
      status: "completed",
    };
    setToolLog((prev) => [...prev, execution].slice(-1000));
  }

  // Team management
  function handleCreateTeam(team) {
    setTeams((prev) => [...prev, { ...team, id: uuid() }]);
  }

  function handleInviteMember(teamId, member) {
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId
          ? { ...t, members: [...(t.members || []), member] }
          : t
      )
    );
  }

  // Automation scheduler
  function handleCreateSchedule(schedule) {
    setSchedules((prev) => [...prev, schedule]);
  }

  function handleUpdateSchedule(scheduleId, updates) {
    setSchedules((prev) =>
      prev.map((s) => (s.id === scheduleId ? { ...s, ...updates } : s))
    );
  }

  function handleDeleteSchedule(scheduleId) {
    setSchedules((prev) => prev.filter((s) => s.id !== scheduleId));
  }

  // Developer panel bot update
  function handleUpdateBotFromDevPanel(updatedBot) {
    setBots((prev) =>
      prev.map((b) => (b.id === updatedBot.id ? updatedBot : b))
    );
    // Host/token/protocol edits must take effect on the live client too.
    disconnectBotClients(updatedBot.id);
    reconnectBot(updatedBot);
  }

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div
      style={{
        maxWidth: isNative ? "100%" : 430,
        height: "100vh",
        margin: "0 auto",
        position: "relative",
        overflow: "hidden",
        boxShadow: isNative ? "none" : "0 0 80px rgba(34,211,238,0.12)",
      }}
    >
      {/* Primary screens (home / chats / agents / models) */}
      {!activeId && !showCfg && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#0d0d14",
            zIndex: 10,
          }}
        >
          {screen === "home" && (
            <HomeScreen
              onOpenMenu={() => setSidebarOpen(true)}
              onNavigate={navigate}
              unread={totalUnread}
              agents={agentRegistry}
              modelStatus={localModelStatus}
              bots={bots}
              history={history}
            />
          )}
          {screen === "chats" && (
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
              onSearchMode={setSearchMode}
              searchMode={searchMode}
              pinnedIds={bots.filter((b) => b.pinned).map((b) => b.id)}
              onOpenMenu={() => setSidebarOpen(true)}
            />
          )}
          {screen === "agents" && (
            <AgentsScreen
              agents={agentRegistry}
              bots={bots}
              onOpenChat={openChat}
              onOpenSettings={openSettings}
              onOpenMenu={() => setSidebarOpen(true)}
            />
          )}
          {screen === "models" && (
            <ModelsScreen
              onChatLocal={() => openChat("local")}
              onSelectLocalModel={handleSelectLocalModel}
              onOpenMenu={() => setSidebarOpen(true)}
              onSyncBenchmarks={handleSyncBenchmarks}
            />
          )}
          {screen === "work" && (
            <WorkScreen
              tasks={workerTasks}
              localSkills={localSkillKeys}
              onProposeSkill={handleProposeSkill}
              onRunTask={handleRunTask}
              onOpenMenu={() => setSidebarOpen(true)}
            />
          )}

          <Sidebar
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            onNavigate={navigate}
            unread={totalUnread}
            agentCount={Object.keys(agentRegistry).length}
          />
        </div>
      )}

      {searchMode === "messages" && search.trim() && (
        <SearchResults
          query={search}
          results={searchResults}
          bots={bots}
          onSelect={(botId) => openChat(botId)}
          onBack={() => {
            setSearchMode("bots");
            setSearch("");
          }}
        />
      )}

      {/* Chat */}
      {bot && !showCfg && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#0d0d14",
            zIndex: 20,
          }}
        >
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
            onNtfyAction={
              bot.protocol === "ntfy"
                ? (action) => handleNtfyAction(bot.id, action)
                : null
            }
            unreadNotifications={bot.protocol === "draymond" ? unreadNotifications : 0}
            draymondChains={bot.protocol === "draymond" ? draymondChains : []}
            onClearUnread={clearUnreadNotifications}
            voiceMicActive={micActive}
            voiceEnabled={speakEnabled}
            voiceSupported={!!bot?.voiceEnabled}
            onMicPointerDown={handleMicPointerDown}
            onMicPointerUp={handleMicPointerUp}
            onMicCancel={handleMicCancel}
            onToggleSpeak={() => setSpeakEnabled((v) => !v)}
            pinned={!!bot.pinned}
            onTogglePin={() => {
              setBots((prev) =>
                prev.map((b) => (b.id === bot.id ? { ...b, pinned: !b.pinned } : b))
              );
            }}
            onCopyLastReply={() => {
              const lastBot = [...messages].reverse().find((m) => m.role === "bot");
              if (lastBot?.text && navigator.clipboard) {
                navigator.clipboard.writeText(lastBot.text).catch(() => {});
              }
            }}
            onSyncToDraymond={
              bot.protocol === "local" ? handleSyncLocalToDraymond : undefined
            }
          />
          {micError && (
          <div
            style={{
              position: "absolute",
              bottom: 90,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "center",
              zIndex: 30,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                background: "#ef4444",
                color: "#fff",
                padding: "8px 14px",
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              {micError}
            </div>
          </div>
        )}
        </div>
      )}

      {/* Settings */}
      {showCfg && cfgBot && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#0d0d14",
            zIndex: 30,
          }}
        >
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
            onOpenAuditLog={() => setShowAuditLog(true)}
            onOpenToolConsole={() => setShowToolConsole(true)}
            onOpenDevPanel={() => setShowDevPanel(true)}
            onOpenTeamPanel={() => setShowTeamPanel(true)}
            onOpenScheduler={() => setShowScheduler(true)}
            draymondClient={
              cfgBot.protocol === "draymond"
                ? orchestratorRefs.current[cfgBot.id] || null
                : null
            }
            draymondNotifications={
              cfgBot.protocol === "draymond" ? draymondNotifications : []
            }
            draymondAgents={agentRegistry}
          />
        </div>
      )}

      {/* Phase 4 & 5 Modals */}
      {showAuditLog && (
        <AuditLog
          toolLog={toolLog}
          onClose={() => setShowAuditLog(false)}
        />
      )}

      {showToolConsole && (
        <ToolExecutionConsole
          onExecute={handleExecuteTool}
          onClose={() => setShowToolConsole(false)}
        />
      )}

      {showDevPanel && bot && (
        <DeveloperPanel
          bot={bot}
          onUpdateBot={handleUpdateBotFromDevPanel}
          onClose={() => setShowDevPanel(false)}
        />
      )}

      {showTeamPanel && (
        <TeamPanel
          teams={teams}
          onCreateTeam={handleCreateTeam}
          onInviteMember={handleInviteMember}
          onClose={() => setShowTeamPanel(false)}
        />
      )}

      {showScheduler && (
        <AutomationScheduler
          schedules={schedules}
          onCreateSchedule={handleCreateSchedule}
          onUpdateSchedule={handleUpdateSchedule}
          onDeleteSchedule={handleDeleteSchedule}
          onClose={() => setShowScheduler(false)}
        />
      )}
    </div>
  );
}

