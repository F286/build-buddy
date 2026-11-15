// Solo mode: one Claude builds the whole creation, and remembers it. No team and no helpers: a
// single `claude -p` session per creation, kept running between requests.
//
//   - Its first reply is the heart of it - the star, its place, the main thing to do - on screen in
//     seconds (the session is started while the kid is still talking).
//   - Then, while the kid plays, it looks at a screenshot of it running and grows it into its full
//     version, makes it beautiful (the star and the look), then looks again as a demanding parent
//     would and polishes it (solo.polish passes in all) - in the same session, so it knows what it
//     meant every piece to do.
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
import { config, fastIn, fastEver, runsFastMode } from './config.mjs';
import * as usage from './usage.mjs';
import { findBin, leadBrain, isQuitting } from './bins.mjs';
import * as store from './store.mjs';
import { systemPrompt, pickLook, parseReply, applyEdits, field, log, noteSpeed, isBusy, WORK_DIR } from './ai.mjs';
import { syntaxErrors, blankProblems, renameClashes } from './team.mjs';

// Solo mode needs Claude Code: it's on when switched on and Claude is the first brain.
export function enabled() {
  const c = config();
  return Boolean(c.solo?.enabled) && leadBrain() === 'claude';
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
- Plan how it works, not just the look: its 2 or 3 real rules, as a few shared numbers (water, heat, hunger) that one place updates every frame, pokes nudge and everything else reads; what each poke sets off; what keeps going on its own; one or two things to discover. No score or goal unless they ask for a game - then also one clear thing to do, a reward every time and a goal that grows, all running on those rules. Give it everything a kid pictures when they ask for that kind of thing (a soccer game has a goalie to beat, a train has tracks and a station).
- The star of it - the thing they asked for - is big, near the middle of the action, easy to recognize at a glance, with a face and personality, and in proportion with its world.
- Everything is drawn in the look, so the whole scene looks like one picture: shapes drawn in that style, not big emoji.
- Controls a 5-year-old gets at once: the arrow keys move things the way they point on the screen (seen from above, never steering-wheel turns), a quick tap gets a clear answer right away, and a drag does what a finger would expect. Every input answers, even where there's nothing to steer: each arrow key, a tap anywhere (empty sky too) and a drag each get something to see and hear (the star hops or looks that way, whatever they tapped answers in its own way, a trail where they drag).
- The look really shows - every part of its description, in the first screenshot. A look effect that's costly is drawn the cheap way, never left out: a glow is drawn once with shadowBlur onto a small offscreen canvas at the start and stamped with drawImage; 3D shadows come from one sun with a small shadow map; clouds and sky go where the camera sees them.
- Make it this kid's own creation, not a generic version: rules, things to find and details that come from exactly what they said, a place with character, a look that fits. Never a copy of the last thing.
- Something new, first reply: start writing straight away - SAY first, then TITLE, then the page - rather than thinking it all through first. Write the heart of it: the star, its place already going (a few kinds of things, made in loops), its real rules and what each poke sets off, up to its big moment (in a game, the goal and its reward), and the controls, all working and in the look - about 120 to 180 short lines, so it's there in seconds. More reactions and things to find come when you grow it, right after.

# After it appears
You'll get a screenshot of it running and how it runs (frame rate, errors), and be asked to grow it, to make it beautiful, or to look again. Reply then with WHY: <what you improved, in one short sentence for the grown-ups' log>, then only FIND/REPLACE edits, each as:
${EDITS}
If it's already as good as it can be, reply with just: OK`;
}

// The request, as the session needs it: the page only when it hasn't seen this one.
function requestPrompt({ page, known, note, history, text, alt, fix, look }) {
  const c = config();
  const parts = [];
  if (!page) parts.push('The screen is blank - nothing has been built yet.');
  else if (known) parts.push('The page is as you last saw it.');
  else parts.push(`<current_page>\n${page}\n</current_page>\n(This is the page as it is now.${note ? ` ${note}` : ''})`);
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
  // Slow: lighter frames, but never by taking away what the look asked for (that's what a kid -
  // and a parent - sees first; a slow computer is better served by lighter drawing).
  const slow = r.fps != null && r.fps < 30 ? '\nIf that feels slow, make each frame lighter (fewer separate meshes, lights or shadow-casters, nothing made every frame) - never by taking away what the look asked for, like its shadows, glow or smooth edges.' : '';
  return `<how_it_is_running>\nRunning at ${r.fps ?? '?'} frames per second${r.canvas ? ` on a ${r.canvas} canvas` : ''}.${slow}\nErrors while running: ${r.errors?.length ? r.errors.slice(-5).join(' | ') : 'none'}\n</how_it_is_running>\n\n${
    shot ? `A screenshot of it right now is in the file ${shot} - look at it first (with the Read tool).` : 'There is no screenshot, so judge from the page.'
  }`;
}

// ---------------------------------------------------------------------------------------------
// The session: one `claude -p` that takes turn after turn, keeping everything it saw and wrote.

const MAX_TURNS = 24; // then a fresh session, handed the page as it is (it keeps the context small)
const IDLE_MS = 20 * 60000;

// How the session's `claude` runs (a session started with other settings is replaced).
function sessionArgs() {
  const r = config().solo || {};
  const c = config().claude;
  const args = ['-p', '--safe-mode', '--tools', 'Read', '--permission-prompts', 'none', '--strict-mcp-config', '--no-session-persistence', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--system-prompt', soloSystem()];
  const model = r.model || c.model;
  const effort = r.effort || c.effort;
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  // (Started in fast mode if any phase is to be fast: each turn then runs at its own phase's speed.)
  if (fastEver(r.fast ?? c.fast)) args.push('--settings', JSON.stringify({ fastMode: true }));
  if (Array.isArray(r.args)) args.push(...r.args.map(String));
  return args;
}

// FIND/REPLACE edits in a reply, read on their own - the same way parseReply reads them.
function editsIn(text) {
  const re = /^<{5,9} ?FIND[^\n]*\n([\s\S]*?)\n?^={5,9}[ \t]*\n([\s\S]*?)\n?^>{5,9} ?REPLACE[^\n]*$/gm;
  const unmark = t => t.split('\n').filter(l => !/^(={5,9}|<{5,9} ?FIND.*|>{5,9} ?REPLACE.*)[ \t]*$/.test(l)).join('\n');
  return [...text.replace(/\r\n/g, '\n').matchAll(re)].map(m => ({ find: m[1], replace: unmark(m[2]) }));
}

// A reply as solo mode reads it: a page only if it really is one. Edits that happen to contain
// "<!doctype html" and "</html>" (or edits in an html fence) are edits, not a page of edit lines.
function readReply(text) {
  const r = parseReply(text);
  if (r.html && /^(<{5,9} ?FIND|>{5,9} ?REPLACE|={5,9}[ \t]*$)/m.test(r.html)) [r.html, r.edits] = [null, editsIn(text)];
  return r;
}

// Was this version made by solo mode - itself, or an overwatch fix on top of one of its versions?
// (Its checks and the rest of its passes stay with solo mode.)
export function madeBySolo(p, version) {
  let v = p.versions.find(x => x.n === version);
  for (let i = 0; v && /overwatch/.test(v.backend || '') && i < 50; i++) v = p.versions.find(x => x.n === v.from);
  return /^claude solo/.test(v?.backend || '');
}

// Which model answers: `first` writes something new while the kid waits (a quicker one), `main`
// everything else - the passes, the kid's changes, repairs. Without a main model set, it never
// switches.
function models() {
  const main = config().solo?.model || config().claude.model || '';
  return { main, first: main ? config().solo?.firstModel || main : '' };
}

// Fast mode for solo mode's one AI, phase by phase (config.mjs).
const soloFast = phase => fastIn(config().solo?.fast ?? config().claude.fast, phase);

// Which family a model belongs to, whatever it's called ("opus", "claude-opus-5-5").
const family = model => /opus|sonnet|haiku|fable/.exec(String(model || '').toLowerCase())?.[0] || '';

// (Team mode's agent way - agents.mjs - runs its lead in one of these too: its own command line,
// its own working folder and name.)
// fastFor(phase): is a turn of that phase answered in fast mode? Each turn belongs to a phase (what
// the kid is doing meanwhile: usage.mjs), and the session's speed is set to it before the turn is
// sent - one session, so it remembers everything, at a speed of its own for each phase.
// turnNote(phase): a line added to that phase's turns. helperModel(phase): the model its subagents
// are started with (the agent way's helpers), to tell what they used apart from its own.
export class Session {
  constructor(projectId, { args = sessionArgs(), cwd = WORK_DIR, label = 'solo', env = null, model = null, fastFor = soloFast, turnNote = null, helperModel = null } = {}) {
    if (isQuitting()) throw new Error('Build Buddy is quitting'); // (nothing new starts once it quits)
    const bin = findBin('claude', config().claude.bin);
    this.label = label;
    if (!bin) throw new Error('Claude Code CLI not found (install it and run `claude` once to sign in)');
    this.key = JSON.stringify(args);
    this.fastNow = args.includes('--settings'); // the speed its next answer would have
    this.fastFor = fastFor;
    this.turnNote = turnNote;
    this.helperModel = helperModel;
    this.spent = { cost: 0, models: {} }; // what Claude Code has reported for it so far, in all
    this.model = model ?? models().main; // the model answering now
    this.projectId = projectId;
    this.page = null; // the page as it knows it (null: it's handed the page on its next turn)
    this.unsure = false; // it wrote edits whose fate isn't settled: it's handed the page next time
    this.turns = 0;
    this.current = null; // the turn being answered
    this.queue = [];
    this.err = '';
    this.child = spawn(bin, args, { cwd, ...(env && { env: { ...process.env, ...env } }), stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' && /\.cmd$/i.test(bin) });
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
    this.child.on('close', code => this.close(new Error(`claude ${this.label} ended${code ? ` (exit ${code}: ${this.err.trim().slice(-200)})` : ''}`)));
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

  // End it at once and for good - it isn't doing what it's told. Kept once its program is gone:
  // from then on, nothing of its can still be writing files. (A few seconds at most.)
  kill() {
    this.gone ??= new Promise(resolve => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) return resolve();
      this.child.once('close', resolve);
      setTimeout(resolve, 3000);
    });
    try {
      this.child.kill('SIGKILL');
    } catch {}
    return this.gone;
  }

  close(err) {
    this.closed = true;
    clearTimeout(this.idle);
    this.unreported(this.current); // (a turn it was still answering: what it used so far)
    for (const t of [this.current, ...this.queue].filter(Boolean)) t.finish(err);
    this.current = null;
    this.queue = [];
    for (const done of this.controls?.values() || []) done(null);
    this.controls?.clear();
  }

  // A turn of the kid's is being answered or waiting.
  get kidWaiting() {
    return [this.current, ...this.queue].some(t => t && t.kind !== 'polish'); // (a repair counts: the kid waits for it)
  }

  handle(line) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    if (ev.type === 'control_response') {
      const id = ev.response?.request_id;
      this.controls?.get(id)?.(ev.response);
      this.controls?.delete(id);
      return;
    }
    if (ev.type === 'system' && ev.subtype === 'notification' && /fast/i.test(ev.key || '')) this.fastNote = ev.text || ev.key;
    const t = this.current;
    if (ev.type === 'result') {
      // (Only where fast mode could have run: on Sonnet or Haiku, normal speed says nothing about it.)
      if (t?.fast && runsFastMode(this.model)) noteSpeed(ev.usage?.speed || 'unknown', ev.usage?.speed === 'fast' ? '' : this.fastNote || '');
      this.used(ev, t);
    }
    if (!t) return;
    // (Its output arrives outside the work that asked for it: what it sets off - a helper started
    // on a job it just wrote - belongs to that work.)
    usage.within(t.what, () => this.answer(t, ev));
  }

  // What a turn used. Claude Code reports the session's running totals with each result, model by
  // model - its subagents' among them - so a turn's share is what was added since the last one.
  // The helpers' part is told by their model; when it's the lead's own (fast helpers write with
  // Opus), by how much of the turn's writing was theirs.
  used(ev, t) {
    const before = this.spent;
    const models = {};
    for (const [name, m] of Object.entries(ev.modelUsage || {})) models[name] = { ...usage.modelTokens(m), cost: m.costUSD || 0 };
    this.spent = { cost: ev.total_cost_usd ?? before.cost, models };
    if (!t) return;
    t.counted = true;
    const helpers = family(this.helperModel?.(t.phase));
    const shared = helpers && helpers === family(this.model || Object.keys(models)[0]);
    const share = shared && t.out.main + t.out.helpers > 0 ? t.out.helpers / (t.out.main + t.out.helpers) : 0;
    const sum = { main: { in: 0, out: 0, cr: 0, cw: 0, cost: 0 }, builders: { in: 0, out: 0, cr: 0, cw: 0, cost: 0 } };
    const names = { main: new Set(), builders: new Set() };
    for (const [name, m] of Object.entries(models)) {
      const was = before.models[name] || {};
      const part = helpers && !shared && family(name) === helpers ? 1 : shared && family(name) === helpers ? share : 0;
      let any = false;
      for (const k of ['in', 'out', 'cr', 'cw', 'cost']) {
        const d = Math.max(0, m[k] - (was[k] || 0));
        any ||= d > 0;
        sum.builders[k] += d * part;
        sum.main[k] += d * (1 - part);
      }
      if (any && part > 0) names.builders.add(name);
      if (any && part < 1) names.main.add(name);
    }
    const fast = ev.usage?.speed === 'fast';
    const row = (who, fastToo) => {
      const { cost, ...tokens } = sum[who];
      for (const k of Object.keys(tokens)) tokens[k] = Math.round(tokens[k]);
      usage.used({ who, role: this.label, model: [...names[who]].join(' + '), fast: fastToo, tokens, cost, ms: who === 'main' ? Date.now() - t.sentAt : 0, approx: Boolean(shared) }, t.what);
    };
    row('main', fast);
    // (Subagents take the lead's speed, where their model can run fast mode.)
    row('builders', fast && runsFastMode(helpers));
  }

  // A turn that ended with no result (it timed out, stalled, or the session was ended under it):
  // Claude Code never reported what it used, so the tokens seen go down without a price - like a
  // program of the team's that was stopped (team.mjs).
  unreported(t) {
    if (!t?.sentAt || t.counted) return;
    t.counted = true;
    const pending = who => Object.entries(t.out.last).reduce((sum, [parent, n]) => sum + (Boolean(parent) === (who === 'helpers') ? n : 0), 0);
    usage.used({ who: 'main', role: this.label, model: this.model || '', fast: t.fast, tokens: { ...t.read, out: t.out.main + pending('main') }, cost: null, ms: Date.now() - t.sentAt }, t.what);
    usage.used({ who: 'builders', role: this.label, model: this.helperModel?.(t.phase) || '', fast: t.fast && runsFastMode(this.helperModel?.(t.phase)), tokens: { out: t.out.helpers + pending('helpers') }, cost: null }, t.what);
  }

  answer(t, ev) {
    t.quietSince = Date.now();
    // How much of the turn's writing was the lead's and how much its helpers' (see used()), and
    // what its first message read.
    if (ev.type === 'stream_event' && ev.event?.type === 'message_start' && !ev.parent_tool_use_id) {
      const u = ev.event.message?.usage;
      t.read ??= { in: u?.input_tokens || 0, cr: u?.cache_read_input_tokens || 0, cw: u?.cache_creation_input_tokens || 0 };
    }
    if (ev.type === 'stream_event' && ev.event?.type === 'message_delta') t.out.last[ev.parent_tool_use_id || ''] = ev.event.usage?.output_tokens || 0;
    if (ev.type === 'stream_event' && ev.event?.type === 'message_stop') {
      t.out[ev.parent_tool_use_id ? 'helpers' : 'main'] += t.out.last[ev.parent_tool_use_id || ''] || 0;
      t.out.last[ev.parent_tool_use_id || ''] = 0;
    }
    t.onEvent?.(ev);
    const se = ev.type === 'stream_event' && !ev.parent_tool_use_id ? ev.event : null;
    if (se?.type === 'message_start') {
      // A message that started again without ending (its stream was retried): drop what it wrote.
      if (t.open) t.text = t.text.slice(0, t.from);
      [t.open, t.from] = [true, t.text.length];
    }
    if (se?.type === 'content_block_start' && se.content_block?.type === 'text' && t.text && !t.text.endsWith('\n')) t.add('\n');
    if (se?.type === 'content_block_delta' && se.delta?.type === 'text_delta') t.add(se.delta.text);
    else if (se?.type === 'message_delta') t.stop = se.delta?.stop_reason || '';
    else if (se?.type === 'message_stop') {
      t.open = false;
      // The reply is over (not a pause for a tool): use it now - the result follows a moment later.
      if ((t.stop === 'end_turn' || t.stop === 'stop_sequence') && !t.interrupted) t.finish(null);
    } else if (ev.type === 'result') {
      // An interrupted turn never counts, whatever it had written so far; nor does one that failed.
      t.finish(t.interrupted ? new Error('interrupted') : ev.is_error ? new Error(ev.result || ev.subtype || `claude ${this.label} error`) : null, ev.result);
      this.current = null;
      this.next();
    }
  }

  // Ask it something; resolves with its reply. Turns are answered one after another.
  // kind: 'build' (what the kid asked for) or 'polish' (which a build interrupts).
  // onSent(): the turn has gone to the program (from then on, it knows what the prompt told it).
  ask(prompt, { onText = () => {}, onEvent = null, onSent = null, timeoutSec = config().timeoutSec, stallSec = 40, priority = false, kind = 'build' } = {}) {
    this.touch();
    return new Promise((resolve, reject) => {
      const what = usage.now();
      // (Outside any request - it shouldn't happen - a pass counts as play, anything else as a change.)
      const phase = what.phase || (kind === 'polish' ? 'play' : usage.PHASE_UNKNOWN);
      const t = {
        prompt,
        kind,
        phase,
        what: { ...what, phase },
        out: { main: 0, helpers: 0, last: {} },
        onEvent,
        onSent,
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
      if (this.closed) return reject(new Error(`claude ${this.label} ended`));
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
    t.fast = Boolean(this.fastFor(t.phase));
    const note = typeof t.prompt === 'string' ? this.turnNote?.(t.phase) || '' : '';
    const send = () => {
      if (this.closed || this.current !== t) return;
      // (Stopped while its speed was being set: it was never sent, so no answer will end it.)
      if (t.interrupted) {
        t.finish(new Error('interrupted'));
        this.current = null;
        return this.next();
      }
      t.sentAt = Date.now();
      t.onSent?.();
      this.child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: note ? `${t.prompt}\n\n${note}` : t.prompt } })}\n`);
    };
    // Its phase's speed, when that isn't the speed the session is at (settled before the turn is sent).
    if (t.fast === this.fastNow) return send();
    this.speed(t.fast).then(send);
  }

  // Fast mode on or off, from its next turn on. Only a switch it confirmed counts: one it refused
  // or didn't answer leaves the session as it was - that turn runs at the speed it had (and the
  // log says so: at the wrong speed it costs more, or takes longer, than was asked for) - and the
  // switch is tried again before the next turn.
  async speed(fast) {
    const r = await this.control({ subtype: 'apply_flag_settings', settings: { fastMode: fast } });
    if (r?.subtype === 'success') this.fastNow = fast;
    else log(`claude ${this.label}: fast mode couldn't be switched ${fast ? 'on' : 'off'} (${String(r?.error || 'no answer').replace(/\s+/g, ' ').slice(0, 160)}): this turn runs ${this.fastNow ? 'fast' : 'at normal speed'}`);
  }

  // A turn that's stuck: the session can't be trusted any more.
  fail(t, why) {
    t.finish(new Error(`claude ${this.label} ${why}`));
    this.end();
  }

  // Change how it runs from its next turn on (like its thinking budget); resolves once it's done.
  control(request) {
    if (this.closed) return Promise.resolve(null);
    const id = `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.controls ??= new Map();
    return new Promise(resolve => {
      const timer = setTimeout(() => (this.controls.delete(id), resolve(null)), 5000);
      this.controls.set(id, r => (clearTimeout(timer), resolve(r)));
      this.child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: id, request })}\n`);
    });
  }

  // How long it thinks before it answers: briefly when the kid is waiting, long when it looks
  // its creation over (team mode's tester does that separately; here it's the same session).
  async think(tokens) {
    if (this.thinking === tokens) return;
    this.thinking = tokens;
    await this.control({ subtype: 'set_max_thinking_tokens', max_thinking_tokens: tokens });
  }

  // Which model answers from its next turn on (the session keeps everything it knew).
  async use(model) {
    if (!model || this.model === model) return;
    this.model = model;
    await this.control({ subtype: 'set_model', model });
  }

  // Stop the turn being answered (it ends without an answer); the session goes on.
  interrupt() {
    if (!this.current || this.closed) return;
    this.current.interrupted = true;
    this.child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: `int-${Date.now()}`, request: { subtype: 'interrupt' } })}\n`);
  }
}

let session = null;

// The session for a creation. A new one is started (and handed the page) for another creation, if
// the old one ended, or - when `renew` (the kid's request is next) - if it has had MAX_TURNS turns
// or was started with other settings. One answering the kid is never replaced.
function sessionFor(projectId, { renew = false } = {}) {
  const s = session;
  const usable = s?.alive && s.projectId === projectId;
  if (usable && (s.kidWaiting || !renew || (s.turns < MAX_TURNS && s.key === JSON.stringify(sessionArgs())))) return s;
  s?.end();
  session = new Session(projectId);
  return session;
}

// What's still to do for a creation: kept apart from the session, so a new session carries on.
//   grow: something new it wrote hasn't been grown into its full version yet
//   shine: ... or made beautiful yet (after it's grown)
//   passes / tries: passes done (and tried) since the kid's last request
//   lastPass: the version its last pass made, and which pass it was
//   note: something its next turn is told (why its last edits were taken back)
let work = { projectId: null };
// Is a pass at work on the creation? (The overwatch waits for it.)
export const busy = () => Boolean(work.checking);
function workFor(projectId) {
  if (work.projectId !== projectId) work = { projectId, grow: false, shine: false, passes: 0, tries: 0, lastPass: null, note: '' };
  return work;
}

// The kid started talking: have the session's program started and waiting.
export function warm() {
  if (!enabled()) return { warm: 0 };
  const p = store.currentProject();
  const before = session;
  try {
    return { warm: sessionFor(p.id, { renew: true }) === before ? 0 : 1 };
  } catch {
    return { warm: 0 };
  }
}

// Solo mode was switched off: its program isn't needed any more.
export function stop() {
  session?.end();
  session = null;
}

// What the kid says comes first: a pass still at work stops, and any waiting to start are dropped
// (they'd look at a page that's about to change).
function makeWay(s) {
  if (s.current?.kind === 'polish' || s.current?.kind === 'repair') s.interrupt();
  for (const t of s.queue.filter(t => t.kind === 'polish' || t.kind === 'repair')) {
    s.queue.splice(s.queue.indexOf(t), 1);
    t.finish(new Error('stale'));
  }
}

// ---------------------------------------------------------------------------------------------
// One build. Resolves like the classic way: { say, done, title, emoji, html, edited, backend }.
// Throws if it couldn't (the classic way takes over).

export async function build({ page, history, text, alt, fix, look = pickLook() }, emit, state) {
  const t0 = Date.now();
  const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const p = store.currentProject();
  const s = sessionFor(p.id, { renew: true });
  const w = workFor(p.id);
  makeWay(s);
  await s.use(page ? models().main : models().first);
  await s.think(thinkingFor('build'));
  makeWay(s); // (one that started meanwhile)
  let chars = 0;
  let said = '';
  let got = '';
  const known = Boolean(page) && s.page === page && !s.unsure;
  const note = w.note;
  [w.note, w.passes, w.tries] = ['', 0, 0];
  const reply = await s.ask(requestPrompt({ page, known, note, history, text, alt, fix, look }), {
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
  const r = readReply(reply.text);
  let html = r.html;
  let edited = false;
  if (!html && r.edits.length) {
    if (!page) throw new Error('edits on a blank page');
    const fitted = await fitEdits(s, page, r.edits);
    [html, edited] = [fitted.html, !fitted.whole];
  }
  // A page it started but didn't finish (its reply was cut off): the classic way takes over.
  if (!html && /```html/i.test(reply.text)) throw new Error('its page was cut off');
  if (!html && !field(reply.text, 'SAY')) throw new Error("couldn't read its reply");
  s.unsure = false;
  if (html) {
    html = await renameClashes(html);
    const problems = [...(await syntaxErrors(html)), ...blankProblems(html)];
    if (problems.length) {
      log(`solo: page doesn't run (${problems.join('; ').slice(0, 160)}), asking it to fix that`);
      const fixed = await s.ask(`Before it's shown: the page doesn't run - ${problems.join('\n')}\nFix just that, with FIND/REPLACE edits.`, { priority: true }).catch(() => null);
      const edits = fixed ? readReply(fixed.text).edits : [];
      try {
        html = applyEdits(html, edits);
      } catch {}
      // Whether or not its fix went in, it's handed the page next time.
      s.unsure = Boolean(fixed);
    }
    s.page = html;
    // Something new (a whole page): it's grown into its full version in the next pass, then
    // made beautiful.
    if (r.html && !fix) [w.grow, w.shine] = [true, false];
  }
  log(`ok   claude solo ${secs()} ${edited ? `${r.edits.length} edits` : html ? 'a whole page' : 'only talked'}, ${html?.length ?? 0} chars, turn ${s.turns}`);
  return { say: said || r.say, done: r.done, title: r.title, emoji: r.emoji, html, edited, look, backend: 'claude solo' };
}

// Its edits, applied - the ones that don't fit go back to it once, to be copied exactly.
async function fitEdits(s, page, edits) {
  try {
    return { html: applyEdits(page, edits) };
  } catch (err) {
    log(`solo: an edit didn't fit (${err.message.slice(0, 80)}), asking again`);
    s.unsure = true;
    const again = readReply((await s.ask(`Your edits didn't fit: each FIND has to be copied exactly from the page, and match only once (${err.message}). Write the whole change again as FIND/REPLACE edits that fit the page as it was before them.`, { priority: true })).text);
    if (again.html) return { html: again.html, whole: true };
    if (!again.edits.length) throw new Error("its edits didn't fit");
    return { html: applyEdits(page, again.edits) };
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
const GROW = `Now grow it into its full, excellent version - about twice as much as there is now - adding to what's there with FIND/REPLACE edits (big REPLACE blocks are fine: whole new functions and scenery, next to the code they belong with):
- First fix anything you can see isn't working or showing yet, and make every word of what the kid said, and of the look, unmistakably there - the center of it, not a detail.
- Then add what it still lacks to be a world that works and a delight: everything a kid pictures for it (a farm has animals to feed), more of its place near and far (made in loops) with things moving on their own, the star and everyone in it reacting to the kid and to what happens, a big happy moment for each thing the kid sets going, one more thing a poke sets off (the full pond spills over its edge), something new that what the kid does adds up to, and things to discover until it has one or two, each with a spark of joy, from exactly what the kid said. In a game, a reward every time and a goal that grows (after a few, something new appears).
- Give it one big idea of its own, built from exactly what the kid said - a rule, a place with a story, or a character with a name and a wish that makes it unlike any other version (they said a shy octopus: it blushes a new color whenever someone looks) - not a big new thing they didn't ask for. Not the standard template.
- Every arrow key, a tap anywhere and a drag each get an answer the kid sees, and a finger can do all the arrow keys do.
- Keep it smooth (nothing made every frame, a costly look drawn the cheap way) and everything in the look.`;

// Then make it beautiful: the star and the look, which judges mark down most once it plays well.
const SHINE = `Now make it look wonderful - a picture a kid would want to frame - with FIND/REPLACE edits:
1. The star: does it read at a glance as what they asked for, from where the camera sees it? Give it the parts a kid would draw (legs, wings, wheels, a tail...), a big friendly face whose expression changes (happy when it gets something, surprised when bumped), and squash and stretch when it moves. Other characters get faces and personality too.
2. The look: go through every word of its description and make each one show on screen - soft shadows soft, glow glowing, outlines thick, textures there - drawn the cheap way where it's costly, never left out.
3. The place: fill bare areas with things that belong there, near and far, so the whole screen is a full, layered picture.
4. Anything that looks wrong in the screenshot: cut off, overlapping, floating, upside down, the wrong size.
Then WHY: <what you improved, in one short sentence for the grown-ups' log>, and the edits. Keep everything working as it does.`;

// Then (and after each change): look again, as the tester in team mode would - testing it in its
// head, since things that look fine in the code are often what a demanding judge marks down.
const LOOK = `Test it the way a demanding parent who designs kids' simulations and games would, before they play it with their kid - in the code and in the screenshot:
1. Every control: follow each arrow key, a tap anywhere and a drag from its handler to what moves on screen. Does each one do something the kid sees right away, and does left go left? (A camera control that never listens to keys answers nothing.) Can a finger alone do all the arrow keys do, and is the main thing to poke easy to spot? Where one falls short, fix it.
2. Every cause and effect: trace what each poke on the main things, each collision and each timer sets off - would it really fire (both things exist, are in range, and have what the check needs) and show on screen, not hidden behind something? Left alone, does it keep going? Pushed hard, do the extremes settle back while what the kid grew or placed stays? Then play it in your head for a few minutes, tapping fast, then doing nothing: can anything get stuck (chasing what it can never reach), pile up (drops covering the screen, a burst and a sound for every pebble at once) or never stop (a motor humming while parked)? In a game, can the goal be reached, again and again?
3. In 3D, also: the camera shows the star's face, not its back; everything faces the way it moves (turn it with its direction of travel); gates, arches and finish lines stand across the path; sky, sun and clouds are where the camera can see them; nothing drives or flies through solid things.
4. Then score it 1 to 10 the way that parent would, on: what they asked for (all of it, in the look, in plain view from the first second), a world that works (true to the real thing unless the kid said otherwise, poking the main things sets off something, it keeps going, no score or goal they didn't ask for, in a game a goal that can be reached; one or two things to find by trying - more don't raise the score, a broken one lowers it), delight (charming and polished, a full scene, everyone in it reacting, big happy moments), easy for a 5-year-old (no reading, big targets, forgiving, the main poke easy to spot, a finger does all the arrow keys do), solid (no bugs, glitches, or anything stuck, piling up, hidden or cut off), and its own (from exactly what the kid said).
First write, under NOTES:, the scores and, for each below 9, what keeps it there - most important first. Then WHY: <what you fixed, in one short sentence for the grown-ups' log>, and the FIND/REPLACE edits that fix as much of it as you can do well. Only if everything is a 9 or 10, reply with just: OK`;

// How long it may think: little while the kid waits, a lot when it looks its creation over.
function thinkingFor(what) {
  const t = config().solo?.thinking || {};
  return what === 'build' ? (t.build ?? 2000) : (t.look ?? 12000);
}

export async function check({ projectId, version, report, screenshot }) {
  if (!enabled() || !polishPasses()) return { skipped: 'off' };
  let p = store.currentProject();
  const v = p.versions.find(x => x.n === version);
  if (!version || p.id !== projectId || p.current !== version || !madeBySolo(p, version) || isBusy()) return { skipped: 'stale' };
  // As many passes as asked for after each creation or change (a grow or beautifying pass that
  // was lost happens again - within a couple of extra tries). One pass at a time.
  const w = workFor(projectId);
  if ((w.passes >= polishPasses() && !w.grow) || w.tries >= polishPasses() + 2) return { skipped: 'polished enough' };
  if (w.checking) return { skipped: 'busy' };
  const s = sessionFor(projectId); // (a new one, handed the page, if the old one is gone)
  const page = store.html(p);
  const shot = saveScreenshot(screenshot);
  const t0 = Date.now();
  const took = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const stale = () => {
    const now = store.currentProject();
    return now.id !== projectId || now.current !== version || isBusy();
  };
  w.checking = true;
  try {
    // Growing it comes first - even after a change, if the kid's change interrupted it - then
    // making it beautiful, then looking again.
    const grow = w.grow;
    const shine = !grow && w.shine;
    const known = s.page === page && !s.unsure;
    const prompt = [
      known ? 'Here it is, running - the kid has been playing with it.' : `${historyNote(p)}<current_page>\n${page}\n</current_page>\nHere it is, running (this is the page as it is now.${w.note ? ` ${w.note}` : ''})`,
      running(report, shot),
      grow ? GROW : shine ? SHINE : LOOK,
      "Keep it the kid's creation: don't change what they chose, keep the controls and the KB.keep names.",
    ].join('\n\n');
    await s.use(models().main);
    await s.think(thinkingFor('look'));
    if (stale()) return { skipped: 'stale' };
    w.note = '';
    w.tries++;
    // Until its edits are in (or it said OK), it's handed the page next time.
    s.unsure = true;
    const reply = await s.ask(prompt, { timeoutSec: 420, kind: 'polish' });
    const r = readReply(reply.text);
    const why = field(reply.text, 'WHY') || 'made it better';
    const done = () => {
      w.passes++;
      if (grow) [w.grow, w.shine] = [false, true];
      if (shine) w.shine = false;
    };
    if (!r.html && !r.edits.length) {
      // Nothing to change - or a reply that can't be read, which doesn't count as a pass.
      if (!/^\s*\**OK\**\s*\.?\s*$/im.test(reply.text) && !/\bNOTES:/i.test(reply.text)) {
        log(`SOLO skip ${took()} (couldn't read its reply)`);
        return { skipped: 'unreadable' };
      }
      s.unsure = false;
      done();
      log(`SOLO ok   ${took()} (pass ${w.passes})`);
      return { ok: true };
    }
    let html = r.html;
    if (!html) {
      try {
        html = applyEdits(page, r.edits);
      } catch (err) {
        // Its own edits that don't fit: once more, copied exactly.
        try {
          const again = readReply((await s.ask(`Those edits didn't fit, so none of them are in: each FIND has to be copied exactly from the page and match only once (${err.message}). Write them all again so they fit.`, { timeoutSec: 180, kind: 'polish' })).text);
          if (!again.html && !again.edits.length) throw new Error('no edits');
          html = again.html || applyEdits(page, again.edits);
        } catch {
          log(`SOLO skip ${took()} ${why} (an edit didn't fit)`);
          return { skipped: "edits didn't fit" };
        }
      }
    }
    const before = (await syntaxErrors(page)).length;
    const unparsed = async h => {
      const errs = await syntaxErrors(h);
      return errs.length > before ? errs : null;
    };
    const errs = await unparsed(html);
    if (errs) {
      // With its edits in, a script doesn't parse: once, it fixes that on top of them.
      let fixed = null;
      try {
        if (stale()) throw new Error('stale');
        const again = readReply((await s.ask(`With those edits in, the page doesn't parse: ${errs.slice(0, 3).join(' | ')}\nReply with FIND/REPLACE edits on the page with your edits in that fix just that.`, { timeoutSec: 180, kind: 'polish' })).text);
        if (again.edits.length) fixed = applyEdits(html, again.edits);
      } catch {}
      if (!fixed || (await unparsed(fixed))) {
        log(`SOLO skip ${took()} ${why} (it didn't parse)`);
        return { skipped: "the change didn't parse" };
      }
      html = fixed;
    }
    // It re-reads what it just changed, as a tester would - a pass's own slips are the bugs it
    // misses most (a name used before it's made, a value that never resets) - and fixes them on top.
    let reviewMissed = false; // its own review's fixes that didn't go in: it's handed the page next time
    if (!stale()) {
      try {
        const again = readReply((await s.ask(`With your edits in, re-read the code you just changed, as a tester: did they break anything - a name used before it's defined, something that no longer answers or never resets, something now hidden, cut off or overlapping? If so, reply with FIND/REPLACE edits on the page with your edits in that fix it. Otherwise reply with just: OK`, { timeoutSec: 180, kind: 'polish' })).text);
        if (again.edits.length) {
          const fixed = applyEdits(html, again.edits);
          if (!(await unparsed(fixed))) html = fixed;
          else reviewMissed = true;
        } else if (again.html) reviewMissed = true;
      } catch {
        reviewMissed = true;
      }
    }
    if (stale()) {
      log(`SOLO stale ${took()} ${why}`);
      return { skipped: 'stale' };
    }
    p = store.addVersion(store.currentProject(), html, { request: `(solo polish) ${why}`, backend: 'claude solo polish', continues: true });
    [s.page, s.unsure] = [html, reviewMissed];
    w.lastPass = { version: p.current, grow, shine };
    done();
    log(`SOLO fix  ${took()} ${why} (${r.html ? 'a whole page' : `${r.edits.length} edits`}, pass ${w.passes}) → v${p.current}`);
    return { fixed: true, verdict: 'fix', why, html: store.html(p), version: p.current };
  } catch (err) {
    log(err.message === 'interrupted' ? `SOLO stop ${took()} (the kid asked for something)` : `SOLO fail ${took()} ${err.message.replace(/\s+/g, ' ').slice(0, 160)}`);
    return { skipped: err.message === 'interrupted' ? 'stale' : 'failed' };
  } finally {
    w.checking = false;
    if (shot) fs.rmSync(shot, { force: true });
  }
}

// For a session that's handed the page: what the kid asked for lately.
function historyNote(p) {
  const c = config();
  const lines = (p.history || []).slice(-c.historyTurns * 2).map(h => `${h.role === 'kid' ? 'Kid' : c.buddyName}: ${h.text}`);
  return lines.length ? `<conversation_so_far>\n${lines.join('\n')}\n</conversation_so_far>\n\n` : '';
}

// One of its passes crashed when the app tried it out of sight, so it was taken back (POST
// /api/drop-fix): it's handed the page next time and told why, and a grow or a beautifying that
// was lost happens again.
export function takenBack({ projectId, version, error }) {
  const w = workFor(projectId);
  if (w.lastPass?.version !== version) return;
  if (session?.projectId === projectId) session.page = null;
  w.note = `Your last edits were taken back: with them in, it crashed when it was tried (${String(error || '').slice(0, 200)}).`;
  if (w.lastPass.grow) [w.grow, w.shine] = [true, false];
  if (w.lastPass.shine) w.shine = true;
  w.passes = Math.max(0, w.passes - 1);
  w.lastPass = null;
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
    const { html, by } = proposals.get(`${p.id}:${version}`) || {};
    if (!html || isBusy()) return { skipped: 'stale' };
    proposals.delete(`${p.id}:${version}`);
    const { n, at, ...meta } = v;
    p = store.addVersion(store.dropVersion(p, version), html, meta);
    // (Only the session that wrote the repair knows it; a newer one is handed the page.)
    if (by === session && by?.alive) [by.page, by.unsure] = [html, false];
    log(`SOLO repair taken → v${p.current}`);
    return { version: p.current };
  }
  if (!errors) return { skipped: 'no errors' };
  const page = store.html(p);
  const s = sessionFor(p.id);
  const known = s.page === page && !s.unsure;
  // Until its repair is taken, it's handed the page next time.
  s.unsure = true;
  await s.use(models().main);
  try {
    const reply = await s.ask(
      (known ? '' : `<current_page>\n${page}\n</current_page>\n\n`) +
        (keep
          ? `It crashes when it starts with the kid's saved progress (KB.keep hands it back these values):\n${JSON.stringify(keep).slice(0, 1500)}\nThe error:\n${String(errors).slice(0, 1500)}\nMake it carry on from those values instead, with FIND/REPLACE edits, changing nothing else.`
          : `When it was tried, it crashed:\n${String(errors).slice(0, 2000)}\nFix just that, with FIND/REPLACE edits.`),
      // (The app waits about 30 s for it; what the kid asks for next goes first.)
      { priority: true, timeoutSec: 120, kind: 'repair' },
    );
    const html = applyEdits(page, readReply(reply.text).edits);
    if (html === page || (await syntaxErrors(html)).length > (await syntaxErrors(page)).length) return { skipped: 'no fix' };
    proposals.set(`${p.id}:${version}`, { html, by: s });
    while (proposals.size > 5) proposals.delete(proposals.keys().next().value);
    log(`SOLO repair ${String(errors).split('\n')[0].slice(0, 100)}`);
    return { html };
  } catch (err) {
    log(`SOLO repair fail ${err.message.replace(/\s+/g, ' ').slice(0, 160)}`);
    return { skipped: 'failed' };
  }
}
