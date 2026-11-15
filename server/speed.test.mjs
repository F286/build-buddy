// Fast mode's two switches: the main agent's (claude.fast) and the builders' (claude.fastHelpers) -
// who runs in fast mode, and with which model, for each way of building with a team.
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { config, helperSpeed } from './config.mjs';
import { roleConfig } from './team.mjs';
import { lead } from './agents.mjs';

// The settings for one check, in memory only (config.json is never written), then put back.
function withSettings({ fast = false, fastHelpers = false, model = 'opus', team = {} }, check) {
  const c = config();
  const before = { claude: c.claude, team: c.team };
  c.claude = { ...c.claude, model, fast, fastHelpers };
  c.team = { ...c.team, lead: {}, helper: { model: 'sonnet', effort: 'low' }, agentLead: {}, agentHelper: { model: 'sonnet' }, ...team };
  try {
    check();
  } finally {
    Object.assign(c, before);
  }
}

const speedOf = name => [roleConfig(name).model, roleConfig(name).fast];

test('both off: nobody is fast, and the helpers write with Sonnet', () => {
  withSettings({}, () => {
    for (const name of ['lead', 'fixer', 'checker', 'polisher', 'tester']) assert.equal(roleConfig(name).fast, false, name);
    assert.deepEqual(speedOf('helper'), ['sonnet', false]);
    assert.deepEqual(speedOf('agentHelper'), ['sonnet', false]);
    assert.deepEqual([lead().fastIn('change'), lead().helperModelIn('change')], [false, 'sonnet']);
  });
});

test('the main agent only: the lead is fast, the helpers stay as they are', () => {
  withSettings({ fast: true }, () => {
    assert.deepEqual(speedOf('lead'), ['opus', true]);
    for (const name of ['fixer', 'checker', 'polisher', 'tester']) assert.equal(roleConfig(name).fast, true, name);
    assert.deepEqual(speedOf('helper'), ['sonnet', false]);
    assert.deepEqual(speedOf('agentHelper'), ['sonnet', false]);
    assert.deepEqual([lead().fastIn('change'), lead().helperModelIn('change')], [true, 'sonnet']);
  });
});

test('the builders only: helpers of their own are fast, on Opus; the lead is not', () => {
  withSettings({ fastHelpers: true }, () => {
    assert.deepEqual(speedOf('lead'), ['opus', false]);
    assert.deepEqual(speedOf('helper'), ['opus', true]);
    assert.deepEqual(speedOf('agentHelper'), ['opus', true]);
    assert.equal(roleConfig('helper').effort, 'low');
    // Subagents take the lead's speed: with a lead at normal speed they can't be fast, and stay on Sonnet.
    assert.deepEqual([lead().fastIn('change'), lead().helperModelIn('change')], [false, 'sonnet']);
  });
});

test('both: the lead is fast, and so are its helpers - subagents too, on Opus', () => {
  withSettings({ fast: true, fastHelpers: true }, () => {
    assert.deepEqual(speedOf('lead'), ['opus', true]);
    assert.deepEqual(speedOf('helper'), ['opus', true]);
    assert.deepEqual(speedOf('agentHelper'), ['opus', true]);
    assert.deepEqual([lead().fastIn('change'), lead().helperModelIn('change')], [true, 'opus']);
  });
});

test('fast helpers keep a model fast mode runs on, and leave Sonnet and Haiku for Opus', () => {
  withSettings({ fastHelpers: true }, () => {
    assert.deepEqual(helperSpeed({}, 'fable'), { fast: true, model: 'fable' });
    assert.deepEqual(helperSpeed({}, 'claude-opus-5-5'), { fast: true, model: 'claude-opus-5-5' });
    assert.deepEqual(helperSpeed({}, ''), { fast: true, model: '' }); // (Claude Code's own default)
    assert.deepEqual(helperSpeed({}, 'claude-sonnet-5-5'), { fast: true, model: 'opus' });
    assert.deepEqual(helperSpeed(undefined, 'haiku'), { fast: true, model: 'opus' });
  });
  withSettings({ fast: true, fastHelpers: true, team: { agentHelper: { model: 'fable' } } }, () => assert.equal(lead().helperModelIn('new'), 'fable'));
});

test("a role's own fast is passed on as written, whatever the switches say", () => {
  withSettings({ fast: true, fastHelpers: true, team: { lead: { fast: false }, helper: { model: 'sonnet', fast: false }, agentHelper: { model: 'haiku', fast: false }, agentLead: { fast: false } } }, () => {
    assert.deepEqual(speedOf('lead'), ['opus', false]);
    assert.deepEqual(speedOf('helper'), ['sonnet', false]);
    assert.deepEqual(speedOf('agentHelper'), ['haiku', false]);
    assert.deepEqual([lead().fastIn('change'), lead().helperModelIn('change')], [false, 'haiku']);
  });
  // (Its own model too: fast mode asked for on Sonnet is Claude Code's to leave off.)
  withSettings({ team: { helper: { model: 'sonnet', fast: true }, agentLead: { fast: true } } }, () => {
    assert.deepEqual(speedOf('helper'), ['sonnet', true]);
    assert.deepEqual([lead().fastIn('change'), lead().helperModelIn('change')], [true, 'sonnet']);
  });
});

test('the voice is never fast', () => {
  withSettings({ fast: true, fastHelpers: true }, () => assert.equal(roleConfig('voice').fast, false));
});
