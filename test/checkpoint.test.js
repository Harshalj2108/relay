const test = require('node:test');
const assert = require('node:assert');
const { decide } = require('../hooks/checkpoint.js');
const { prompt, assistant, toolUse, result, advisor, lines, id } = require('./helpers.js');

const S = 'claude-sonnet-5-5';
const P = 'p1';
const CFG = 'C:/Users/me/.claude';
const env = {};

// A turn where the model already edited `files` (one tool_use + successful result each).
function turnWithEdits(files, model = S) {
  const out = [prompt('p0', 'old turn'), assistant(model, [toolUse('Edit', { file_path: 'old.js', old_string: 'a', new_string: lines(100) })]), prompt(P)];
  for (const f of files) {
    const t = toolUse('Edit', { file_path: f, old_string: 'a', new_string: 'b' });
    out.push(assistant(model, [t]), result(P, t.id));
  }
  return out;
}

const pre = (tool_name, tool_input, extra = {}) => ({ hook_event_name: 'PreToolUse', prompt_id: P, permission_mode: 'default', tool_name, tool_input, tool_use_id: id(), ...extra });
const editInput = (file, k = 1) => ({ file_path: file, old_string: 'x', new_string: lines(k) });
const isDeny = (o, tag) => o && o.hookSpecificOutput.permissionDecision === 'deny' && o.hookSpecificOutput.permissionDecisionReason.includes(`[relay:${tag}]`);

test('small single-file edit is allowed', () => {
  assert.equal(decide(pre('Edit', editInput('a.js', 3)), turnWithEdits([]), env, CFG), null);
});

test('edit that makes the turn reach 2 files without a consult is denied', () => {
  assert.ok(isDeny(decide(pre('Edit', editInput('b.js')), turnWithEdits(['a.js']), env, CFG), 'approach'));
});

test('edit that reaches 30 lines in one file is denied', () => {
  assert.ok(isDeny(decide(pre('Write', { file_path: 'a.js', content: lines(30) }), turnWithEdits([]), env, CFG), 'approach'));
});

test('lines from earlier turns do not count', () => {
  // turnWithEdits puts a 100-line edit in the previous turn
  assert.equal(decide(pre('Edit', editInput('a.js', 2)), turnWithEdits([]), env, CFG), null);
});

test('after a native advisor consult the edit is allowed', () => {
  const t = turnWithEdits(['a.js']);
  t.push(assistant(S, [advisor()]));
  assert.equal(decide(pre('Edit', editInput('b.js')), t, env, CFG), null);
});

test('a consultant subagent call counts as a consult', () => {
  const t = turnWithEdits(['a.js']);
  const c = toolUse('Agent', { subagent_type: 'relay:consultant', prompt: 'brief' });
  t.push(assistant(S, [c]), result(P, c.id));
  assert.equal(decide(pre('Edit', editInput('b.js')), t, env, CFG), null);
});

test('denies only once per turn (marker already in a tool result)', () => {
  const t = turnWithEdits(['a.js']);
  const d = toolUse('Edit', editInput('b.js'));
  t.push(assistant(S, [d]), result(P, d.id, true, '[relay:approach] consult first'));
  assert.equal(decide(pre('Edit', editInput('b.js')), t, env, CFG), null);
});

test('a denied edit does not count toward the turn', () => {
  const t = [prompt(P)];
  const d = toolUse('Edit', editInput('b.js', 40));
  t.push(assistant(S, [d]), result(P, d.id, true, 'blocked by something else'));
  assert.equal(decide(pre('Edit', editInput('c.js', 2)), t, env, CFG), null);
});

test('plan mode skips the approach checkpoint', () => {
  assert.equal(decide(pre('Edit', editInput('b.js'), { permission_mode: 'plan' }), turnWithEdits(['a.js']), env, CFG), null);
});

test('files in the Claude config dir are ignored', () => {
  const t = turnWithEdits(['a.js']);
  assert.equal(decide(pre('Write', { file_path: 'C:\\Users\\me\\.claude\\plans\\x.md', content: lines(80) }), t, env, CFG), null);
});

test('ExitPlanMode without a consult is denied, with one is allowed', () => {
  const t = [prompt(P), assistant(S, [toolUse('Read', { file_path: 'a.js' })])];
  assert.ok(isDeny(decide(pre('ExitPlanMode', {}), t, env, CFG), 'plan'));
  t.push(assistant(S, [advisor()]));
  assert.equal(decide(pre('ExitPlanMode', {}), t, env, CFG), null);
});

test('subagents, Opus, RELAY_STRICT=0 and unknown models are left alone', () => {
  const t = turnWithEdits(['a.js']);
  assert.equal(decide(pre('Edit', editInput('b.js'), { agent_id: 'abc' }), t, env, CFG), null);
  assert.equal(decide(pre('Edit', editInput('b.js')), turnWithEdits(['a.js'], 'claude-opus-5-5'), env, CFG), null);
  assert.equal(decide(pre('Edit', editInput('b.js')), t, { RELAY_STRICT: '0' }, CFG), null);
  assert.equal(decide(pre('Edit', editInput('b.js')), [prompt(P)], env, CFG), null);
});

test('model falls back to the last assistant line of earlier turns', () => {
  const t = [prompt('p0'), assistant(S, [{ type: 'text', text: 'hi' }]), prompt(P)];
  assert.ok(isDeny(decide(pre('Write', { file_path: 'a.js', content: lines(40) }), t, env, CFG), 'approach'));
});

test('second failure of the same command asks for a consult, the third does not', () => {
  const t = [prompt(P)];
  const ev = (tid) => ({ hook_event_name: 'PostToolUseFailure', prompt_id: P, tool_name: 'Bash', tool_input: { command: 'npm  test' }, tool_use_id: tid, error: 'Exit code 1' });
  const f1 = toolUse('Bash', { command: 'npm test' });
  t.push(assistant(S, [f1]));
  assert.equal(decide(ev(f1.id), t, env, CFG), null);
  t.push(result(P, f1.id, true, 'Exit code 1'));
  const f2 = toolUse('Bash', { command: 'npm test' });
  t.push(assistant(S, [f2]));
  const out = decide(ev(f2.id), t, env, CFG);
  assert.ok(out.hookSpecificOutput.additionalContext.includes('[relay:failure]'));
  t.push(result(P, f2.id, true, 'Exit code 1'));
  const f3 = toolUse('Bash', { command: 'npm test' });
  t.push(assistant(S, [f3]));
  assert.equal(decide(ev(f3.id), t, env, CFG), null);
});

test('a consult resets the failure count', () => {
  const t = [prompt(P)];
  const f1 = toolUse('Bash', { command: 'npm test' });
  t.push(assistant(S, [f1]), result(P, f1.id, true), assistant(S, [advisor()]));
  const f2 = toolUse('Bash', { command: 'npm test' });
  t.push(assistant(S, [f2]));
  assert.equal(decide({ hook_event_name: 'PostToolUseFailure', prompt_id: P, tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: f2.id }, t, env, CFG), null);
});

test('Stop after a substantive turn without a later consult is blocked once', () => {
  const stop = (extra = {}) => ({ hook_event_name: 'Stop', prompt_id: P, stop_hook_active: false, ...extra });
  const t = turnWithEdits(['a.js', 'b.js']);
  const out = decide(stop(), t, env, CFG);
  assert.equal(out.decision, 'block');
  assert.ok(out.reason.includes('[relay:review]'));
  assert.equal(decide(stop({ stop_hook_active: true }), t, env, CFG), null);
});

test('Stop is allowed for small turns and after a review consult', () => {
  const stop = { hook_event_name: 'Stop', prompt_id: P, stop_hook_active: false };
  assert.equal(decide(stop, turnWithEdits(['a.js']), env, CFG), null);
  const t = turnWithEdits(['a.js', 'b.js']);
  t.push(assistant(S, [advisor()]));
  assert.equal(decide(stop, t, env, CFG), null);
});

test('Stop is blocked when the only consult came before the last edit', () => {
  const t = [prompt(P), assistant(S, [advisor()])];
  for (const f of ['a.js', 'b.js']) {
    const e = toolUse('Edit', editInput(f));
    t.push(assistant(S, [e]), result(P, e.id));
  }
  assert.equal(decide({ hook_event_name: 'Stop', prompt_id: P, stop_hook_active: false }, t, env, CFG).decision, 'block');
});

test('without prompt_id the turn starts at the last real user prompt', () => {
  const t = turnWithEdits(['a.js']);
  assert.ok(isDeny(decide(pre('Edit', editInput('b.js'), { prompt_id: undefined }), t, env, CFG), 'approach'));
});

test('main() never throws on bad input', () => {
  const { main } = require('../hooks/checkpoint.js');
  assert.equal(main('not json'), '');
  assert.equal(main(JSON.stringify({ hook_event_name: 'Stop', transcript_path: 'Z:/nope.jsonl' })), '');
});

test('parallel edits not yet in the transcript are counted from the record', () => {
  const t = [prompt(P), assistant(S, [toolUse('Read', { file_path: 'x' })])];
  const recorded = [{ id: 'toolu_prev', file: 'a.js', lines: 1 }];
  assert.ok(isDeny(decide(pre('Write', { file_path: 'b.js', content: 'x' }), t, env, CFG, recorded), 'approach'));
  // a recorded edit that later failed does not count
  t.push(result(P, 'toolu_prev', true, 'denied'));
  assert.equal(decide(pre('Write', { file_path: 'b.js', content: 'x' }), t, env, CFG, recorded), null);
});

test('first tool batch of a session takes the model from the api-request line', () => {
  const t = [prompt(P), { type: 'api-request', params: { model: S } }];
  assert.ok(isDeny(decide(pre('Write', { file_path: 'a.js', content: lines(40) }), t, env, CFG), 'approach'));
  const o = [prompt(P), { type: 'api-request', params: { model: 'claude-opus-5-5' } }];
  assert.equal(decide(pre('Write', { file_path: 'a.js', content: lines(40) }), o, env, CFG), null);
});

test('main() records allowed edits per prompt and denies the next parallel one', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { main } = require('../hooks/checkpoint.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-'));
  process.env.CLAUDE_PLUGIN_DATA = dir;
  const tp = path.join(dir, 't.jsonl');
  fs.writeFileSync(tp, [prompt(P), { type: 'api-request', params: { model: S } }].map((x) => JSON.stringify(x)).join('\n'));
  const ev = (file) => JSON.stringify({ ...pre('Write', { file_path: file, content: 'x' }), session_id: 's1', transcript_path: tp });
  assert.equal(main(ev('a.js')), '');
  assert.match(main(ev('b.js')), /relay:approach/);
  delete process.env.CLAUDE_PLUGIN_DATA;
});

test('Bash heredoc writes to several files count as edits', () => {
  const { bashTargets } = require('../lib/transcript.js');
  assert.deepEqual(bashTargets(`cat >> calc.py <<'EOF'\nx\nEOF\ncat > "test_calc.py" <<'EOF'\ny\nEOF\nnpm test 2>&1 | tee out.log; echo hi > /dev/null 2>/dev/null`), ['calc.py', 'test_calc.py', 'out.log']);
  const t = [prompt(P), assistant(S, [toolUse('Read', { file_path: 'x' })])];
  assert.ok(isDeny(decide(pre('Bash', { command: 'printf a > a.txt; printf b > b.txt' }), t, env, CFG), 'approach'));
  assert.equal(decide(pre('Bash', { command: 'npm test 2>&1' }), t, env, CFG), null);
});

test('a relative Bash target and an absolute Edit path are the same file', () => {
  const t = [prompt(P)];
  const e = toolUse('Edit', { file_path: 'C:/repo/calc.py', old_string: 'a', new_string: 'b' });
  t.push(assistant(S, [e]), result(P, e.id));
  assert.equal(decide(pre('Bash', { command: 'echo x >> calc.py' }, { cwd: 'C:/repo' }), t, env, CFG), null);
});
