const test = require('node:test');
const assert = require('node:assert');
const { collect, normModel, render } = require('../scripts/savings.js');

const ts = '2026-11-02T10:00:00.000Z';
const since = Date.parse('2026-11-01T00:00:00Z');
const line = (model, id, usage, timestamp = ts) => ({ type: 'assistant', timestamp, message: { model, id, usage } });
const M = 1e6;

test('model ids from providers normalize to first-party ids', () => {
  assert.equal(normModel('us.anthropic.claude-sonnet-5-5-v1:0'), 'claude-sonnet-5-5');
  assert.equal(normModel('claude-opus-4-5@20251101'), 'claude-opus-4-5');
  assert.equal(normModel('claude-haiku-4-5-20251001'), 'claude-haiku-4-5');
  assert.equal(normModel('anthropic.claude-opus-5-5'), 'claude-opus-5-5');
});

test('duplicate lines of one message are counted once', () => {
  const u = { input_tokens: M, output_tokens: 0 };
  const r = collect([line('claude-sonnet-5-5', 'm1', u), line('claude-sonnet-5-5', 'm1', u)], since);
  assert.equal(r.rows['claude-sonnet-5-5'].input, M);
  assert.equal(r.rows['claude-sonnet-5-5'].cost, 2);
});

test('advisor iterations are priced at the advisor model and left out of the baseline', () => {
  const u = {
    input_tokens: M, output_tokens: 0,
    iterations: [
      { type: 'message', input_tokens: M, output_tokens: 0 },
      { type: 'advisor_message', model: 'claude-opus-5-5', input_tokens: M, output_tokens: M },
    ],
  };
  const r = collect([line('claude-sonnet-5-5', 'm1', u)], since);
  assert.equal(r.rows['claude-sonnet-5-5'].cost, 2);
  assert.equal(r.rows['claude-opus-5-5 (advisor)'].cost, 24);
  assert.equal(r.consults, 1);
  assert.equal(r.actual, 26);
  assert.equal(r.baseline, 4); // only the executor's 1M input, at Opus 5.5 rates
});

test('1h and 5m cache writes use their own rates; reads use the read rate', () => {
  const u = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: M, cache_creation_input_tokens: 2 * M, cache_creation: { ephemeral_5m_input_tokens: M, ephemeral_1h_input_tokens: M } };
  const r = collect([line('claude-opus-5-5', 'm1', u)], since);
  assert.equal(r.rows['claude-opus-5-5'].cost, 0.2 + 5 + 8);
});

test('Haiku 5.5 prompts over 100K tokens pay the higher rate', () => {
  const small = collect([line('claude-haiku-5-5', 'a', { input_tokens: 100000, output_tokens: 0 })], since);
  const big = collect([line('claude-haiku-5-5', 'b', { input_tokens: 100001, output_tokens: 0 })], since);
  assert.equal(small.rows['claude-haiku-5-5'].cost, 0.01);
  assert.ok(Math.abs(big.rows['claude-haiku-5-5'].cost - 0.0500005) < 1e-9);
});

test('unknown models show tokens with no cost; old lines and synthetic messages are skipped', () => {
  const r = collect([
    line('claude-mystery-9', 'x', { input_tokens: 5, output_tokens: 0 }),
    line('claude-sonnet-5-5', 'old', { input_tokens: M, output_tokens: 0 }, '2026-10-01T00:00:00Z'),
    line('<synthetic>', 's', { input_tokens: 9, output_tokens: 0 }),
  ], since);
  assert.equal(r.rows['claude-mystery-9'].cost, null);
  assert.equal(r.rows['claude-mystery-9'].input, 5);
  assert.equal(Object.keys(r.rows).length, 1);
});

test('render says when routing cost more than Opus would have', () => {
  const u = { input_tokens: 0, output_tokens: 0, iterations: [{ type: 'message', input_tokens: 10, output_tokens: 0 }, { type: 'advisor_message', model: 'claude-opus-5-5', input_tokens: M, output_tokens: 0 }] };
  const out = render(collect([line('claude-sonnet-5-5', 'm1', u)], since), 7);
  assert.match(out, /more than running everything on Opus/);
  const saved = render(collect([line('claude-sonnet-5-5', 'm2', { input_tokens: M, output_tokens: 0 })], since), 7);
  assert.match(saved, /Saved \$2\.00 \(50%\)/);
});
