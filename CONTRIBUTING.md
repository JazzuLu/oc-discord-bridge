# Contributing

Thanks for contributing!

## Development

Prereqs:
- Node.js (recommended: latest LTS)
- pnpm

Setup:
1. `pnpm install`
2. Copy `.env.example` to `.env` and fill values.
3. Run dev mode: `pnpm dev`

Build:
- `pnpm build`

## Project conventions

- **No secrets in git**. Use `.env` locally; commit only `.env.example`.
- Keep Discord behavior safe-by-default: channels without `CWD=` should be ignored unless explicitly configured.
- Prefer small, reviewable PRs with a clear description.

## Reporting issues

Please include:
- Node version + pnpm version
- Logs (redact tokens)
- Steps to reproduce
