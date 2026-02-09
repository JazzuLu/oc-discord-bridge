# Contributing

Thanks for contributing!

## Development setup

Prereqs:
- Node.js 20+
- pnpm

Install deps:

```bash
pnpm install
```

Build:

```bash
pnpm build
```

Dev mode (watch):

```bash
pnpm dev
```

## Project conventions

- Keep the bridge safe-by-default (ignore channels without an explicit CWD, allowlist support, etc.).
- Prefer small, reviewable PRs.
- Avoid adding heavy dependencies unless clearly justified.

## Submitting changes

1. Fork the repo and create a feature branch.
2. Make your changes.
3. Ensure `pnpm build` passes.
4. Open a PR with a clear description and rationale.

## Reporting security issues

If you believe you have found a security vulnerability, please **do not** open a public issue.

Instead, contact the maintainer privately with:
- steps to reproduce
- impact assessment
- suggested fix (if you have one)
