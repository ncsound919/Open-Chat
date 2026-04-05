# Agent Protocol Integration Guide

Open-Chat now supports **four protocols** for connecting to AI agents:

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

---

## 🔧 Protocol Comparison

| Feature | Hermes | OpenClaw | Uplift Bridge | SubTeam |
|---------|--------|----------|---------------|---------|
| **Transport** | HTTP/SSE | WebSocket | HTTP/Polling | HTTP/SSE |
| **Real-time** | ✅ Streaming | ✅ Streaming | ⚠️ Simulated | ✅ Streaming |
| **Auto-reconnect** | ❌ | ✅ | ⚠️ Manual | ❌ |
| **Auth** | Bearer Token | Token | OAuth | Token (optional) |
| **Use Case** | General chat | Low-latency chat | IDE integration | CPU design |

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

---

## 📚 Additional Resources

- **Uplift Agent**: See [uplift-code README](https://github.com/ncsound919/uplift-code/blob/main/README.md)
- **Sub-Team**: See [Sub-Team README](https://github.com/ncsound919/Sub-Team/blob/main/README.md)
- **Draymond Orchestrator**: Referenced in Sub-Team docs as the centralized agent dashboard

---

## 🎯 Next Steps

1. ✅ Set up your agent servers
2. ✅ Configure Open-Chat with the appropriate protocol
3. ✅ Start chatting with your agents!
4. 📈 Monitor connection status in the Inbox sidebar
5. 🔧 Customize agent behavior via Settings

For issues or questions, open an issue on the [Open-Chat GitHub repo](https://github.com/ncsound919/Open-Chat/issues).
