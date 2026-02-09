# oc-discord-bridge

Discord ↔ OpenCode (opencode) bridge running locally on Pancras' Mac.

## Goals
- Channel topic declares project root: `CWD=/absolute/path`
- Thread = OpenCode session (context preserved)
- Out-of-band control via slash commands (escape hatch)

## Local dev
1. Create `.env` (see `.env.example`)
2. Install deps: `pnpm i`
3. Run: `pnpm dev`

## Config via channel topic
Set channel topic to include a line like:

```
CWD=/Users/pancraslu/WorkingPlace/Joto/wenshu
```

Channels without `CWD=` are ignored by default (safety).
