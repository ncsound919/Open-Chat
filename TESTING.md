# Testing Guide for Open-Chat

## Pre-Testing Checklist

Before running the app, ensure you have:

- [ ] Node.js 18+ installed (`node --version`)
- [ ] npm installed (`npm --version`)
- [ ] OpenClaw or Hermes agent available for testing

## Installation & First Run

### 1. Install Dependencies

```bash
cd /home/runner/work/Open-Chat/Open-Chat
npm install
```

**Expected**: Clean installation with no errors. Check for:
- React 18.2.0
- Vite 5.0.8
- @vitejs/plugin-react

### 2. Start Development Server

```bash
npm run dev
```

**Expected Output**:
```
  VITE v5.0.8  ready in 300 ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
```

### 3. Open in Browser

Navigate to `http://localhost:3000`

**Expected**: App loads with:
- "Messages" header
- Two default bots (OpenClaw 🦞, Hermes ☿)
- Search bar
- Clean, dark UI

## Feature Testing

### Test 1: Basic UI Functionality

- [ ] App loads without console errors
- [ ] Inbox displays two default bots
- [ ] Search bar filters bots by name
- [ ] Click on a bot opens chat view
- [ ] Back button returns to inbox
- [ ] UI transitions are smooth (0.28s cubic-bezier)

### Test 2: Bot Management

#### Add New Bot
1. Click `+` button in Inbox
2. Fill in bot details:
   - Name: "Test Bot"
   - Avatar: 🤖
   - Protocol: Hermes
   - Host: 127.0.0.1
   - Port: 8642
3. Click "Create Bot"

**Expected**: New bot appears in inbox list

#### Edit Bot
1. Click ⚙️ icon next to any bot
2. Change port number
3. Click "Save & Reconnect"

**Expected**: Bot settings updated, connection attempt made

#### Delete Bot
1. Open bot settings
2. Click "Delete" button
3. Confirm deletion

**Expected**: Bot removed from list, history cleared

### Test 3: Connection Status (Without Agents)

Since agents may not be running yet, test connection indicators:

**OpenClaw (WS):**
- [ ] Initial status: "connecting…" (yellow)
- [ ] After timeout: "error" or "offline" (red/gray)
- [ ] Hover shows connection status

**Hermes (HTTP):**
- [ ] Initial status: "connecting…"
- [ ] After health check: "offline" (gray) or "error" (red)

### Test 4: UI Components

#### Message Input
- [ ] Textarea expands as you type (up to 120px)
- [ ] Enter sends message (should fail without connection)
- [ ] Shift+Enter creates new line
- [ ] Send button enables when text entered
- [ ] Send button color matches bot color

#### Empty State
- [ ] New chat shows bot avatar, name, tagline
- [ ] Shows connection info (ws:// or http://)

#### Chat Header
- [ ] Shows bot avatar and name
- [ ] Shows connection status
- [ ] Kebab menu (⋮) opens dropdown
- [ ] Dropdown has "Settings" and "Clear Chat"

### Test 5: With Running Agent (If Available)

If you have OpenClaw or Hermes running:

#### OpenClaw Connection
```bash
# Start OpenClaw with gateway
openclaw --gateway

# If using token:
export OPENCLAW_GATEWAY_TOKEN=your-token
```

In Open-Chat:
1. Open OpenClaw settings
2. Verify host (127.0.0.1) and port (18789)
3. Add token if set
4. Save & Reconnect

**Expected**: Status changes to "online" (green)

#### Hermes Connection
```bash
# Start Hermes with API server
hermes --api-server

# Ensure CORS is set in .env:
API_SERVER_CORS_ORIGINS=*
```

In Open-Chat:
1. Open Hermes settings
2. Verify host (127.0.0.1) and port (8642)
3. Save & Reconnect

**Expected**: Status changes to "online" (green)

#### Send Messages
1. Type "Hello, can you help me?"
2. Press Enter

**Expected**:
- Message appears in chat (right-aligned, bot color)
- Placeholder bot message appears (left-aligned, gray)
- Streaming dots animation appears
- Tokens stream in character by character
- Streaming dots disappear when complete
- User message shows double-check (✓✓)

#### Test Markdown Rendering

Send these test messages:

**Code Block:**
```
Can you show me a Python hello world?
```

**Expected**: Agent response renders with:
- Syntax-highlighted code block
- Language label (e.g., "python")
- Proper formatting

**Bold/Italic:**
```
Tell me about **important** concepts and *subtle* details
```

**Expected**: **Bold** text rendered, *italic* text rendered

**Lists:**
```
Give me a numbered list of 5 things
```

**Expected**: Ordered list (1. 2. 3.) properly formatted

#### Test Message Context Menu
1. Right-click on any message
2. Click "Copy text"

**Expected**: Message copied to clipboard, button shows "Copied!"

3. Right-click on message again
4. Click "Delete"

**Expected**: Message removed from chat

#### Test Clear Chat
1. Send several messages
2. Click kebab menu (⋮) in header
3. Click "Clear Chat"
4. Confirm

**Expected**: All messages deleted, empty state shown

#### Test Interrupt
1. Send a long request (e.g., "Write a 500 word essay")
2. While streaming, click red stop button

**Expected**: Streaming stops, message shows "[interrupted]"

### Test 6: Unread Messages

1. Open chat with Bot A
2. Receive/send messages
3. Go back to inbox
4. Open chat with Bot B
5. Receive/send messages
6. Go back to inbox

**Expected**:
- Bot A shows unread badge (if bot sent messages)
- Unread count shown (1-9 or "9+" if more)
- Badge disappears when chat reopened

### Test 7: Auto-Scroll Behavior

1. Send enough messages to fill the screen
2. Scroll to top of conversation
3. Send new message

**Expected**: Screen does NOT auto-scroll (you're reading history)

4. Scroll to bottom (within 80px of bottom)
5. Receive streaming response

**Expected**: Screen DOES auto-scroll with response

### Test 8: Auto-Reconnect (OpenClaw)

1. Connect to OpenClaw successfully
2. Stop OpenClaw agent
3. Observe status change to "disconnected"
4. Restart OpenClaw agent
5. Wait up to 30 seconds

**Expected**: Auto-reconnect, status returns to "online"

### Test 9: Search Functionality

1. Go to inbox
2. Type bot name in search
3. Observe filtering

**Expected**: Only matching bots shown

4. Clear search

**Expected**: All bots shown again

### Test 10: localStorage Persistence

1. Send messages to multiple bots
2. Add custom bot
3. Close browser tab
4. Reopen http://localhost:3000

**Expected**:
- All bots still present (including custom)
- All message history intact
- Last connection status remembered

## Production Build Testing

### Build the App

```bash
npm run build
```

**Expected Output**:
```
✓ built in 3.5s
dist/index.html                  0.45 kB │ gzip:  0.30 kB
dist/assets/index-[hash].css     1.82 kB │ gzip:  0.93 kB
dist/assets/index-[hash].js    143.24 kB │ gzip: 46.18 kB
```

### Preview Production Build

```bash
npm run preview
```

**Expected**: Builds successfully, no errors

Open preview URL and repeat core functionality tests.

### Build Verification

- [ ] No console errors
- [ ] All features work in production build
- [ ] App loads quickly (< 2s)
- [ ] Smooth performance, no lag
- [ ] Bundle size reasonable (< 500KB total)

## Common Issues & Solutions

### Issue: Port 3000 already in use
**Solution**: Use different port: `npm run dev -- --port 3001`

### Issue: npm install fails
**Solution**:
```bash
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
```

### Issue: Vite doesn't start
**Solution**: Check Node.js version (need 18+)

### Issue: "Cannot connect to agent"
**Solution**:
1. Verify agent is running
2. Check host/port match agent config
3. Check CORS settings (Hermes)
4. Check firewall/security settings

### Issue: Messages don't stream
**Solution**:
1. Check browser console for errors
2. Verify WebSocket connection (OpenClaw)
3. Verify SSE connection (Hermes)
4. Check agent logs

### Issue: Markdown not rendering
**Solution**: Check browser console, verify markdown.jsx is loaded

### Issue: Auto-scroll not working
**Solution**: Known behavior - only scrolls if within 80px of bottom

## Performance Testing

### Metrics to Check

1. **Initial Load**: Should be < 2s
2. **Message Send**: Should be < 100ms
3. **Streaming**: Should show tokens in real-time
4. **Search**: Should filter instantly
5. **Transitions**: Should be smooth (no jank)

### Load Testing

1. Send 100+ messages
2. Add 10+ bots
3. Switch between chats rapidly

**Expected**: No performance degradation, smooth UI

## Browser Compatibility

Test in multiple browsers:
- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari

**Expected**: Works in all modern browsers

## Mobile Responsive Testing

1. Open browser DevTools
2. Toggle device toolbar
3. Test on mobile viewport (375px wide)

**Expected**:
- UI adapts to narrow screen
- All features accessible
- Touch-friendly buttons
- No horizontal scroll

## Accessibility Testing

- [ ] Keyboard navigation works
- [ ] Focus indicators visible
- [ ] Color contrast sufficient
- [ ] Screen reader friendly (basic)

## Security Testing

- [ ] No console warnings about insecure content
- [ ] localStorage data encrypted (basic obfuscation)
- [ ] No tokens leaked in console
- [ ] No external network requests (except to localhost agents)

## Final Checklist

Before declaring testing complete:

- [ ] All core features work
- [ ] No console errors
- [ ] Production build successful
- [ ] Performance acceptable
- [ ] Tested with at least one agent
- [ ] localStorage persistence works
- [ ] Documentation accurate
- [ ] Known issues documented

## Reporting Issues

If you find bugs, report them with:
1. **Steps to reproduce**
2. **Expected behavior**
3. **Actual behavior**
4. **Browser/OS**
5. **Console errors (if any)**
6. **Screenshots (if applicable)**

## Next Steps After Testing

1. **Document any issues** found during testing
2. **Fix critical bugs** that prevent core functionality
3. **Optimize** based on performance metrics
4. **Polish** UI/UX based on user feedback
5. **Prepare for deployment** (Gumroad, static hosting, etc.)

---

**Testing Complete?** Create a test report summarizing findings and readiness for launch.
