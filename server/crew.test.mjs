// What the agent way's direct helpers (crew.mjs) read out of the lead's reply: the page of something
// new and the jobs in it, the jobs handed out in a change, and its FIX and FILE blocks.
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobReader, changesIn, fixed, applyReply, codeOf, tagOf } from './crew.mjs';

// A reply read in small chunks, as it arrives.
function read(text, chunk = 5) {
  const jobs = [];
  let pages = 0;
  const r = new JobReader(j => jobs.push(j), () => pages++);
  for (let i = 0; i < text.length; i += chunk) r.push(text.slice(i, i + chunk));
  r.end();
  return { jobs, names: jobs.map(j => j.name), pages, page: r.page };
}

const PAGE = '<!doctype html>\n<script type="module">\n// shared\nconst S = {};\n// @part truck [🚚 the monster truck]: drawTruck(ctx) - a big purple truck\n// @part cars: makeCars() → { update(dt) } - five cars\n// MAIN\ndrawTruck();\n</script>';

test('the page of something new: its jobs start as their lines are written', () => {
  const r = read(`TITLE: 🚚 Trucks\n\n\`\`\`html\n${PAGE}\n\`\`\`\n`, 7);
  assert.equal(r.pages, 1);
  assert.deepEqual(r.names, ['truck', 'cars']);
  assert.equal(r.page, PAGE);
  const [truck, cars] = r.jobs;
  assert.deepEqual([truck.emoji, truck.words, truck.job, truck.again, truck.partial], ['🚚', 'the monster truck', 'drawTruck(ctx) - a big purple truck', false, true]);
  // A helper sees the page up to its own job line: not the jobs after it, not MAIN.
  assert.ok(truck.page.startsWith('<!doctype html>') && truck.page.endsWith('a big purple truck') && !truck.page.includes('makeCars'));
  assert.ok(cars.page.includes('drawTruck(ctx)') && !cars.page.includes('MAIN'));
  assert.deepEqual([cars.emoji, cars.words], ['', '']);
});

test('a page with a blank line before it, and a bare page without the block', () => {
  assert.equal(read(`TITLE: x\n\n\`\`\`html\n\n${PAGE}\n\`\`\`\n`).page, PAGE);
  const bare = read(`TITLE: x\n<!doctype html>\n<html><script>\n// @part a: f() - y\n</script></html>\nPART b: g() - h\n`);
  assert.deepEqual([bare.pages, bare.names], [1, ['a', 'b']]);
});

test('jobs handed out in a change: PART lines, new and again', () => {
  const r = read('PART rival [🛻 a racing truck]: makeRival() → { update(dt), draw(ctx) } - races\nPART `arena` (again): add a ramp; the rest stays\n\nFIX page.html\n<<<<<<< FIND\n// @part cars\n=======\n// @part cars\n// @part rival\n>>>>>>> REPLACE\nDONE: ok');
  assert.equal(r.pages, 0);
  assert.deepEqual(r.jobs.map(j => [j.name, j.again, j.partial, j.page]), [['rival', false, false, null], ['arena', true, false, null]]);
  assert.equal(r.jobs[0].words, 'a racing truck');
});

test('nothing inside a FIX block, a whole file or a snippet counts as a job or a page', () => {
  // (A FIX that touches the first line of the page must never be taken for a new page.)
  const fix = read('PART b: g() - h\nFIX page.html\n<<<<<<< FIND\n<!doctype html>\n<html><head>\n=======\n<!doctype html>\n<html lang=en><head>\nPART c: no() - job\n>>>>>>> REPLACE\nPART d: k() - l\nDONE: ok');
  assert.deepEqual([fix.pages, fix.names], [0, ['b', 'd']]);
  const file = read('FILE parts/x.js\n```js\nPART q: no() - job\nconst a = 1;\n```\nPART d: k() - l');
  assert.deepEqual([file.pages, file.names], [0, ['d']]);
  const snippet = read('Here is the bit:\n```html\n<canvas id=c></canvas>\n// @part x: f() - y\n```\nPART rival: makeRival() - races');
  assert.deepEqual([snippet.pages, snippet.names, snippet.page], [0, ['rival'], null]);
  assert.deepEqual(read('```html\n```\nPART b: g() - h\n').names, ['b']);
});

test('a job tag: its picture and its words', () => {
  assert.deepEqual(tagOf('🚚 the monster truck'), { emoji: '🚚', words: 'the monster truck' });
  assert.deepEqual(tagOf('⚙️ how it works!'), { emoji: '⚙️', words: 'how it works' });
  assert.deepEqual(tagOf('the cars'), { emoji: '', words: 'the cars' });
  assert.deepEqual(tagOf(undefined), { emoji: '', words: '' });
});

test('the changes in a reply, in order: FIX blocks and whole files', () => {
  const c = changesIn('Some words.\nFIX parts/a.js\n<<<<<<< FIND\n  x = 1;\n=======\n  x = 2;\n>>>>>>> REPLACE\n<<<<<<< FIND\ny\n=======\n>>>>>>> REPLACE\n\nFILE parts/b.js\n```js\nconst b = 1;\n```\n**FIX `page.html`**\n<<<<<<< FIND\nq\n=======\nr\ns\n>>>>>>> REPLACE\nDONE: yes');
  assert.deepEqual(c, [
    { path: 'parts/a.js', find: '  x = 1;', replace: '  x = 2;' },
    { path: 'parts/a.js', find: 'y', replace: '' },
    { path: 'parts/b.js', content: 'const b = 1;' },
    { path: 'page.html', find: 'q', replace: 'r\ns' },
  ]);
});

test('a FIX fits one place only', () => {
  assert.equal(fixed('a\n  x = 1;\nb', { find: 'x = 1;', replace: 'x = 2;' }).text, 'a\n  x = 2;\nb');
  // The spaces at either end of its lines may differ from the file's.
  assert.equal(fixed('a\n\tx = 1;  \nb', { find: '  x = 1;', replace: '  x = 2;' }).text, 'a\n  x = 2;\nb');
  assert.match(fixed('x\nx', { find: 'x', replace: 'y' }).why, /2 places/);
  assert.match(fixed('abc', { find: 'zzz', replace: 'y' }).why, /isn't in the file/);
  assert.match(fixed('abc', { find: ' ', replace: 'y' }).why, /empty/);
  // (A $ in the replacement is just a $.)
  assert.equal(fixed('a$b', { find: 'a$b', replace: "$&$'x" }).text, "$&$'x");
});

test("a reply's changes are taken into the creation's files only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-'));
  try {
    fs.mkdirSync(path.join(dir, 'parts'));
    fs.writeFileSync(path.join(dir, 'page.html'), 'one\ntwo\n');
    const misses = applyReply(dir, 'FIX page.html\n<<<<<<< FIND\ntwo\n=======\n2\n>>>>>>> REPLACE\nFIX ../evil.js\n<<<<<<< FIND\na\n=======\nb\n>>>>>>> REPLACE\nFIX parts/none.js\n<<<<<<< FIND\na\n=======\nb\n>>>>>>> REPLACE\nFILE parts/new.js\n```\nlet n = 1;\n```\nFILE /etc/passwd\n```\nx\n```\n');
    assert.equal(fs.readFileSync(path.join(dir, 'page.html'), 'utf8'), 'one\n2\n');
    assert.equal(fs.readFileSync(path.join(dir, 'parts/new.js'), 'utf8'), 'let n = 1;\n');
    assert.deepEqual(misses.map(m => m.path), ['../evil.js', 'parts/none.js', '/etc/passwd']);
    assert.match(misses[0].why, /isn't one of the creation's files/);
    assert.match(misses[1].why, /isn't there/);
    assert.ok(!fs.existsSync(path.join(dir, '..', 'evil.js')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a helper's reply is its part's code", () => {
  assert.equal(codeOf('Here:\n```js\nconst a = 1;\n```\nDone'), 'const a = 1;');
  assert.equal(codeOf('const a = 1;\n'), 'const a = 1;');
  assert.equal(codeOf('```js\nconst a = 1;\nconst b = 2;'), 'const a = 1;\nconst b = 2;'); // (a block it never closed)
  assert.equal(codeOf(''), '');
});
