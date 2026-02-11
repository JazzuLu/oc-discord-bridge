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

### `DISCORD_ALLOW_ROLE_IDS` (optional)
Comma-separated list of Discord role IDs allowed to use the `/oc` slash command.

Examples:

```bash
DISCORD_ALLOW_ROLE_IDS=345678901234567890,456789012345678901
```

Authorization behavior:
- If **both** `DISCORD_ALLOW_USER_IDS` and `DISCORD_ALLOW_ROLE_IDS` are empty, `/oc` is allowed for anyone (backwards-compatible default; not recommended for shared servers).
- Otherwise, `/oc` is allowed if the user ID is in `DISCORD_ALLOW_USER_IDS` **or** the user has a role in `DISCORD_ALLOW_ROLE_IDS`.

If empty, the bridge will accept messages from any non-bot user the bot can see (not recommended for shared servers).

## Behavior

### `DISCORD_IGNORE_BOTS` (default: `true`)
Ignore messages sent by bots.

### `DISCORD_IGNORE_CHANNELS_WITHOUT_CWD` (default: `true`)
Safety switch.

- `true`: only channels with an explicit `CWD=/abs/path` mapping (in channel topic or set via `/oc cwd ...`) will be processed.
- `false`: channels without a mapping may be processed using `OPENCODE_DEFAULT_CWD` (if set).

### `DISCORD_FORWARD_TRIGGER_MODE` (default: `off`)
Optional UX/safety switch: require an explicit trigger before forwarding normal messages to OpenCode.

Allowed values:
- `off`: forward everything (subject to allowlists, CWD mapping, pause)
- `mention`: only forward messages that @mention the bot
- `prefix`: only forward messages that start with `DISCORD_FORWARD_TRIGGER_PREFIX`
- `mention_or_prefix`: accept either mention or prefix

### `DISCORD_FORWARD_TRIGGER_PREFIX` (default: `!oc `)
Prefix used when `DISCORD_FORWARD_TRIGGER_MODE` is `prefix` or `mention_or_prefix`.

Example:

```bash
DISCORD_FORWARD_TRIGGER_MODE=prefix
DISCORD_FORWARD_TRIGGER_PREFIX="!oc "
```

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

If `false`, you must start ACP yourself.

> Note: Remote ACP mode is **not implemented yet**. The bridge currently always spawns a local `opencode acp`
> process and does not connect to an external ACP host/port.

### `OPENCODE_ACP_HOSTNAME` (default: `127.0.0.1`)
Reserved for future remote ACP mode (currently ignored).

### `OPENCODE_ACP_PORT` (default: `0`)
Reserved for future remote ACP mode (currently ignored).

## Storage

### `DATA_DIR` (default: `.data`)
Directory used to persist state (channel↔cwd, thread↔session, paused channels, etc.).

This is intentionally plaintext JSON so you can inspect/backup it easily.
