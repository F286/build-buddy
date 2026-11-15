#!/usr/bin/env node
// A stand-in for the `claude` command, for the tests (usage.test.mjs: claude.bin points here). It
// speaks Claude Code's stream-json the way Build Buddy uses it - a session that takes turn after
// turn, or one question and done - calls no model, and reports made-up tokens and prices the way
// Claude Code reports real ones: running totals for the session, model by model. It answers every
// request with a small page. What it was started with and sent is written to $FAKE_CLAUDE_LOG.
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const note = what => process.env.FAKE_CLAUDE_LOG && fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify(what)}\n`);
const out = ev => process.stdout.write(`${JSON.stringify(ev)}\n`);
const fullName = m => ({ opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5', fable: 'claude-fable-5-2' })[m] || m || 'claude-opus-5-5';
const runsFast = m => !/sonnet|haiku/.test(m);

let model = opt('--model') || 'opus';
let fast = /"fastMode":true/.test(opt('--settings')); // (fast mode: as started, then as set between turns)
const subagents = opt('--tools').split(',').includes('Agent');
note({ started: true, model, fast, tools: opt('--tools') });

const totals = {}; // the session's running totals, model by model
let cost = 0;
let turns = 0;
function spend(name, tokens, price) {
  const m = (totals[name] ||= { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 });
  m.inputTokens += tokens.in;
  m.outputTokens += tokens.out;
  m.cacheReadInputTokens += tokens.cr;
  m.cacheCreationInputTokens += tokens.cw;
  m.costUSD += price;
  cost += price;
}

function turn(content) {
  turns++;
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  note({ turn: turns, fast, model, text: text.slice(0, 4000) });
  const speed = fast && runsFast(model) ? 'fast' : 'standard';
  const reply = `SAY: Okay!\nTITLE: 🚚 Test Truck\n\`\`\`html\n<!doctype html>\n<html><body><canvas id="c"></canvas><script>\nconst turn = ${turns};\n</script></body></html>\n\`\`\`\nDONE: Here it is!`;
  const stream = (event, parent) => out({ type: 'stream_event', event, ...(parent && { parent_tool_use_id: parent }) });
  stream({ type: 'message_start', message: { usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, speed } } });
  stream({ type: 'content_block_start', content_block: { type: 'text' } });
  stream({ type: 'content_block_delta', delta: { type: 'text_delta', text: reply } });
  // A lead with subagents: one helper writes three times as much as the lead, with the model the
  // lead was told to start it with (this turn's note, or else its instructions).
  if (subagents) {
    const helper = /start your helpers with model "(\w+)"/.exec(text)?.[1] || /model "(\w+)"\)/.exec(opt('--system-prompt'))?.[1] || 'sonnet';
    stream({ type: 'message_start', message: { usage: {} } }, 'toolu_helper');
    stream({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 300 } }, 'toolu_helper');
    stream({ type: 'message_stop' }, 'toolu_helper');
    spend(fullName(helper), { in: 5, out: 300, cr: 500, cw: 100 }, fast && runsFast(helper) ? 0.03 : runsFast(helper) ? 0.012 : 0.006);
  }
  spend(fullName(model), { in: 10, out: 100, cr: 1000, cw: 200 }, speed === 'fast' ? 0.025 : 0.01);
  stream({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 100 } });
  stream({ type: 'message_stop' });
  out({ type: 'result', subtype: 'success', is_error: false, result: reply, total_cost_usd: cost, usage: { input_tokens: 10, output_tokens: 100, speed }, modelUsage: totals });
}

function control(id, request) {
  note({ control: request.subtype, ...(request.settings && { settings: request.settings }), ...(request.model && { model: request.model }) });
  if (request.subtype === 'apply_flag_settings' && 'fastMode' in (request.settings || {})) fast = request.settings.fastMode === true;
  if (request.subtype === 'set_model') model = request.model;
  out({ type: 'control_response', response: { subtype: 'success', request_id: id } });
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  buf += d;
  if (opt('--input-format') !== 'stream-json') return; // (one question, read whole)
  for (let i; (i = buf.indexOf('\n')) >= 0; ) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.type === 'control_request') control(msg.request_id, msg.request);
    else if (msg.type === 'user') turn(msg.message.content);
  }
});
process.stdin.on('end', () => {
  if (opt('--input-format') !== 'stream-json') turn(buf);
  process.exit(0);
});
