# Open-Chat User Manual

Welcome to **Open-Chat** — a private, local-first messaging app for chatting with your
autonomous AI agents. Everything runs on your device; nothing is routed through a
third-party messaging platform.

This manual covers the app as a user. For setup of the agents themselves (OpenClaw,
Hermes, Draymond), see [README.md](../README.md) and [AGENT_INTEGRATION.md](../AGENT_INTEGRATION.md).

---

## Table of Contents

1. [Installing the App](#installing-the-app)
2. [First Launch](#first-launch)
3. [The Screens](#the-screens)
4. [Chatting with Agents](#chatting-with-agents)
5. [Private Local (On-Device AI)](#private-local-on-device-ai)
6. [Phone Control](#phone-control)
7. [Managing Bots](#managing-bots)
8. [Settings](#settings)
9. [Troubleshooting](#troubleshooting)

---

## Installing the App

The app ships as an Android APK (and a desktop Electron app).

**Android (sideload):**

1. Download the latest `.apk` from the **[GitHub Releases](https://github.com/ncsound919/Open-Chat/releases)** page.
2. Open your file manager, find the `.apk`, and tap it.
3. If prompted, enable **Install unknown apps** for your file manager.
4. Tap **Install**, then **Open**.

**Desktop:** run `npm run electron:dev` from the source tree, or use the packaged
installer from `npm run electron:build`.

---

## First Launch

When you open Open-Chat you land on the **Home** (Messages) screen, showing a feed of
your agents' activity. Use the **☰** button to open the navigation drawer and move
between screens.

> The app runs fully on-device. No account, no sign-up, no server.

---

## The Screens

The slide-out **☰ menu** (top-left) lists every destination:

| Screen | What it does |
|--------|--------------|
| **Home** | Activity feed of recent messages and events from all agents. |
| **Chats** | Your per-agent conversations (the inbox). |
| **Agents** | Your configured bots and their status. |
| **Approvals** | Pending human-in-the-loop approvals from agents (e.g. Draymond relay). |
| **Stats** | Usage and activity statistics. |
| **Work** | Asynchronous tasks and skill executions. |
| **Models** | On-device AI models: download, load, benchmark, and chat privately. |
| **Settings** | App-wide preferences, local model scanning, and phone-control status. |
| **Private Local** (shortcut) | Jump straight into a fully on-device AI chat. |

---

## Chatting with Agents

1. Open the **☰** menu → **Chats**.
2. Tap an agent to open its conversation, or use **+** in the inbox to add a new bot.
3. Type at the bottom and press **Enter** to send (**Shift+Enter** = new line).
4. Replies stream in token-by-token in real time.

**Per-message actions:** right-click (long-press on mobile) a message for **Copy** or **Delete**.

**Clear a conversation:** tap the **⋮** menu in a chat's header → **Clear Chat**.

---

## Private Local (On-Device AI)

Open-Chat can run a fully on-device language model (Gemma 3n) so your assistant works
even with no network — and nothing leaves the phone.

**Using it:**

1. Open the **☰** menu → **Private Local** (or **Models** → **Chat privately**).
2. On first use, the Models screen will offer a model to download if none is installed yet.
3. Once loaded, just type and chat — replies are generated on the phone.

**Managing models (Models screen):**

- **Download** — fetch a Gemma model (E4B flagship or E2B fast) to the device.
- **Load** — activate a model for chat.
- **Delete** — remove a downloaded model.
- **Accelerator** — choose **CPU** (fastest for int4, recommended), **GPU**, or **Auto**.
- **Benchmark & skill tests** — measure model speed and run phone/Galaxy skill checks.

> **Tip:** for faster responses you can switch to the smaller **Gemma 3n E2B** model.
> The E4B model is more capable; E2B generates roughly twice as fast.

---

## Phone Control

When a model is loaded, the private assistant can **drive apps on your phone** — open
apps, read the screen, tap, and type — through the Android accessibility service.

**Enabling it (one-time):**

1. Go to **Models** → the **Phone control** card.
2. Tap **Enable in system settings**.
3. On the system Accessibility page, find **Open Chat** and turn it **On**.

> On some Android versions this appears under *Accessibility → Installed apps → Open Chat*.
> If a toggle is greyed out with "controlled by restricted setting", tap it anyway —
> a confirmation dialog lets you allow it for sideloaded apps.

Once enabled, you can ask the assistant to do things like *"read my screen,"* *"open
Messages,"* or *"summarize my last note"* (via Samsung Galaxy AI).

**Safety:** mutating actions (opening apps, running Galaxy AI actions) ask for
confirmation first.

---

## Managing Bots

Open-Chat supports several agent protocols:

- **OpenClaw** — WebSocket (`ws://127.0.0.1:18789`)
- **Hermes** — HTTP (`http://127.0.0.1:8642`)
- **Draymond Orchestrator** — multi-agent coordination (`http://127.0.0.1:8644`)
- **Private Local** — on-device Gemma
- Plus **Uplift Bridge**, **SubTeam**, **ntfy**, **A2A**, and **MCP Host**.

**Add a bot:** Inbox → **+** → fill in name, protocol, host/port, and token (if any) → save.

**Edit a bot:** tap the **⚙️** icon next to a bot.

**Delete a bot:** open its settings → **Delete**.

For Draymond bots you also get remote management in settings: agent roster, chains/pipelines
(Run), scheduled jobs (On/Off), and recent notifications.

---

## Settings

The **Settings** screen (☰ → Settings) is the app-wide control panel:

- **Local Models** — scans for on-device MediaPipe bundles and OpenAI-compatible local
  servers (Ollama, LM Studio, llama.cpp, …). Detected models can be loaded or added as bots.
- **Private Local** — quick access to the on-device chat.
- **App preferences** — general app options.

---

## Ecosystem Setup (make Open Chat aware of your world)

Open Chat can be made **ecosystem-aware**: the on-device agent reads a file called
`ECOSYSTEM.md` and treats its contents as part of its system prompt. This lets the
assistant know your ecosystem, your agents, and your agenda up front.

**How to create your own `ECOSYSTEM.md`:**

1. Open the bundled `ECOSYSTEM.md` (a blank template is included).
2. Fill in the three sections with **your** setup:

| Section | What to write |
|---------|---------------|
| **1. Ecosystem** | What the system is, who runs it, the overall mission (2–4 sentences). |
| **2. Agents** | Each agent/fleet member: name, role, what it does. |
| **3. Agenda** | Your current focus / priorities the assistant should help with. |

3. Save it, rebuild, and reinstall Open Chat.

The content is injected automatically into the on-device model's context — no other
configuration needed.

**Keep it clean:** only true/current facts, plain short lines, no secrets (never put
API keys or tokens in it), and update the agenda often.

---

## Troubleshooting

**"No local models found" in Settings/Models**
You need an on-device Gemma model. Open **Models** and tap **Download** on a model card,
then **Load** it.

**Phone-control tools fail with "Accessibility service is not enabled"**
The accessibility service isn't on. Enable it under **Models → Phone control →
Enable in system settings** (see [Phone Control](#phone-control)).

**Replies are slow**
On-device 4B inference is CPU-bound. The app uses persistent sessions and a trimmed
system prompt to keep it fast. For ~2× faster generation, switch to the smaller **Gemma 3n E2B**
model in **Models**.

**A long conversation stops generating**
The on-device session has a fixed context window (4096 tokens). When it fills, the app
automatically falls back to a fresh full-context pass so your request still completes.

**Nothing loads / blank screen**
Force-close the app and reopen it. If it persists, the cached model may be corrupted —
delete it in **Models** and re-download.

---

*Open-Chat — private, local-first, agent-native. Built for the agent-native future.*
