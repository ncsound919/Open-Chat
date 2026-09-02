# Open-Chat Component Audit — 2026-09-01

Full-source audit of `Open-Chat/src` (components, utils, protocols, hooks, App.jsx, electron). Every finding below was verified by reading the code; the P0/P1s were re-verified against source before being written here.

## Baseline

- `npm run lint` — clean (0 warnings, 0 errors).
- `npm test` — **79 files / 1155 tests, all passing** (~200s).
- No `dangerouslySetInnerHTML` anywhere → low XSS surface.
- App is Electron-sandboxed (`contextIsolation` on, `nodeIntegration` off, `sandbox` on), A2A hub binds loopback only.

**Bottom line:** "poorly implemented" is not a fair blanket verdict. The core chat loop, protocol clients, storage, on-device AI, and security utilities are genuinely well-engineered with real tests. But the audit found **2 crash/data-loss bugs (P0), ~20 real functional defects (P1), and ~40 duplication/dead-code/hygiene items (P2)** — concentrated in App.jsx's monolith, the Draymond client's missing wake/direct surface, and copy-paste drift across utils.

---

## P0 — crash / data loss (fix immediately)

### P0-1. Draymond offline-queue silently drops commands when a retry fails
- `src/protocols/DraymondOrchestratorClient.js:762–799` (with `:472–478`, `:556–562`, `:610–616`)
- `flushOfflineQueue()` drains the queue then calls `syncMessages`/`executeChain`/`toggleSchedule`. Those methods never throw — on failure they return `{ok:false}` and the re-queue is guarded by `if (!this._flushing)`, which is true during a flush. So a failed retry is **not** re-queued, and the loop still does `succeeded++`. The command is permanently lost exactly in the flaky-network scenario the queue exists for, and `_saveOfflineQueue()` persists the loss.
- Fix: in the flush loop, treat a returned `{ok:false}` as a failure (`push` back + `failed++`), or have the underlying methods throw while `_flushing`.

### P0-2. Electron main process crashes when an A2A client aborts a stream
- `electron/a2aServer.js:95–107`
- The SSE pump calls `res.write(Buffer.from(value))` (line 103) with **no `res.on("error")` listener**. When a client disconnects mid-stream, `write()` on the destroyed ServerResponse emits an unhandled `ERR_STREAM_DESTROYED` error → uncaught exception → the whole desktop app dies. The `.catch(() => res.end())` only guards `reader.read()`, not `res.write()`.
- Fix: `res.on("error", () => {})` + `req.on("close", () => { if (!res.writableEnded) res.destroy(); })` and cancel the underlying ReadableStream on disconnect.

---

## P1 — real functional bugs / significant risks

### P1-1. Settings "Scan" for local models is completely broken (ReferenceError)
- `src/components/Settings.jsx:172` — calls `detectLocalModels({ extraHost: lanHost })` but never imports it (imports at `:1–8`). Function actually lives in `src/utils/modelRegistry.js:310` and returns `{ sources: [...] }`, not an array — so even a fixed import breaks at `scanResults.length` / `.map()`. Lint stays green because `no-undef` is not enabled.
- Fix: `import { detectLocalModels } from "../utils/modelRegistry.js"` and `const { sources: results } = await detectLocalModels({ includeServers: true, extraHost: lanHost })`.

### P1-2. Draymond token sent over cleartext HTTP to remote hosts (two sync paths)
- `src/App.jsx:1413–1415` and `:1442–1444` — both `handleSyncBenchmarks` and `handleSyncLocalToDraymond` build `http://${host}.../api` for a bare remote hostname (e.g. `xxxx.trycloudflare.com`), while `DraymondOrchestratorClient` (`:54–81`) and `resolveWorkerBaseUrl` (`workerEngine.js:31–41`) deliberately force `https://` for remote hosts "to prevent bearer tokens being sent in cleartext" (`security.js:69–72`). The bearer token is then POSTed over plain HTTP. The two blocks are also literal copy-paste of each other.
- Fix: reuse `resolveWorkerBaseUrl(draymondBot) + "/api"` in both handlers.

### P1-3. App.jsx auto-connect ignores `manualConnect` for Draymond agent shells → N+1 SSE streams
- `src/App.jsx:741–748` — the Draymond branch filters only `protocol === "draymond"`, unlike the local branch (`:761`) which honors `!b.manualConnect`. Auto-populated agent shells (`:415–431`) carry `manualConnect: true` ("don't stream events until opened"), but the effect connects them anyway. Result: one SSE stream per discovered agent to the same orchestrator, re-delivering the whole event bus; `onToolExecution`/`onNotification` append without dedup, so every tool execution and notification is duplicated N+1 times.
- Fix: add `&& !b.manualConnect` to the Draymond filter (mirroring the local branch).

### P1-4. Hermes/SubTeam send the user turn to the model twice
- `src/App.jsx:967–974` and `:1095–1102` — the user message was already appended at `:921`; `prior` is built from `history[bot.id]` filtered for `role === "user"` (which includes the just-added message) and then `prior.push({role:"user", content:text})` appends it again. The local branch (`:1292`) explicitly pops it, confirming this is a bug.
- Fix: `prior.pop()` after building `prior` in the hermes and subteam branches.

### P1-5. Cross-protocol stale-ref leak: `streamImageRef` written in local, read in a2a
- `src/App.jsx:668–670` (written only in `connectLocal.onToolCall` for `image_gen`) vs `:1240–1242` (read/cleared only in the `a2a` branch). (a) On-device generated images never render in the local chat; (b) the stale image is silently attached to the next A2A message.
- Fix: consume + reset `streamImageRef` in the `local` branch and in `finally`.

### P1-6. Stop / switch-chat aborts the wrong stream and corrupts global stream refs
- `src/App.jsx:1349–1356` + `:1328–1331` — `streamBuf`, `streamMsgIdRef`, `abortRef` are single globals shared by all chats. Opening chat B while A is streaming, then pressing Stop aborts A's controller and the two streams fight over the shared refs; A's `finally` can clear B's placeholder id and `streaming`, enabling a third overlapping send.
- Fix: track streaming per bot id and make interrupt/abort target the owning bot.

### P1-7. Draymond client: no fetch timeouts on 13 of 15 calls
- `src/protocols/DraymondOrchestratorClient.js:391–703, 830–867` — `getWorkflowStatus`, `cancelWorkflow`, `syncMessages`, `loadMessages`, `listChains`, `executeChain`, `listSchedules`, `toggleSchedule`, `reportStatus`, `getServerStatus`, `getMissionDashboard`, `getHeartbeats`, `_discoverAgents` all `fetch` with no `AbortSignal`. A hung server leaves `StatsScreen.refresh()` stuck with `refreshing=true` forever.
- Fix: wrap every fetch in `AbortSignal.timeout(...)` (pattern already at `:213`).

### P1-8. Draymond client never touches the server's wake/direct/invoke/recover surface
- Server exposes `POST /api/ping/[slug]`, `POST /api/agents/[id]/invoke`, `POST /api/agents/[id]/recover` (verified in `Draymond-Orchestrator/src/app/api/**`). The client has **zero** references to them. `invokeEntity()` (`:716`) does NOT call `/api/agents/[id]/invoke` — it re-routes through `/api/v1/orchestrate` with `entity_slug` metadata, a different mechanism, and it's never called by non-test code. This is the "wake & direct" gap for the command-center workstream.
- Fix: add `wake(slug)`, `invokeAgent(id, action, input)`, `recoverAgent(id)` hitting the real routes; make `invokeEntity` call `/api/agents/[id]/invoke`.

### P1-9. Draymond `_discoverAgents` swallows auth errors → fake "connected"
- `src/protocols/DraymondOrchestratorClient.js:830–867` — catches everything and returns `{}`; `connect()` then reports "connected" and starts an event stream with a bad token, which silently dies after 5 reconnects with no status change.
- Fix: re-throw on non-ok; set status `"error"` on reconnect exhaustion.

### P1-10. Three divergent "which Draymond bot" selectors in App.jsx
- `:172–175` (`statuses[b.id] === "connected"`), `:1409–1411` and `:1434–1436` (`orchestratorRefs.current[b.id]?.status === "connected"`). `bots.find` returns the first match; an auto-populated agent shell (`protocol: "draymond"`) can satisfy the find and become the worker engine's bot, so worker results land in the shell's chat instead of the user's main Draymond chat.
- Fix: single `useMemo` selector preferring the primary/non-shell Draymond bot, used by the worker engine and both sync handlers.

### P1-11. `NtfyClient.connect()` has no timeout — a hanging connect wedges the client forever
- `src/protocols/NtfyClient.js:94–97` — if the server accepts but never responds, neither `catch` nor `_handleStreamClosed` fires, status stays "connecting" forever.
- Fix: `AbortSignal.timeout(...)` mirroring `_httpAction`.

### P1-12. `bridge-protocol.parseSSEFrames` is CRLF-blind → UpliftBridge streams can deliver nothing
- `src/protocols/bridge-protocol.js:151–198` — searches for `"\n\n"` only; on a `\r\n` stream every frame is stuck in `remaining`, so `UpliftBridgeClient.send()` returns empty text and the event stream never delivers. Draymond (`:987`) and A2A (`:513`) both normalize CRLF — the authors know the field uses CRLF.
- Fix: normalize `\r\n`/`\r` before scanning.

### P1-13. `MCPHostClient` doesn't persist `Mcp-Session-Id`
- `src/protocols/MCPHostClient.js:73–110` — MCP Streamable HTTP requires echoing the `Mcp-Session-Id` response header from `initialize` on every subsequent request; the client never reads or sends it, so sessionful servers reject `tools/list`/`tools/call`.
- Fix: capture the header in `_jsonRpc` and store it on the connection.

### P1-14. `workerEngine.runTask` ignores the claim result → duplicate side effects
- `src/utils/workerEngine.js:143` — `await client.claimTask(taskId)` result is discarded; a task already claimed by another worker is still executed locally. Two Open-Chat devices sharing a bot id can run the same mutating task twice.
- Fix: bail with `{ok:false, status:"skipped"}` when the claim returns false.

### P1-15. `secureStore.enable()` can permanently lose history/config on native
- `src/utils/secureStore.js:220–244` (with `:44–57`, `:253–270`) — `enable()` writes the encrypted blob via fire-and-forget `Preferences.set()` then immediately removes the plaintext. If the blob write fails (large history + base64/GCM ~33% size overhead can exceed Preferences capacity), a restart finds neither blob nor plaintext. `change()` re-keys every blob the same way.
- Fix: `await` each blob write and only remove the plaintext after the write resolves.

### P1-16. `skillRegistry` reminder id collisions (a fixed bug re-copied)
- `src/utils/skillRegistry.js:88` — `LocalNotifications.schedule({ id: Date.now() % 100000, ... })` overwrites same-millisecond / wrapped / cross-restart reminders. `notifications.js:41` documents this exact bug and adds a monotonic `notificationSeq`.
- Fix: mirror the `notificationSeq` pattern.

### P1-17. `useVoiceCall` throws can kill the call loop and leak `speaking=true`
- `src/hooks/useVoiceCall.js:135–176` — `rec.start()` throwing rejects the promise executor, killing the un-awaited async loop as an unhandled rejection; a throwing model call skips `setSpeaking(false)` (no try/finally), leaving the UI stuck "speaking".
- Fix: try/catch around `rec.start()`, try/finally around the model call.

### P1-18. `OpenClawClient.connect()` can double-connect when a reconnect timer is pending
- `src/protocols/OpenClawClient.js:27–178` — `onclose` schedules `_reconnectTimer`; a manual `connect()` creates a new WebSocket without clearing it, so the timer fires another `connect()` → two live sockets.
- Fix: guard with a connecting flag / clear the timer at the top of `connect()`.

### P1-19. Draymond stale reconnect timer closes a healthy replacement stream
- `src/protocols/DraymondOrchestratorClient.js:873–944` — `connect()`/`_connectEventStream` never clear `_reconnectTimerId`; a pending timer later runs `_connectEventStream()` which `eventSource.close()`s the stream the manual connect just opened.
- Fix: clear `_reconnectTimerId` at the start of `connect()` and `_connectEventStream()`.

### P1-20. Electron has no single-instance lock
- `electron/main.js:87–105` — `app.requestSingleInstanceLock()` never called; a second launch opens a second window and its A2A bind fails silently (error is caught and logged at `:82–84`), so the second instance runs without the hub.
- Fix: `requestSingleInstanceLock()` + `second-instance` handler.

---

## P2 — minor bugs, duplication, dead code

### Component UI bugs
- `src/components/StatsScreen.jsx` — **missing `key` prop** on list children (test emits the warning).
- `src/components/AuditLog.jsx:24,45,63,75,93,123` — `Math.random()` in every generated `key` + `buildAuditEntries` recomputed every render → full list remount on each keystroke of search.
- `src/components/TeamPanel.jsx:470` — role badge renders the hex color string as text (`#ef4444`) instead of the role name.
- `src/components/ApprovalsScreen.jsx:106–122` — `await onExecute` with no try/catch; on rejection `setBusyKey(null)` never runs, every approval button stays disabled forever.
- `src/components/WorkScreen.jsx:90–114` — `await onProposeSkill` with no try/catch; rejection leaves the button stuck "Submitting…".
- `src/components/Chat.jsx:637–651` — quick-action trash deletes the whole conversation with no confirm (the kebab-menu path gates it behind `confirm()`).
- `src/components/Chat.jsx:225–251` — sync-to-Draymond button has no try/catch; rejection leaves `syncState` stuck "…" with an unhandled rejection.
- `src/components/Chat.jsx:560–565` — `VoiceCallButton` URL built as `http://${host}:${port}` breaks HTTPS/full-URL Draymond tunnel hosts (malformed `http://https://…`).
- `src/components/DeveloperPanel.jsx:306–411,414–505` — Models and Webhooks tabs are inert "theater" UI: no state, no handlers, dead "Send Test Request" button.
- `src/components/HomeScreen.jsx:37–43` — "agents online" counts only `status === "active"`, but agents register as `"online"`/`"connected"` → under-reports.
- `src/components/Inbox.jsx:106` — hardcoded `mode === "dev"` instead of the `MODES` constant.
- `src/App.jsx:1387–1388` — "Gemma ready" label asserted for any connected local engine (Gemini Nano/WebLLM included).
- `src/App.jsx:694–698` — ntfy fallback hardcodes topic `"alerts"` instead of `bot.topic`.
- `src/App.jsx:911–1332` — no default branch in the 10-protocol chain; an unknown protocol leaves a permanently `streaming:true` placeholder persisted.
- `src/components/MessageBubble.jsx:158,386` — `ToolCallCard` declares/receives an unused `accent` prop.
- React `act()` warnings in tests for MessageBubble/ActionButton, StatsScreen, WorkScreen, GeneralSettings, OnDeviceInsights — state updates after await without `act()`.

### Duplication (extract shared helpers)
- SSE parsers written **6×**: `DraymondOrchestratorClient.js:294–383` + `:987–1033`, `HermesClient.js:113–194`, `SubTeamClient.js:81–152`, `A2AClient.js:512–547`, `bridge-protocol.js:151–198`.
- Modal overlay shell copy-pasted across `DeveloperPanel.jsx:60–86`, `TeamPanel.jsx:57–83`, `AutomationScheduler.jsx:74–100`, `ToolExecutionConsole.jsx:38–61`, `AuditLog.jsx:160–186` (+ 5× `DevButton` in `Settings.jsx:864–957`).
- Agent status→rank mapping in `Settings.jsx:21–28` and `AgentsScreen.jsx:79–84`.
- `safeColor()` in `Chat.jsx:22–28` and `MessageBubble.jsx:162–168` (byte-identical).
- Avatar-URL resolution 3×: `Settings.jsx:995–1000`, `AgentsScreen.jsx:104–112`, `BotAvatar.jsx:10–17`.
- localhost/private-IP detection 3×: `security.js:6,38`, `workerEngine.js:37–40`, `voice.js:16–17`.
- Wikipedia+DuckDuckGo fetchers 3×: `webSearch.js:34–74`, `researchTools.js:60–128`, `cloudIntegrations.js:66–154`.
- `workerBaseUrl` verbatim in `useWorkerEngine.js:175–186` vs `workerEngine.js:31–41`.
- `galaxyAi.isGalaxySkill` (`:102`) duplicated by `LocalModelClient.js:273 isGalaxySkillName`.
- "mark user read" block copy-pasted 10× in `App.jsx`; `onDelta` callback 7×; `prior` builder 3×.
- Gemini package name disagrees: `appRecipes.js:170` uses `com.google.android.apps.bard`, `aiAppRecipes.js:14` uses `com.google.android.apps.gemini`.

### Dead code (only referenced by their own tests)
- `src/utils/aiAppRecipes.js` — entire module (AI_APPS, recipeFor, appByHandle).
- `src/utils/benchmarks.js:16` `tokensPerSec`; `:89–111` `syncBenchmarksToDraymond` (also a latent secret-distribution hazard — ships a Supabase service-role key pattern).
- `src/utils/mcpConfig.js:38` `serializeMcpServers`.
- `src/utils/ecosystem.js:65` `hasEcosystemContext`.
- `src/utils/phoneTools.js:82,87` `isPhoneTool` / `isMutatingPhoneTool`.
- `src/utils/skillExecutors.js:229` `PHONE_TOOL_NAMES`.
- `src/protocols/DraymondOrchestratorClient.js:439,447,459,489,716,736` — `getAgents`, `getActiveWorkflows`, `syncMessages`, `loadMessages`, `invokeEntity`, `triggerChain`.
- `src/protocols/HermesClient.js:296` `hermesModels`; `MCPHostClient.js:116,150,199` `listTools`/`callTool`/`getServerInfo`; `A2AClient.js:427,460` `getTask`/`cancelTask`; `bridge-protocol.js` `encodeWorkSecret`, `sameSessionId`, `buildSdkUrl`, `buildCCRv2SdkUrl`, `convertSSEUrlToPostUrl`.

### Other P2
- `localChat.js:247–255` — provider probe keeps running after timeout resolves.
- `localChat.js:165–167,201–202` — `abort()` always calls `mp.cancel()` even after success (can interrupt a concurrent generation).
- `localChat.js:314–318` — degenerate-reply retry budget is 1 vs mediaPipe's 2 → garbage surfaced.
- `OnDeviceAI.js:98,155` — `session.destroy()` not awaited.
- `security.js:133–145` — `safeLog` redaction misses `ghp_`, `sk-`, `secret`/`api_key` JSON keys, 32+ hex blobs, and leaves the label verbatim.
- `security.js:93–98` — `resolveEndpoint("::1")` emits unbracketed `http://::1:8642` (IPv6). Same in Draymond constructor `:80–81` and OpenClaw.
- `storage.js:79–88` — `storageRemove` doesn't delegate to `secureStore` for encrypted keys.
- `storage.js:252–269` — quota estimate counts UTF-16 units, not bytes, and double-counts decrypted values.
- `storage.js:284–295` — `loadBots` re-adds deleted local/fleet bots on every load (can never keep them deleted).
- `runBenchmarks.js:153` — default backend `"gpu"` contradicts the CPU default (documented GPU detokenizer bug).
- `runBenchmarks.js:38–44` — model-load row reports `ok:true` even when `loadModel` returned `{ok:false}`.
- `phoneTools.js:137` — reversed substring match (`query.includes(t)`) can tap the wrong element.
- `browserNavigate.js:117–123` — prefix-match arrival check can "verify" the wrong article; consent redirects (consent.google.com) fail web search.
- `appRecipes.js:104–108` — double submit (execPhoneTool's internal submit + askApp's submitText).
- `galaxyAi.js:190–250` — `galaxy_ai_action`'s `action` arg is decorative; all actions tap the same first AI button.
- `workerEngine.js:198–212` — `pull()` can overlap, last-writer-wins drops tasks.
- `workerClient.js:68–130` / `draymondTools.js:75–87` — mixed return shapes (`[]` vs `{ok:false}`) create type fragility.
- `localModels.js:19,73–76` — dead "Ollama (LAN)" probe config.
- `localModels.js:34` — caller AbortSignal dropped when `AbortSignal.any` is missing.
- `voice.js:126–166` — `transcribeAudio`/`synthesizeAndPlay` have no timeout/abort → hang forever on a dead localhost proxy.
- `skillRegistry.js:68` — model-controlled package string interpolated unencoded into an `intent://` URI (prompt-injection vector for extras).
- `useVoice.js:145–154` — enabling auto-speak replays the last stale message.
- `useVoice.js:157–166` — blob audio URLs never revoked on unmount.
- `useWorkerEngine.js:18–52,72–73,130–143` — native/web storage split causes stale initial state.
- `A2AServer.js:269–275` — CancelTask doesn't stop the running executor; `this.tasks` grows unbounded.
- `A2AServer.js:213` — streamed JSON-RPC frames omit the request `id`.
- Draymond `:220–232` — AbortSignal polyfill listener leak (no `{once:true}`/remove).
- Draymond `:272–282` — orchestrate abort listener never removed; abort leaves workflow `"in_progress"` forever.
- Draymond `:1150–1192` — `_pollTimerIds` grows unbounded (fired timers never deleted).
- Draymond `:288` — `res.body.getReader()` outside try/catch.
- Draymond `:765–798` — flush reports `{ok:false}` retries as `succeeded` even after P0-1.
- Hermes `:151–194` / SubTeam `:108–151` — no 1 MB stream-buffer cap (Draymond/A2A have one).
- `UpliftBridgeClient.js:464` — `break outer` on `[DONE]` leaks the reader.
- `electron/main.js:9–19` — CSP `img-src` blocks LAN `http://192.168.x.x` avatars; `connect-src https://* ws://* wss://*` is maximally broad.
- `electron/main.js:52` — `loadFile` with no error handling (blank window if `dist` missing).
- `electron/main.js:100–104` — `a2aServer.close()` not awaited, doesn't tear down keep-alive SSE sockets.
- `electron/a2aServer.js:147–158` — post-listen `'error'` events unhandled; catch handler can write to a destroyed socket.

---

## Architecture notes for the "command center" workstream

1. **App.jsx (1954 lines) is the primary refactor target** — it holds ~14 responsibilities: state ×8, six connection factories, auto-connect lifecycle, platform effects, message CRUD, the 10-protocol `sendMessage`, nav/unread/approval derivation, bot CRUD, dev-tool modals, and all JSX. Highest-value extractions: (a) `sendMessage` → per-protocol sender registry with per-protocol stream state (kills ~420 lines and the cross-protocol ref bugs by construction), (b) connection lifecycle → `useBotConnections` (fixes P1-3 + dependency churn), (c) a `useDraymond` context owning the single canonical Draymond bot + worker engine + sync handlers (fixes P1-10).
2. **`Settings.jsx` (1677 lines)** mixes 6 unrelated concerns (bot form, Draymond remote management, connection test, model scanning, at-rest encryption, dev tools) — split into section components.
3. **The "wake & direct" gap (P1-8)** is the concrete foundation for the command-center vision: the Draymond server already has `/ping/[slug]`, `/agents/[id]/invoke`, `/agents/[id]/recover`; Open-Chat just needs client methods + UI.
4. **Keywire integration is absent** (verified by grep) — separate workstream.
