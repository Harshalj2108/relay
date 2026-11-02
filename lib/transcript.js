// Reads Claude Code session transcripts (JSONL). The format is internal to Claude Code;
// shapes here match v2.1.316. Callers must treat any error as "no information".
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function readLines(file) {
  const out = [];
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l) continue;
    try { out.push(JSON.parse(l)); } catch {}
  }
  return out;
}

const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
const blocks = (line) => (Array.isArray(line.message && line.message.content) ? line.message.content : []);
const isRealPrompt = (l) => l.type === 'user' && !l.isMeta && typeof (l.message && l.message.content) === 'string';

// Lines of the current turn: from the user prompt with this promptId (tool results share it),
// else from the last real user prompt.
function currentTurn(lines, promptId) {
  let start = promptId ? lines.findIndex((l) => l.promptId === promptId) : -1;
  if (start < 0) {
    for (let i = lines.length - 1; i >= 0; i--) if (isRealPrompt(lines[i])) { start = i; break; }
  }
  return start < 0 ? [] : lines.slice(start);
}

function lastModel(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].type === 'assistant' && lines[i].message && lines[i].message.model;
    if (m && m !== '<synthetic>') return m;
  }
  return null;
}

// Model of the current turn. Tool calls reach hooks before their assistant line is written,
// so on a turn's first tool batch fall back to the turn's first API request.
function turnModel(turn, all) {
  const m = lastModel(turn);
  if (m) return m;
  const req = turn.find((l) => l.type === 'api-request' && l.params && l.params.model);
  return req ? req.params.model : lastModel(all);
}

const countLines = (s) => (s ? String(s).split('\n').length : 0);

// Files a Bash command writes through `>`, `>>`, `&>` or `tee`.
// shortcut: misses sed -i, cp, mv and scripts that write files; extend the patterns if those show up.
function bashTargets(cmd) {
  const out = [];
  const re = /(?:\d?>>?|&>)\s*(['"]?)([^\s;&|<>'"()]+)\1|\btee\s+(?:-a\s+)?(['"]?)([^\s;&|<>'"()]+)\3/g;
  for (const m of String(cmd || '').matchAll(re)) {
    const f = m[2] || m[4];
    if (f && !/^(\/dev\/|nul$|NUL$|\$)/.test(f)) out.push(f);
  }
  return [...new Set(out)];
}

// [{file, lines}] for one tool call. Bash: one entry per written file; the command's lines go to the first.
function editsOf(name, input) {
  input = input || {};
  if (name === 'Bash') return bashTargets(input.command).map((file, i) => ({ file, lines: i ? 0 : countLines(input.command) }));
  const file = input.file_path || input.notebook_path;
  let n = 0;
  if (name === 'Edit') n = Math.max(countLines(input.old_string), countLines(input.new_string));
  else if (name === 'Write') n = countLines(input.content);
  else if (name === 'MultiEdit') for (const e of input.edits || []) n += Math.max(countLines(e.old_string), countLines(e.new_string));
  else if (name === 'NotebookEdit') n = countLines(input.new_source);
  else return [];
  return file ? [{ file, lines: n }] : [];
}

const isConsult = (b) =>
  (b.type === 'server_tool_use' && b.name === 'advisor') ||
  (b.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task') && /consultant$/.test(String((b.input || {}).subagent_type || '')));

const normCmd = (c) => String(c || '').trim().replace(/\s+/g, ' ');

// Facts about one turn, each tagged with its line index so callers can order them.
function turnFacts(turn, cfgDir = configDir(), skipToolUseId) {
  const errors = new Map(); // tool_use_id -> is_error
  for (const l of turn) for (const b of blocks(l)) if (b.type === 'tool_result') errors.set(b.tool_use_id, !!b.is_error);
  const cfg = norm(cfgDir) + '/';
  const facts = { edits: [], consults: [], failures: [], markers: new Set(), errors, toolIds: new Set() };
  turn.forEach((l, i) => {
    if (l.type === 'user') {
      const m = JSON.stringify(l.message || '').match(/\[relay:(\w+)\]/g);
      if (m) m.forEach((x) => facts.markers.add(x.slice(7, -1)));
    }
    if (l.type !== 'assistant') return;
    for (const b of blocks(l)) {
      if (isConsult(b)) facts.consults.push(i);
      if (b.type !== 'tool_use' || b.id === skipToolUseId) continue;
      facts.toolIds.add(b.id);
      if ((EDIT_TOOLS.has(b.name) || b.name === 'Bash') && errors.get(b.id) !== true) {
        for (const e of editsOf(b.name, b.input)) if (!norm(e.file).startsWith(cfg)) facts.edits.push({ ...e, idx: i });
      }
      if (b.name === 'Bash' && errors.get(b.id) === true) facts.failures.push({ cmd: normCmd(b.input && b.input.command), idx: i });
    }
  });
  return facts;
}

module.exports = { readLines, currentTurn, lastModel, turnModel, turnFacts, editsOf, bashTargets, normCmd, norm, configDir };
