# Open-Chat as a Tool — Design

Date: 2026-08-09
Status: Approved

## Goal

Turn Open-Chat from a communication surface into a working tool executor for the
Draymond agent ecosystem. Two capabilities, both already backed by existing but
unwired infrastructure:

1. **Real worker loop** — Open-Chat acts as a Draymond remote worker: pulls queued
   worker tasks, claims them, executes the referenced skill pack on-device
   (phone tools / on-device skills / local model), and reports results back.
2. **Agent tool-calling surface** — tool executions become visible, actionable
   cards inside the chat, and the on-device agent gains Draymond skill tools it
   can call mid-conversation.

## Phase 1 — Real worker loop

### `src/utils/skillExecutors.js`
Handler map injected into `SkillPackRuntime`. Each key is a skill-pack `tools`
entry name → async (context) → serializable output. Executors:
- Phone tools via `execPhoneTool` from `phoneTools.js`.
- On-device skills via `runSkill` from `skillRegistry.js` (read_recap, open_app,
  set_reminder, read_notifications, current_time, send_to_chat, share_to).
- `text` / `llm` / `summarize` → `chatLocal` (on-device chat, no tools).
- `notify` → local notification.
- Unknown tool → `{ ok:false, error }` (the runtime already fails soft).
- Factory `buildSkillExecutors({ onSend, onNotify })` so callers can inject chat /
  notification side effects (tests substitute fakes).

### `src/utils/workerEngine.js`
`createWorkerEngine({ baseUrl, token, workerId })` → `{ start, stop, runTask,
proposeSkill, getState, onState }`.
- Owns a `WorkerClient`, a `LocalSkillLibrary` (Capacitor Preferences-backed KV),
  and a `SkillPackRuntime` built from `skillExecutors`.
- `start()`: heartbeat + pull loop every 15s; for each due queued task with a
  skill pack id, `runTask` it serially.
- `runTask(id)`: `claimTask` → resolve pack (cached library → `fetchSkill`) →
  `runtime.execute(pack, task.payload)` → `reportTask` (completed with output +
  artifact refs, or failed with error). Skips tasks with no pack id (reports
  `failed` with a clear reason).
- `proposeSkill(pack)`: POST to `/v1/worker/skills`.
- Failure modes are non-fatal: pull/network errors surface as `lastError` state
  and the loop retries next tick; a crashed task never blocks the queue.
- `stop()`: clears timers.

### `src/hooks/useWorkerEngine.js`
React hook that owns one engine for a connected Draymond bot:
- `useWorkerEngine({ bot, enabled })` → `{ tasks, skills, status, lastError,
  runningTaskId, runTask, proposeSkill }`.
- Persists `tasks` and `skills` to localStorage (keyed `openchat_worker_*`).
- Auto `start()` when `enabled && bot` with a Draymond protocol bot; `stop()` on
  unmount / disconnect.

### App.jsx wiring
- Replace the stub `handleRunTask` / `handleProposeSkill` with engine calls.
- Feed real `tasks` / `skills` from the hook to `WorkScreen` (removing the
  hardcoded `useState([])` values).
- `WorkScreen` "Run now" claims + executes + reports (existing button, now real).
- "Propose skill" builds a pack from the local skill library + registry and
  proposes it via the engine; the Work screen reflects proposals.
- Add a small engine status line to WorkScreen (worker id, last pull, error).

## Phase 2 — Agent tool-calling surface

### `src/utils/draymondTools.js`
Builds tool schemas + handlers that let the on-device model drive Draymond:
- `list_skills` → WorkerClient listSkills
- `run_skill` → enqueue + resolve + execute a skill pack (reuses engine.runTask)
- `run_chain` → DraymondOrchestratorClient.executeChain
- `enqueue_task` → WorkerClient POST /v1/worker/tasks
Handlers return serializable `{ ok, ... }` objects.

### Tool-call cards in chat
- `MessageBubble` renders collapsible tool cards from `msg.toolCalls`
  (`[{ name, args, result, status }]`): tool name, args summary, result, status chip.
- `Chat`/`App` attach `toolCalls` to streamed bot messages from the local bot's
  `onToolCall` callback (LocalModelClient already reports calls; App currently
  only logs them).
- Worker→chat bridge: when a worker task completes/fails, append a bot message to
  the Draymond bot's chat with a tool card + result summary.

### LocalModelClient
- Add `draymondSkillsEnabled` bot flag; when enabled, append `draymondTools`
  schemas to the tool surface so the agent can call Draymond skills as tools.

## Testing
- New `workerEngine.test.js`, `skillExecutors.test.js`, `draymondTools.test.js`
  with mocked fetch / plugin calls; update `WorkScreen.test.jsx` for the new
  status line. Follow existing Vitest + RTL conventions, run `npm run lint`
  (zero warnings) and `npm test`.

## Out of scope
- Slash-command palette.
- Phone tools on web (native-only; they fail soft with clear errors).
- Real multi-worker contention handling beyond the existing claim protocol.

## Addendum — Draymond producer side (so the loop has work)

The consumer loop (Open Chat) is only useful if Draymond enqueues tasks. Added:

- **`on_device_ops` skill pack** (seeded in `skill-packs.ts`): purpose + triggers for
  phone/device requests; tools = `phone_control, capture, text, llm, notify, ai_apps,
  current_time, outputs` — all executable by Open-Chat's on-device executors.
- **On-device chat routing** (`chat.ts`): `isOnDeviceRequest` detects phone/device
  intents (open an app, screenshot, reminder, notifications, …) and
  `handleOnDeviceTask` enqueues a worker task (`skill_pack_id: on_device_ops`)
  via `enqueueWorkerTask`, replying "Queued to your phone". Tested for success and
  enqueue-failure paths.
- **Seeded `dispatch_worker_tasks` job** (`scheduler.ts` BASIC_JOBS): daily 9:45am
  job enqueues a morning-snapshot task for the Open-Chat worker, exercising the
  existing custom handler.

End-to-end flow: Draymond chat or the daily job → `draymond_worker_tasks` → Open-Chat
worker pulls/claims → executes `on_device_ops` on-device → reports result → Draymond
records it and Open-Chat surfaces it in chat as a tool card.

