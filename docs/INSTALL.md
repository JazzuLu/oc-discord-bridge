# Install & run

This is a small Discord ↔ OpenCode bridge intended to run locally.

## Requirements

- Node.js 22+
- pnpm (CI uses pnpm 9)

## Install

```bash
pnpm install
```

## Configure

```bash
cp .env.example .env
```

Minimum required:
- `DISCORD_BOT_TOKEN`

Recommended:
- `DISCORD_GUILD_ID` (guild-scoped commands refresh faster)
- `DISCORD_ALLOW_USER_IDS` (basic allowlist)

See also: `docs/CONFIG.md`.

## Discord setup

### Enable gateway intents

In Discord Developer Portal:
- Your app → **Bot** → **Privileged Gateway Intents**
- Enable **Message Content Intent**

### Invite the bot

Generate an OAuth2 URL with:
- **Scopes:** `bot`, `applications.commands`
- **Bot permissions (minimum):**
  - View Channels
  - Read Message History
  - Send Messages
  - Send Messages in Threads (recommended)
  - Manage Threads (recommended; helps keep threads usable)
  - Create Public Threads (optional; only if you want the bridge to create threads)
  - Manage Channels (optional; only if you want the bot to set channel topic automatically)

## Run

### Dev

```bash
pnpm dev
```

### Prod-ish

```bash
pnpm build
pnpm start
```

## Quick smoke test

1. In a Discord text channel, set the topic to include:

   ```
   CWD=/absolute/path/to/your/repo
   ```

2. Start a thread and send a message.
3. Run `/oc status` to confirm the channel/thread mappings.
