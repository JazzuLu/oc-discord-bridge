# Contributing

Thanks for helping improve **oc-discord-bridge**.

## Scope / goals

- Keep the bridge **local-first** (runs on a developer machine next to the repo(s)).
- Prefer **safe defaults** (avoid accidentally running tools in the wrong directory, leaking secrets, or responding to the wrong Discord channel/thread).
- Keep changes **small and auditable**.

## Development setup

- Node.js 20+
- pnpm

Install deps:

```bash
pnpm install
```

Run in dev mode:

```bash
pnpm dev
```

Build:

```bash
pnpm build
```

## Configuration

Configuration is via `.env`.

- Copy `.env.example` → `.env`
- **Do not commit `.env`** (it may contain secrets)

## Coding conventions

- TypeScript, ESM (`type: module`).
- Keep runtime dependencies minimal.
- Prefer small, named functions over deeply nested logic.

## Pull requests

- Include a short summary of *why* the change is needed.
- If behavior changes, update `README.md` accordingly.
- Ensure `pnpm build` passes.

## Security

If you believe you’ve found a security issue, please do **not** open a public issue with exploit details.

Instead, contact the maintainer privately (e.g. via Discord DM or GitHub private message) and include:
- What you found
- Impact
- Steps to reproduce
