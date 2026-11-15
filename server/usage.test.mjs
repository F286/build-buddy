// Fast mode phase by phase, and what Claude's work costs: a session's turns run at their own
// phase's speed, and what each program used is written down for the day's breakdown.
// (With fake-claude.mjs standing in for the `claude` command: no model is called.)
//   npm test
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// (A data folder of its own, set before Build Buddy's modules are loaded.)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildbuddy-usage-'));
process.env.KIDBUILD_DATA = dir;
process.env.FAKE_CLAUDE_LOG = path.join(dir, 'fake.log');
const { config, DEFAULTS, fastIn, fastEver, fastPhases, helperSpeed } = await import('./config.mjs');
const usage = await import('./usage.mjs');
const { Session } = await import('./solo.mjs');
const { askRole, roleConfig, stopPrograms } = await import('./team.mjs');
const agents = await import('./agents.mjs');
config().claude.bin = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
after(() => stopPrograms());

const sleep = ms => new Promise(r => setTimeout(r, ms));
const lines = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const used = () => lines(path.join(dir, 'usage.jsonl')).filter(r => r.kind === 'use');
const sent = () => lines(process.env.FAKE_CLAUDE_LOG);
// (What a program used is written when it reports it, a moment after its reply is in.)
async function until(check) {
  for (let i = 0; i < 100 && !check(); i++) await sleep(20);
  assert.ok(check(), 'still waiting after two seconds');
}
function fresh() {
  for (const f of ['usage.jsonl', 'fake.log']) fs.rmSync(path.join(dir, f), { force: true });
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
const SESSION = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--model', 'opus'];

test('a fast setting: one switch for everything, or one for each phase', () => {
  assert.deepEqual(fastPhases(true), { new: true, change: true, play: true });
  assert.deepEqual(fastPhases(undefined), { new: false, change: false, play: false });
  assert.deepEqual(fastPhases({ new: true, play: false }), { new: true, change: false, play: false });
  assert.equal(fastIn({ change: true }, 'change'), true);
  assert.deepEqual([fastEver(false), fastEver({ new: false, change: false, play: false }), fastEver({ play: true })], [false, false, true]);
});

test('by default: the main agent is fast for something new, and nothing else is', () => {
  assert.deepEqual(fastPhases(DEFAULTS.claude.fast), { new: true, change: false, play: false });
  assert.deepEqual(fastPhases(DEFAULTS.claude.fastHelpers), { new: false, change: false, play: false });
});

test('each role runs at its phase’s speed, by the work it was asked within', () => {
  const c = config();
  const before = { claude: c.claude, team: c.team };
  c.claude = { ...c.claude, model: 'opus', fast: { new: true, change: false, play: false }, fastHelpers: { new: false, change: true, play: false } };
  c.team = { ...c.team, lead: {}, helper: { model: 'sonnet' }, agentLead: {}, agentHelper: { model: 'sonnet' } };
  try {
    const at = (phase, name) => usage.during({ phase }, () => [roleConfig(name).model, roleConfig(name).fast]);
    assert.deepEqual([at('new', 'lead'), at('change', 'lead'), at('play', 'lead')], [['opus', true], ['opus', false], ['opus', false]]);
    assert.deepEqual([at('new', 'agentHelper'), at('change', 'agentHelper'), at('play', 'helper')], [['sonnet', false], ['opus', true], ['sonnet', false]]);
    assert.deepEqual(helperSpeed({}, 'sonnet', 'change'), { fast: true, model: 'opus' });
    // Subagents take the lead's speed: fast builders for changes need a lead that's fast for changes.
    assert.deepEqual(['new', 'change', 'play'].map(p => agents.lead().helperModelIn(p)), ['sonnet', 'sonnet', 'sonnet']);
    c.claude.fast = { new: true, change: true, play: false };
    assert.deepEqual(['new', 'change', 'play'].map(p => agents.lead().helperModelIn(p)), ['sonnet', 'opus', 'sonnet']);
    assert.deepEqual(['new', 'change', 'play'].map(p => agents.lead().fastIn(p)), [true, true, false]);
  } finally {
    Object.assign(c, before);
  }
});

test('one session, a speed for each phase: set before the turn is sent, and each turn’s own share written down', async () => {
  fresh();
  const s = new Session('p1', { args: [...SESSION, '--settings', '{"fastMode":true}'], label: 'agents', model: 'opus', fastFor: phase => phase !== 'play' });
  try {
    await usage.during({ phase: 'new', ask: 'a1' }, () => s.ask('one'));
    await usage.during({ phase: 'play', ask: 'a1' }, () => s.ask('two', { kind: 'polish' }));
    await usage.during({ phase: 'change', ask: 'a2' }, () => s.ask('three'));
    await until(() => used().length === 3);
  } finally {
    s.end();
  }
  // What the program was sent, in order: fast mode goes off before the pass and back on after it.
  assert.deepEqual(
    sent().map(l => (l.started ? `started fast=${l.fast}` : l.control ? `${l.control} ${JSON.stringify(l.settings)}` : `turn ${l.text} fast=${l.fast}`)),
    ['started fast=true', 'turn one fast=true', 'apply_flag_settings {"fastMode":false}', 'turn two fast=false', 'apply_flag_settings {"fastMode":true}', 'turn three fast=true'],
  );
  // Claude Code reports running totals: each turn is written down with what it added.
  assert.deepEqual(used().map(r => [r.phase, r.ask, r.who, r.fast, r.out, r.cr]), [['new', 'a1', 'main', true, 100, 1000], ['play', 'a1', 'main', false, 100, 1000], ['change', 'a2', 'main', true, 100, 1000]]);
  used().forEach((r, i) => near(r.cost, [0.025, 0.01, 0.025][i]));
  assert.equal(used()[0].model, 'claude-opus-5-5');
});

test('a lead and its subagents: the builders’ share by their model - or by their writing, when it’s the lead’s own', async () => {
  fresh();
  const helper = phase => (phase === 'change' ? 'opus' : 'sonnet');
  const s = new Session('p2', {
    args: [...SESSION, '--tools', 'Agent,Read', '--system-prompt', 'Your helpers are subagents (model "sonnet").', '--settings', '{"fastMode":true}'],
    label: 'agents',
    model: 'opus',
    fastFor: () => true,
    helperModel: helper,
    turnNote: phase => (helper(phase) === 'sonnet' ? '' : `(For this turn, start your helpers with model "${helper(phase)}" in place of "sonnet".)`),
  });
  try {
    await usage.during({ phase: 'new', ask: 'b1' }, () => s.ask('a truck'));
    await usage.during({ phase: 'change', ask: 'b2' }, () => s.ask('make it green'));
    await until(() => used().length === 4);
  } finally {
    s.end();
  }
  const [main1, builders1, main2, builders2] = used();
  // Something new: an Opus lead in fast mode, Sonnet helpers at their usual speed.
  assert.deepEqual([main1.who, main1.model, main1.fast, main1.out], ['main', 'claude-opus-5-5', true, 100]);
  assert.deepEqual([builders1.who, builders1.model, builders1.fast, builders1.out, builders1.phase], ['builders', 'claude-sonnet-5-5', false, 300, 'new']);
  [near(main1.cost, 0.025), near(builders1.cost, 0.006)];
  // The change: its turn says to start the helpers with Opus, and they're fast like the lead.
  assert.match(sent().find(l => l.turn === 2).text, /make it green\n\n\(For this turn, start your helpers with model "opus"/);
  assert.deepEqual([main2.fast, builders2.fast, builders2.model, main2.approx, builders2.approx], [true, true, 'claude-opus-5-5', true, true]);
  // (Lead and helpers on one model: Opus's 0.055 is shared out by who wrote how much - 100 and 300.)
  assert.deepEqual([main2.out, builders2.out], [100, 300]);
  [near(main2.cost, 0.01375), near(builders2.cost, 0.04125)];
});

test('a helper of its own: started at its phase’s speed, and what it reports written down', async () => {
  fresh();
  const c = config();
  const before = { claude: c.claude, team: c.team };
  c.claude = { ...c.claude, model: 'opus', effort: 'low', fast: false, fastHelpers: { new: true, change: false, play: false } };
  c.team = { ...c.team, warm: false, agentHelper: { model: 'sonnet' } };
  try {
    await usage.during({ phase: 'new', ask: 'c1' }, () => askRole('agentHelper', { system: 'write a part', prompt: 'the truck', timeoutSec: 20 }));
    await usage.during({ phase: 'change', ask: 'c2' }, () => askRole('agentHelper', { system: 'write a part', prompt: 'the ramp', timeoutSec: 20 }));
    await until(() => used().length === 2);
  } finally {
    Object.assign(c, before);
  }
  assert.deepEqual(sent().filter(l => l.started).map(l => [l.model, l.fast]), [['opus', true], ['sonnet', false]]);
  const rows = used().sort((a, b) => a.ask.localeCompare(b.ask));
  assert.deepEqual(rows.map(r => [r.ask, r.phase, r.who, r.role, r.model, r.fast, r.out]), [['c1', 'new', 'builders', 'agentHelper', 'claude-opus-5-5', true, 100], ['c2', 'change', 'builders', 'agentHelper', 'claude-sonnet-5-5', false, 100]]);
  [near(rows[0].cost, 0.025), near(rows[1].cost, 0.01)];
});

test('the day’s breakdown: each phase by who did it, and each thing asked for', () => {
  const day = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
  const use = (t, ask, phase, who, cost, more = {}) => ({ t, kind: 'use', ask, phase, who, fast: false, in: 10, out: 100, cr: 1000, cw: 0, cost, ...more });
  const all = [
    { t: day(14, 17), kind: 'ask', id: 'old', phase: 'new', text: 'a fish tank' },
    use(day(14, 17, 1), 'old', 'new', 'main', 0.5),
    { t: day(15, 16), kind: 'ask', id: 'x1', phase: 'new', text: 'a monster truck' },
    use(day(15, 16), 'x1', 'new', 'voice', 0.001),
    use(day(15, 16), 'x1', 'new', 'main', 0.2, { fast: true, model: 'claude-opus-5-5' }),
    use(day(15, 16), 'x1', 'new', 'builders', 0.1, { model: 'claude-sonnet-5-5' }),
    use(day(15, 16), 'x1', 'new', 'builders', null), // (stopped before it reported a price)
    { t: day(15, 16, 1), kind: 'shown', ask: 'x1', ms: 40000, ok: true, title: 'Truck Show', backend: 'claude agents' },
    use(day(15, 16, 2), 'x1', 'play', 'main', 0.3),
    use(day(15, 16, 3), 'x1', 'play', 'watch', 0.05),
    { t: day(15, 16, 5), kind: 'ask', id: 'x2', phase: 'change', text: 'make it green' },
    use(day(15, 16, 5), 'x2', 'change', 'main', 0.04, { fast: true }),
    { t: day(15, 16, 5), kind: 'shown', ask: 'x2', ms: 8000, ok: true, title: 'Truck Show', backend: 'claude agents' },
    { t: day(15, 16, 9), kind: 'ask', id: 'x3', phase: 'change', text: 'add fire' },
    { t: day(15, 16, 9), kind: 'shown', ask: 'x3', ms: 3000, ok: false },
    use(day(15, 16, 20), 'old', 'play', 'watch', 0.02), // (a request of another day)
  ];
  const u = usage.summary(undefined, all);
  assert.deepEqual(u.days.map(d => [d.day, d.asks]), [['2026-11-15', 3], ['2026-11-14', 1]]);
  assert.equal(u.day, '2026-11-15');
  near(u.total.cost, 0.711);
  near(u.total.fast, 0.24);
  assert.equal(u.total.unpriced, 1);
  near(u.phases.new.main.cost, 0.2);
  near(u.phases.new.builders.cost, 0.1);
  near(u.phases.new.other.cost, 0.001);
  assert.deepEqual([u.phases.new.asks, u.phases.new.waitMs, u.phases.change.asks, u.phases.change.waitMs, u.phases.play.asks], [1, 40000, 2, 8000, 2]);
  near(u.phases.play.total.cost, 0.37);
  assert.equal(u.phases.new.total.out, 400);
  assert.deepEqual(u.asks.map(a => [a.text, a.phase, a.ok, a.waitMs]), [['a monster truck', 'new', true, 40000], ['make it green', 'change', true, 8000], ['add fire', 'change', false, 3000]]);
  near(u.asks[0].wait.total.cost, 0.301);
  near(u.asks[0].wait.total.fast, 0.2);
  near(u.asks[0].play.cost, 0.35);
  assert.deepEqual(u.asks[0].models, ['main claude-opus-5-5 fast', 'builders claude-sonnet-5-5']);
  near(u.loose.cost, 0.02);
  // Another day, asked for by name; and nothing at all yet.
  near(usage.summary('2026-11-14', all).total.cost, 0.5);
  assert.deepEqual([usage.summary(undefined, []).day, usage.summary(undefined, []).days], [null, []]);
});
