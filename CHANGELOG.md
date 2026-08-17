# Changelog

All notable changes to **Open-Chat** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-08-17

### Added
- **On-device private chat** — fully local inference with MediaPipe Gemma, nothing leaves the phone.
- **New Models screen** — model catalog (Gemma 3n E4B / E2B), download / load / delete, benchmark & skill tests, accelerator selector, and phone-capability summary.
- **Real Settings menu** — the ⚙️ Settings button now opens a proper settings screen (local model scan, Private Local info, app preferences) instead of a single bot's config.
- **New screens** — Agents, Models, Home, Work, Stats, and Approvals.
- **Worker engine** — asynchronous task execution, skill pack runtime, and a local versioned skill library.
- **Phone-control tooling** — capture screenshot, AI app-control recipes, and a confirmation gate for mutating phone tools.
- **Draymond integration hardening** — chain/schedule management, notification history, agent roster, and benchmark results sync.

### Changed
- **Persistent KV-cache sessions** — the on-device agent now reuses a MediaPipe `LlmInferenceSession` across tool-loop turns, eliminating repeated system-prompt re-processing (~10× faster multi-turn tool loops).
- **Natural, human tone** — the local assistant now replies conversationally (contractions, plain language) instead of like a robot.
- **Trimmed system prompt** — condensed base rules and the app-context list for faster responses.
- **Accelerator tuning** — confirmed CPU/XNNPack is the fastest backend for int4 models (GPU/NPU delegate measured slower) and made it the default.
- **Removed OpenClaw from default bots** — no longer auto-created as a hardcoded default.

### Fixed
- **Settings button** opened the OpenClaw bot config; now opens the real settings menu.
- **Private Local** sidebar shortcut redirected to the chats list; now opens the local chat directly.
- **Local model scan** ignored on-device MediaPipe models; now detects them (e.g. the installed Gemma E4B).
- **Chat input bar** was hidden behind the Android navigation bar; safe-area padding now keeps it above.
- **Accessibility service** for phone control could not be enabled for sideloaded builds (restricted setting); the app now surfaces enablement guidance and the status correctly.

### Security
- Confirmation gate for mutating phone tools (open app, Galaxy AI actions) before acting.
- Token masking and connection info now shown in Basic mode settings.

## [1.0.0] - 2026-08-14

### Added
- Initial MVP: private, local-first messaging interface for autonomous agents.
- Multi-agent chat with OpenClaw (WebSocket), Hermes (HTTP), and Draymond Orchestrator protocols.
- Real-time token streaming, markdown rendering, and smart auto-scroll.
- Bot management (add / edit / delete) and per-bot settings.
- Message context menu (copy / delete) and clear-chat actions.
- Responsive design for desktop and mobile, plus Capacitor Android and Electron desktop builds.
- Input sanitization, connection timeouts, host-validation warnings, and token masking.

[Unreleased]: https://github.com/ncsound919/Open-Chat/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/ncsound919/Open-Chat/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ncsound919/Open-Chat/releases/tag/v1.0.0
