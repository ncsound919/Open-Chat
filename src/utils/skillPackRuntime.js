/**
 * SkillPackRuntime — executes a Draymond skill pack by dispatching each
 * declared tool to the matching phone handler. Handlers are injected so tests
 * can substitute fakes; production wires real phoneTools/email/capture.
 *
 * Handlers interface: map of tool name → async fn(context) → output value.
 * The context passed to each handler includes the original context plus
 * `pack` and `tool`.
 *
 * execute() is graceful: unknown tools and handler failures are collected in
 * `failed` while successful tool outputs are collected in `output`, so a pack
 * with a bad step still returns partial output.
 */

export class SkillPackRuntime {
  constructor(handlers) {
    this.handlers = handlers ?? {};
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
        output[tool] = await fn({ ...context, pack, tool });
      } catch (error) {
        failed.push({ tool, error });
        output[tool] = { ok: false, error };
      }
    }

    return { pack: pack.name, context, output, failed };
  }
}
