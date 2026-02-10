# Spec (MVP)

## Core mapping
- Channel => CWD via channel topic line: `CWD=/abs/path` (A is primary)
- Thread => OpenCode sessionId (persisted)

## Routing rules
- Only handle messages in the configured guild.
- Ignore bot messages (prevent loops).
- If `DISCORD_ALLOW_USER_IDS` is set, only accept messages from those user IDs.
- For messages in a thread:
  - Ensure thread is mapped to an OpenCode session. If not, create session using the parent channel CWD.
  - Send the user message to OpenCode.
  - If the Discord message includes attachments, include **URLs + basic metadata** (filename/contentType/size) in the prompt context (do **not** download the file automatically).
  - Stream response back by editing a single Discord message (preferred). If editing fails, fall back to chunked sends.

## Escape hatch (slash commands)
- /oc status (show: threadId, mapped sessionId, channel cwd)
- /oc new (create new session, bind to current thread)
- /oc switch <sessionId> (bind current thread to existing session)
- /oc pause (stop auto-forwarding for current channel)
- /oc resume
- /oc cwd set <path> (set cwd for current channel; optionally update channel topic)

## Storage
Persist in DATA_DIR:
- channelCwd.json: { [channelId]: { cwd, updatedAt } }
- threadSession.json: { [threadId]: { sessionId, cwd, createdAt, updatedAt } }
- pausedChannels.json: { [channelId]: true }

## OpenCode control
Use ACP (`opencode acp`) for:
- initialize
- session/new
- session/load
- session/prompt (stream via session/update agent_message_chunk)

## Non-goals (for MVP)
- Multi-user
- Automatic downloading of attachment files (we only forward URLs/metadata)
- Permission prompts
