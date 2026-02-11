# Troubleshooting

## Bot can’t set / update the channel topic

- The bot needs **Manage Channels** in that channel.
- If you don’t want to grant that, set the mapping via `/oc cwd path:/absolute/path`.

## Messages aren’t being forwarded

Common causes:

- No `CWD=` mapping (and `DISCORD_IGNORE_CHANNELS_WITHOUT_CWD=true`).
- Forwarding paused for that channel (`/oc status` will show `paused: true`).
- `DISCORD_ALLOW_USER_IDS` / `DISCORD_ALLOW_ROLE_IDS` is set and you are not in the configured allowlist (by user id or role).
- Missing permissions:
  - View Channel / Read Message History
  - Send Messages
  - Send Messages in Threads
  - (optional) Create Public Threads (only if using “main thread” convenience)

## Slash commands don’t show up

- Set `DISCORD_GUILD_ID` so commands are registered **guild-scoped**.
- Restart the bridge after changing env.
- Discord can take a short time to refresh commands.

## OpenCode ACP host/port env vars don’t seem to work

That’s expected for now.

Remote ACP mode is **not implemented yet**; the bridge currently always spawns a local `opencode acp` process.
`OPENCODE_ACP_HOSTNAME`/`OPENCODE_ACP_PORT` are reserved for future use.

## I see a Discord.js deprecation warning about `ready`

Example:

```
DeprecationWarning: The ready event has been renamed to clientReady ...
```

This is a warning coming from discord.js. It’s noisy but not fatal.
If it becomes actionable, we should update the event handler to use `clientReady` (and keep backwards compat if needed).
