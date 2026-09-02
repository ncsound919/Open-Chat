# ECOSYSTEM.md — Give Open Chat model awareness of your world

Open Chat's on-device agent reads this file (if present) and uses it as a
**system prompt supplement**, so the local model knows your ecosystem, your
agents, and your current agenda before you even ask.

> **This is a blank template.** Edit it to describe **your** setup, then
> rebuild/reinstall. Open Chat automatically injects its content into the
> on-device model's context — no other configuration needed.

---

## How to use this

1. Open `ECOSYSTEM.md` (bundled with Open Chat).
2. Fill in the three sections below with **your** ecosystem, agents, and agenda.
3. Save, rebuild, reinstall. Every private-local chat is now aware of your world.

For a full explanation of the criteria, see **"Ecosystem setup"** in the
[User Manual](./docs/USER_MANUAL.md).

---

# YOUR ECOSYSTEM

## 1. Ecosystem

_What is this system? Who runs it? What is the overall mission? 2–4 sentences._

(Describe your ecosystem here.)

## 2. Agents

_List each agent/fleet member: name, role, what it does, how it helps. One
line each is enough._

- (Agent 1 — role / what it does)
- (Agent 2 — role / what it does)

## 3. Agenda

_What is the current focus / priority right now? What should the assistant
help with? Update it often._

- (Current focus / task)
- (This week's goal)
- (Ongoing priority)

---

# Criteria (keep it clean)

- **True and current** — the model trusts this; don't leave stale facts.
- **Plain text, no heavy markdown** — a few sections, short lines.
- **No secrets** — never put API keys, tokens, or passwords in here.
- **Update often** — the agenda especially. The fresher it is, the more useful
  the assistant becomes.
