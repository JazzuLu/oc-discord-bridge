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

## License

MIT (see `LICENSE`).
