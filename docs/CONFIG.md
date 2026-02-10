# Config reference

This project is configured via environment variables (see `.env.example`).

## Discord

### `DISCORD_BOT_TOKEN` (required)
Bot token from the Discord Developer Portal.

### `DISCORD_GUILD_ID` (recommended)
If set, slash commands are registered **guild-scoped** for faster iteration and more predictable updates.

If omitted, Discord will treat commands as global which can take much longer to propagate.

### `DISCORD_ALLOW_USER_IDS` (recommended)
Comma-separated list of Discord user IDs allowed to interact with the bridge.

Examples:

```bash
DISCORD_ALLOW_USER_IDS=123456789012345678,234567890123456789
```

If empty, the bridge will accept messages from any non-bot user the bot can see (not recommended for shared servers).

## Behavior

### `DISCORD_IGNORE_BOTS` (default: `true`)
Ignore messages sent by bots.

### `DISCORD_IGNORE_CHANNELS_WITHOUT_CWD` (default: `true`)
Safety switch.

- `true`: only channels with an explicit `CWD=/abs/path` mapping (in channel topic or set via `/oc cwd ...`) will be processed.
- `false`: channels without a mapping may be processed using `OPENCODE_DEFAULT_CWD` (if set).

## Safety

### `REDACT_SECRETS` (default: `false`)
Best-effort redaction of common secret/token patterns in:

- local logs
- text echoed back to Discord

Leave `false` if you want maximum fidelity for debugging; enable `true` if you want extra defense-in-depth when running in shared channels.

## OpenCode

### `OPENCODE_BIN` (default: `opencode`)
Binary name/path used to start OpenCode.

### `OPENCODE_ACP_AUTOSTART` (default: `true`)
If `true`, the bridge starts its own `opencode acp` process.

If `false`, you must start ACP yourself and point the bridge at it via `OPENCODE_ACP_HOSTNAME` + `OPENCODE_ACP_PORT`.

### `OPENCODE_ACP_HOSTNAME` (default: `127.0.0.1`)
Hostname/interface for the ACP server.

### `OPENCODE_ACP_PORT` (default: `0`)
ACP port.

- `0`: let OpenCode pick a random free port (recommended for local usage)
- non-zero: fixed port (useful for debugging or if another process depends on it)

## Storage

### `DATA_DIR` (default: `.data`)
Directory used to persist state (channel↔cwd, thread↔session, paused channels, etc.).

This is intentionally plaintext JSON so you can inspect/backup it easily.
