# Open-Chat

**A private, Signal-style chat interface for autonomous agents** (OpenClaw & Hermes)

Open-Chat is a clean, local-first messaging app designed to replace Telegram/Slack/Discord as the control surface for autonomous agents. Chat directly with your AI agents through a beautiful, responsive interface — no third-party platforms required.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

### ✨ Current (MVP)
- **Multi-Agent Support**: Chat with OpenClaw (WebSocket) and Hermes (HTTP) agents
- **Real-Time Streaming**: See AI responses as they're generated, token by token
- **Markdown Rendering**: Code blocks, lists, bold, italic, inline code — all beautifully formatted
- **Local-First**: All data stored in your browser — zero telemetry, 100% private
- **Message Management**: Right-click context menu for copy/delete
- **Bot Configuration**: Easy setup and management of multiple agents
- **Smart Auto-Scroll**: Follows conversation without disrupting reading
- **Connection Status**: Real-time indicators for each agent
- **Auto-Reconnect**: WebSocket connections automatically recover
- **Responsive Design**: Works perfectly on desktop and mobile browsers

## Quick Start

### Prerequisites
- **Node.js** 18+ and npm
- **OpenClaw** or **Hermes** agent running locally

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
