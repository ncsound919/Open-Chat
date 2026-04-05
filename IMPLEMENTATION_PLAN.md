# Open-Chat Implementation Plan

## Project Overview
Open-Chat is a private, agent-native chat application designed to replace Telegram/Slack as the control surface for autonomous agents like OpenClaw and Hermes. This document outlines the implementation strategy for building a production-ready $10 Gumroad product.

## Current State
- **Repository**: Basic structure with App (React component), Breakdown (feature requirements), README
- **Existing Code**: Single-file React app with OpenClaw (WebSocket) and Hermes (HTTP) protocol support
- **Known Issues**:
  - Components defined inside App causing re-render issues
  - Missing textarea auto-resize
  - No WebSocket reconnection
  - Incomplete UI features (menu, clear chat)
  - No markdown rendering
  - App file is truncated at line 1082

## Architecture Decisions

### Technology Stack
- **Frontend Framework**: React 18+
- **Build Tool**: Vite (fast, modern, better DX than CRA)
- **Language**: JavaScript (TypeScript optional for v2)
- **Styling**: Inline styles + CSS modules for animations
- **State Management**: React Context + useReducer for complex state
- **Local Storage**: LocalStorage for settings, IndexedDB for messages/history
- **Desktop**: Electron wrapper (future enhancement)

### Project Structure
```
Open-Chat/
├── public/
│   └── index.html
├── src/
│   ├── components/
│   │   ├── Inbox.jsx
│   │   ├── Chat.jsx
│   │   ├── Settings.jsx
│   │   ├── MessageBubble.jsx
│   │   └── icons/
│   ├── protocols/
│   │   ├── OpenClawClient.js
│   │   └── HermesClient.js
│   ├── hooks/
│   │   ├── useAutoResize.js
│   │   └── useScrollFollow.js
│   ├── utils/
│   │   ├── storage.js
│   │   ├── markdown.js
│   │   └── helpers.js
│   ├── contexts/
│   │   └── AppContext.jsx
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── package.json
├── vite.config.js
└── README.md
```

## Implementation Phases

### Phase 1: Foundation & MVP (Sprint 1-2) - CURRENT FOCUS

#### 1.1 Project Setup ✓ NEXT
- [x] Create package.json with dependencies
- [x] Set up Vite configuration
- [x] Create proper directory structure
- [x] Move existing App code to src/
- [ ] Set up build and dev scripts

**Dependencies**:
```json
{
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "marked": "^11.0.0" or custom markdown parser
}
```

#### 1.2 Bug Fixes (Critical)
- [ ] Move Inbox, Chat, Settings components outside App
- [ ] Implement useAutoResize hook for textarea
- [ ] Add smart auto-scroll with scroll position tracking
- [ ] Implement WebSocket reconnection with exponential backoff
- [ ] Wire up clearChat and showMenu functionality
- [ ] Complete the truncated App file code

#### 1.3 Missing MVP Features
- [ ] Markdown rendering for bot messages (code blocks, lists, bold, italic)
- [ ] Message context menu (right-click: Copy, Delete)
- [ ] Add/Remove bot functionality in UI
- [ ] Cap unread badge at "9+"
- [ ] Export unread count display helper

#### 1.4 Code Quality
- [ ] Extract protocol clients into separate files
- [ ] Create reusable hooks
- [ ] Add PropTypes or TypeScript interfaces
- [ ] Improve error handling
- [ ] Add loading states

### Phase 2: Multi-Channel & Security (Sprint 3-4)

#### 2.1 Multi-Channel Support
- [ ] Group chat with multiple agents
- [ ] Human ↔ agent ↔ human routing
- [ ] Channel creation UI
- [ ] Channel list management
- [ ] Real-time streaming for multiple agents

#### 2.2 Agent Routing & Tagging
- [ ] @mention system for agent tagging
- [ ] Agent switching within chat
- [ ] Agent → Channel mapping
- [ ] Multi-agent orchestration UI

#### 2.3 Security Features (Basic)
- [ ] Better local storage encryption
- [ ] Device pairing UI for OpenClaw
- [ ] Audit log viewer for agent actions
- [ ] Permission prompts for sensitive operations
- [ ] Zero telemetry mode toggle

### Phase 3: Memory & Context (Sprint 5-6)

#### 3.1 Enhanced Memory System
- [ ] IndexedDB integration for message history
- [ ] Full-text search across conversations
- [ ] Advanced search filters (date, agent, keywords)
- [ ] Per-agent memory isolation
- [ ] Memory export/import

#### 3.2 Context Management
- [ ] Context injection interface
- [ ] Team-shared memory spaces
- [ ] Memory summarization
- [ ] Context size management

### Phase 4: Tools & Developer Mode (Sprint 7-8)

#### 4.1 Skill/Tool Execution Console
- [ ] Skill invocation UI
- [ ] Tool call log viewer with expandable details
- [ ] File upload/download interface
- [ ] Sandboxed execution result display
- [ ] Error trace viewer with stack traces
- [ ] Cron/automation scheduling UI

#### 4.2 Developer Mode
- [ ] Live log streaming viewer
- [ ] Agent config JSON editor
- [ ] Model switching dropdown (Claude/GPT/Gemini/etc)
- [ ] Webhook tester
- [ ] Local LLM endpoint tester
- [ ] Debug mode toggle

### Phase 5: Team & Collaboration (Sprint 9-10)

#### 5.1 Team Features
- [ ] Role-based access control
- [ ] Team spaces creation
- [ ] Shared agent configurations
- [ ] Shared memory vaults
- [ ] Admin console
- [ ] Compliance mode

#### 5.2 Collaboration Tools
- [ ] Invite system
- [ ] Team member management
- [ ] Activity feed
- [ ] Notification system

### Phase 6: Advanced Features (Sprint 11-12)

#### 6.1 Automation Engine
- [ ] Scheduled task interface
- [ ] Event trigger configuration
- [ ] Multi-step workflow builder
- [ ] Parallel subagent support
- [ ] Retry logic configuration

#### 6.2 Agent Identity System
- [ ] Avatar upload/customization
- [ ] Personality profile editor
- [ ] Agent stats dashboard
- [ ] Nameplate customization
- [ ] Agent performance metrics

#### 6.3 Plugin Marketplace (V2)
- [ ] Skill marketplace UI
- [ ] Plugin versioning
- [ ] Ratings and reviews
- [ ] Dependency scanning
- [ ] One-click install

### Phase 7: Polish & Distribution (Sprint 13+)

#### 7.1 Cross-Platform
- [ ] Responsive mobile design
- [ ] PWA support
- [ ] Electron desktop wrapper
- [ ] iOS/Android (React Native - future)

#### 7.2 Distribution
- [ ] Build optimization
- [ ] Gumroad integration
- [ ] License key system
- [ ] Auto-update mechanism
- [ ] Documentation site

## MVP Feature Set (Phase 1 Target)

The minimum viable product for the $10 Gumroad sale includes:

1. **Core Chat Features**
   - ✓ Support for OpenClaw and Hermes protocols
   - ✓ Real-time message streaming
   - ✓ Multiple bot management
   - ✓ Persistent chat history
   - ✓ Markdown rendering

2. **User Experience**
   - ✓ Signal-style clean interface
   - ✓ Inbox with unread counts
   - ✓ Search across agents
   - ✓ Message copy/delete
   - ✓ Settings per bot

3. **Reliability**
   - ✓ Auto-reconnect for WebSocket
   - ✓ Error handling and display
   - ✓ Loading states
   - ✓ Offline support (local-first)

4. **Developer Features**
   - ✓ Easy bot configuration
   - ✓ Connection status indicators
   - ✓ Protocol debugging info

## Technical Specifications

### OpenClaw Protocol (WebSocket)
- **Endpoint**: `ws://host:port` (default: ws://127.0.0.1:18789)
- **Authentication**: Optional token via `OPENCLAW_GATEWAY_TOKEN`
- **Handshake**: JSON-RPC with protocol version negotiation
- **Messages**: Streaming via `event:agent` and final via `res:agent`
- **Reconnection**: Auto-reconnect with 5s backoff

### Hermes Protocol (HTTP/SSE)
- **Endpoint**: `http://host:port/v1/chat/completions` (default: http://127.0.0.1:8642)
- **Authentication**: Bearer token via `API_SERVER_KEY`
- **Format**: OpenAI-compatible API
- **Streaming**: Server-Sent Events (SSE)
- **CORS**: Requires `API_SERVER_CORS_ORIGINS=*` in agent .env

### Data Storage

#### LocalStorage (Settings & Config)
```javascript
{
  "openchat_conf_v1": [
    {
      "id": "string",
      "name": "string",
      "avatar": "emoji",
      "color": "#hex",
      "tagline": "string",
      "protocol": "openclaw" | "hermes",
      "host": "string",
      "port": number,
      "token": "string"
    }
  ]
}
```

#### IndexedDB (Messages - Future)
- Database: `openchat_db`
- Store: `messages` (indexed by botId, timestamp)
- Store: `memory` (indexed by botId, searchable)

## Security Considerations

### Current (Phase 1)
- Local-first storage (no cloud sync)
- Tokens stored in localStorage (browser security)
- All communication over localhost
- No telemetry or analytics

### Future Enhancements
- Optional E2E encryption for shared spaces
- Secure credential storage (OS keychain integration)
- Audit logging for all agent actions
- Skill permission sandboxing
- Supply chain attack prevention

## Performance Targets

- **Initial Load**: < 2s
- **Message Send**: < 100ms to UI
- **Streaming**: Real-time token display
- **Search**: < 500ms for 10k messages
- **Memory**: < 100MB for typical usage

## Testing Strategy

### Phase 1
- Manual testing with OpenClaw and Hermes agents
- Browser testing (Chrome, Firefox, Safari)
- Connection failure scenarios
- Large message handling

### Future
- Unit tests for protocol clients
- Integration tests for message flow
- E2E tests with Playwright
- Performance benchmarks

## Deployment

### Development
```bash
npm install
npm run dev
```

### Production Build
```bash
npm run build
# Outputs to dist/ directory
```

### Distribution
1. Build optimized production bundle
2. Package with license check
3. Upload to Gumroad as download
4. Provide installation instructions

## Success Metrics

### MVP Launch
- Stable connection to both protocols
- Zero critical bugs in core chat flow
- Clean, intuitive UI
- Complete documentation
- 5+ satisfied beta testers

### Post-Launch
- 100+ sales in first month
- < 5% refund rate
- Active user feedback loop
- Feature requests prioritization

## Timeline Estimate

- **Phase 1 (MVP)**: 2-3 weeks
- **Phase 2-3**: 3-4 weeks
- **Phase 4-5**: 3-4 weeks
- **Phase 6-7**: 4-5 weeks

**Total to Full Feature Set**: ~3-4 months
**MVP Launch Target**: 2-3 weeks

## Next Steps (Immediate)

1. ✅ Create this implementation plan
2. ⏭️ Set up package.json and Vite config
3. ⏭️ Create directory structure
4. ⏭️ Complete the truncated App.jsx file
5. ⏭️ Extract components and refactor
6. ⏭️ Fix critical bugs
7. ⏭️ Add missing MVP features
8. ⏭️ Test with real agents
9. ⏭️ Polish and package
10. ⏭️ Launch on Gumroad

## Resources

- OpenClaw Gateway Docs: Check OpenClaw GitHub for WebSocket protocol
- Hermes Agent Docs: OpenAI-compatible API reference
- React Docs: https://react.dev
- Vite Docs: https://vitejs.dev
- Marked.js (Markdown): https://marked.js.org

---

**Last Updated**: 2026-04-05
**Status**: Phase 1 - Foundation & MVP
**Next Milestone**: Complete project setup and fix critical bugs
