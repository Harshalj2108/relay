#!/usr/bin/env node
// relay savings report: tokens and estimated API cost per model over the last N days of
// Claude Code sessions, compared with the same work priced on Opus 5.5.
// Usage: node savings.js [days]   (default 7)
const fs = require('fs');
const path = require('path');
const { configDir } = require('../lib/transcript.js');

const PRICES = require('./prices.json');
const BASELINE = 'claude-opus-5-5';

function normModel(id) {
  return String(id || '')
    .toLowerCase()
    .replace(/^.*?(claude-)/, '$1') // provider prefixes: anthropic., us.anthropic., ...
    .replace(/@.*$/, '') // vertex @version
    .replace(/-v\d+(:\d+)?$/, '') // bedrock -v1:0
    .replace(/-\d{8}$/, ''); // dated snapshots
}

function rates(model, prompt) {
  const p = PRICES[model];
  if (!p) return null;
  return p.over && prompt > p.over.prompt ? p.over : p;
}

function tokens(u) {
  const write = u.cache_creation_input_tokens || 0;
  const c = u.cache_creation || {};
  const w1 = c.ephemeral_1h_input_tokens || 0;
  return { input: u.input_tokens || 0, w5: c.ephemeral_5m_input_tokens != null ? c.ephemeral_5m_input_tokens : write - w1, w1, read: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 };
}

const cost = (t, r) => (t.input * r.in + t.w5 * r.w5 + t.w1 * r.w1 + t.read * r.read + t.output * r.out) / 1e6;

function collect(lines, sinceMs) {
  const seen = new Set();
  const res = { rows: {}, actual: 0, baseline: 0, consults: 0, advisorCost: 0, unpriced: false };
  for (const l of lines) {
    const m = l.type === 'assistant' && l.message;
    if (!m || !m.usage || !m.model || m.model === '<synthetic>') continue;
    if (Date.parse(l.timestamp) < sinceMs) continue;
    const key = m.id || `${l.requestId}|${l.uuid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const its = Array.isArray(m.usage.iterations) && m.usage.iterations.length ? m.usage.iterations : [{ type: 'message', ...m.usage }];
    for (const it of its) {
      const advisor = it.type === 'advisor_message';
      const model = normModel(advisor ? it.model : m.model);
      const t = tokens(it);
      const prompt = t.input + t.w5 + t.w1 + t.read;
      const r = rates(model, prompt);
      const c = r ? cost(t, r) : null;
      const name = advisor ? `${model} (advisor)` : model;
      const row = (res.rows[name] = res.rows[name] || { calls: 0, input: 0, write: 0, read: 0, output: 0, cost: r ? 0 : null });
      row.calls++;
      row.input += t.input;
      row.write += t.w5 + t.w1;
      row.read += t.read;
      row.output += t.output;
      if (c == null) { res.unpriced = true; continue; }
      row.cost += c;
      res.actual += c;
      if (advisor) { res.consults++; res.advisorCost += c; }
      else res.baseline += cost(t, rates(BASELINE, prompt));
    }
  }
  return res;
}

function* jsonlFiles(dir, sinceMs) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* jsonlFiles(p, sinceMs);
    else if (e.name.endsWith('.jsonl')) {
      try { if (fs.statSync(p).mtimeMs >= sinceMs) yield p; } catch {}
    }
  }
}

function* readAll(files) {
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const l of text.split('\n')) {
      // cheap pre-filter: only assistant lines carry usage
      if (!l.includes('"usage"')) continue;
      try { yield JSON.parse(l); } catch {}
    }
  }
}

const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(n));
const usd = (n) => (n == null ? '?' : n > 0 && n < 0.005 ? '<$0.01' : '$' + n.toFixed(2));

function render(r, days) {
  const names = Object.keys(r.rows).sort((a, b) => (r.rows[b].cost || 0) - (r.rows[a].cost || 0));
  if (!names.length) return `No Claude Code usage found in the last ${days} days.`;
  const out = [`relay savings: last ${days} days`, '', '| Model | Calls | Input | Cache write | Cache read | Output | Cost |', '|---|--:|--:|--:|--:|--:|--:|'];
  for (const n of names) {
    const x = r.rows[n];
    out.push(`| ${n} | ${x.calls} | ${k(x.input)} | ${k(x.write)} | ${k(x.read)} | ${k(x.output)} | ${usd(x.cost)} |`);
  }
  out.push(`| **Total** | | | | | | **${usd(r.actual)}** |`, '');
  if (r.consults) out.push(`Advisor consults: ${r.consults}, ${usd(r.advisorCost)} total, ${usd(r.advisorCost / r.consults)} each on average.`);
  out.push(`Same work on Opus 5.5 (estimate): ${usd(r.baseline)}.`);
  const diff = r.baseline - r.actual;
  if (r.baseline > 0) {
    out.push(diff >= 0 ? `Saved ${usd(diff)} (${Math.round((diff / r.baseline) * 100)}%).` : `Routing cost ${usd(-diff)} more than running everything on Opus. Fewer or earlier advisor consults, or shorter sessions, bring this down.`);
  }
  if (r.unpriced) out.push('Some models have no price in prices.json; their cost is left out.');
  out.push('', '_API list prices. Bedrock, Vertex, Foundry and subscription plans count usage differently, so read this as relative. The baseline assumes Opus would have used the same tokens._');
  return out.join('\n');
}

if (require.main === module) {
  const days = Math.max(1, parseInt(process.argv[2], 10) || 7);
  const since = Date.now() - days * 864e5;
  const files = jsonlFiles(path.join(configDir(), 'projects'), since);
  console.log(render(collect(readAll(files), since), days));
}

module.exports = { collect, normModel, render };
