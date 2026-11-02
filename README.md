# relay

Three-model routing for Claude Code. **Sonnet** leads the session and writes the code. **Opus** advises at the moments that decide the outcome. **Haiku** runs the chores. You get most of Opus's judgment at a fraction of the cost of running Opus on every turn, and `/relay:savings` shows whether that's true for your own work.

| Model | Role | How |
|---|---|---|
| Sonnet | Lead: plans, edits, debugs | relay switches the main session to Sonnet when installed |
| Opus | Advisor at decision points | Claude Code's built-in advisor (`/advisor opus`), or the `relay:consultant` agent where that isn't available |
| Haiku | Runner: commits, test runs, lookups, log summaries | the `relay:runner` agent |

## Install

```
/plugin marketplace add Harshalj2108/relay
/plugin install relay@relay
/advisor opus
```

The last line is a one-time step: plugins can't turn on the advisor for you. Start a new session afterwards.

Requirements: Claude Code 2.1.316 or later (the version relay is tested on) and Node.js 18 or later, which the hooks and the report run on.

## What it does

**Routing rules.** At session start relay adds short rules to Claude's context: when to consult Opus, and which chores to hand to Haiku. Claude Code's own system prompt and your output style stay as they are.

**Four enforced Opus checkpoints.** While Sonnet or Haiku is the main model, hooks make it consult the advisor:

| Checkpoint | When |
|---|---|
| plan | before leaving plan mode |
| approach | when a turn's changes reach 2+ files or 30+ lines (the edit that crosses the line waits for the consult) |
| failure | when the same command fails twice |
| review | before finishing a turn that changed 2+ files or 30+ lines |

Each checkpoint fires at most once per turn. One-line fixes never trigger anything. Checkpoints don't run inside subagents or when the main model is Opus or Fable, and if a hook hits any error, it lets the action through.

**Haiku runner.** Sonnet hands `relay:runner` git commits, noisy test/lint/build runs, targeted lookups and long-log summaries. The runner can't edit code and never pushes unless you asked for it. Sending noisy output to Haiku also keeps the main conversation short, which makes every advisor call cheaper.

**Savings report.** `/relay:savings [days]` (default 7) reads your local session logs and prints tokens and estimated cost per model, advisor consults included, next to what the same tokens would have cost on Opus 5.5. If routing cost you more, it says so.

## Turning it down or off

- Need Opus for a hard task: `/model opus`. Back to routing: `/model sonnet`.
- Keep the routing, drop the enforced checkpoints: add `"env": { "RELAY_STRICT": "0" }` to your settings.
- Turn everything off: `/plugin disable relay`.

## Other providers

The built-in advisor needs the Anthropic API (subscriptions included). On Bedrock, Vertex or Foundry, or when the advisor is off, Sonnet uses the `relay:consultant` agent, an Opus subagent that gets a written brief instead of the whole conversation. The checkpoints accept either. The savings report uses Anthropic list prices, so on other providers read it as relative.

## What it costs

At current list prices Sonnet 5.5 costs half of Opus 5.5 at every rate, and Haiku 5.5 a twentieth of Sonnet. The catch is the advisor: each consult re-reads the whole conversation at Opus prices, without caching. A few consults per task in a normal-length session save money; many consults in a very long session can cost more than running Opus throughout. relay keeps consults to the checkpoints, and `/relay:savings` shows the real number.

## Notes

- relay reads Claude Code's local transcripts, an internal format that can change between versions. Everything fails open: if parsing breaks, the checkpoints step aside and nothing is blocked.
- Another plugin that also sets the main-session agent will conflict with relay's auto-switch.
- `relay:lead` appears in the agent list. It is the main-session agent; Claude is told not to delegate to it.

## Development

```
node --test test/*.test.js
claude plugin validate .
claude --plugin-dir .
```

MIT licensed.
