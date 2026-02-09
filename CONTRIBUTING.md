# Contributing

Thanks for your interest in contributing!

## Development setup

Prereqs:
- Node.js 20+
- pnpm
- (optional) `opencode` on your PATH (or set `OPENCODE_BIN`)

Steps:

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Build:

```bash
pnpm build
```

Run the built output:

```bash
pnpm start
```

## Repo conventions

- Keep `.env` **out of git**. If you need new config, update `.env.example` instead.
- Prefer small, reviewable PRs.
- If you change behavior, update `README.md` (especially the slash commands / CWD mapping sections).

## Security

If you find a security issue, please do **not** open a public issue with details.
Instead, contact the maintainer privately.
