/**
 * SkillPackRuntime — executes a Draymond skill pack by dispatching each
 * declared tool to the matching phone handler. Handlers are injected so tests
 * can substitute fakes; production wires real phoneTools/email/capture.
 *
 * Handlers interface: map of tool name → async fn(context) → output value.
 * The context passed to each handler includes the original context plus
 * `pack` and `tool`.
 *
 * Reserved keys: `pack` and `tool` are injected into the handler args and will
 * override any same-named keys already present in the caller's context.
 *
 * execute() is graceful: unknown tools and handler failures (including
 * timeouts) are collected in `failed` while successful tool outputs are
 * collected in `output`, so a pack with a bad step still returns partial
 * output. Every recorded error is a plain string so the result survives
 * JSON serialization on the report path.
 */

function normalizeError(err) {
  return err instanceof Error ? err.message : String(err);
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`tool timeout: ${label}`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export class SkillPackRuntime {
  constructor(handlers, { timeoutMs = 30_000 } = {}) {
    this.handlers = handlers ?? {};
    this.timeoutMs = timeoutMs;
  }

  async execute(pack, context = {}) {
    const tools = Array.isArray(pack.tools) ? pack.tools : [];
    const output = {};
    const failed = [];

    for (const tool of tools) {
      const fn = this.handlers[tool];
      if (!fn) {
        failed.push({ tool, error: `unknown tool in pack: ${tool}` });
        continue;
      }
      try {
        // Handlers receive the running `output` map so a later tool can consume
        // an earlier tool's result (e.g. capture_to_smd reads capture.screenshot).
        output[tool] = await withTimeout(fn({ ...context, pack, tool, output }), this.timeoutMs, tool);
      } catch (error) {
        const msg = normalizeError(error);
        failed.push({ tool, error: msg });
        output[tool] = { ok: false, error: msg };
      }
    }

    return { pack: pack.name, version: pack.version ?? "unknown", context, output, failed };
  }
}
