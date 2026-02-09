# Contributing

Thanks for taking the time to contribute!

## Development

### Prereqs

- Node.js 20+
- pnpm
- `opencode` on your PATH (or set `OPENCODE_BIN`)

### Install

```bash
pnpm install
```

### Configure

Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

> Note: `.env` is intentionally gitignored. Do not commit secrets.

### Run

```bash
pnpm dev
```

### Build

```bash
pnpm build
pnpm start
```

## Pull requests

- Keep PRs small and focused.
- Prefer adding a short note to `README.md` for any user-facing behavior change.
- Do not commit credentials or tokens. Use `.env` for local secrets.

## Reporting security issues

If you believe you found a security issue, please open an issue with minimal details and ask for a private channel to share reproduction steps.
