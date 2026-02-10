# Contributing

Thanks for considering a contribution!

## Development setup

- Node.js: recommended **Node 20+**
- Package manager: **pnpm**

```bash
pnpm install
```

Copy env template:

```bash
cp .env.example .env
```

Run in dev/watch mode:

```bash
pnpm dev
```

Build:

```bash
pnpm build
```

## Repository hygiene

- **Do not commit secrets.** Never commit `.env` or tokens.
- If you suspect a secret was committed, assume it is compromised and rotate it.
- Prefer small, focused PRs.

## Pull requests

- Keep changes scoped (one concern per PR where possible).
- Update README/docs when behavior changes.
- Ensure `pnpm build` passes.

## Reporting issues

When filing a bug, please include:
- what you expected vs. what happened
- steps to reproduce
- your Node/pnpm versions
- relevant logs (redact tokens)
