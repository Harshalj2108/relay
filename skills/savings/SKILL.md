---
name: savings
description: Show relay's savings report - tokens and estimated cost per model (Sonnet, Haiku, Opus advisor) for recent Claude Code sessions, compared with running everything on Opus. Use when the user runs /relay:savings or asks what model routing saved or cost.
argument-hint: "[days]"
---

Run this command and show its output to the user exactly as printed, with no extra analysis unless they ask for it:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/savings.js" $ARGUMENTS
```
