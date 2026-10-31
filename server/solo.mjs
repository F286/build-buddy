// Solo mode: one Claude builds the whole creation, and remembers it. No team and no helpers: a
// single `claude -p` session per creation, kept running between requests.
//
//   - Its first reply is the heart of it - the star, its place, the main thing to do - on screen in
//     seconds (the session is started while the kid is still talking).
//   - Then, while the kid plays, it looks at a screenshot of it running and grows it into its full
//     version, then looks again as a demanding parent would and polishes it (solo.polish passes in
//     all) - in the same session, so it knows what it meant every piece to do.
//   - The kid's changes go to the same session: it knows every line it wrote, so it changes the
//     page with small edits instead of reading it again.
//   - Something the kid asks for comes first: a pass that's still running is interrupted (the
//     session keeps everything it knew).
//
// If a session ends (the creation changes, the app restarts, it gets too long), the next one is
// handed the page as it is.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { findBin } from './bins.mjs';
import * as store from './store.mjs';
import { systemPrompt, pickLook, parseReply, applyEdits, field, log, isBusy, WORK_DIR } from './ai.mjs';
import { syntaxErrors, blankProblems, renameClashes } from './team.mjs';

// Solo mode needs Claude Code: it's on when switched on and Claude is the first brain.
export function enabled() {
  const c = config();
  return Boolean(c.solo?.enabled) && c.backends[0] === 'claude';
}

// How many look-and-improve passes follow a creation (or a change).
export function polishPasses() {
  const v = config().solo?.polish;
  return v === false ? 0 : v === true || v == null ? 3 : Math.max(0, Math.min(4, Math.round(Number(v)) || 0));
}

// ---------------------------------------------------------------------------------------------
// What it's told

const EDITS = `<<<<<<< FIND
lines copied exactly from the current page
=======
the new lines
>>>>>>> REPLACE
(exactly those three marker lines per edit; FIND must match the page exactly and only once - include a couple of lines of context)`;

function soloSystem() {
  return `${systemPrompt()}

# Make it excellent - and its own
You build it alone, and you keep working on it: your first reply is the heart of it, on screen in seconds; right after, you'll see it running and grow it into its full version, then look again and polish it, while the kid plays. The kid's changes come back to you too.
- Plan the fun, not just the look: one clear thing to do (catch, collect, race, build, make music), a cheerful reward every time they do it (a sound, sparkles, a counter that pops), and things that react to each other the way a kid expects. Give it everything a kid pictures when they ask for that kind of thing (a soccer game has a goalie to beat, a train has tracks and a station).
- The star of it - the thing they asked for - is big, near the middle of the action, easy to recognize at a glance, with a face and personality, and in proportion with its world.
- Everything is drawn in the look, so the whole scene looks like one picture: shapes drawn in that style, not big emoji.
- Controls a 5-year-old gets at once: the arrow keys move things the way they point on the screen (seen from above, never steering-wheel turns), a quick tap gets a clear answer right away, and a drag does what a finger would expect.
- Make it this kid's own creation, not a generic version: little surprises and details that come from exactly what they said, a place with character, a look that fits. Never a copy of the last thing.
- Something new, first reply: start writing straight away - SAY first, then TITLE, then the page - rather than thinking it all through first. Write the heart of it: the star, its place, the main thing to do with its reward, and the controls, all working and in the look - about 120 to 180 short lines, so it's there in seconds. You grow it right after.

# After it appears
You'll get a screenshot of it running and how it runs (frame rate, errors), and be asked to grow it or to look again. Reply then with WHY: <what you improved, in one short sentence for the grown-ups' log>, then only FIND/REPLACE edits, each as:
${EDITS}
If it's already as good as it can be, reply with just: OK`;
}

// The request, as the session needs it: the page only when it hasn't seen this one.
function requestPrompt({ page, known, history, text, alt, fix, look }) {
  const c = config();
  const parts = [];
  if (!page) parts.push('The screen is blank - nothing has been built yet.');
  else if (known) parts.push('The page is as you last saw it.');
  else parts.push(`<current_page>\n${page}\n</current_page>\n(This is the page as it is now.)`);
  if (!fix) parts.push(`${page ? 'If this turns into a fresh new page, try' : 'For this new creation, try'} this look, unless the kid asked for something else: ${look}.`);
  if (!known && history.length) {
    const lines = history.slice(-c.historyTurns * 2).map(h => `${h.role === 'kid' ? 'Kid' : c.buddyName}: ${h.text}`);
    parts.push(`<conversation_so_far>\n${lines.join('\n')}\n</conversation_so_far>`);
  }
  if (fix) parts.push(`The page just crashed with this problem:\n${fix}\nFix it without changing anything else. SAY: "Oops! Let me fix a wobbly bit." Keep DONE very short.`);
  else {
    parts.push(`The kid just said: "${text}"`);
    if (alt) parts.push(`(The other listener heard: "${alt}". Little kids are hard to hear - use both versions and the conversation to work out what they meant.)`);
  }
  return parts.join('\n\n');
}

function running(report, shot) {
  const r = report || {};
  return `<how_it_is_running>\nRunning at ${r.fps ?? '?'} frames per second${r.canvas ? ` on a ${r.canvas} canvas` : ''}.\nErrors while running: ${r.errors?.length ? r.errors.slice(-5).join(' | ') : 'none'}\n</how_it_is_running>\n\n${
    shot ? `A screenshot of it right now is in the file ${shot} - look at it first (with the Read tool).` : 'There is no screenshot, so judge from the page.'
  }`;
}

// ---------------------------------------------------------------------------------------------
// The session: one `claude -p` that takes turn after turn, keeping everything it saw and wrote.

const MAX_TURNS = 24; // then a fresh session, handed the page as it is (it keeps the context small)
const IDLE_MS = 20 * 60000;

class Session {
  constructor(projectId) {
    const r = config().solo || {};
    const c = config().claude;
    const args = ['-p', '--safe-mode', '--tools', 'Read', '--permission-prompts', 'none', '--strict-mcp-config', '--no-session-persistence', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--system-prompt', soloSystem()];
    const model = r.model || c.model;
    const effort = r.effort || c.effort;
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (Array.isArray(r.args)) args.push(...r.args.map(String));
    const bin = findBin('claude', c.bin);
    if (!bin) throw new Error('Claude Code CLI not found (install it and run `claude` once to sign in)');
    this.projectId = projectId;
    this.page = null; // the page it last saw or wrote
    this.turns = 0;
    this.current = null; // the turn being answered
    this.queue = [];
    this.err = '';
    this.child = spawn(bin, args, { cwd: WORK_DIR, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' && /\.cmd$/i.test(bin) });
    let buf = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', d => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0; ) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        this.handle(line);
      }
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', d => (this.err = (this.err + d).slice(-2000)));
    this.child.on('close', code => this.close(new Error(`claude solo ended${code ? ` (exit ${code}: ${this.err.trim().slice(-200)})` : ''}`)));
    this.child.on('error', err => this.close(err));
    this.child.stdin.on('error', () => {});
    this.touch();
  }

  get alive() {
    return !this.closed;
  }

  touch() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.end(), IDLE_MS);
  }

  end() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.idle);
    try {
      this.child.stdin.end();
      this.child.kill();
    } catch {}
    this.close(new Error('stopped'));
  }

  close(err) {
    this.closed = true;
    clearTimeout(this.idle);
    for (const t of [this.current, ...this.queue].filter(Boolean)) t.finish(err);
    this.current = null;
    this.queue = [];
  }

  handle(line) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    const t = this.current;
    if (!t) return;
    t.quietSince = Date.now();
    const se = ev.type === 'stream_event' && !ev.parent_tool_use_id ? ev.event : null;
    if (se?.type === 'content_block_start' && se.content_block?.type === 'text' && t.text && !t.text.endsWith('\n')) t.add('\n');
    if (se?.type === 'content_block_delta' && se.delta?.type === 'text_delta') t.add(se.delta.text);
    else if (se?.type === 'message_delta') t.stop = se.delta?.stop_reason || '';
    // The reply is over (not a pause for a tool): use it now - the result follows a moment later.
    else if (se?.type === 'message_stop' && (t.stop === 'end_turn' || t.stop === 'stop_sequence') && !t.interrupted) t.finish(null);
    else if (ev.type === 'result') {
      // An interrupted turn never counts, whatever it had written so far.
      t.finish(t.interrupted ? new Error('interrupted') : ev.is_error && !t.text ? new Error(ev.result || ev.subtype || 'claude solo error') : null, ev.result);
      this.current = null;
      this.next();
    }
  }

  // Ask it something; resolves with its reply. Turns are answered one after another.
  // kind: 'build' (what the kid asked for) or 'polish' (which a build interrupts).
  ask(prompt, { onText = () => {}, timeoutSec = config().timeoutSec, stallSec = 40, priority = false, kind = 'build' } = {}) {
    this.touch();
    return new Promise((resolve, reject) => {
      const t = {
        prompt,
        kind,
        timeoutSec,
        stallSec,
        text: '',
        stop: '',
        done: false,
        add: s => ((t.text += s), onText(s)),
        finish: (err, result) => {
          if (t.done) return;
          t.done = true;
          clearTimeout(t.timer);
          clearInterval(t.stall);
          if (err) reject(err);
          else resolve({ text: t.text || result || '' });
        },
      };
      if (this.closed) return reject(new Error('claude solo ended'));
      if (priority) this.queue.unshift(t);
      else this.queue.push(t);
      this.next();
    });
  }

  next() {
    if (this.current || !this.queue.length || this.closed) return;
    const t = (this.current = this.queue.shift());
    this.turns++;
    t.quietSince = Date.now();
    t.timer = setTimeout(() => this.fail(t, `took longer than ${t.timeoutSec}s`), t.timeoutSec * 1000);
    // Once it has started writing, a reply that goes quiet that long has stalled.
    t.stall = setInterval(() => t.text && Date.now() - t.quietSince > t.stallSec * 1000 && this.fail(t, 'stalled'), 2000);
    this.child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: t.prompt } })}\n`);
  }

  // A turn that's stuck: the session can't be trusted any more.
  fail(t, why) {
    t.finish(new Error(`claude solo ${why}`));
    this.end();
  }

  // Stop the turn being answered (it ends without an answer); the session goes on.
  interrupt() {
    if (!this.current || this.closed) return;
    this.current.interrupted = true;
    this.child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: `int-${Date.now()}`, request: { subtype: 'interrupt' } })}\n`);
  }
}

let session = null;

function sessionFor(projectId) {
  if (session?.alive && session.projectId === projectId && session.turns < MAX_TURNS) return session;
  session?.end();
  session = new Session(projectId);
  return session;
}

// The kid started talking: have the session's program started and waiting.
export function warm() {
  if (!enabled()) return { warm: 0 };
  const p = store.currentProject();
  if (session?.alive && session.projectId === p.id) return { warm: 0 };
  try {
    sessionFor(p.id);
    return { warm: 1 };
  } catch {
    return { warm: 0 };
  }
}

// ---------------------------------------------------------------------------------------------
// One build. Resolves like the classic way: { say, done, title, emoji, html, edited, backend }.
// Throws if it couldn't (the classic way takes over).

export async function build({ page, history, text, alt, fix, look = pickLook() }, emit, state) {
  const t0 = Date.now();
  const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const p = store.currentProject();
  const s = sessionFor(p.id);
  // What the kid says comes first: a look-and-improve pass still at work stops, and any waiting
  // to start are dropped (they'd look at a page that's about to change).
  if (s.current && s.current.kind === 'polish') s.interrupt();
  for (const t of s.queue.filter(t => t.kind === 'polish')) {
    s.queue.splice(s.queue.indexOf(t), 1);
    t.finish(new Error('stale'));
  }
  let chars = 0;
  let said = '';
  let got = '';
  const reply = await s.ask(requestPrompt({ page, known: Boolean(page) && s.page === page, history, text, alt, fix, look }), {
    priority: true,
    onText: chunk => {
      chars += chunk.length;
      got += chunk;
      emit({ type: 'progress', chars });
      if (!said && !fix) {
        const m = /^[ \t>*_]*SAY:[*_]*\s*(.+)\n/m.exec(got);
        if (m && !state.said) emit({ type: 'say', text: (said = state.said = m[1].replace(/[*_]+$/, '').trim()) });
      }
    },
  });
  const r = parseReply(reply.text);
  let html = r.html;
  let edited = false;
  if (!html && r.edits.length) {
    if (!page) throw new Error('edits on a blank page');
    html = await fitEdits(s, page, r.edits);
    edited = true;
  }
  if (!html && !field(reply.text, 'SAY')) throw new Error("couldn't read its reply");
  if (html) {
    html = await renameClashes(html);
    const problems = [...(await syntaxErrors(html)), ...blankProblems(html)];
    if (problems.length) {
      log(`solo: page doesn't run (${problems.join('; ').slice(0, 160)}), asking it to fix that`);
      const fixed = await s.ask(`Before it's shown: the page doesn't run - ${problems.join('\n')}\nFix just that, with FIND/REPLACE edits.`, { priority: true }).catch(() => null);
      const edits = fixed ? parseReply(fixed.text).edits : [];
      try {
        if (edits.length) html = applyEdits(html, edits);
      } catch {}
    }
    s.page = html;
  }
  log(`ok   claude solo ${secs()} ${edited ? `${r.edits.length} edits` : html ? 'a whole page' : 'only talked'}, ${html?.length ?? 0} chars, turn ${s.turns}`);
  return { say: said || r.say, done: r.done, title: r.title, emoji: r.emoji, html, edited, look, backend: 'claude solo' };
}

// Its edits, applied - the ones that don't fit go back to it once, to be copied exactly.
async function fitEdits(s, page, edits) {
  try {
    return applyEdits(page, edits);
  } catch (err) {
    log(`solo: an edit didn't fit (${err.message.slice(0, 80)}), asking again`);
    const again = await s.ask(`Your edits didn't fit: each FIND has to be copied exactly from the page, and match only once (${err.message}). Write the whole change again as FIND/REPLACE edits that fit the page as it was before them.`, { priority: true });
    return applyEdits(page, parseReply(again.text).edits);
  }
}

// ---------------------------------------------------------------------------------------------
// After it appears: it looks at a screenshot of its creation running and makes it better (the app
// asks: POST /api/check). Its edits become a new version that slides in at a calm moment.

function saveScreenshot(dataUrl) {
  const m = /^data:image\/(jpeg|png);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const file = path.join(WORK_DIR, `solo-${Date.now()}.${m[1] === 'png' ? 'png' : 'jpg'}`);
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
  return file;
}

// After something new appears: grow it into its full version (FIND/REPLACE edits, adding to it).
const GROW = `Now grow it into its full, excellent version, adding to what's there with FIND/REPLACE edits:
- First fix anything you can see isn't working or showing yet.
- Then add what it still lacks to be a delight: everything a kid pictures for this kind of thing, more of its place (near and far, made in loops), characters with faces and personality that react, a reward that feels great and a goal that grows, and one or two surprises that come from exactly what the kid said.
- Keep it smooth (no filters or shadowBlur, nothing made every frame) and everything in the look.`;

// Then (and after each change): look again, as the tester in team mode would.
const LOOK = `Look at it again as a demanding parent who is also a game designer. First write, under NOTES:, the most important things they'd mark down - at most 6, most important first - looking for:
- what the kid asked for, or the look, not fully there or not visible
- glitches you can see in the screenshot: cut off, overlapping, muddy, floating, facing the wrong way, hidden
- the star hard to recognize, too small, without personality, or out of proportion
- controls that do nothing, answer weakly, or confuse a small kid (left that doesn't go left, a quick tap that barely does anything, a drag that does nothing special)
- nothing to reach or beat, a goal that can't be reached, a thin reward, nothing new as they keep playing
- a thin or empty scene; bugs you can see in the code
Then fix as many of them as you can do well. If nothing important is left, reply with just: OK`;

export async function check({ projectId, version, report, screenshot, polish = false }) {
  if (!enabled() || !polishPasses()) return { skipped: 'off' };
  let p = store.currentProject();
  const v = p.versions.find(x => x.n === version);
  if (!version || p.id !== projectId || p.current !== version || !/^claude solo/.test(v?.backend || '')) return { skipped: 'stale' };
  // As many passes as asked for, after each creation or change.
  const since = p.versions.slice(p.versions.findLastIndex(x => x.backend === 'claude solo') + 1);
  if (since.some(x => x.backend !== 'claude solo polish') || since.length >= polishPasses()) return { skipped: 'polished enough' };
  const s = sessionFor(projectId); // (a new one, handed the page, if the old one is gone)
  const page = store.html(p);
  const shot = saveScreenshot(screenshot);
  const t0 = Date.now();
  const took = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  try {
    const grow = !since.length && v.backend === 'claude solo' && !v.continues;
    const prompt = [
      s.page === page ? 'Here it is, running - the kid has been playing with it.' : `<current_page>\n${page}\n</current_page>\nHere it is, running (this is the page as it is now).`,
      running(report, shot),
      grow ? GROW : LOOK,
      "Keep it the kid's creation: don't change what they chose, keep the controls and the KB.keep names.",
    ].join('\n\n');
    const reply = await s.ask(prompt, { timeoutSec: 420, kind: 'polish' });
    const edits = parseReply(reply.text).edits;
    const why = field(reply.text, 'WHY') || 'made it better';
    if (!edits.length) {
      log(`SOLO ok   ${took()} (pass ${since.length + 1})`);
      return { ok: true };
    }
    let html;
    try {
      html = applyEdits(page, edits);
    } catch (err) {
      log(`SOLO skip ${took()} ${why} (an edit didn't fit)`);
      return { skipped: "edits didn't fit" };
    }
    if ((await syntaxErrors(html)).length > (await syntaxErrors(page)).length) return { skipped: "the change didn't parse" };
    p = store.currentProject();
    if (p.id !== projectId || p.current !== version || isBusy()) {
      log(`SOLO stale ${took()} ${why}`);
      return { skipped: 'stale' };
    }
    p = store.addVersion(p, html, { request: `(solo polish) ${why}`, backend: 'claude solo polish', continues: true });
    s.page = html;
    log(`SOLO fix  ${took()} ${why} (${edits.length} edits, pass ${since.length + 1}) → v${p.current}`);
    return { fixed: true, verdict: 'fix', why, html: store.html(p), version: p.current };
  } catch (err) {
    log(`SOLO fail ${took()} ${err.message.replace(/\s+/g, ' ').slice(0, 160)}`);
    return { skipped: 'failed' };
  } finally {
    if (shot) fs.rmSync(shot, { force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Its new page crashed when the app tried it out of sight, before showing it: it repairs it (the
// same propose-then-accept as team mode's repair, so a repair is only taken if it runs).

const proposals = new Map();

export async function repair({ version, errors, keep, accept = false }) {
  let p = store.currentProject();
  const v = p.versions.find(x => x.n === version);
  if (!enabled() || p.current !== version || v?.backend !== 'claude solo') return { skipped: 'stale' };
  if (accept) {
    const html = proposals.get(`${p.id}:${version}`);
    if (!html || isBusy()) return { skipped: 'stale' };
    proposals.delete(`${p.id}:${version}`);
    const { n, at, ...meta } = v;
    p = store.addVersion(store.dropVersion(p, version), html, meta);
    if (session?.projectId === p.id) session.page = html;
    log(`SOLO repair taken → v${p.current}`);
    return { version: p.current };
  }
  if (!errors) return { skipped: 'no errors' };
  const page = store.html(p);
  const s = sessionFor(p.id);
  try {
    const reply = await s.ask(
      (s.page === page ? '' : `<current_page>\n${page}\n</current_page>\n\n`) +
        (keep
          ? `It crashes when it starts with the kid's saved progress (KB.keep hands it back these values):\n${JSON.stringify(keep).slice(0, 1500)}\nThe error:\n${String(errors).slice(0, 1500)}\nMake it carry on from those values instead, with FIND/REPLACE edits, changing nothing else.`
          : `When it was tried, it crashed:\n${String(errors).slice(0, 2000)}\nFix just that, with FIND/REPLACE edits.`),
      { priority: true, timeoutSec: 120 },
    );
    const html = applyEdits(page, parseReply(reply.text).edits);
    if (html === page || (await syntaxErrors(html)).length > (await syntaxErrors(page)).length) return { skipped: 'no fix' };
    proposals.set(`${p.id}:${version}`, html);
    while (proposals.size > 5) proposals.delete(proposals.keys().next().value);
    log(`SOLO repair ${String(errors).split('\n')[0].slice(0, 100)}`);
    return { html };
  } catch (err) {
    log(`SOLO repair fail ${err.message.replace(/\s+/g, ' ').slice(0, 160)}`);
    return { skipped: 'failed' };
  }
}
