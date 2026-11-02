// Builds transcript lines in the shapes Claude Code 2.1.316 writes (observed in the spike).
let n = 0;
const id = () => `toolu_${++n}`;

const prompt = (promptId, text = 'do the thing') => ({ type: 'user', promptId, message: { role: 'user', content: text } });

const assistant = (model, blocks, msgId = `msg_${++n}`, usage) => ({
  type: 'assistant',
  message: { model, id: msgId, role: 'assistant', content: blocks, usage: usage || { input_tokens: 1, output_tokens: 1 } },
});

const toolUse = (name, input, tid = id()) => ({ type: 'tool_use', id: tid, name, input });

const result = (promptId, tid, isError = false, content = 'ok') => ({
  type: 'user',
  promptId,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, is_error: isError || undefined, content }] },
});

const advisor = () => ({ type: 'server_tool_use', id: `srvtoolu_${++n}`, name: 'advisor', input: {} });

const lines = (k) => Array.from({ length: k }, (_, i) => `line ${i}`).join('\n');

module.exports = { prompt, assistant, toolUse, result, advisor, lines, id };
