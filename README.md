# oc-discord-bridge

A small Discord ↔ OpenCode (`opencode`) bridge that runs locally.

## How it works

- **Channel topic → working directory mapping**
  - Set a Discord text channel topic to include a line like:
    
    ```
    CWD=/absolute/path/to/your/repo
    ```
  - The bridge uses that `CWD=` as the project root for OpenCode operations.
  - By default, channels **without** `CWD=` are ignored (safety).

- **Thread = session**
  - Each Discord thread is treated as an OpenCode session boundary.
  - This keeps context isolated per task and makes it easy to run multiple threads in parallel.

- **Slash commands = escape hatch / control plane**
  - The bridge registers a single `/oc` command with subcommands to inspect and control mappings.

## Requirements

- Node.js 22+
- pnpm (CI uses pnpm 9)

## Setup

### 1) Install

```bash
pnpm install
```

### 2) Configure env

```bash
cp .env.example .env
```

Fill in:
- `DISCORD_BOT_TOKEN`
- `DISCORD_GUILD_ID` (recommended; commands are registered **guild-scoped**)
- `DISCORD_ALLOW_USER_IDS` (recommended allowlist)

### 3) Run (dev)

```bash
pnpm dev
```

### 4) Run (prod-ish)

```bash
pnpm build
pnpm start
```

## Slash commands

`/oc status`
- Show current mapping + pause state (channel/thread).

`/oc new`
- Create a new OpenCode session for the current thread.

`/oc switch session_id:<id>`
- Bind this thread to an existing OpenCode session id.

`/oc pause` / `/oc resume`
- Pause/resume forwarding for the current channel.

`/oc cwd path:/absolute/path`
- Explicitly set `cwd` for the channel (in addition to / instead of channel topic `CWD=`).

## Safety / defaults

- `.env` is ignored by git; commit only `.env.example`.
- Channels without `CWD=` are ignored unless you explicitly set a default `OPENCODE_DEFAULT_CWD`.

## Troubleshooting

### Bot can’t set / update the channel topic

- The bot needs the **Manage Channels** permission in that channel.
- If you don’t want to grant that, you can still set the mapping via `/oc cwd path:/absolute/path` (it will persist in `.data/`).

### Messages aren’t being forwarded

Common causes:
- No `CWD=` mapping (and `DISCORD_IGNORE_CHANNELS_WITHOUT_CWD=true`).
- Forwarding paused for that channel (`/oc status` will show `paused: true`).
- `DISCORD_ALLOW_USER_IDS` is set and your user id is not in the allowlist.
- The bot is missing permissions to **Read Messages / View Channel**, **Send Messages**, and (if you use the “main thread” convenience) **Create Public Threads**.

### Slash commands don’t show up

- Make sure `DISCORD_GUILD_ID` is set so commands are registered **guild-scoped**.
- Re-run the bridge after changing env; Discord can take a short time to refresh commands.

## Contributing

See `CONTRIBUTING.md`.

## License

MIT (see `LICENSE`).
