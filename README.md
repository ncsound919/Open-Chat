# Open-Chat

**A private, Signal-style chat interface for autonomous agents** (OpenClaw & Hermes)

Open-Chat is a clean, local-first messaging app designed to replace Telegram/Slack/Discord as the control surface for autonomous agents. Chat directly with your AI agents through a beautiful, responsive interface — no third-party platforms required.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Why Open Chat?

**Third-party messaging platforms are fundamentally insecure for AI agent communication.** Telegram, Slack, Discord, and WhatsApp introduce critical vulnerabilities:

- 🔓 **Token Exposure** — Bot credentials leak through GitHub, logs, and infrastructure breaches
- 🕵️ **No E2E Encryption** — Platform employees and attackers can read all your conversations
- 🎯 **C2 Attack Vector** — Your bot shares infrastructure with active malware operations
- ⛔ **Rate Limits & Bans** — Arbitrary account suspensions and message throttling
- 📊 **Data Retention** — Your messages stored indefinitely on third-party servers
- 🌐 **Platform Dependency** — Outages, API changes, and vendor lock-in

**Open Chat's local-first architecture removes the third-party platform layer** — connecting directly to `127.0.0.1` means no platform server ever sees your messages or credentials. The current build ships with input sanitization, connection timeouts, host validation warnings, token masking, and an Error Boundary for graceful recovery.

> ⚠️ **Threat model note:** Full security requires running with the default localhost-only configuration. Bot tokens stored in Settings are currently saved as plaintext in `localStorage` — avoid high-value tokens until token encryption is added in a future release.

👉 **[Read the full security analysis and implementation status](./SECURITY.md)**

## Features

### ✨ Current (MVP)
- **Multi-Agent Support**: Chat with OpenClaw (WebSocket), Hermes (HTTP), Uplift Bridge, SubTeam, and Draymond Orchestrator agents
- **Real-Time Streaming**: See AI responses as they're generated, token by token
- **Markdown Rendering**: Code blocks, lists, bold, italic, inline code — all beautifully formatted
- **Local-First**: All data stored in your browser — zero telemetry, 100% private
- **Message Management**: Right-click context menu for copy/delete
- **Bot Configuration**: Easy setup and management of multiple agents
- **Smart Auto-Scroll**: Follows conversation without disrupting reading
- **Connection Status**: Real-time indicators for each agent
- **Auto-Reconnect**: WebSocket connections automatically recover
- **Responsive Design**: Works perfectly on desktop and mobile browsers
- **5 Protocol Support**: OpenClaw, Hermes, Uplift Bridge, SubTeam, Draymond Orchestrator
- **Orchestrator Integration**: Deep integration with Draymond for multi-agent coordination, workflow tracking, and agent discovery

## Quick Start

### Prerequisites
- **Node.js** 18+ and npm
- **One or more agents**: OpenClaw, Hermes, Uplift Agent, SubTeam, or Draymond Orchestrator

### Installation

```bash
# Clone the repository
git clone https://github.com/ncsound919/Open-Chat.git
cd Open-Chat

# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:3000 in your browser
```

### Building for Production

```bash
# Build optimized bundle
npm run build

# Preview production build
npm run preview
```

## Configuration

### OpenClaw Setup

1. Start OpenClaw with gateway enabled: `openclaw --gateway`
2. In Open-Chat, configure your bot:
   - **Protocol**: OpenClaw (WebSocket)
   - **Host**: `127.0.0.1` / **Port**: `18789`
   - **Token**: Set `OPENCLAW_GATEWAY_TOKEN` (optional)

### Hermes Setup

1. Start Hermes agent with API server: `hermes --api-server`
2. Configure CORS in Hermes `.env`: `API_SERVER_CORS_ORIGINS=*`
3. In Open-Chat, configure your bot:
   - **Protocol**: Hermes (HTTP)
   - **Host**: `127.0.0.1` / **Port**: `8642`
   - **Token**: Your `API_SERVER_KEY` (if set)

### Uplift Bridge Setup

1. Start Uplift in remote control mode: `uplift remote-control`
2. Complete OAuth authentication to get your access token
3. In Open-Chat, configure your bot:
   - **Protocol**: Uplift Bridge (Uplift Agent)
   - **Host**: Your bridge endpoint host
   - **Port**: Your bridge endpoint port
   - **Token**: Your OAuth access token

### SubTeam / Draymond Setup

1. Set up a SubTeam HTTP wrapper (see [AGENT_INTEGRATION.md](./AGENT_INTEGRATION.md))
2. Start your wrapper server
3. In Open-Chat, configure your bot:
   - **Protocol**: SubTeam (CPU Design / Draymond)
   - **Host**: `127.0.0.1`
   - **Port**: Your wrapper port (e.g., `8643`)
   - **Token**: Optional auth token

### Draymond Orchestrator Setup

1. Start Draymond Orchestrator with all agents registered
2. Ensure the orchestrator API is running (default port: `8644`)
3. In Open-Chat, configure your bot:
   - **Protocol**: Draymond Orchestrator (Multi-Agent)
   - **Host**: `127.0.0.1`
   - **Port**: `8644`
   - **Token**: Your orchestrator API key (if required)

This enables deep integration features:
- **Agent Discovery**: Automatically discover available agents and their capabilities
- **Multi-Agent Coordination**: Submit tasks that coordinate across multiple specialized agents
- **Workflow Tracking**: Monitor multi-phase workflows with real-time status updates
- **Tool Execution Monitoring**: Track which agents are executing which tools
- **Event Stream**: Real-time SSE updates for all orchestrator activities

📘 **For detailed setup instructions**, see [AGENT_INTEGRATION.md](./AGENT_INTEGRATION.md)

## Usage

### Managing Bots
- **Add Bot**: Click `+` button in Inbox
- **Edit Bot**: Click ⚙️ icon next to any bot
- **Delete Bot**: Open Settings → Delete

### Chatting
- **Send Message**: Type and press Enter (Shift+Enter for new line)
- **Copy Message**: Right-click message → Copy text
- **Delete Message**: Right-click message → Delete
- **Clear Chat**: Click menu (⋮) in chat header → Clear Chat

## Roadmap

See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for details.

### Phase 1 (Current - MVP) ✅
- ✅ Multi-agent support (OpenClaw + Hermes)
- ✅ Real-time streaming & markdown rendering
- ✅ Message context menu & bot management
- ✅ Auto-reconnect & smart auto-scroll

### Phase 2+ (Future)
- Multi-channel support & agent tagging
- Enhanced search & IndexedDB storage
- Tool execution console & developer mode
- Team features & automation engine

## Development

```bash
npm run dev      # Start dev server (localhost:3000)
npm run build    # Build for production
npm run preview  # Preview production build
```

## License

MIT License - see [LICENSE](./LICENSE) file

## Credits

Created by [@ncsound919](https://github.com/ncsound919) | Built for the agent-native future 🤖
