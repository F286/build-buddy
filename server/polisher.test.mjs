// The polisher (team.agentPolisher): a second agent that remembers the creation, in a session of
// its own, which grows and polishes it while the kid plays. What the lead did reaches the polisher,
// what the polisher changed reaches the lead, and the kid's next request stops a pass under way.
// (With fake-claude.mjs standing in for the `claude` command: no model is called.)
//   npm test
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// (A data folder of its own, set before Build Buddy's modules are loaded.)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildbuddy-polisher-'));
process.env.KIDBUILD_DATA = dir;
process.env.FAKE_CLAUDE_LOG = path.join(dir, 'fake.log');
const { config } = await import('./config.mjs');
const usage = await import('./usage.mjs');
const store = await import('./store.mjs');
const agents = await import('./agents.mjs');
const { stopPrograms } = await import('./team.mjs');

const c = config();
c.claude = { ...c.claude, bin: fileURLToPath(new URL('./fake-claude.mjs', import.meta.url)), model: 'opus', fast: { new: true, change: false, play: false }, fastHelpers: false };
c.team = { ...c.team, enabled: true, agents: true, agentHelpers: 'subagents', warm: false, check: true, polish: 2, agentLead: {}, agentHelper: { model: 'sonnet' }, agentPolisher: { enabled: true, model: 'fable' } };
c.solo = { ...c.solo, enabled: false };
c.backends = ['claude'];
after(() => (agents.stop(), stopPrograms()));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sent = () => (fs.existsSync(process.env.FAKE_CLAUDE_LOG) ? fs.readFileSync(process.env.FAKE_CLAUDE_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
// The turns the lead and the polisher were sent, apart (the voice has no tools).
const turnsOf = model => sent().filter(l => l.turn && l.model === model && !/^Kid's request|SAY/.test(l.text));
async function until(check) {
  for (let i = 0; i < 150 && !check(); i++) await sleep(20);
  assert.ok(check(), 'still waiting after three seconds');
}

// What the kid asks for, built the agent way and kept as the app keeps it.
async function kidSays(text) {
  let p = store.currentProject();
  const page = store.html(p);
  const ask = usage.asked({ phase: usage.waitingFor(page), text, project: p.id });
  const r = await usage.during({ phase: ask.phase, ask: ask.id }, () => agents.build({ page, history: p.history, text, title: p.title }, () => {}, { said: '' }));
  p = store.addHistory(p, 'kid', text);
  p = store.addVersion(p, r.html, { request: text, backend: r.backend, continues: Boolean(page) });
  if (r.title) p = store.setTitle(p, r.title, r.emoji);
  return store.currentProject();
}
// The app asks for a pass, once the creation is on screen.
const pass = () => {
  const p = store.currentProject();
  return usage.during({ phase: 'play', ask: usage.lastAsk(p.id)?.id ?? null }, () => agents.check({ projectId: p.id, version: p.current, report: { fps: 60, errors: [] }, screenshot: '' }));
};
// The creation's one part, as it is in its folder ('' before it's written).
const part = () => {
  const file = path.join(dir, 'tmp', 'agents', store.currentProject().id, 'parts', 'truck.js');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};

test('what changed in the files, as each is told it', () => {
  const changes = agents.fileChanges({ 'page.html': 'a\nb', 'parts/old.js': 'x', 'parts/truck.js': 'one\ntwo' }, { 'page.html': 'a\nb', 'parts/truck.js': 'one\ntwo\n  three', 'parts/fire.js': '1\n2\n3' });
  assert.deepEqual(changes.map(ch => [ch.file, ch.kind]), [['parts/fire.js', 'new'], ['parts/old.js', 'removed'], ['parts/truck.js', 'changed']]);
  assert.deepEqual(changes[2].added, ['three']);
  assert.equal(agents.changesSaid(changes), 'parts/fire.js new (3 lines); parts/old.js removed; parts/truck.js changed (2 → 3 lines)');
  // The polisher's report, for the lead - and nothing to say when it did nothing.
  assert.equal(agents.reportSaid([]), '');
  assert.match(agents.reportSaid([{ files: 'parts/truck.js changed (2 → 3 lines)', why: 'made it bounce', lead: 'truck_bounce is new' }]), /the polisher changed your files[\s\S]*parts\/truck\.js changed \(2 → 3 lines\) - made it bounce What you should know: truck_bounce is new/);
});

test('the story the polisher is told: only what it hasn’t heard, with everything the lead was told and did', () => {
  const story = [
    { n: 1, kind: 'new', kid: 'a truck', alt: 'a duck', said: 'A truck, coming up!', lead: 'TITLE: 🚚 Truck\nDONE: Here it is!', jobs: [{ what: 'the truck', job: 'write parts/truck.js' }], changes: [{ file: 'parts/truck.js', kind: 'new', now: 3 }], secs: 40 },
    { n: 2, kind: 'talk', kid: 'what is it', lead: 'SAY: A truck!' },
    { n: 3, kind: 'fix', fix: 'ReferenceError: x is not defined\n  at line 3', lead: 'DONE: fixed', changes: [{ file: 'parts/truck.js', kind: 'changed', was: 3, now: 4, added: ['const x = 1;'], removed: [] }] },
  ];
  const all = agents.storySaid(story, 0);
  assert.equal(all.upTo, 3);
  for (const said of ['The kid said: "a truck"', 'The other listener heard: "a duck"', 'Sparky answered out loud: "A truck, coming up!"', 'built it as something new (40 s)', '- the truck: write parts/truck.js', 'DONE: Here it is!', 'Files: parts/truck.js new (3 lines)', 'The lead only answered', 'The page crashed when it was tried (ReferenceError: x is not defined)', '+ const x = 1;']) assert.ok(all.text.includes(said), said);
  const rest = agents.storySaid(story, 2);
  assert.ok(rest.text.includes('The page crashed') && !rest.text.includes('a truck"'));
  assert.deepEqual(agents.storySaid(story, 3), { text: '', upTo: 3 });
});

test('a long story is told whole: the latest turns in full, the earlier ones in short - and what was too old to keep is said', () => {
  const story = Array.from({ length: 11 }, (_, i) => ({ n: i + 5, kind: 'change', kid: `request ${i + 5}`, said: `answer ${i + 5}`, lead: `DONE: did ${i + 5}`, changes: [{ file: `parts/p${i + 5}.js`, kind: 'new', now: 3 }] }));
  const all = agents.storySaid(story, 0);
  assert.equal(all.upTo, 15);
  for (let n = 5; n <= 15; n++) assert.ok(all.text.includes(`The kid said: "request ${n}"`) && all.text.includes(`parts/p${n}.js new`), `turn ${n}`);
  // (Three of the eleven in short: no answers, no words of the lead's. Turns 1 to 4 were never kept.)
  assert.ok(!all.text.includes('answer 7') && !all.text.includes('did 7') && all.text.includes('answer 8') && all.text.includes('did 8'));
  assert.ok(all.text.includes('Turns before these are no longer kept') && all.text.includes('The earlier ones in short'));
  const some = agents.storySaid(story, 9);
  assert.ok(!some.text.includes('no longer kept') && !some.text.includes('in short') && some.text.includes('answer 10'));
  // With the page put back whole, the files the lead changed say nothing any more.
  assert.ok(!agents.storySaid(story, 13, { files: false }).text.includes('parts/p14.js'));
});

test('files put back: only what differs is written, each with the date it had', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'buildbuddy-files-'));
  fs.mkdirSync(path.join(folder, 'parts'));
  const file = rel => path.join(folder, rel);
  fs.writeFileSync(file('page.html'), 'page');
  fs.writeFileSync(file('parts/truck.js'), 'truck');
  const long = new Date(Date.now() - 60000);
  for (const rel of ['page.html', 'parts/truck.js']) fs.utimesSync(file(rel), long, long);
  const before = agents.snapshot(folder);
  assert.deepEqual(Object.keys(before), ['page.html', 'parts/truck.js']); // (the dates are kept out of sight)
  // A pass changes the part and adds another; then it's stopped.
  fs.writeFileSync(file('parts/truck.js'), 'truck, polished');
  fs.writeFileSync(file('parts/fire.js'), 'fire');
  agents.restore(folder, before);
  assert.deepEqual(agents.snapshot(folder), { 'page.html': 'page', 'parts/truck.js': 'truck' });
  // To whoever read them before the pass, both look untouched: the same words, the same date.
  for (const rel of ['page.html', 'parts/truck.js']) assert.ok(Math.abs(fs.statSync(file(rel)).mtimeMs - long.getTime()) < 2, rel);
});

test('how the files stand, for each of two agents that share them', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'buildbuddy-sync-'));
  fs.mkdirSync(path.join(folder, 'parts'));
  const write = part => {
    fs.writeFileSync(path.join(folder, 'page.html'), '<script>\n// @part truck\n</script>');
    fs.writeFileSync(path.join(folder, 'parts', 'truck.js'), part);
  };
  const page = () => agents.assemble(folder).html; // (the page, as the files hold it now)
  const [lead, polisher] = [{ dir: folder, files: null }, { dir: folder, files: null }];
  write('one');
  const one = page();
  // New to the folder, then as it left it; the other's work reads as a change inside it.
  assert.deepEqual([agents.syncState(lead, one), agents.syncState(lead, one), agents.syncState(polisher, one)], ['inside', '', 'inside']);
  write('two'); // (the polisher's pass)
  const two = page();
  polisher.files = two;
  assert.deepEqual([agents.syncState(lead, two), agents.syncState(polisher, two)], ['inside', '']);
  // The lead's files get ahead of the page (a repair that wasn't taken): the polisher is handed the
  // page whole - and the lead, for whom the page is still the one it knew, is told its parts are gone.
  write('three');
  assert.equal(agents.syncState(polisher, two), 'outside');
  assert.ok(!fs.existsSync(path.join(folder, 'parts', 'truck.js')));
  assert.deepEqual([agents.syncState(lead, two), agents.syncState(lead, two), agents.syncState(polisher, two)], ['whole', '', '']);
  // One agent alone is never told that: the page changing outside its files is just that.
  const alone = { dir: folder, files: two };
  assert.deepEqual([agents.syncState(alone, two), agents.syncState(alone, 'another page'), agents.syncState(alone, 'another page')], ['', 'outside', '']);
});

test('the lead builds, the polisher polishes in a session of its own, and each is told what the other did', async () => {
  store.newProject();
  await kidSays('a monster truck');
  assert.match(part(), /makeTruck/);
  assert.equal(turnsOf('fable').length, 0); // (nobody polishes while the kid waits)

  // The first pass: a second program, on its own model, never fast - told the whole story.
  const first = await pass();
  assert.equal(first.fixed, true);
  const started = sent().filter(l => l.started && /Write/.test(l.tools));
  assert.deepEqual(started.map(l => [l.model, l.fast, Boolean(l.polisher)]), [['opus', true, false], ['fable', false, true]]);
  const told = turnsOf('fable')[0].text;
  for (const said of ['Kid: a monster truck', 'Read rules.md, page.html and every part first', '<since_your_last_turn>', 'The kid said: "a monster truck"', 'built it as something new', 'When it appeared, Sparky said: "Here is your truck!"', `- the truck: Read rules.md and page.html, then write parts/truck.js`, 'DONE: Here is your truck!', 'Files: page.html new (6 lines); parts/truck.js new (3 lines)', 'Now grow it into its full, excellent version', 'the LEAD line comes after WHY']) assert.ok(told.includes(said), said);
  assert.match(part(), /truck_polish1/);
  assert.equal(store.currentProject().versions.at(-1).backend, 'claude agents polish');
  // (The lead's conversation had one turn: the pass wasn't one of its own.)
  assert.equal(turnsOf('opus').length, 1);

  // The kid's next request: the lead is told what the polisher changed, and why.
  await kidSays('make it green');
  const lead = turnsOf('opus')[1].text;
  for (const said of ['While the kid played, the polisher changed your files', 'parts/truck.js changed (3 → 4 lines)', 'made the truck bounce when poked (pass 1)', 'What you should know: parts/truck.js has a new flag, truck_polish1', 'The kid just said: "make it green"']) assert.ok(lead.includes(said), said);
  assert.ok(!lead.includes('conversation_so_far')); // (it still knows the rest)
  assert.match(part(), /truck_polish1[\s\S]*truck_change2/); // (it built on what the polisher added)

  // The next pass: the same polisher, told only what happened since - the change, line by line.
  const second = await pass();
  assert.equal(second.fixed, true);
  assert.equal(sent().filter(l => l.started && l.polisher).length, 1);
  const next = turnsOf('fable')[1].text;
  for (const said of ['The kid said: "make it green"', 'The lead changed what was there', 'Files: parts/truck.js changed (4 → 5 lines)', '+ const truck_change2 = true;', 'Test it the way a demanding parent']) assert.ok(next.includes(said), said);
  for (const gone of ['a monster truck', 'Read rules.md, page.html and every part first']) assert.ok(!next.includes(gone), gone);

  // What it cost is kept apart: the polisher's turns under play, as the polisher's.
  const mains = () => fs.readFileSync(path.join(dir, 'usage.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.kind === 'use' && r.who === 'main');
  await until(() => mains().filter(r => r.role === 'polisher').length === 2);
  assert.deepEqual(mains().map(r => [r.role, r.phase, r.fast, r.model]), [['agents', 'new', true, 'claude-opus-5-5'], ['polisher', 'play', false, 'claude-fable-5-2'], ['agents', 'change', false, 'claude-opus-5-5'], ['polisher', 'play', false, 'claude-fable-5-2']]);
});

test('the kid asks for something during a pass: the polisher stops, its half-done changes are taken out, and it’s told', async () => {
  agents.stop();
  store.newProject();
  await kidSays('a fire truck');
  process.env.FAKE_CLAUDE_HANG = '1'; // (the polisher's program: its turn changes the file, then never ends)
  const before = turnsOf('fable').length;
  let hanging;
  try {
    hanging = pass();
    await until(() => turnsOf('fable').length === before + 1 && /truck_polish/.test(part()));
  } finally {
    delete process.env.FAKE_CLAUDE_HANG;
  }

  await kidSays('add a ladder');
  assert.deepEqual(await hanging, { skipped: 'stale' });
  assert.ok(!/truck_polish/.test(part()) && /truck_change/.test(part())); // (the lead worked on the files as it left them)
  const lead = turnsOf('opus').at(-1).text;
  assert.ok(!lead.includes('the polisher changed your files')); // (nothing of the pass was kept: nothing to report)

  // Its next pass: what was taken out, and the request that came in.
  await agents.stop(); // (a polisher of its own again, that answers)
  const again = await pass();
  assert.equal(again.fixed, true);
  const told = turnsOf('fable').at(-1).text;
  for (const said of ['The kid said: "add a ladder"', 'Your last changes were taken out (the kid asked for something first)']) assert.ok(told.includes(said), said);
});

test('a polisher that doesn’t stop for the kid is ended: the lead never works in the files while it does', async () => {
  agents.stop();
  store.newProject();
  await kidSays('a crane');
  const polishers = () => sent().filter(l => l.started && l.polisher).length;
  const before = polishers();
  process.env.FAKE_CLAUDE_HANG = '1';
  process.env.FAKE_CLAUDE_DEAF = '1'; // (its turn changes the file, then goes on whatever it's told)
  let hanging;
  try {
    hanging = pass();
    await until(() => polishers() === before + 1 && /truck_polish/.test(part()));
  } finally {
    delete process.env.FAKE_CLAUDE_HANG;
    delete process.env.FAKE_CLAUDE_DEAF;
  }
  const t0 = Date.now();
  await kidSays('add a hook');
  assert.ok(Date.now() - t0 >= 4500, 'it was given a moment to stop first');
  assert.deepEqual(await hanging, { skipped: 'failed' });
  // The lead built on the files as they were before the pass: nothing half-done in them.
  assert.ok(!/truck_polish/.test(part()) && /truck_change/.test(part()));
  assert.ok(!turnsOf('opus').at(-1).text.includes('taken out')); // (they were never the lead's changes)
  // A new polisher takes its place, and is told what became of the pass.
  assert.equal((await pass()).fixed, true);
  assert.equal(polishers(), before + 2);
  assert.ok(turnsOf('fable').at(-1).text.includes('Your last changes were taken out (that turn failed)'));
});

test('a pass that crashed when it was tried is taken out of the files, whether or not the polisher is still there', async () => {
  agents.stop();
  store.newProject();
  await kidSays('a digger');
  const made = await pass();
  assert.match(part(), /truck_polish/);
  agents.stop(); // (the settings were saved meanwhile: its session is gone)
  const p = store.currentProject();
  store.dropVersion(p, made.version);
  agents.takenBack({ projectId: p.id, version: made.version, error: 'ReferenceError: bounce is not defined' });
  assert.ok(!/truck_polish/.test(part()));
  // (Its next turn says why; the lead isn't told of changes it never saw.)
  await kidSays('make it yellow');
  assert.ok(!turnsOf('opus').at(-1).text.includes('the polisher changed your files'));
  assert.equal((await pass()).fixed, true);
  assert.ok(turnsOf('fable').at(-1).text.includes('Your last changes were taken back: with them in, it crashed when it was tried (ReferenceError: bounce is not defined)'));
});

test('the page changed outside the files: each is told it was put back whole, and the polisher’s report still reaches the lead', async () => {
  agents.stop();
  store.newProject();
  await kidSays('a bus');
  // (The overwatch fixed the page: it's no longer what the files hold.)
  let p = store.currentProject();
  store.addVersion(p, store.html(p).replace('</body>', '<!-- fixed --></body>'), { request: '(overwatch)', backend: 'claude agents', continues: true });
  // The polisher is handed the page whole, with no parts, and polishes that.
  assert.equal((await pass()).fixed, true);
  const told = turnsOf('fable').at(-1).text;
  assert.ok(told.includes('page.html now holds the whole page as it is, with no parts'));
  assert.equal(part(), '');
  // The lead, at its next turn: the parts it knew are gone - and what the polisher changed since.
  await kidSays('make it red');
  const lead = turnsOf('opus').at(-1).text;
  for (const said of ['was put back into them whole', 'the polisher changed your files', 'page.html changed', 'What you should know: page.html has a new flag']) assert.ok(lead.includes(said), said);
});

test('switched off, the lead polishes in its own conversation again - and is told what the polisher had changed', async () => {
  agents.stop();
  store.newProject();
  await kidSays('a tow truck');
  assert.equal((await pass()).fixed, true); // (the polisher's)
  c.team = { ...c.team, agentPolisher: { enabled: false } };
  try {
    const leadTurns = turnsOf('opus').length;
    const polisherTurns = turnsOf('fable').length;
    assert.equal((await pass()).fixed, true); // (the lead's own)
    assert.equal(turnsOf('fable').length, polisherTurns);
    const told = turnsOf('opus').slice(leadTurns).at(-1).text;
    for (const said of ['the polisher changed your files', 'Test it the way a demanding parent']) assert.ok(told.includes(said), said);
  } finally {
    c.team = { ...c.team, agentPolisher: { enabled: true, model: 'fable' } };
  }
});
