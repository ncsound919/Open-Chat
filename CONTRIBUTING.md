# Contributing to Open-Chat

Thanks for your interest in contributing! Open-Chat is a local-first chat surface
for autonomous agents, and we welcome bug reports, fixes, and improvements.

## Getting Started

1. Fork the repository and clone your fork.
2. Install dependencies: `npm install`
3. Create a branch: `git checkout -b feat/your-change`
4. Make your changes and ensure they pass:

```bash
npm run lint            # ESLint, zero warnings
npm test                # Vitest suite
npm run test:coverage   # Coverage thresholds enforced
npm run build           # Production build must succeed
```

## What we look for

- **Bug fixes** — include a test that reproduces the bug (see the existing
  component/protocol test files for patterns).
- **Features** — new functionality must come with tests and must not break the
  coverage thresholds in `vite.config.js`.
- **Security** — Open-Chat is a security-focused app. Sanitize any rendered output,
  never log tokens (use `safeLog`/`maskToken`), and keep Electron hardened
  (`contextIsolation` on, `nodeIntegration` off, CSP intact).

## Commit style

Concise, conventional-style messages, e.g. `fix(chat): patch streaming message by id`.

## Pull requests

- Target the `main` branch.
- Keep PRs focused and reviewable.
- Update `README.md` / `TESTING.md` if behaviour or requirements change.

## Code of Conduct

By participating, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).
