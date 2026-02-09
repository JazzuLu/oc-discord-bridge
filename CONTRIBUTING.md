# Contributing

Thanks for your interest in contributing!

## Quick start

- Use Node.js + pnpm.
- Install deps: `pnpm i`
- Build: `pnpm build`
- Dev: `pnpm dev`

## Development notes

- This bridge is intentionally conservative about **scope**:
  - Optionally restrict to a single guild (`DISCORD_GUILD_ID`).
  - Optionally restrict to allowlisted users (`DISCORD_ALLOW_USER_IDS`).
  - By default, it ignores channels that don’t have a `CWD=` mapping.
- Keep logs secret-free. Don’t print env vars or tokens.

## Pull requests

1. Create a topic branch.
2. Keep PRs small and focused.
3. Ensure `pnpm build` passes.
4. Update README if behavior/UX changes.

## Security

If you believe you’ve found a security issue, please do **not** open a public issue.
Instead, contact the maintainer privately.
