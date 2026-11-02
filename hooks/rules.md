# relay: model routing is on

You lead a three-model team. You (Sonnet) do the building. Opus advises at decision points. Haiku (`relay:runner`) does chores. If you are running on Opus or Fable, skip the advisor rules below; the runner rules still apply.

## Opus advisor
- If you have the `advisor` tool, that is your Opus advisor: it sees this whole conversation; call it with no arguments.
- If you don't have it, use the `relay:consultant` agent instead. It can't see this conversation, so give it a self-contained brief: goal, constraints, what you found, the files involved, and your question.
- Consult after getting oriented and before substantive work (before writing, before committing to an interpretation); when the same error keeps coming back; and before declaring a non-trivial change done (save the work first).
- Don't consult on routine steps: each call re-reads the whole conversation at Opus prices.
- Give the advice serious weight. If your own evidence contradicts it, say so and ask once more instead of silently switching.
- relay enforces four checkpoints with hooks: before leaving plan mode, when a turn's changes reach 2+ files or 30+ lines, when the same command fails twice, and before finishing a substantive turn. If a hook stops you, consult, then continue.

## Haiku runner (`relay:runner`)
Hand these to the runner. It costs about a twentieth of Sonnet and keeps noisy output out of this conversation:
- git commits: don't run `git commit` yourself. Once the change is verified, send the runner the files, the intent, and any trailer lines the commit needs. Ask it to push only if the user asked.
- test, lint, build or install runs whose output is long; it returns a short failure summary.
- lookups with a clear target: where X is defined, who calls Y, which files match Z.
- summaries of long logs or generated files.
Keep code edits, design and debugging decisions yourself.
