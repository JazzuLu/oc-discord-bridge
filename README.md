# oc-discord-bridge

A local Discord ↔ OpenCode (`opencode`) bridge.

Core ideas:
- **Channel → CWD mapping** via channel topic (`CWD=/absolute/path`).
- **Thread = OpenCode session** (one thread keeps one session context).
- **Slash commands** provide an escape hatch / admin controls.

## What this is (and isn’t)

- This is meant to run **locally** (your laptop / workstation), where `opencode` can access your files.
- It is **not** a hosted SaaS bot.
- Treat it like a “Discord UI wrapper” around your local OpenCode.

## Setup

### Prereqs

- Node.js 20+
- pnpm
- `opencode` on your PATH (or set `OPENCODE_BIN`)

### Discord bot setup

1. Create a Discord application + bot in the Developer Portal.
2. Enable the bot intents you need (at least **Message Content Intent** if you want to forward raw message content).
3. Invite the bot to your server (scopes: `bot`, `applications.commands`).
4. Copy the bot token for `DISCORD_BOT_TOKEN`.

### Install

```bash
pnpm install
```

### Configure

1. Copy `.env.example` → `.env` and fill in values:

```bash
cp .env.example .env
```

2. Start in dev mode:

```bash
pnpm dev
```

For production-ish local use:

```bash
pnpm build
pnpm start
```

### Configuration reference

All config is via environment variables:

- `DISCORD_BOT_TOKEN` (required)
- `DISCORD_GUILD_ID` (optional, but recommended for fast slash command iteration)
- `DISCORD_ALLOW_USER_IDS` (optional, comma-separated allowlist)
- `DISCORD_IGNORE_BOTS` (default: `true`)
- `DISCORD_IGNORE_CHANNELS_WITHOUT_CWD` (default: `true`)
- `OPENCODE_BIN` (default: `opencode`)
- `OPENCODE_ACP_AUTOSTART` (default: `true`)
- `OPENCODE_ACP_HOSTNAME` (default: `127.0.0.1`)
- `OPENCODE_ACP_PORT` (default: `0`, random)
- `OPENCODE_DEFAULT_CWD` (optional)
- `DATA_DIR` (default: `.data`)

See: [`.env.example`](./.env.example)

## Channel topic → CWD mapping

In a Discord text channel, set the channel topic to include a line like:

```
CWD=/Users/pancraslu/WorkingPlace/Joto/wenshu
```

Notes:
- The bridge looks for the **first** line starting with `CWD=`.
- By default, channels without `CWD=` are ignored (safety).
- You can also set CWD using `/oc cwd path:<ABSOLUTE_PATH>`:
  - it will try to update the topic, and
  - it will cache the value for that channel.

## Thread = session

- Messages are forwarded from a thread to the OpenCode session bound to that thread.
- If you talk in the parent text channel (not in a thread), the bridge will find or create a `main` thread and use it.

This keeps context from different tasks separated (Discord threads map nicely to “one chat session”).

## Slash commands

Guild-scoped commands (registered only when `DISCORD_GUILD_ID` is set):

- `/oc status` — show channel/thread/session mapping status (ephemeral)
- `/oc new` — bind current thread to a **new** OpenCode session (ephemeral)
- `/oc switch session_id:<id>` — bind current thread to an existing session (ephemeral)
- `/oc pause` — pause forwarding in this channel (ephemeral)
- `/oc resume` — resume forwarding in this channel (ephemeral)
- `/oc cwd path:<ABSOLUTE_PATH>` — set the channel CWD (tries to update topic) (ephemeral)

## CI

GitHub Actions runs `pnpm install --frozen-lockfile` + `pnpm build` on pushes and PRs.

## Security / safety defaults

- `.env` is ignored by git (do not commit secrets).
- Optional allowlist: `DISCORD_ALLOW_USER_IDS`.
- Optional guild scope: `DISCORD_GUILD_ID`.
- By default, the bridge ignores channels without `CWD=` (`DISCORD_IGNORE_CHANNELS_WITHOUT_CWD=true`).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — see [LICENSE](./LICENSE).
