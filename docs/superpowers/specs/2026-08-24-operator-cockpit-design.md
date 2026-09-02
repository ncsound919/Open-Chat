# Operator Cockpit — Design Spec

**Date:** 2026-08-24
**Scope:** Open-Chat (this repo) + Draymond-Orchestrator + KeyWire
**Serves:** Mission engine E2/E3 enablement; operator force-multiplier for all four engines
**Predecessor work already shipped:** ntfy inbound (KeyWire hourly reports), native TTS speak/stopSpeaking, research pack (deep_research/read_page/navigate), GPU/CPU backend fallback watchdog, auto-research grounding, Fleet Approvals screen, DraymondOrchestratorClient mission APIs

---

## 1. Goal

Turn Open-Chat into a full operator cockpit: autonomous fleet remediation with
phone-side notifications and destructive-only human approval, voice-driven
fleet ops, and a live mission dashboard — wired into Draymond's self-learning
loop and KeyWire telemetry so remediation quality compounds over time.

## 2. Architecture Overview

```
Kairos detectors (Draymond, 15min)
        │ findings
        ▼
Remediation Autopilot (Draymond)  ──►  Guardian Policy Table (config JSON)
        │                                              │
   mode: auto ──► execute via existing repair machinery│
   mode: notify_only ──► log + push                    │
   mode: approval ──► Approvals API ─────────┐         │
        │                                    ▼         │
        ▼                          Open-Chat Approvals │
ntfy push (all outcomes)                     screen     │
        │                                               │
        ▼                                               ▼
Open-Chat Fleet Alerts card            autopilot-log.json + learning-store
                                                │
                                                ▼
                              nightly self_learning_loop → stats
                                                │
                              weekly Policy Tuner (Guardian-gated)
                                                │
KeyWire gatherTelemetry ◄── stats endpoint ─────┘
        │
        └──► hourly Open-Chat report (Autopilot section) + trends annotations
```

Brain stays server-side (Draymond). Phone = eyes, voice, veto.

## 3. Guardian Policy Table

File: `Draymond-Orchestrator/config/remediation-policy.json`

```json
{
  "version": 1,
  "policies": [
    { "finding": "monitor_down",      "action": { "type": "pm2_restart",       "target": "$finding.app" },      "mode": "auto",        "cooldownMin": 15 },
    { "finding": "job_failed",        "action": { "type": "rerun_job",         "target": "$finding.jobId" },    "mode": "auto" },
    { "finding": "weak_agent",        "action": { "type": "dispatch_repair",   "target": "$finding.agentId" },  "mode": "auto" },
    { "finding": "stale_heartbeat",   "action": { "type": "ping_probe",        "target": "$finding.service" },  "mode": "notify_only" },
    { "finding": "port_occupant_kill","action": { "type": "kill_port_occupant" },                               "mode": "approval" },
    { "finding": "queue_purge",       "action": { "type": "purge_queue" },                                      "mode": "approval" },
    { "finding": "secret_*",          "action": null,                                                           "mode": "approval" }
  ],
  "default_mode": "approval"
}
```

Rules:
- Deterministic first-match-wins on `finding` (wildcard `*` suffix supported).
- Modes: `auto` | `approval` | `notify_only`.
- Unmatched finding → `default_mode` (`approval`) — fail-safe, never guess.
- Cooldowns prevent restart loops (same target not re-actioned within window).
- Tuner mutations append `{changedAt, reason, sampleSize}` per policy entry.
- Resolution is hand-rolled (~60 lines, zero dependencies) rather than a rules
  engine dependency: auditable by construction; json-rules-engine evaluated
  and rejected (dormant maintenance, ESM-only transitive dep, excess power).

## 4. Remediation Autopilot (Draymond)

New module: `src/lib/draymond/autopilot.ts`, hooked into the existing Kairos
scan cycle (15 min).

Flow per finding:
1. Resolve policy (table above).
2. Execute by mode:
   - `auto`: run action through existing repair machinery (`repairFailedJob`,
     pm2 ops, agent dispatch). Retry once on failure. Append evidence entry to
     `.draymond/autopilot-log.json`: `{ts, findingId, findingType, policyId,
     action, result, durationMs, outcome}`.
   - `approval`: POST to existing approvals API (consumed by Open-Chat Fleet
     Approvals screen).
   - `notify_only`: log + push.
3. Record outcome into learning-store as an outcome
   (`{agentId: "autopilot", pattern: "<findingType>", lesson, result}`) so the
   nightly `self_learning_loop` distills it with all other fleet lessons.
4. Publish ntfy notification for every terminal state:
   `{kind: "remediation", status: "auto_fixed"|"pending_approval"|"failed",
   findingId, summary, ts}`.

Stats endpoint: `GET /api/v1/autopilot/stats` returns per-findingType
`{successRate, meanTimeToFixMs, recurrenceCount, sampleSize, lastOutcomeAt}` +
pending promotion proposals.

### 4a. Policy Tuner (weekly, Guardian-gated)

Deterministic moves over accumulated stats:
- **Demote**: success rate < 70% across ≥ 5 samples → flip mode
  `auto → approval`; record lesson explaining why.
- **Promote-proposal**: fix type in approval mode succeeding ≥ 10 consecutive
  times → generate an approval card: "Promote job_failed→rerun_job to
  autopilot? 12/12 success". Human taps once; policy bumps itself.
- No silent self-modification: every change is an auditable, versioned event.

## 5. Open-Chat: Alerts

- ntfy envelope (published by Draymond): JSON body with
  `kind/status/findingId/summary/ts`.
- NtfyClient consumer learns the envelope: renders compact cards in Fleet
  Alerts bot thread — green (auto_fixed), amber "tap to review"
  (pending_approval → deep-link to Approvals screen), red with evidence
  (failed). Existing dedupe-by-id and since-replay behavior unchanged.

## 6. Open-Chat: Voice Ops

- Speech recognition via **`@capgo/capacitor-speech-recognition`** (v8,
  actively maintained, Capacitor 8-native): Android uses the on-device
  `SpeechRecognizer` inline path — no cloud backend, permission helpers and
  streaming partial results included. No custom native `listen()` code needed.
- Hold-to-talk control on the Fleet context captures transcript.
- `src/utils/fleetCommands.js`: deterministic grammar (~10 v1 commands),
  first-match-wins regex/intent table mapping to direct Draymond API calls:
  - revenue today / this week → Treasurer KPIs
  - run <chain> → chain execution
  - restart <app> → pm2 op (server-side policy table still governs: voiced
    destructive requests land in Approvals, never auto-execute)
  - status of <service> → KeyWire probe over tunnel
  - approve pending → opens Approvals screen
- Off-grammar transcript → handed to local Gemma chat as a normal message.
- Replies spoken through native TTS `speak()` (already shipped).

## 7. Open-Chat: Mission Dashboard

StatsScreen rewires to live data:
- Sources: `getMissionDashboard()`, `getHeartbeats()` (both exist in
  DraymondOrchestratorClient), KeyWire `/api/v1/ecosystem/servers` summary
  over tunnel, Autopilot stats endpoint.
- Cards: $-pace ring vs $1,100/day target; four engine bars (E1–E4);
  Guardian flag count; agent up/down triage; autopilot effectiveness panel
  (success-rate sparkline, top recurring findings, pending promotions);
  recent autopilot actions feed.
- Refresh 60 s while open; last-known values cached (localStorage) for
  offline with staleness banner.

## 8. KeyWire Integration

- `gatherTelemetry()` gains `draymond_autopilot` source (stats endpoint).
- `generateReportMarkdown()` gains an Autopilot section: weekly intervention
  count, auto-resolve %, escalations, top recurring finding.
- Trends engine (`trends.ts`) annotates recurring findings in the LOP stream;
  hourly Open-Chat report carries the section automatically.

## 9. Degraded Modes

| Failure | Behavior |
|---|---|
| Draymond unreachable | Dashboard shows stale + banner; voice replies honestly; alerts deliver via ntfy when network returns |
| Policy lookup miss | Approval mode (fail-safe) |
| Auto-action fails twice | status=failed push with evidence; repair loop notified |
| ntfy unreachable | Server-side publish retry; ntfy.sh retains ~12 h replay |
| SpeechRecognizer unavailable | Voice button hidden; chat input remains |

## 10. Testing

- Draymond (vitest): policy resolution table (match/wildcard/default/cooldown),
  autopilot execution modes with synthetic findings, tuner demote/promote
  thresholds, stats endpoint shape.
- KeyWire (vitest): telemetry source inclusion, report markdown section.
- Open-Chat (vitest): notification-envelope parsing/routing, fleet command
  grammar parser, dashboard data assembly with mocked clients, voice hook
  with mocked recognizer, approvals deep-link.

## 11. Non-Goals (v1)

- No phone-side execution of remediations (display/veto only).
- No natural-language freeform command parsing beyond grammar (falls to Gemma).
- No automatic policy changes without Guardian-gated approval or recorded
  demotion evidence.
