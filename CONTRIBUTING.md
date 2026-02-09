# Contributing

Thanks for taking the time to contribute.

## Quick start

- Requires Node.js 20+
- Uses `pnpm`

```bash
pnpm install
pnpm build
```

## Development

```bash
pnpm dev
```

## Testing

There are currently no automated tests. CI runs typecheck/build.

## Code style

- Keep changes small and easy to review.
- Prefer explicit, boring code over cleverness.
- Avoid adding new runtime dependencies unless there’s a clear reason.

## Security

- **Never commit secrets** (Discord bot tokens, private keys, etc.).
- Use `.env` locally; keep `.env.example` up to date.
- If you suspect a token was committed, rotate it immediately.

## Submitting changes

1. Create a branch.
2. Make your change.
3. Ensure `pnpm build` passes.
4. Open a PR describing the motivation and approach.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
