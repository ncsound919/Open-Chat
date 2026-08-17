# Third-Party Integrations for Open-Chat — Design

Date: 2026-08-17
Status: Draft

## Goal

Give the on-device Open-Chat agent (Gemma) first-class access to the user's
everyday phone apps — Gmail, Google Calendar, Google Drive / Files, Gemini,
YouTube, Wikipedia, and News — so it can read and act on them from chat.

Scope decisions (from user):
- **No OAuth.** No Google Cloud credentials, no Gmail/Calendar/Drive/Gemini
  deep APIs. This is a local-first, keyless design.
- **Hybrid integration**:
  - **Keyless cloud APIs** for Wikipedia and News (reliable, no device needed).
  - **Phone-driven recipes** (accessibility bridge) for Gmail, Calendar,
    Drive/Files, Gemini, and YouTube (open the real app, read the screen, act).

## Architecture

Follows the existing tool pattern exactly (modeled on `webSearch.js` + the
`PHONE_TOOLS` system). Two new focused modules, plus registration in
`LocalModelClient` and the worker executor map.

```
LocalModelClient (tool schemas + routing)
        │  wikipedia_search / wikipedia_summary / news_headlines
        │  gmail_inbox / calendar_events / drive_browse / gemini_query / youtube_search
        ▼
┌───────────────────────┐        ┌────────────────────────────┐
│ cloudIntegrations.js  │        │ appRecipes.js              │
│  Wikipedia (REST/API) │        │  composed phone recipes    │
│  News (RSS)           │        │  using execPhoneTool()     │
└───────────┬───────────┘        └─────────────┬──────────────┘
            │ fetch (network)                  │ execPhoneTool (accessibility)
            ▼                                  ▼
      Wikimedia / Google News          PhoneControl plugin
```

### 1. `src/utils/cloudIntegrations.js` — keyless cloud APIs

Three tools. All fail soft with `{ ok:false, error }`.

- **`wikipedia_search { query, limit? }`**
  - Endpoint (Action API, needs `origin=*` for CORS in the Capacitor WebView):
    `https://en.wikipedia.org/w/api.php?action=query&list=search&prop=info&inprop=url&format=json&origin=*&srlimit=10&srsearch={query}`
  - Returns `[{ title, snippet, url }]` (up to `limit`, default 5).
- **`wikipedia_summary { title }`**
  - Endpoint (REST, cached, clean JSON — avoids wiki markup):
    `https://en.wikipedia.org/api/rest_v1/page/summary/{title}`
  - Returns `{ title, extract }` (the plain-text intro).
- **`news_headlines { topic?, query?, count? }`**
  - Keyless Google News RSS search endpoint:
    `https://news.google.com/rss/search?q={query or topic}&hl=en-US&gl=US&ceid=US:en`
  - For known `topic`s (world, tech, business, sports, science, health) use a
    curated named feed; otherwise treat the value as a search query.
  - Parse RSS with `DOMParser` (built into the WebView); return
    `[{ title, source, link, published }]` (up to `count`, default 8).

**Both Wikipedia calls MUST send an identifying `User-Agent` header**
(`User-Agent: OpenChat/1.0 (local-first chat app)`). Wikimedia returns HTTP 403
to requests without one (confirmed by AutoGPT, anthropics/claude-cookbooks, sim).
Each `fetch` gets a timeout (`AbortSignal.timeout(20_000)`).

### 2. `src/utils/appRecipes.js` — phone-driven recipes

Each recipe composes the existing low-level `execPhoneTool` primitives
(`open_app`, `read_screen`, `tap`, `type`, `press`) from `phoneTools.js`. They
reuse the existing **confirmation gate**: opening an app, tapping, and typing
are already `MUTATING_PHONE_TOOLS`, so every recipe triggers the user-approval
flow. Each recipe:
- checks accessibility status (same as `webSearch.js`),
- opens the target app and waits for it to render,
- reads the screen back and trims it to the essentials (capped list),
- returns to Open-Chat at the end.

Recipes and package names:

- **`gmail_inbox { }`** → open `com.google.android.gm`, read the inbox list →
  return visible sender/subject lines.
- **`calendar_events { }`** → open `com.google.android.calendar`, read the
  current view → return visible event titles/times.
- **`drive_browse { }`** → open `com.google.android.apps.docs` (fallback
  `com.google.android.documentsui`), read visible file/folder names.
- **`gemini_query { query }`** → open `com.google.android.apps.bard`, focus the
  input field, type the query, submit, wait, read the answer back.
- **`youtube_search { query }`** → open `com.google.android.youtube`, tap the
  search affordance, type, submit, wait, read the video result titles.

Recipes are **best-effort**: Google apps expose rich accessibility nodes (and
`accessibility_service_config.xml` already sets
`flagRetrieveInteractiveWindows|flagReportViewIds|flagIncludeNotImportantViews`,
so reads work), but app-version UI changes can break a specific step. A failed
step returns a partial result with the screen text captured so far, plus a clear
error, rather than throwing.

### 3. Registration

**`src/protocols/LocalModelClient.js`**
- Import `CLOUD_TOOLS` (the 3 cloud schemas) from `cloudIntegrations.js` and
  `RECIPE_TOOLS` (the 5 recipe schemas) from `appRecipes.js`.
- In `send()`, when `this.phoneToolsEnabled`, push `...CLOUD_TOOLS` and
  `...RECIPE_TOOLS` into the `tools` array (alongside `PHONE_TOOLS` and
  `WEB_SEARCH_TOOL`).
- In `toolHandler`, route the new names:
  - `wikipedia_search` / `wikipedia_summary` / `news_headlines` → the
    corresponding `cloudIntegrations` functions.
  - `gmail_inbox` / `calendar_events` / `drive_browse` / `gemini_query` /
    `youtube_search` → the corresponding `appRecipes` functions (passing
    `confirm: this.confirmAction`).
- Append a short "INTEGRATIONS" section to the system prompt (like the existing
  `_appContext()` section) so Gemma knows these apps/tools exist and when to
  prefer a cloud tool vs. a phone recipe.

**`src/utils/skillExecutors.js`**
- Wire the same handlers into `buildSkillExecutors` (so Draymond skill packs and
  the worker loop can call them too), mirroring how `web` is wired.

**`src/utils/draymondTools.js`** (seed packs) — no change required; the new
tools become available to packs automatically through `buildSkillExecutors`.

### 4. Android 16 hardening (native, small)

**`src/plugins/capacitor-phone-control/android/src/main/java/.../PhoneControlPlugin.kt`**
- `getStatus` currently reports `enabled` from the in-memory service instance.
  On Android 16+, `Settings.Secure` is restricted for third-party apps, so the
  robust check is `AccessibilityManager.getEnabledAccessibilityServiceList()`.
  Add a fallback: if the in-memory instance is null but the accessibility
  service is present in the enabled list, report `enabled: true`. (This keeps
  the current in-memory fast path and hardens the false-negative case.)

## Data flow

User asks in chat → Gemma emits a JSON tool call → `LocalModelClient.send()`
routes it → cloud tool does a network fetch / recipe drives the phone → serializable
`{ ok, ... }` result returns to the model → Gemma summarizes for the user. Tool
calls surface as cards via the existing `onToolCall` path.

## Error handling & safety

- Cloud tools: fail soft with `{ ok:false, error }`; timeouts on every fetch;
  `User-Agent` set for Wikimedia.
- Phone recipes: reuse the existing confirmation gate (mutating actions always
  require approval); fail-soft on missing accessibility; partial results on
  mid-sequence failure; return to Open-Chat when done.
- No credentials are stored; nothing leaves the device beyond the public
  Wikipedia/News requests and the local app automation.

## Testing

Vitest unit tests per module, mirroring existing conventions
(`webSearch.test.js`, `phoneTools.test.js`):
- `cloudIntegrations.test.js` — mock `fetch` for Wikipedia search/summary
  (assert `User-Agent` + `origin=*` are sent) and News RSS (stub an RSS XML
  string, assert `DOMParser` output).
- `appRecipes.test.js` — mock `execPhoneTool`/`loadPhoneControl`; assert each
  recipe calls `open_app` → `read_screen` → (for Gemini/YouTube) `tap`/`type`
  in the right order and returns trimmed results.
- `LocalModelClient.test.js` — extend to assert the new tool schemas are
  registered and routed.
- `skillExecutors.test.js` — assert the new handler names resolve.
Run `npm run lint` (zero warnings) and `npm test`.

## Out of scope

- Gmail/Calendar/Drive/Gemini deep APIs (no OAuth, per user).
- Cloud YouTube Data API (needs an API key).
- Sending Gmail / creating Calendar events / uploading to Drive (read-only
  phone recipes; mutating writes are intentionally not automated).
- Wikipedia language selection (English only for now).
