/**
 * keywireClient — read-only client for the Keywire zero-trust vault.
 *
 * Keywire is the fleet's secret store (Keywire/server.ts, default
 * http://127.0.0.1:3000). Open-Chat talks to it to resolve agent/bot
 * credentials from the vault instead of holding high-value tokens in
 * localStorage/settings.
 *
 * Auth: `Authorization: Bearer <JWT>` (asymmetric JWKS or symmetric HS256 —
 * see Keywire/server.ts /api/v1 auth middleware).
 *
 * Security rules enforced here:
 *  - Tokens and secret values are NEVER logged (safeLog redacts them).
 *  - Unmasked values are only fetched when the caller explicitly asks
 *    (`unmask: true`) — the default list call stays masked.
 *  - Every request has a hard timeout so a hung vault can't wedge the UI.
 */

import { isSafeUrl } from "./security.js";

/** Default Keywire listen address (Keywire/server.ts). */
export const KEYWIRE_DEFAULT_BASE = "http://127.0.0.1:3000";

/** Normalize a base URL, refusing non-http(s) targets. */
export function normalizeBaseUrl(base) {
  const trimmed = String(base || "").trim() || KEYWIRE_DEFAULT_BASE;
  let withScheme;
  if (/^https?:\/\//i.test(trimmed)) {
    withScheme = trimmed;
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw new Error("Keywire URL must use http(s)");
  } else {
    withScheme = `http://${trimmed}`;
  }
  if (!isSafeUrl(withScheme)) {
    throw new Error("Keywire URL must use http(s)");
  }
  return withScheme.replace(/\/+$/, "");
}

/** Accept a bare array or a `{ <plural>:[...] }` wrapper. */
function asList(data, plural) {
  if (Array.isArray(data)) return data;
  const wrapped = data && typeof data === "object" ? data[plural] : null;
  return Array.isArray(wrapped) ? wrapped : [];
}

export class KeywireClient {
  /**
   * @param {string} [baseUrl] - vault origin (default KEYWIRE_DEFAULT_BASE)
   * @param {string} [token] - Bearer JWT / service token
   */
  constructor(baseUrl, token) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = String(token || "").trim();
  }

  _headers(extra = {}) {
    return {
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }

  /**
   * GET a JSON endpoint with a hard timeout. Never throws on HTTP errors —
   * returns { ok, data?, error?, status? } so callers degrade gracefully.
   */
  async _get(path, { timeoutMs = 10_000 } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: this._headers(),
        signal: controller.signal,
      });
      if (!res.ok) {
        return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      }
      return { ok: true, status: res.status, data: await res.json() };
    } catch (err) {
      return {
        ok: false,
        error: err?.name === "AbortError" ? "request timed out" : err?.message || "network error",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** True when a token is configured (vault calls will be authenticated). */
  hasToken() {
    return this.token.length > 0;
  }

  /** Health/connectivity probe — hits an unauthenticated endpoint. */
  async healthCheck() {
    const res = await this._get("/api/v1/metrics", { timeoutMs: 4000 });
    if (res.ok) return { ok: true };
    // 401 means the vault is up but our token is missing/invalid.
    if (res.status === 401) {
      return { ok: false, auth: true, error: "Keywire is up but authentication is required/invalid" };
    }
    return res;
  }

  /** List vault projects. */
  async listProjects() {
    const res = await this._get("/api/v1/projects");
    return { ...res, projects: res.ok ? asList(res.data, "projects") : [] };
  }

  /** List environments for a project. */
  async listEnvironments(projectId) {
    const enc = encodeURIComponent(projectId);
    const res = await this._get(`/api/v1/projects/${enc}/environments`);
    return { ...res, environments: res.ok ? asList(res.data, "environments") : [] };
  }

  /**
   * List secrets in an environment. Values are masked unless `unmask` is
   * explicitly true.
   */
  async listSecrets(projectId, envSlug, { unmask = false } = {}) {
    const enc = encodeURIComponent(projectId);
    const slug = encodeURIComponent(envSlug);
    const qs = unmask ? "?unmask=true" : "";
    const res = await this._get(`/api/v1/projects/${enc}/envs/${slug}/secrets${qs}`);
    return { ...res, secrets: res.ok ? asList(res.data, "secrets") : [] };
  }

  /**
   * Fetch ONE secret's live value. Requires `unmask: true` intent (and a
   * token with the right policy). The value is returned to the caller but is
   * never logged by this client.
   */
  async getSecretValue(projectId, envSlug, key) {
    // Live (unmasked) values are served by the secrets LIST endpoint with
    // ?unmask=true — the versions endpoint returns ciphertext only.
    const list = await this.listSecrets(projectId, envSlug, { unmask: true });
    if (!list.ok) return { ok: false, error: list.error };
    const match = list.secrets.find((s) => String(s.key ?? "") === String(key));
    if (!match) return { ok: false, error: `secret not found: ${key}` };
    const value = typeof match.value === "string" ? match.value : "";
    return {
      ok: true,
      key: match.key,
      value,
      currentVersion: match.currentVersion ?? null,
      masked: /^••+/.test(value),
    };
  }

  /** List a secret's version history (metadata only — ciphertext records). */
  async getSecretVersions(projectId, envSlug, key) {
    const enc = encodeURIComponent(projectId);
    const slug = encodeURIComponent(envSlug);
    const k = encodeURIComponent(key);
    const res = await this._get(`/api/v1/projects/${enc}/envs/${slug}/secrets/${k}/versions`);
    return { ...res, versions: res.ok ? asList(res.data, "versions") : [] };
  }
}
