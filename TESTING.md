# Testing Guide for Open-Chat

This guide covers the automated test suite, coverage requirements, and the manual
smoke-test checklist for verifying Open-Chat (web, Android, and Electron).

## Prerequisites

- **Node.js** 20.19+ (required by Vite 8)
- npm
- Optional: an agent to test against (OpenClaw, Hermes, Draymond Orchestrator, etc.)

## Automated Tests

```bash
npm install
npm run lint            # ESLint — zero warnings allowed
npm test                # Run the full Vitest suite (695 tests / 33 files)
npm run test:coverage   # Run with coverage and enforce thresholds
```

### Coverage thresholds

| Metric     | Threshold |
|------------|-----------|
| Lines      | 98%       |
| Statements | 96%       |
| Functions  | 92%       |
| Branches   | 90%       |

### What is covered

- **Protocol clients** — OpenClaw (WebSocket), Hermes, Ntfy, Draymond Orchestrator,
  SubTeam, and Uplift Bridge: connect/send/reconnect, offline queueing, action
  execution, and error paths.
- **Components** — Chat, Inbox, Settings, MessageBubble, AuditLog, DeveloperPanel,
  ToolExecutionConsole, OnDeviceInsights, ErrorBoundary, icons.
- **Hooks & utils** — auto-resize, scroll-follow, voice, storage (quota/pruning),
  security (sanitization, token masking), markdown, notifications.
- **Android-native edge cases** — black-screen GPU-compositing regressions,
  `window.Capacitor` guards, plugin availability.

## Manual Smoke Test

### 1. Chat streaming
Send a message to a Hermes bot and confirm token-by-token streaming, then interrupt
mid-stream (works for all protocols except OpenClaw).

### 2. Inbound mid-stream safety
Trigger an inbound ntfy/Draymond notification while a reply is streaming. The stream
must keep writing to its **own** message (bug fixed in 1.0.0).

### 3. Protocol switch
Edit a bot from OpenClaw → Draymond. Confirm the old socket closes and the new
client connects (bug fixed in 1.0.0).

### 4. On-device insights
Open a Draymond message and expand "On-device insights". The panel must complete
instead of hanging on "Thinking on-device…" (bug fixed in 1.0.0). Retry after a
failed generation.

### 5. Remote management
In a Draymond bot's Settings, confirm chains and schedules load, and that toggling a
schedule sends the `enable`/`disable` action.

### 6. Basic UX
- Inbox search filters bots by name.
- Right-click / long-press a message to copy or delete.
- Auto-scroll follows new messages only when near the bottom.
- Unread badges appear and clear when a chat is opened.
- Closing and reopening the app preserves bots and history (localStorage /
  native storage).

## Building & Verifying Artifacts

```bash
npm run build           # Production web bundle → dist/
npm run electron:build  # Desktop installers (Windows/macOS/Linux)
npm run android:build   # Sync web bundle + Capacitor plugins into android/
cd android && ./gradlew assembleDebug   # → android/app/build/outputs/apk/debug/app-debug.apk
```

Verify:
- [ ] Production build produces no console errors.
- [ ] APK installs on a physical Android device (Enable "Install unknown apps").
- [ ] App icon appears correctly across launcher sizes.

## Common Issues

| Symptom | Likely cause / fix |
|---------|--------------------|
| `Port 3000 already in use` | Port is now 5173; run `npm run dev -- --port <n>` if needed |
| `npm install` fails | Remove `node_modules` + `package-lock.json`, then reinstall |
| Vite won't start | Node must be **20.19+** (Vite 8 requirement) |
| `Cannot connect to agent` | Verify the agent is running and host/port/token match Settings; check CORS (`API_SERVER_CORS_ORIGINS=*`) for Hermes |
| Messages don't stream | Check the browser console; verify WebSocket (OpenClaw) / SSE (Hermes) connectivity |
| Coverage run fails | Run `npm run test:coverage` and add tests for uncovered lines (see thresholds) |

## Reporting Issues

Open an issue at https://github.com/ncsound919/Open-Chat/issues with:
1. Steps to reproduce
2. Expected vs actual behavior
3. Platform (web / Android / Electron) and OS/browser
4. Console errors, if any
5. Screenshots, if applicable
