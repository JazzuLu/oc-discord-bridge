# Contributing

Thanks for taking the time to contribute!

## Development setup

Prereqs:
- Node.js 20+
- pnpm
- `opencode` available on your PATH (or set `OPENCODE_BIN`)

Install:

```bash
pnpm install
```

Run (dev):

```bash
cp .env.example .env
pnpm dev
```

Build:

```bash
pnpm build
```

## Project conventions

- **Channel → CWD mapping** is configured via Discord channel topic `CWD=/absolute/path`.
- **Thread = session**: one Discord thread maps to one OpenCode session id.
- Prefer small, reviewable commits.

## Pull requests

- Keep PRs focused.
- Update the README if behavior / setup changes.
- Ensure `pnpm build` passes.

## Security

- Never commit real tokens or secrets.
- Use `.env` locally; it is git-ignored.
