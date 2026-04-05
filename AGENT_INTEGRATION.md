# Agent Protocol Integration Guide

Open-Chat now supports **five protocols** for connecting to AI agents:

## 📋 Supported Protocols

### 1. **Hermes (HTTP / OpenAI-compatible)**
- **Type**: HTTP with Server-Sent Events (SSE)
- **Default Port**: 8642
- **Use Case**: Standard OpenAI-compatible agents
- **Endpoint**: `http://127.0.0.1:8642/v1/chat/completions`

### 2. **OpenClaw (WebSocket)**
- **Type**: JSON-RPC over WebSocket
- **Default Port**: 18789
- **Use Case**: Low-latency persistent connections
- **Endpoint**: `ws://127.0.0.1:18789`

### 3. **Uplift Bridge (Uplift Agent)** 🆕
- **Type**: HTTP REST API with polling
- **Default Port**: Custom (set by your Uplift instance)
- **Use Case**: Connecting to Uplift Agent remote sessions
- **Architecture**: Bridge-based with environment registration
- **Endpoint**: `http://127.0.0.1:<port>/v1/environments/bridge`

### 4. **SubTeam (CPU Design / Draymond)** 🆕
- **Type**: HTTP with SSE (Hermes-compatible)
- **Default Port**: Custom (set by your wrapper server)
- **Use Case**: CPU design automation via Sub-Team agent
- **Draymond Integration**: Registered in Draymond orchestrator
- **Endpoint**: `http://127.0.0.1:<port>/v1/chat/completions`

### 5. **Draymond Orchestrator (Multi-Agent)** 🆕
- **Type**: HTTP with SSE + Real-time event stream
- **Default Port**: 8644
- **Use Case**: Multi-agent coordination and workflow orchestration
- **Deep Integration**: Agent discovery, workflow tracking, tool execution monitoring
- **Endpoint**: `http://127.0.0.1:8644/v1/orchestrate`

---

## 🚀 Quick Start

### Setting Up Uplift Bridge

1. **Start Uplift in Bridge Mode**:
   ```bash
   uplift remote-control
   # or
   uplift code --bridge
   ```

2. **Get Your OAuth Token**:
   - Follow Uplift's authentication flow
   - Copy your access token

3. **Add Bot in Open-Chat**:
   - Click `+` to add a new bot
   - Select **"Uplift Bridge (Uplift Agent)"**
   - Enter host and port (e.g., `127.0.0.1:8080`)
   - Paste your OAuth token
   - Save configuration

### Setting Up SubTeam Agent

SubTeam is a deterministic CPU design agent that's part of the Draymond orchestrator ecosystem.

#### Option 1: Using Existing HTTP Wrapper

If you already have a SubTeam HTTP wrapper running:

1. **Add Bot in Open-Chat**:
   - Click `+` to add a new bot
   - Select **"SubTeam (CPU Design / Draymond)"**
   - Enter host and port where your wrapper is running
   - (Optional) Add auth token if required
   - Save configuration

#### Option 2: Create a Simple HTTP Wrapper

Create a Python wrapper around Sub-Team's API:

```python
# subteam_wrapper.py
from flask import Flask, request, Response
from sub_team import CPU, ISA, PipelineTemplate
from sub_team import SpecificationAgent, MicroarchitectureAgent
from sub_team import ImplementationAgent, VerificationAgent
import json

app = Flask(__name__)

@app.route('/v1/health')
def health():
    return {'status': 'ok'}

@app.route('/v1/chat/completions', methods=['POST'])
def chat():
    data = request.json
    messages = data.get('messages', [])
    user_message = messages[-1]['content'] if messages else ''

    # Parse user intent and invoke appropriate Sub-Team tool
    # Example: "Design a RISC-V CPU with 5-stage pipeline"

    try:
        # Simple intent matching
        if 'design' in user_message.lower() or 'create' in user_message.lower():
            # Run full pipeline
            cpu = CPU(
                isa=ISA.RV32I,
                pipeline=PipelineTemplate.FIVE_STAGE,
                forwarding=True
            )
            spec = SpecificationAgent().run(cpu)
            plan = MicroarchitectureAgent().run(spec)
            rtl = ImplementationAgent().run(spec, plan)
            report = VerificationAgent().run(spec, rtl)

            response_text = f"CPU design completed!\\n\\n{report.summary()}"
        elif 'verify' in user_message.lower():
            response_text = "Verification requested. Please provide RTL files."
        else:
            response_text = "I can help you design CPUs! Try: 'Design a RISC-V 5-stage pipeline CPU'"

        # Stream response in OpenAI format
        def generate():
            chunk_size = 10
            for i in range(0, len(response_text), chunk_size):
                chunk = response_text[i:i+chunk_size]
                yield f"data: {json.dumps({'choices': [{'delta': {'content': chunk}}]})}\n\n"
            yield "data: [DONE]\n\n"

        return Response(generate(), mimetype='text/event-stream')

    except Exception as e:
        return {'error': str(e)}, 500

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=8643)
```

Run the wrapper:
```bash
python subteam_wrapper.py
```

Then connect Open-Chat to `127.0.0.1:8643` using the SubTeam protocol.

### Setting Up Draymond Orchestrator

Draymond Orchestrator provides deep multi-agent coordination capabilities.

#### Prerequisites

1. **Running Draymond Orchestrator**: Ensure you have the orchestrator running with agents registered
2. **API Endpoint**: The orchestrator must expose its API (default port: `8644`)
3. **Registered Agents**: At least one agent registered in the orchestrator

#### Connection Steps

1. **Start Draymond Orchestrator**:
   ```bash
   # Example startup (actual command depends on your setup)
   draymond-orchestrator --port 8644 --api-key YOUR_KEY
   ```

2. **Verify Agent Registration**:
   ```bash
   # Check registered agents
   curl http://127.0.0.1:8644/v1/agents
   ```

3. **Add Bot in Open-Chat**:
   - Click `+` to add a new bot
   - Select **"Draymond Orchestrator (Multi-Agent)"**
   - Enter host: `127.0.0.1`
   - Enter port: `8644`
   - (Optional) Add API key if required
   - Save configuration

4. **Verify Connection**:
   - Check that the bot status shows "connected" (green dot)
   - The orchestrator will automatically discover available agents
   - Agent capabilities are stored locally for offline reference

#### Deep Integration Features

Once connected, you get access to advanced orchestrator features:

**Agent Discovery**
- Open-Chat automatically discovers all agents registered in the orchestrator
- Agent capabilities are cached locally
- Real-time updates when agents are added/removed

**Multi-Agent Coordination**
- Submit complex tasks that require multiple specialized agents
- The orchestrator automatically routes work to appropriate agents
- Parallel execution where possible

**Workflow Tracking**
- Monitor multi-phase workflows in real-time
- See which phase is currently executing
- Track progress across agent boundaries

**Tool Execution Monitoring**
- View which agents are executing which tools
- Track execution duration and results
- Execution log persisted locally (last 1000 executions)

**Event Stream**
- Real-time SSE updates for all orchestrator events
- Agent status changes, workflow updates, tool executions
- Automatic reconnection with exponential backoff

#### Expected API Endpoints

The Draymond Orchestrator integration expects these endpoints:

**Agent Management**:
- `GET /v1/agents` - List all registered agents with capabilities
- `GET /v1/health` - Health check

**Orchestration**:
- `POST /v1/orchestrate` - Submit task for multi-agent coordination
  ```json
  {
    "workflow_id": "uuid",
    "task": "Design a RISC-V CPU with 5-stage pipeline",
    "stream": true,
    "metadata": {
      "client": "open-chat",
      "version": "1.0.0"
    }
  }
  ```

**Workflow Tracking**:
- `GET /v1/workflows/{workflowId}` - Get workflow status
- `DELETE /v1/workflows/{workflowId}` - Cancel workflow

**Events (SSE)**:
- `GET /v1/events?token={token}` - Real-time event stream
  - Events: `agent.registered`, `agent.updated`, `workflow.started`, `workflow.updated`, `phase.completed`, `tool.executed`, `workflow.completed`, `workflow.failed`

#### Example Workflow

1. User sends message: "Design a 5-stage pipelined RISC-V CPU"
2. Open-Chat creates workflow and submits to orchestrator
3. Orchestrator coordinates:
   - SpecificationAgent → generates CPU specification
   - MicroarchitectureAgent → designs pipeline stages
   - ImplementationAgent → generates RTL code
   - VerificationAgent → runs test suite
4. Real-time updates show progress through each phase
5. Tool executions are logged with duration and results
6. Final result aggregated and displayed

---

## 🔧 Protocol Comparison

| Feature | Hermes | OpenClaw | Uplift Bridge | SubTeam | Draymond |
|---------|--------|----------|---------------|---------|----------|
| **Transport** | HTTP/SSE | WebSocket | HTTP/Polling | HTTP/SSE | HTTP/SSE + Events |
| **Real-time** | ✅ Streaming | ✅ Streaming | ⚠️ Simulated | ✅ Streaming | ✅ Streaming |
| **Auto-reconnect** | ❌ | ✅ | ⚠️ Manual | ❌ | ✅ (events only) |
| **Auth** | Bearer Token | Token | OAuth | Token (optional) | Bearer Token |
| **Use Case** | General chat | Low-latency chat | IDE integration | CPU design | Multi-agent orchestration |
| **Multi-Agent** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Workflow Tracking** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Agent Discovery** | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 🐛 Troubleshooting

### Uplift Bridge Connection Issues

**Problem**: "Authentication failed (401)"
- **Solution**: Regenerate your OAuth token with `uplift login`

**Problem**: "Environment expired (410)"
- **Solution**: Restart your bridge session with `uplift remote-control`

### SubTeam Connection Issues

**Problem**: "Connection refused"
- **Solution**: Ensure your SubTeam HTTP wrapper is running on the correct port

**Problem**: "No response from agent"
- **Solution**: Check wrapper logs for Python errors in Sub-Team pipeline

### Draymond Orchestrator Connection Issues

**Problem**: "Orchestrator not connected"
- **Solution**: Verify orchestrator is running on the configured port
- Check: `curl http://127.0.0.1:8644/v1/health`

**Problem**: "No agents discovered"
- **Solution**: Ensure agents are registered in the orchestrator
- Check: `curl http://127.0.0.1:8644/v1/agents`

**Problem**: "Event stream disconnected"
- **Solution**: The client auto-reconnects. Check orchestrator logs for errors.
- Maximum reconnect attempts: 5 with exponential backoff

**Problem**: "Workflow stuck in 'in_progress'"
- **Solution**: Check orchestrator logs for agent failures
- Cancel workflow and retry if needed

---

## 📚 Additional Resources

- **Uplift Agent**: See [uplift-code README](https://github.com/ncsound919/uplift-code/blob/main/README.md)
- **Sub-Team**: See [Sub-Team README](https://github.com/ncsound919/Sub-Team/blob/main/README.md)
- **Draymond Orchestrator**: See [Draymond-Orchestrator README](https://github.com/ncsound919/Draymond-Orchestrator/blob/main/README.md)

---

## 🎯 Next Steps

1. ✅ Set up your agent servers
2. ✅ Configure Open-Chat with the appropriate protocol
3. ✅ Start chatting with your agents!
4. 📈 Monitor connection status in the Inbox sidebar
5. 🔧 Customize agent behavior via Settings

For issues or questions, open an issue on the [Open-Chat GitHub repo](https://github.com/ncsound919/Open-Chat/issues).
