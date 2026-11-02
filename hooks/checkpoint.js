// relay's strict Opus checkpoints. Decisions come from the current turn of the transcript, plus a
// small per-session record of edits this hook already allowed (parallel tool calls reach hooks
// before they are written to the transcript). Fail-open: any error, or any doubt, lets the action through.
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../lib/transcript.js');

const MIN_FILES = 2; // a turn is "substantive" at 2+ files...
const MIN_LINES = 30; // ...or 30+ changed lines
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash']);
const ASK = 'consult the advisor (the `advisor` tool, or the `relay:consultant` agent if you have no advisor tool)';

function weight(edits, cwd = '') {
  return { files: new Set(edits.map((e) => T.norm(path.resolve(cwd, e.file)))).size, lines: edits.reduce((s, e) => s + e.lines, 0) };
}
const substantive = (w) => w.files >= MIN_FILES || w.lines >= MIN_LINES;

const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

// recorded: [{id, file, lines}] edits allowed earlier in this turn, possibly not in the transcript yet.
function decide(input, lines, env = process.env, cfgDir = T.configDir(), recorded = []) {
  if (env.RELAY_STRICT === '0' || input.agent_id) return null;
  const turn = T.currentTurn(lines, input.prompt_id);
  if (!turn.length) return null;
  if (!/sonnet|haiku/i.test(T.turnModel(turn, lines) || '')) return null; // tiered mode only

  const f = T.turnFacts(turn, cfgDir, input.tool_use_id);
  const extra = recorded.filter((r) => r.id !== input.tool_use_id && !f.toolIds.has(r.id) && f.errors.get(r.id) !== true);
  const edits = [...f.edits, ...extra];
  const ev = input.hook_event_name;

  if (ev === 'PreToolUse' && input.tool_name === 'ExitPlanMode') {
    if (f.consults.length || f.markers.has('plan')) return null;
    return deny(`[relay:plan] Checkpoint, not a failure. Before presenting this plan, ${ASK} on it. Then call ExitPlanMode again.`);
  }

  if (ev === 'PreToolUse') {
    if (input.permission_mode === 'plan' || f.consults.length || f.markers.has('approach')) return null;
    const pending = T.editsOf(input.tool_name, input.tool_input).filter((e) => !T.norm(e.file).startsWith(T.norm(cfgDir) + '/'));
    if (!pending.length || !substantive(weight([...edits, ...pending], input.cwd))) return null;
    return deny(`[relay:approach] Checkpoint, not a failure. This turn's changes now reach ${MIN_FILES}+ files or ${MIN_LINES}+ lines. Before continuing, ${ASK} on your approach, then retry this edit.`);
  }

  if (ev === 'PostToolUseFailure' && input.tool_name === 'Bash') {
    const cmd = T.normCmd(input.tool_input && input.tool_input.command);
    const since = f.consults.length ? Math.max(...f.consults) : -1;
    const n = f.failures.filter((x) => x.cmd === cmd && x.idx > since).length + 1;
    if (n !== 2) return null;
    return { hookSpecificOutput: { hookEventName: 'PostToolUseFailure', additionalContext: `[relay:failure] Checkpoint, not a failure. \`${cmd}\` has now failed twice. Before trying again, ${ASK}.` } };
  }

  if (ev === 'Stop') {
    if (input.stop_hook_active || f.markers.has('review') || !substantive(weight(edits, input.cwd))) return null;
    const lastEdit = f.edits.length ? Math.max(...f.edits.map((e) => e.idx)) : Infinity;
    if (f.consults.some((c) => c > lastEdit)) return null;
    return { decision: 'block', reason: `[relay:review] Checkpoint, not a failure. This turn changed ${MIN_FILES}+ files or ${MIN_LINES}+ lines. Make sure the work is saved, then ${ASK} to review the change. After that, finish normally.` };
  }
  return null;
}

// shortcut: one small state file per session is never deleted; fine at a few hundred bytes each, add cleanup if it ever matters.
function statePath(input) {
  const dir = process.env.CLAUDE_PLUGIN_DATA || os.tmpdir();
  return path.join(dir, `relay-${String(input.session_id).replace(/[^\w-]/g, '')}.json`);
}

function loadRecorded(input) {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(input), 'utf8'));
    return s.promptId === input.prompt_id ? s.edits : [];
  } catch {
    return [];
  }
}

function record(input, recorded) {
  const e = T.editsOf(input.tool_name, input.tool_input);
  if (!e.length) return;
  try {
    fs.mkdirSync(path.dirname(statePath(input)), { recursive: true });
    fs.writeFileSync(statePath(input), JSON.stringify({ promptId: input.prompt_id, edits: [...recorded, ...e.map((x) => ({ id: input.tool_use_id, ...x }))] }));
  } catch {}
}

// Returns the hook's stdout. Never throws.
function main(stdin) {
  try {
    const input = JSON.parse(stdin);
    const recorded = input.prompt_id && input.session_id ? loadRecorded(input) : [];
    const out = decide(input, T.readLines(input.transcript_path), process.env, T.configDir(), recorded);
    if (!out && input.hook_event_name === 'PreToolUse' && EDIT_TOOLS.has(input.tool_name) && input.prompt_id && input.session_id) record(input, recorded);
    return out ? JSON.stringify(out) : '';
  } catch {
    return '';
  }
}

if (require.main === module) {
  let s = '';
  process.stdin.on('data', (d) => (s += d)).on('end', () => process.stdout.write(main(s)));
}

module.exports = { decide, main };
