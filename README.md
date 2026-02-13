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

Notes:
- `src/index.ts` loads dotenv from `../.env` (repo root). If you run from a different working directory, keep the `.env` location in mind.
- Commit only `.env.example` — never commit real secrets.

Fill in:
- `DISCORD_BOT_TOKEN`
- `DISCORD_GUILD_ID` (recommended; commands are registered **guild-scoped**)
- `DISCORD_ALLOW_USER_IDS` (recommended allowlist)
- `DISCORD_ALLOW_ROLE_IDS` (optional; role allowlist for `/oc`)

### 2.4) Enable gateway intents

In the Discord Developer Portal:
- Your app → **Bot** → **Privileged Gateway Intents**
- Enable **Message Content Intent** (required to read message text).

### 2.5) Invite the bot to your server

In the Discord Developer Portal, generate an OAuth2 URL with:
- **Scopes:** `bot`, `applications.commands`
- **Bot permissions (minimum):**
  - View Channels
  - Read Message History
  - Send Messages
  - Send Messages in Threads (recommended)
  - Manage Threads (recommended if you want the bridge to unarchive / keep threads usable)
  - Create Public Threads (optional; only if you want the bridge to create threads)
  - Manage Channels (optional; only if you want the bot to set the channel topic automatically)

Discord docs (OAuth2 URL generator):
https://discord.com/developers/applications → Your app → OAuth2 → URL Generator

### 3) Run (dev)

```bash
pnpm dev
```

### 4) Run (prod-ish)

```bash
pnpm build
pnpm start
```

### Configuration reference

All config is via environment variables:

- `DISCORD_BOT_TOKEN` (required)
- `DISCORD_GUILD_ID` (optional, but recommended for fast slash command iteration)
- `DISCORD_ALLOW_USER_IDS` (optional, comma-separated allowlist)
  - If set to a non-empty list, **all `/oc` slash commands require the user ID to be in this list** (role allowlist will not grant access).
- `DISCORD_ALLOW_ROLE_IDS` (optional, comma-separated role allowlist)
- `DISCORD_DEFAULT_DENY` (default: `false`; when `true`, deny by default unless an allowlist matches)
- `DISCORD_IGNORE_BOTS` (default: `true`)
- `DISCORD_IGNORE_CHANNELS_WITHOUT_CWD` (default: `true`)
- `DISCORD_ALLOWED_CWD_PREFIXES` (optional, comma-separated absolute path prefixes allowed for channel `CWD=`; when unset/empty, any existing absolute directory is accepted)
- `OPENCODE_BIN` (default: `opencode`)
- `OPENCODE_ACP_AUTOSTART` (default: `true`)
- `OPENCODE_DEFAULT_CWD` (optional)
- `REDACT_SECRETS` (default: `false`)
- `DATA_DIR` (default: `.data`)

See: [`.env.example`](./.env.example)

## Channel topic → CWD mapping

In a Discord text channel, set the channel topic to include a line like:

```
CWD=/absolute/path/to/your/project
```

Notes:
- The bridge looks for the **first** line starting with `CWD=`.
- By default, channels without `CWD=` are ignored (safety).
- CWD validation rules (applies to both channel topic and `/oc cwd`):
  - Must be an **absolute path** (relative paths are rejected).
  - Must be a **single line** (values containing `\n` / `\r` are rejected).
  - Leading/trailing whitespace is trimmed.
  - The stored value is normalized with `path.resolve(...)` (so `/a/b/..` becomes `/a`).
- You can also set CWD using `/oc cwd path:<ABSOLUTE_PATH>`:
  - it will try to update the topic, and
  - it will cache the value for that channel.

## Thread = session

- Messages are forwarded from a thread to the OpenCode session bound to that thread.
- If you talk in the parent text channel (not in a thread), the bridge will find or create a `main` thread and use it.

This keeps context from different tasks separated (Discord threads map nicely to “one chat session”).

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

Examples:
- ✅ `/oc cwd path:/Users/alice/code/my-repo`
- ✅ `/oc cwd path:/Users/alice/code/my-repo/..` → stored as `/Users/alice/code`
- ❌ `/oc cwd path:my-repo` (relative path rejected)
- ❌ `/oc cwd path:"/Users/alice/code\n/tmp"` (newlines rejected)

## Safety / defaults

- `.env` is ignored by git; commit only `.env.example`.
- Channels without `CWD=` are ignored unless you explicitly set a default `OPENCODE_DEFAULT_CWD`.
- If `REDACT_SECRETS=true`, the bridge will best-effort redact common token patterns in:
  - logs (`err=` / stack traces)
  - text echoed back to Discord
- **Attachments are not downloaded.** If a Discord message has attachments, the bridge forwards only **URLs + basic metadata** (filename/contentType/size) into the OpenCode prompt context.
- Per-guild/channel/thread state is persisted under `.data/` (so you can inspect/backup it easily):
  - `.data/channelCwd.json`
  - `.data/threadSession.json`
  - `.data/pausedChannels.json`

## Troubleshooting

### Bot can’t set / update the channel topic

- The bot needs the **Manage Channels** permission in that channel.
- If you don’t want to grant that, you can still set the mapping via `/oc cwd path:/absolute/path` (it will persist in `.data/`).

### Messages aren’t being forwarded

Common causes:
- No `CWD=` mapping (and `DISCORD_IGNORE_CHANNELS_WITHOUT_CWD=true`).
- Forwarding paused for that channel (`/oc status` will show `paused: true`).
- `DISCORD_ALLOW_USER_IDS` / `DISCORD_ALLOW_ROLE_IDS` is set and you are not in the configured allowlist (by user id or role).
- The bot is missing permissions to **Read Messages / View Channel**, **Send Messages**, and (if you use the “main thread” convenience) **Create Public Threads**.

### Slash commands don’t show up

- Make sure `DISCORD_GUILD_ID` is set so commands are registered **guild-scoped**.
- Re-run the bridge after changing env; Discord can take a short time to refresh commands.

## Docs

- Install & run: `docs/INSTALL.md`
- Troubleshooting: `docs/TROUBLESHOOTING.md`
- Spec: `docs/SPEC.md`
- Config reference: `docs/CONFIG.md`

## Contributing

See `CONTRIBUTING.md`.

## License

MIT (see `LICENSE`).
