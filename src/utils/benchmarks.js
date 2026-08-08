/**
 * benchmarks — benchmark + skill-test harness for the Open-Chat on-device
 * stack, with ingestion into Draymond's `draymond_benchmarks` table so results
 * become part of the orchestrator's self-learning loop.
 *
 * Pure/transport helpers live here (unit-testable); the in-app orchestration
 * lives in runBenchmarks.js.
 */

/** Rough tokens from text (≈4 chars/token). */
export function estimateTokens(text) {
  return Math.max(1, Math.round((text ?? "").length / 4));
}

/** Tokens per second. */
export function tokensPerSec(text, ms) {
  return ms > 0 ? Math.round((estimateTokens(text) / ms) * 1000) : 0;
}

/** Time an async fn, returning elapsed ms (best-effort; ms>=0). */
export async function timeAsync(fn) {
  const start = performance.now();
  let value;
  let error = null;
  try {
    value = await fn();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const ms = Math.max(0, Math.round(performance.now() - start));
  return { ms, value, error };
}

/** Stable ISO timestamp. */
export function nowIso() {
  return new Date().toISOString();
}

/** Generate a run id, e.g. "oc-bench-20260808T030405Z-a1b2c3". */
export function makeRunId(prefix = "oc-bench") {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

/**
 * Normalize one benchmark result into a `draymond_benchmarks` row.
 * component_class is constrained to entity|site|cron|chain — we use "entity".
 */
export function toBenchmarkRow({ runId, slug, name, metrics, weakness_score = 0, evidence, trend = {} }) {
  return {
    run_id: runId,
    component_class: "entity",
    component_slug: slug,
    component_name: name,
    metrics: metrics ?? {},
    weakness_score: Number(weakness_score) || 0,
    trend: trend ?? {},
    evidence: evidence ?? null,
  };
}

/** Build the full payload (list of rows) for a run. */
export function buildBenchmarkRows(runId, results) {
  return results.map((r) =>
    toBenchmarkRow({
      runId,
      slug: r.slug,
      name: r.name,
      metrics: r.metrics,
      weakness_score: r.weakness_score,
      evidence: r.evidence,
      trend: r.trend,
    })
  );
}

const BENCH_URL = (base) => `${base.replace(/\/+$/, "")}/rest/v1/draymond_benchmarks`;

/**
 * POST benchmark rows into Draymond's Supabase `draymond_benchmarks` table
 * using the service-role key (bypasses RLS — writes are server-side only).
 * @param {object} opts
 * @param {string} opts.supabaseUrl
 * @param {string} opts.serviceKey
 * @param {Array} opts.rows - draymond_benchmarks rows
 * @returns {Promise<{ok:boolean,count?:number,error?:string}>}
 */
export async function syncBenchmarksToDraymond({ supabaseUrl, serviceKey, rows }) {
  if (!supabaseUrl || !serviceKey || !rows?.length) {
    return { ok: false, error: "supabaseUrl, serviceKey and rows required" };
  }
  try {
    const res = await fetch(BENCH_URL(supabaseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      return { ok: false, error: `Draymond sync failed: HTTP ${res.status}` };
    }
    return { ok: true, count: rows.length };
  } catch (err) {
    return { ok: false, error: `Draymond sync failed: ${err?.message}` };
  }
}

/**
 * POST benchmark rows to the Draymond orchestrator's /api/v1/benchmarks route
 * (the app-safe path — Draymond holds the Supabase service-role key).
 * @param {object} opts
 * @param {string} opts.baseUrl - Draymond base URL, e.g. "http://host:3444/api"
 * @param {string} [opts.token] - Draymond CRON_SECRET bearer token
 * @param {Array} opts.rows - draymond_benchmarks rows
 * @returns {Promise<{ok:boolean,count?:number,error?:string}>}
 */
export async function syncBenchmarksViaDraymond({ baseUrl, token, rows }) {
  if (!baseUrl || !rows?.length) return { ok: false, error: "baseUrl and rows required" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/benchmarks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ rows }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `Draymond sync failed: HTTP ${res.status}` };
    return { ok: data?.ok !== false, count: data?.count ?? rows.length };
  } catch (err) {
    return {
      ok: false,
      error: err?.name === "AbortError" ? "Draymond sync timed out" : `Draymond sync failed: ${err?.message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
