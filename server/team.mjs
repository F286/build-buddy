// Team mode: Claude Code builds with a team instead of one AI writing the whole page.
//
//   voice   answers the kid out loud straight away (a small, quick model)
//   lead    plans the page: the code every piece shares, one job per helper, and the code that
//           puts the pieces together. A change that is one thing it makes itself, as edits;
//           several separate things at once it hands out, one change per helper
//   helpers each write one piece (or one change), all at the same time. Each starts the moment
//           the lead has written its job, while the lead is still writing the rest of the plan
//   fixer   repairs the page if the pieces don't parse, or if edits didn't fit
//   checker takes a careful look at the finished page right after it appears (does every piece
//           fit, do the controls work, can it be played, is it smooth) and quietly fixes what
//           would spoil it; the fix slides in at a calm moment, keeping the kid's progress
//
// Every one of them is the `claude` command-line tool, each with its own model, effort, fast
// mode, advisor and extra options (config.team). A page is mostly code, and code takes about as
// long to write as it is long: split across helpers, a big creation arrives in about the time
// it takes to write its biggest piece. Before anything is shown, every script on the page is
// checked; if one doesn't parse, the fixer gets one try to repair it (if it can't, the page is shown
// anyway and the app's usual crash fixing takes over).
//
// While the kid is still talking, the app warms the team up (POST /api/warm): the programs start
// and wait, so none of them has to start up once the request arrives.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawn, execFile } from 'node:child_process';
import { config } from './config.mjs';
import { findBin } from './bins.mjs';
import * as store from './store.mjs';
import { buddyIntro, talkingRules, buildingRules, userPrompt, pickLook, parseReply, applyEdits, field, log, noteSpeed, isBusy, WORK_DIR } from './ai.mjs';

// Team mode needs Claude Code: it's on when switched on and Claude is the first brain.
export function enabled() {
  const c = config();
  return Boolean(c.team?.enabled) && c.backends[0] === 'claude';
}

// A role's settings. The lead, helpers and fixer default to the Claude model, effort and speed
// chosen for the classic way (config.claude, also in the grown-ups' panel).
function roleConfig(name) {
  const c = config();
  const r = c.team?.[name] || {};
  const inherit = name !== 'voice';
  return {
    model: r.model || (inherit ? c.claude.model : '') || '',
    effort: r.effort || (inherit ? c.claude.effort : '') || '',
    fast: r.fast ?? (inherit ? Boolean(c.claude.fast) : false),
    advisor: r.advisor || '',
    args: Array.isArray(r.args) ? r.args.map(String) : [],
  };
}

const HEDGE_MS = 7000;

export const maxHelpers = () => Math.max(1, Math.min(8, Number(config().team?.helpers) || 6));

// ---------------------------------------------------------------------------------------------
// What each of them is told

const EDIT_FORMAT = `<<<<<<< FIND
lines copied exactly from the current page
=======
the new lines
>>>>>>> REPLACE
(exactly those three marker lines per edit - no extra ======= line)`;

// A role with an advisor (a stronger model it can ask for advice) is told when to ask.
function withAdvisor(name, text, when) {
  return roleConfig(name).advisor ? `${text}\n\nYou have an advisor (the advisor tool): ${when} Keep it quick - the kid is waiting.` : text;
}

function voiceSystem() {
  const c = config();
  return `You are ${c.buddyName}, a cheerful robot building buddy for a ${c.kidAge}-year-old${c.kidName ? ` named ${c.kidName}` : ''}. The kid talks to you out loud, and you build what they ask for on a big screen: a team of helpers does the building while you talk. Their words come through speech-to-text and are sometimes misheard ("a rice car" is probably "a race car") - guess the most likely meaning.

Reply with exactly one line:
SAY: <one short, warm sentence said out loud right away, showing what you understood, like "A red race car? Coming right up!">

Tiny sentences, simple words, excited. Never say code, HTML, JavaScript, CSS, file, browser, bug or error. Never suggest ideas or offer choices, not even as a question. If they asked you a question or you can't tell what they want, answer or ask them to tell you more, in that one sentence. Keep it friendly: for scary or gory ideas, say back a silly, cartoony version. Creations can't close or lock the app or limit play time: if they ask for that, kindly say only a grown-up can set play time.`;
}

function sketchSystem() {
  const c = config();
  return `You make a quick first look at what a ${c.kidAge}-year-old just asked for, so they see it on screen within seconds. A team is building the full version at the same time; yours is shown until theirs is ready, so make it quickly.

Reply with only one \`\`\`html code block: a complete page of at most about 30 short lines (about 1,500 characters) - small and quick beats detailed here.
- The thing they asked for, big (about a third of the screen) and in the middle, in the look you're given, already moving (a wiggle, a bounce, driving or flying around), with a face if it's a character or vehicle.
- A simple background that shows the place (sky and ground, water, space...).
- The arrow keys and a tap or drag make it move, jump or sparkle right away.
- No words on the page (they can't read). Canvas 2D, or Three.js for 3D (import * as THREE from 'three' in a module script). Keep it light: no shadowBlur, no CSS or SVG filters.
If they're asking to change what's on the screen rather than for something new, reply with just: SKIP`;
}

function sketchPrompt({ text, alt, look, title }) {
  return [
    title ? `On the screen now: ${title}` : 'The screen is blank.',
    `The kid just said: "${text}"${alt ? ` (the other listener heard: "${alt}")` : ''}`,
    `The look: ${look}.`,
  ].join('\n\n');
}

function voicePrompt({ history, text, alt, title }) {
  const c = config();
  const recent = history.slice(-4).map(h => `${h.role === 'kid' ? 'Kid' : c.buddyName}: ${h.text}`);
  return [
    title ? `On the screen now: ${title}` : 'The screen is blank.',
    recent.length ? `Lately:\n${recent.join('\n')}` : '',
    `The kid just said: "${text}"${alt ? ` (the other listener heard: "${alt}")` : ''}`,
  ].filter(Boolean).join('\n\n');
}

function leadSystem() {
  const n = maxHelpers();
  return withAdvisor('lead', `${buddyIntro()}

# Reply format (always exactly this)

TITLE: <one emoji> <2-4 word name>   (only when you start something new or it changes a lot)
DONE: <1-2 short sentences said when it appears: how to play with it. You may end with an open question like "What's next?" - never with a suggestion>
then the edits or the plan (below).

Someone else has already answered the kid out loud, so don't write SAY - unless there is nothing to build (you didn't understand, or they asked you something): then write only SAY: <what to say> and nothing else.

# You lead a building team
You have up to ${n} helpers who write code at the same time as each other, so the kid gets it much sooner. Hand out the work rather than writing it all yourself.

For a change to the current page that is one thing - a color or a speed, or even something bigger like a second player or levels - write the edits yourself, so it all fits together, each as:
${EDIT_FORMAT}

When the kid asks for several separate things at once (like "make it night and give the car headlights and add a moon"), hand them out - helpers write the edits, one thing each, at the same time:
CHANGES:
//@change <name>: <the job>
//@change <name>: <the job>
Each helper sees the current page and the kid's words, and starts the moment its line is written. Each job says, in under 40 words, exactly what to change in which part of the page (the names in the page help) and what it should become. Give every helper a different area of the page: never two jobs that change the same lines. Use 2-${n} changes, one per separate thing the kid asked for.

For anything new, or when most of the page has to change, write the plan - start writing it straight away rather than thinking it all through first (each helper starts the moment its line appears, and the details are theirs):
PLAN:
\`\`\`js
<the shared code>
\`\`\`
//@part <name>: <what it defines> - <the job>
//@part <name>: <what it defines> - <the job>
MAIN:
\`\`\`js
<the code that puts it together>
\`\`\`

- The page is one module script: your shared code, then each part's code, then MAIN. Its body starts empty: every element is made by the code before anything uses it.
- The shared code (at most about 15 short lines) has every import any part needs, the palette and sizes, the shared state, KB.keep, and anything all the parts use (for 3D: the renderer, scene, camera and lights; for a 2D canvas: the canvas and its context).
- Each helper starts the moment its line is written, seeing your shared code and the jobs before it - so write all the jobs before MAIN, biggest first.
- Each job starts with exactly what the part defines, written as code, for example: makeWorld(scene) → { update(dt), clickables }, or drawSky(ctx, t), or class Frog { constructor(scene); update(dt) }. Then, in under 25 words, how it should look, sound and feel. Your helpers are good builders who know the kid's words and the look - they fill in the details.
- Parts only define things: nothing runs until MAIN calls it. MAIN (about 20-40 lines) builds the page's elements and styles, creates everything by calling the parts exactly as their jobs say, runs the main loop (in 3D it calls renderer.render(scene, camera) every frame) and handles input.
- The pieces are written apart, so they only fit if everyone follows the same rules - put them in the shared code and the jobs:
  - Time is always in seconds: MAIN's loop passes every update dt (seconds since the last frame, at most 0.05) and t (seconds since the start). Say so in the signatures, like update(dt, t).
  - MAIN owns the input: it keeps a shared input object up to date (like input.left, input.right, input.up and input.down for the arrow keys, input.x, input.y and input.pressed for the pointer, and input.tapped for a tap this frame), and the parts read it. A part that reacts to taps on its own things says so in its job, with the exact function MAIN calls, like hitTest(x, y) → true if tapped.
  - Anything one piece makes and another uses - an element's id or data- attribute, an object's fields, a mesh's userData - is named exactly in both jobs (or in the shared code).
  - In 3D, MAIN owns the camera unless a job says otherwise.
- Plan the fun, not just the look: one clear thing to do (catch, collect, race, build, make music), a cheerful reward every time they do it (a sound, sparkles, a counter that pops), and things that react to each other the way a kid expects (cars bump, fish swim to the food, the dragon waves back). The star of it - the thing they asked for - is big, near the middle of the action, and the kid can see its face (in 3D, put its eyes where the camera sees them).
- The kid's main action must work end to end, with both the arrow keys and the pointer (tap, hold or drag): every control you promise in DONE is wired in MAIN to the part that moves, and the thing they asked for is in plain view when it starts.
- <name> is one lowercase word. The kid waits for the slowest helper, so split the work into ${Math.min(5, n)}-${n} small parts of about 25 short lines each (about 1,800 characters), similar in size: for example the sky and background, the ground or track, the player, the other characters, the effects, the sounds. Split anything big (a whole world, a whole scene, a detailed star) into two parts.
- When you plan over an existing page, the helpers also see the page as it was, so they can keep what the kid already built. Keep the same KB.keep names.

${talkingRules()}

${buildingRules()}`, 'ask it once, right before you write the plan, the changes or the edits.');
}

function helperSystem() {
  const c = config();
  return withAdvisor('helper', `You are a helper on a small team building a web page for a ${c.kidAge}-year-old: pictures, animated scenes, toys and little games, made from what the kid says out loud. The team lead has planned the page: shared code every piece uses, one job for each helper, and the main code that puts the pieces together. You write the code for one job, while the other helpers write theirs at the same time.

The page is one module script: the shared code, then each part's code, then the lead's main code, which uses your part exactly as your job's first words say.

Reply with only your code, in one \`\`\`js code block - no talk before or after it.
- Define exactly what your job's first words say (the same names and parameters, returning the same things): the main code depends on it. Use the shared code's names, and use another part only as its job says.
- What your job's first words define keeps exactly those names. Only the extra top-level names you add (helpers, constants, state) start with your part's name and an underscore, so they can't clash with other parts. At the top level only declare things: nothing runs until the main code calls your part. Whatever your piece needs before its first frame (its sizes, a background drawn once) happens in the function the main code calls first - not only when the window is resized.
- No <script> tags or imports (the shared code has every import). If you need page elements or styles, make them from JavaScript.
- The kid can't read yet: no words or instructions on the page - big emoji and pictures instead.
- About 25 short lines, about 1,800 characters (never more than 2,500): the kid is waiting for the slowest helper, and a small polished piece beats a big one. Don't over-plan - write it.
- Make your piece delightful and alive, and smooth: it must run without errors at 60 frames per second. Whatever the kid can touch or steer in your piece answers every time - a bounce, a sound, a burst - and reaching a goal in it is a big, happy moment: it stays there and celebrates for a few seconds before anything starts again.
- If your piece is the star (the thing the kid asked for), make it easy to recognize at a glance (a piano has its body and black keys, a dragon has wings) and big enough that its face and eyes are clear from where the camera looks - but in proportion with its world (a car fits on its road).
- If your piece is the place (the background, world or scenery), make it unmistakable and full: a jungle is thick with jungle, a castle has towers, flags and a moat - things near and far. Fill it the short way: a few kinds of things, each made in a loop many times over with varied sizes, colors and spots, not lots of separate code. Put what sets the look (clouds, the sun, hills) where the camera really sees it.
- The pieces only fit if you follow the team's rules: time is always in seconds - use dt and t exactly as passed to you (seconds since the last frame / since the start), and never divide them by 1000 again; read keys and the pointer from the shared input object (or the handler your job names) rather than adding your own listeners, unless your job says to; use exactly the names, ids, attributes and fields your job and the shared code give, and create everything your job says other pieces rely on.
- In 3D: flat shapes you build yourself (roads, ribbons, custom planes) use side: THREE.DoubleSide so they can't vanish when seen from the other side; nothing that should be seen sits inside, under or behind another shape (a moat is wider than the castle's base); don't move the camera unless your job says to.
- Your piece shares every frame with the other helpers' pieces, so keep it light: at most about 40 moving things or particles; no CSS or SVG filters (drop-shadow, feDropShadow, blur) or box-shadow on anything that moves, and no canvas shadowBlur - for a soft shadow, draw a darker, see-through copy of the shape a little below it instead; in 3D, no new lights or shadow-casting unless your job says so, make geometries and materials once and reuse them, and use InstancedMesh for many copies.

Some jobs are a change to the current page instead ("//@change <name>: <the job>"). Then reply with only FIND/REPLACE edits to the current page, each as:
${EDIT_FORMAT}
FIND must be copied exactly from the current page and match only once: include a couple of lines of context. Change only what your job needs - other helpers are changing other parts of the same page at the same time. Keep everything the kid already built, and the KB.keep names.

${buildingRules()}`, 'ask it once before you write your code, if your job is tricky.');
}

function helperPrompt({ page, text, alt, look, done, shared, jobs, job }) {
  if (job.kind === 'change') {
    return [
      `<current_page>\n${page}\n</current_page>`,
      `The kid said: "${text}"${alt ? ` (the other listener heard: "${alt}")` : ''}`,
      `<changes>\n${jobs.map(j => `//@change ${j.name}: ${j.job}`).join('\n')}\n</changes>`,
      `Write the edits for the ${job.name} change:\n//@change ${job.name}: ${job.job}`,
    ].join('\n\n');
  }
  return [
    page ? `<the_page_before_this_change>\n${page}\n</the_page_before_this_change>` : '',
    `The kid said: "${text}"${alt ? ` (the other listener heard: "${alt}")` : ''}`,
    look && !page ? `The look: ${look}.` : '',
    done ? `How they'll play with it: ${done}` : '',
    `<shared_code>\n${shared}\n</shared_code>`,
    `<jobs>\n${jobs.map(j => `//@part ${j.name}: ${j.job}`).join('\n')}\n</jobs>`,
    `Write the code for the ${job.name} part - about 25 short lines, never more than 2,500 characters (the kid is waiting for the slowest piece):\n//@part ${job.name}: ${job.job}`,
  ].filter(Boolean).join('\n\n');
}

function checkerSystem() {
  const c = config();
  return `You are the last check on a web page for a ${c.kidAge}-year-old who can't read. A team of AI helpers wrote it in pieces at the same time, and the kid has just started playing with it. Find and fix only real problems that would spoil it for them - quickly.

Check:
0. The wish: everything the kid just asked for is really there and easy to recognize, done the way they said (rainbow fish are themselves rainbow-colored; a second player has their own keys), and so is the look the page was given. In something new, the star of it is easy to recognize and big enough that the kid sees its face - but in proportion with its world (a car fits on its road). New levels or goals come soon - within about half a minute of play - and each is a little harder, with nothing jumping when it changes.
1. The pieces fit: every function, method, field, id or data- attribute that one piece uses really exists in another with that name, parameters and shape; time units match (dt and t in seconds - a second /1000 freezes things).
2. Controls: the main thing the kid asked for works with the arrow keys AND with the pointer (tap, hold or drag), as the kid was told. Every promised control is really wired to what moves. Never the space bar or Enter. Every arrow key and a tap anywhere gets some visible, audible answer - where one does nothing, add a small one (a wiggle, or sparkles and a pop where they tapped).
2b. The goal: reaching it (the finish, the moon, catching one) gets a clear celebration, and play carries on after it.
3. The start: the main character and the main action are on screen and clearly visible - not off-screen, clipped at an edge, behind something, too small, or out of the camera's view; things don't start on top of each other.
4. It can be played: goals can be reached (things can really be caught, collected, eaten or hit), speeds and counts stay sensible as play goes on, nothing jumps or teleports.
5. Smoothness: no CSS or SVG filters (drop-shadow, blur) or box-shadow on things that move, no canvas shadowBlur, no objects created every frame. If it runs below about 30 frames per second, find what makes each frame heavy and lighten it (fewer shadow-casting or moving things, drawing once instead of every frame).
6. It runs: no APIs that don't exist (Phaser 4 has no Phaser.Geom.Point), no lookups of elements that are never made, and none of the errors the page reported while running.
7. How it looks (if there's a screenshot, look at it first with the Read tool). If it's blank or nearly empty, find out why nothing is drawn (in 3D: is renderer.render(scene, camera) called every frame?). nothing important cut off or sliced at an edge, overlapping, hidden behind something or blocking the view; the star of it big enough and facing the kid; nothing too faint, too dark or lost in an empty screen.

The app itself provides KB.keep(...) (it carries the kid's progress to the next version - always keep it) and the 'three' and 'phaser' imports: they exist.

Don't restyle it and don't change what the kid chose; beyond fixing, only add the small answers and celebrations above. If nothing is really wrong, reply with just: OK
Otherwise reply with WHY: <what you fixed, in one short sentence for the grown-ups' log>, then only FIND/REPLACE edits that fix the real problems, each as:
${EDIT_FORMAT}
FIND must be copied exactly from the page and match only once: include a couple of lines of context.`;
}

// The finishing touches, once the checker is done: what would make it clearly better for the kid.
function polishSystem() {
  const c = config();
  return `You give a web page for a ${c.kidAge}-year-old who can't read its finishing touches. It already works: a team built it from what the kid asked for, and it has been checked. Look at it (the screenshot first, if there is one, with the Read tool) as a demanding parent who is also a game designer: what would make it clearly better for this kid?

Make the 2 or 3 changes that matter most, for example:
- What they asked for, or the look the page was given, isn't fully there or can't be seen (out of the camera's view, too faint, hidden) - watercolor that's just flat shapes, neon without a glow, paper cut-outs without soft shadows: make the look show, on the star first.
- The main thing to do plays itself, or needs no skill or choice from the kid (flies that get caught without the kid doing anything).
- The star of it isn't recognizable at a glance (a piano with no body or black keys, a dragon without wings), is too small to see its face, or is out of proportion with its world (a car wider than its road).
- A game has nothing to beat or reach: no goal, no challenge that grows, no 'you did it' moment.
- Something is cut off at an edge, overlapping, cluttered or muddy.
- An arrow key, a tap or a drag gets a weak answer or none; doing the main thing has no satisfying reward, or nothing new ever happens as they keep playing.
- A sound never stops, plays twice at once, or is harsh.
- A bug you can see in the code (something that can never be reached, caught or eaten; a count that's wrong; a thing that jumps).

Keep it the kid's creation: don't change what they chose, don't add big new things, don't restyle it, keep the controls and the KB.keep names (the app provides KB.keep and the 'three' and 'phaser' imports). Keep it smooth: no CSS or SVG filters, shadowBlur, or objects made every frame.

If it's already as good as it can be, reply with just: OK
Otherwise reply with WHY: <what you improved, in one short sentence for the grown-ups' log>, then only FIND/REPLACE edits, each as:
${EDIT_FORMAT}
FIND must be copied exactly from the page and match only once: include a couple of lines of context.`;
}

function fixerSystem() {
  return `You fix web pages made for a young kid (by a team of AI helpers). You get a page and what's wrong with it. Reply with only FIND/REPLACE edits that fix it, changing nothing else, each as:
${EDIT_FORMAT}
FIND must be copied exactly from the page and match only once: include a couple of lines of context.`;
}

// ---------------------------------------------------------------------------------------------
// Running Claude Code. Every call is a fresh, tool-less `claude -p` that reads its request as a
// stream-json message, so a program can be started early and wait (warm) until it's needed.

let warmPool = []; // { key, proc, timer }
const WARM_MS = 120000;

function claudeArgs(name, system, tools = '') {
  const r = roleConfig(name);
  const args = [
    '-p', '--safe-mode', '--tools', tools, '--strict-mcp-config', '--no-session-persistence',
    '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--system-prompt', system,
  ];
  if (tools) args.push('--permission-prompts', 'none'); // read-only tools only, never ask
  if (r.model) args.push('--model', r.model);
  if (r.effort) args.push('--effort', r.effort);
  if (r.advisor) args.push('--advisor', r.advisor);
  if (r.fast) args.push('--settings', JSON.stringify({ fastMode: true }));
  args.push(...r.args);
  return args;
}

function start(args) {
  const bin = findBin('claude', config().claude.bin);
  if (!bin) throw new Error('Claude Code CLI not found (install it and run `claude` once to sign in)');
  const child = spawn(bin, args, {
    cwd: WORK_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32' && /\.cmd$/i.test(bin),
  });
  // Output that arrives before anyone listens (while warm) is kept for them.
  const proc = { child, early: [], onData: null, onClose: null, closed: null, err: '' };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', d => (proc.onData ? proc.onData(d) : proc.early.push(d)));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', d => (proc.err = (proc.err + d).slice(-2000)));
  child.on('error', e => {
    proc.closed ??= { code: -1, error: e };
    proc.onClose?.();
  });
  child.on('close', code => {
    proc.closed ??= { code };
    proc.onClose?.();
  });
  child.stdin.on('error', () => {}); // it may exit before reading
  return proc;
}

function take(key) {
  const i = warmPool.findIndex(w => w.key === key && !w.proc.closed);
  if (i < 0) return null;
  const [w] = warmPool.splice(i, 1);
  clearTimeout(w.timer);
  return w.proc;
}

// Have `count` programs for this role started and waiting. Returns how many were started.
function keepWarm(name, system, count) {
  if (config().team?.warm === false) return 0;
  warmPool = warmPool.filter(w => !w.proc.closed);
  const args = claudeArgs(name, system);
  const key = JSON.stringify(args);
  let started = 0;
  for (let n = warmPool.filter(w => w.key === key).length; n < count; n++) {
    let proc;
    try {
      proc = start(args);
    } catch {
      break;
    }
    const w = { key, proc };
    w.timer = setTimeout(() => {
      warmPool = warmPool.filter(x => x !== w);
      proc.child.kill();
    }, WARM_MS);
    warmPool.push(w);
    started++;
  }
  return started;
}

// The kid started talking: start the voice and the lead now, so they're ready when the request
// arrives. (Helpers are started once it's clear the lead is planning - see build().)
export function warm() {
  if (!enabled()) return { warm: 0 };
  const leads = Math.max(1, Math.min(3, Number(config().team.leads) || 1));
  const sketch = config().team.firstLook === false ? 0 : keepWarm('sketch', sketchSystem(), 1);
  return { warm: keepWarm('voice', voiceSystem(), 1) + keepWarm('lead', leadSystem(), leads) + sketch };
}

// Ask one member of the team. onText(chunk) gets the reply as it's written. Resolves with the
// whole reply; the AbortSignal stops it.
function ask(name, { system, prompt, onText = () => {}, signal, timeoutSec, tally, tools = '' }) {
  const args = claudeArgs(name, system, tools);
  const r = roleConfig(name);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('stopped'));
    let proc;
    try {
      proc = take(JSON.stringify(args)) || start(args);
    } catch (err) {
      return reject(err);
    }
    let buf = '';
    let streamed = '';
    let result = null;
    let fastNote = '';
    let finished = false;
    let stopReason = '';
    let speed = '';
    let tokens = 0;
    let messageTokens = 0;
    const finish = err => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      if (err) {
        proc.child.kill('SIGKILL');
        return reject(err);
      }
      handle(buf);
      if (!result) return reject(new Error(`claude ${name} gave no answer${proc.closed?.code ? ` (exit ${proc.closed.code}: ${proc.err.trim().slice(-300)})` : ''}`));
      if (result.is_error) return reject(new Error(result.result || result.subtype || `claude ${name} error`));
      if (r.fast) noteSpeed(result.usage?.speed || 'unknown', result.usage?.speed === 'fast' ? '' : fastNote);
      if (tally) tally.tokens += result.usage?.output_tokens || 0;
      resolve({ text: streamed || result.result, usage: result.usage });
    };
    const handle = line => {
      if (!line.trim()) return;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      // A reply can come in several text blocks (e.g. around an advisor call): keep them apart.
      if (ev.type === 'stream_event' && ev.event?.type === 'content_block_start' && ev.event.content_block?.type === 'text' && !ev.parent_tool_use_id && streamed && !streamed.endsWith('\n')) {
        streamed += '\n';
        onText('\n');
      }
      const se = ev.type === 'stream_event' && !ev.parent_tool_use_id ? ev.event : null;
      const d = se?.type === 'content_block_delta' ? se.delta : null;
      if (d?.type === 'text_delta') {
        streamed += d.text;
        onText(d.text);
      } else if (se?.type === 'message_start') {
        speed = se.message?.usage?.speed || speed;
        messageTokens = 0;
      } else if (se?.type === 'message_delta') {
        stopReason = se.delta?.stop_reason || '';
        messageTokens = se.usage?.output_tokens || messageTokens;
      } else if (se?.type === 'message_stop') {
        tokens += messageTokens;
        // The reply is over (not a pause for a tool): use it now. The program may still spend a
        // second or two on its own wrap-up (and exiting) before it reports the result.
        if (stopReason === 'end_turn' || stopReason === 'stop_sequence') {
          result = { result: streamed, usage: { output_tokens: tokens, speed } };
          finish();
        }
      } else if (ev.type === 'system' && ev.subtype === 'notification' && /fast/i.test(ev.key || '')) {
        fastNote = ev.text || ev.key;
      } else if (ev.type === 'result') {
        result = ev;
        finish();
      }
    };
    const onData = chunk => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(handle);
    };
    const stop = () => finish(new Error('stopped'));
    const timer = setTimeout(() => finish(new Error(`claude ${name} took longer than ${timeoutSec || config().timeoutSec}s`)), (timeoutSec || config().timeoutSec) * 1000);
    signal?.addEventListener('abort', stop);
    proc.onData = onData;
    proc.early.splice(0).forEach(onData);
    proc.onClose = () => finish(proc.closed?.error);
    if (proc.closed) return finish(proc.closed.error);
    proc.child.stdin.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } })}\n`);
  });
}

// ---------------------------------------------------------------------------------------------
// The plan: read while it's being written, so each helper can start on its job straight away.

// Headers and job lines are matched loosely: models sometimes add markdown (#, **, -, 1., `).
const JOB_LINE = /^[ \t>*_`-]*(?:\d+[.)][ \t]*)?\/\/[ \t]*@(part|change)[ \t]+([\w-]+)[ \t]*:?[ \t]*(.*?)`?[ \t]*$/;
const HEAD = name => new RegExp(`^[ \\t>*_#]*${name}[*_]*:`, 'im');
const SHARED_BLOCK = /^[ \t>*_#]*PLAN[*_]*:[^\n]*\n+[ \t]*```[a-z]*[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*\n/im;
const CHANGES_HEAD = /^[ \t>*_#]*CHANGES[*_]*:[^\n]*\n/im;
const MAIN_BLOCK = /^[ \t>*_#]*MAIN[*_]*:[^\n]*\n+[ \t]*```[a-z]*[ \t]*\n([\s\S]*?)\n[ \t]*```/im;

// Reads the lead's reply as it's written: a PLAN (shared code, then //@part jobs, then MAIN) or
// CHANGES (//@change jobs). Each job is handed to onJob the moment its line is complete. When
// several leads race, onPlan() says whether this one's plan is the one used.
class PlanReader {
  constructor(onJob, onPlan = () => true) {
    this.onJob = onJob;
    this.onPlan = onPlan;
    this.lost = false;
    this.text = '';
    this.shared = null; // set once the plan's shared code is written
    this.changes = false; // set once the lead starts handing out changes
    this.jobs = [];
    this.scanned = 0;
    this.inMain = false;
  }

  push(chunk) {
    this.text += chunk.replace(/\r/g, '');
    if (this.shared == null && !this.changes) {
      const plan = SHARED_BLOCK.exec(this.text);
      const changes = CHANGES_HEAD.exec(this.text);
      if (plan && (!changes || plan.index < changes.index)) {
        // Jobs written inside the shared code block still count as jobs.
        const lines = plan[1].split('\n');
        this.shared = lines.filter(l => !JOB_LINE.test(l)).join('\n');
        this.lost = !this.onPlan();
        lines.forEach(l => this.line(l));
        this.scanned = plan.index + plan[0].length;
      } else if (changes && !HEAD('PLAN').test(this.text.slice(0, changes.index))) {
        this.changes = true;
        this.lost = !this.onPlan();
        this.scanned = changes.index + changes[0].length;
      } else return;
    }
    for (;;) {
      const nl = this.text.indexOf('\n', this.scanned);
      if (nl < 0) return;
      this.line(this.text.slice(this.scanned, nl));
      this.scanned = nl + 1;
    }
  }

  line(l) {
    if (this.lost) return;
    if (HEAD('MAIN').test(l)) this.inMain = true;
    const m = !this.inMain && JOB_LINE.exec(l);
    if (!m || m[1] !== (this.changes ? 'change' : 'part')) return;
    let name = m[2].toLowerCase();
    while (this.jobs.some(j => j.name === name)) name += '2';
    const job = { kind: m[1], name, job: m[3].trim() };
    this.jobs.push(job);
    this.onJob(job);
  }

  // After the lead has finished: the code that puts the plan together.
  main() {
    return MAIN_BLOCK.exec(this.text)?.[1] ?? null;
  }
}

function codeOf(reply, shared) {
  const code = (/```(?:js|javascript|mjs)?[^\n]*\n([\s\S]*?)\n[ \t]*```/i.exec(reply)?.[1] ?? reply).trim();
  // Imports belong to the shared code: drop ones it already has.
  return code
    .split('\n')
    .filter(l => !(/^\s*import\s.*from\s*['"][^'"]+['"];?\s*$/.test(l) && shared.includes(l.trim())))
    .join('\n');
}

export function assemble(shared, parts, main) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}</style>
</head>
<body>
<script type="module">
${shared.trim()}

${parts.map(p => `// ---- ${p.name}\n${p.code}`).join('\n\n')}

// ---- main
${main.trim()}
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------------------------
// Checks and repairs

// Every inline JavaScript on the page should parse. Returns the problems, with page line numbers.
// Modules are checked with \`node --check\`; classic scripts in-process, as the browser reads them.
export async function syntaxErrors(html) {
  const errs = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  let i = 0;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const type = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1]?.toLowerCase() || '';
    if (/\bsrc\s*=/i.test(attrs) || !(type === '' || type === 'module' || /^(text|application)\/(x-)?(java|ecma)script$/.test(type))) continue;
    const firstLine = html.slice(0, m.index).split('\n').length + (m[0].slice(0, m[0].indexOf('>') + 1).split('\n').length - 1);
    if (type !== 'module') {
      try {
        new vm.Script(m[2], { filename: 'page' });
      } catch (err) {
        const at = Number(/page:(\d+)/.exec(err.stack || '')?.[1]);
        errs.push(`${err.name}: ${err.message}${at ? ` (page line ${firstLine + at - 1})` : ''}`);
      }
      continue;
    }
    const file = path.join(WORK_DIR, `check-${process.pid}-${Date.now()}-${i++}.mjs`);
    fs.writeFileSync(file, m[2]);
    const out = await new Promise(resolve => execFile(process.execPath, ['--check', file], { timeout: 10000 }, (err, _o, stderr) => resolve(err ? String(stderr || err.message) : null)));
    fs.rmSync(file, { force: true });
    if (!out) continue;
    const lines = out.split('\n').filter(Boolean);
    const at = Number(/:(\d+)\s*$/.exec(lines[0] || '')?.[1]);
    const what = lines.find(l => /Error/.test(l)) || 'SyntaxError';
    errs.push(`${what.trim()}${at ? ` (page line ${firstLine + at - 1}: ${(lines[1] || '').trim().slice(0, 120)})` : ''}`);
  }
  return errs;
}

// Problems that certainly spoil the page but don't show until it runs: a 3D page that never draws,
// or an element looked up by its id that nothing makes (the team's page starts with an empty body).
export function blankProblems(html) {
  const code = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n');
  const problems = [];
  if (/from\s*['"]three['"]/.test(code) && !/\.render\s*\(/.test(code)) problems.push('It never draws: nothing calls renderer.render(scene, camera), so the screen stays blank. Call it at the end of every frame of the main loop.');
  const lookups = {};
  for (const m of html.matchAll(/getElementById\(\s*(['"`])([\w-]+)\1\s*\)|querySelector\(\s*(['"`])#([\w-]+)\3\s*\)/g)) lookups[m[2] || m[4]] = (lookups[m[2] || m[4]] || 0) + 1;
  // Made anywhere means the id shows up somewhere besides the lookups (id="x", el.id = 'x', #x in CSS...).
  const missing = Object.keys(lookups).filter(id => (html.match(new RegExp(`['"\`#=]${id}(?![\\w-])`, 'g')) || []).length <= lookups[id]);
  if (missing.length) problems.push(`It looks up ${missing.map(id => `#${id}`).join(', ')} by id, but nothing makes ${missing.length > 1 ? 'those elements' : 'that element'} - the page starts with an empty body. Create ${missing.length > 1 ? 'them' : 'it'} (and add ${missing.length > 1 ? 'them' : 'it'} to the page) before ${missing.length > 1 ? 'they are' : 'it is'} first used.`);
  return problems;
}

// Names the plan's pieces are made from (makeWorld, drawSky, new Frog...) that are called but never
// defined: the pieces were written apart, and one may have named its function differently. Where a
// piece wrote it under its own prefix (keys_makePiano for makePiano), the name is simply added;
// what's left is for the fixer.
const PIECE_NAME = /^(?:(?:make|draw|create|build|init|setup|spawn|add|update|play|start|show)[A-Z]\w*|[A-Z][a-z]\w*)$/;
const BROWSER = new Set(['addEventListener', 'Image', 'Audio', 'Path2D', 'OffscreenCanvas', 'KeyboardEvent', 'PointerEvent', 'MouseEvent', 'TouchEvent', 'CustomEvent', 'Event', 'AudioContext', 'OfflineAudioContext', 'OscillatorNode', 'GainNode', 'AudioBuffer', 'DOMMatrix', 'DOMPoint', 'DOMRect', 'ResizeObserver', 'IntersectionObserver', 'MutationObserver', 'Option', 'FontFace', 'ImageData', 'ImageBitmap', 'Worker', 'Range', 'Text', 'Comment', 'Node', 'Element', 'HTMLElement', 'Headers', 'Request', 'Response', 'FormData', 'XMLSerializer', 'DOMParser', 'Notification', 'Animation', 'KeyframeEffect', 'SpeechSynthesisUtterance', 'VideoFrame']);
export function repairNames(html) {
  const code = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1])
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const called = new Set([...code.matchAll(/(?<![\w$.])(?:new\s+)?([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]).filter(n => PIECE_NAME.test(n) && !BROWSER.has(n) && !(n in globalThis) && !code.includes(`typeof ${n}`)));
  const defined = n => new RegExp(`(?:function\\s*\\*?\\s*${n}\\b|class\\s+${n}\\b|(?:const|let|var)\\s+${n}\\b|(?<![\\w$.])${n}\\s*=(?!=)|[{,]\\s*${n}\\s*[,}=:]|[(,]\\s*${n}\\s*[,)=]|(?<![\\w$.])${n}\\s*\\([^()]*\\)\\s*\\{)`).test(code);
  const missing = [...called].filter(n => !defined(n));
  const aliases = [];
  const left = [];
  for (const n of missing) {
    const other = new RegExp(`(?:function\\s*\\*?\\s*|class\\s+|(?:const|let|var)\\s+)([A-Za-z]\\w*_${n})\\b`).exec(code)?.[1];
    if (other) aliases.push(`const ${n} = ${other};`);
    else left.push(n);
  }
  if (aliases.length && html.includes('\n// ---- main\n')) html = html.replace('\n// ---- main\n', `\n${aliases.join('\n')}\n\n// ---- main\n`);
  else left.push(...aliases.map(a => a.split(' ')[1]));
  return { html, problems: left.length ? [`It calls ${left.join(', ')} but nothing on the page defines ${left.length > 1 ? 'them' : 'it'}: one piece named it differently (find it and use one name) or it's missing.`] : [] };
}

// Apply the edits that fit; return the ones that don't.
function applySome(page, edits) {
  let html = page;
  const failed = [];
  for (const e of edits) {
    try {
      html = applyEdits(html, [e]);
    } catch {
      failed.push(e);
    }
  }
  return { html, failed };
}

const showEdits = edits => edits.map(e => `<<<<<<< FIND\n${e.find}\n=======\n${e.replace}\n>>>>>>> REPLACE`).join('\n\n');

// Apply edits; the ones that don't fit go to the fixer once, to be copied exactly from the page.
// Returns the page and the edits that still don't fit.
async function applyEditsWithFixer(page, edits, signal, tally) {
  const first = applySome(page, edits);
  if (!first.failed.length) return first;
  log(`team: ${first.failed.length} of ${edits.length} edits didn't fit, asking the fixer`);
  const reply = await ask('fixer', {
    system: fixerSystem(),
    prompt: `<page>\n${first.html}\n</page>\n\nThese edits didn't fit, because each FIND has to be copied exactly from the page. Write them again so they fit (copy FIND exactly from the page above):\n\n${showEdits(first.failed)}`,
    signal,
    tally,
  });
  const again = parseReply(reply.text).edits;
  const second = applySome(first.html, again);
  return { html: second.html, failed: again.length ? second.failed : first.failed };
}

async function fix(html, problem, signal, tally) {
  const reply = await ask('fixer', { system: fixerSystem(), prompt: `<page>\n${html}\n</page>\n\n${problem}`, signal, tally });
  const r = parseReply(reply.text);
  if (r.html) return r.html;
  return applySome(html, r.edits).html;
}

// ---------------------------------------------------------------------------------------------
// One build by the team. Resolves like the classic way does: { say, done, title, emoji, html,
// edited, backend }. Throws if the team couldn't do it (the classic way takes over).

export async function build({ page, history, text, alt, fix: crash, title = '', look = pickLook() }, emit, state) {
  const t0 = Date.now();
  const secs = (t = Date.now()) => `${((t - t0) / 1000).toFixed(1)}s`;
  const stats = { parts: [] };
  const spent = { tokens: 0 }; // output tokens written by the whole team, for the log
  const stopAll = new AbortController();
  const signal = stopAll.signal;
  let chars = 0;
  let helpersDone = 0;
  const jobs = [];
  const progress = (n = 0) => {
    chars += n;
    emit({ type: 'progress', chars, helpers: jobs.length, helpersDone });
  };

  // The voice answers out loud while the lead plans (but never after the build is over).
  let voiceSay = '';
  let over = false;
  const sayNow = text => {
    if (over || state.said) return;
    voiceSay = state.said = text;
    emit({ type: 'say', text });
  };
  const voice = crash
    ? Promise.resolve()
    : ask('voice', {
        system: voiceSystem(),
        prompt: voicePrompt({ history, text, alt, title }),
        timeoutSec: 60,
        signal,
        tally: spent,
        onText: (() => {
          let said = '';
          return chunk => {
            said += chunk;
            const m = said.match(/^[ \t>*_]*SAY:[*_]*\s*(.+)\n/m);
            if (m) sayNow(m[1].replace(/[*_]+$/, '').trim());
          };
        })(),
      }).then(
        r => {
          const text = field(r.text, 'SAY');
          if (text) sayNow(text);
        },
        err => log(`team voice failed: ${err.message.replace(/\s+/g, ' ').slice(0, 200)}`),
      );

  // Helpers start as their jobs are written.
  const prompt = userPrompt({ page, history, text, alt, fix: crash, look });
  const running = new Map();
  // At most `helpers` at work at once: any further jobs wait for one to finish.
  let free = maxHelpers();
  const waiting = [];
  const withHelper = async work => {
    if (free > 0) free--;
    else await new Promise(resolve => waiting.push(resolve));
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else free++;
    }
  };
  const startJob = (job, reader) => {
    jobs.push(job);
    const seen = jobs.slice();
    let startedAt = Date.now();
    const write = () =>
      withHelper(() => {
        startedAt = Date.now();
        const prompt = helperPrompt({ page, text: text || '(fixing a crash)', alt, look, done: field(reader.text, 'DONE'), shared: reader.shared, jobs: seen, job });
        // A helper that hasn't written a word after a few seconds is thinking hard, and the
        // slowest piece holds up the whole page: a second helper starts on the same job, and
        // whichever finishes first is used.
        const stops = [new AbortController(), new AbortController()];
        let wrote = false;
        const one = i =>
          ask('helper', {
            system: helperSystem(),
            prompt,
            onText: chunk => {
              if (i === 0) wrote = true;
              progress(chunk.length);
            },
            signal: AbortSignal.any([signal, stops[i].signal]),
            tally: spent,
          }).then(reply => ({ reply, i }));
        const first = one(0);
        const second = new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            if (wrote || signal.aborted) return reject(new Error('not needed'));
            log(`team: helper ${job.name} hasn't started writing after ${HEDGE_MS / 1000}s, starting a second one`);
            one(1).then(resolve, reject);
          }, HEDGE_MS);
          first.then(() => (clearTimeout(timer), reject(new Error('not needed'))), () => {});
        });
        return Promise.any([first, second]).then(
          ({ reply, i }) => {
            stops[1 - i].abort();
            return reply;
          },
          err => {
            throw err.errors?.find(e => e.message !== 'not needed') || err.errors?.[0] || err;
          },
        );
      });
    // One more try if a helper fails.
    const part = write()
      .catch(err => {
        if (signal.aborted) throw err;
        log(`team helper ${job.name} failed (${err.message.replace(/\s+/g, ' ').slice(0, 120)}), trying again`);
        return write();
      })
      .then(reply => {
        helpersDone++;
        progress();
        return { ...job, reply: reply.text, code: job.kind === 'part' ? codeOf(reply.text, reader.shared) : '', startedAt, doneAt: Date.now() };
      });
    part.catch(() => {}); // if the build stops early, nobody waits for it
    running.set(job.name, part);
    progress();
  };

  // Helpers start up while the lead writes the shared code: straight away for something new,
  // or as soon as the lead starts a plan for a change.
  let helpersWarm = false;
  const warmHelpers = () => {
    if (helpersWarm) return;
    helpersWarm = true;
    keepWarm('helper', helperSystem(), maxHelpers());
  };
  if (!page && !crash) warmHelpers();

  // The lead - or several leads racing (team.leads): how long a lead thinks before it writes varies
  // a lot, so the first to start a plan (or to finish, for edits) is used and the others stop.
  const leads = Math.max(1, Math.min(3, Number(config().team.leads) || 1));
  const runs = [];
  let winner = null;
  const claim = i => {
    if (winner == null) {
      winner = i;
      runs.forEach((run, j) => j !== i && run.stop.abort());
    }
    return winner === i;
  };
  for (let i = 0; i < leads; i++) {
    const stop = new AbortController();
    const reader = new PlanReader(
      job => startJob(job, reader),
      () => claim(i),
    );
    const run = { stop, reader };
    run.done = ask('lead', {
      system: leadSystem(),
      prompt,
      signal: AbortSignal.any([signal, stop.signal]),
      tally: spent,
      onText: chunk => {
        if (winner != null && winner !== i) return;
        reader.push(chunk);
        showSketch();
        if (!helpersWarm && (HEAD('PLAN').test(reader.text) || HEAD('CHANGES').test(reader.text))) warmHelpers();
        progress(chunk.length);
      },
    }).then(reply => {
      if (!claim(i)) throw new Error('another lead was quicker');
      return reply;
    });
    run.done.catch(() => {});
    runs.push(run);
  }

  // A first look (team.firstLook): a quick sketch of something new, shown while the team builds
  // the real thing - but only once a lead is writing a plan, never for changes to the page.
  const stopSketch = new AbortController();
  let sketch = null;
  let sketchShown = false;
  function showSketch() {
    if (sketchShown || !sketch || over || !runs.some(run => HEAD('PLAN').test(run.reader.text) && !run.reader.changes)) return;
    sketchShown = true;
    stats.sketchMs = Date.now() - t0;
    emit({ type: 'sketch', html: sketch });
  }
  if (!crash && config().team.firstLook !== false) {
    ask('sketch', { system: sketchSystem(), prompt: sketchPrompt({ text, alt, look, title }), signal: AbortSignal.any([signal, stopSketch.signal]), timeoutSec: 60, tally: spent }).then(
      async reply => {
        const html = /^\s*SKIP\b/.test(reply.text) ? null : parseReply(reply.text).html;
        if (!html || over) return;
        const problems = [...(await syntaxErrors(html)), ...blankProblems(html)];
        if (problems.length) return log(`team: first look not shown (${problems[0].slice(0, 120)})`);
        sketch = html;
        showSketch();
      },
      err => stopSketch.signal.aborted || signal.aborted || log(`team first look failed: ${err.message.replace(/\s+/g, ' ').slice(0, 160)}`),
    );
  }

  try {
    let lead;
    try {
      lead = await Promise.any(runs.map(run => run.done));
    } catch (err) {
      throw err.errors?.find(e => !/^(stopped|another lead was quicker)$/.test(e.message)) || err.errors?.[0] || err;
    }
    const reader = runs[winner].reader;
    reader.push('\n');
    const leadAt = Date.now();
    stats.leadMs = leadAt - t0;
    stats.lead = winner;
    const r = parseReply(lead.text);
    let html = null;
    let edited = false;
    let how = `the lead only talked, ${secs(leadAt)}`;

    // Edits (the lead's own, or its helpers' changes) that still don't fit after the fixer: the
    // classic way takes over - one AI that sees the whole page keeps everything already on it
    // (a fresh plan would rebuild it, and things the kid made could go missing).
    const misfit = failed => new Error(`edits didn't fit: ${failed[0].find.trim().split('\n')[0].slice(0, 60)}`);
    const timing = jobs => {
      stats.parts = jobs.map(p => ({ name: p.name, ms: p.doneAt - p.startedAt, startedMs: p.startedAt - t0, chars: (p.code || p.reply).length }));
      const slowest = jobs.reduce((a, p) => (p.doneAt > (a?.doneAt || 0) ? p : a), null);
      return slowest ? ` (slowest: ${slowest.name}, ${secs(slowest.startedAt)}→${secs(slowest.doneAt)})` : '';
    };

    if (reader.shared != null) {
      const main = reader.main();
      if (main == null) throw new Error('the plan has no MAIN');
      if (!reader.jobs.length) throw new Error('the plan has no parts');
      const parts = await Promise.all(reader.jobs.map(j => running.get(j.name)));
      html = assemble(reader.shared, parts, main);
      how = `lead ${secs(leadAt)}, ${parts.length} helpers${timing(parts)}`;
    } else if (reader.changes && reader.jobs.length) {
      if (!page) throw new Error('changes on a blank page');
      const changes = await Promise.all(reader.jobs.map(j => running.get(j.name)));
      const edits = changes.flatMap(c => parseReply(c.reply).edits);
      if (!edits.length) throw new Error('the helpers wrote no changes');
      const fitted = await applyEditsWithFixer(page, edits, signal, spent);
      if (fitted.failed.length) throw misfit(fitted.failed);
      html = fitted.html;
      edited = true;
      how = `lead ${secs(leadAt)}, ${changes.length} helpers changing it with ${edits.length} edits${timing(changes)}`;
    } else if (r.html) {
      html = r.html;
      how = `lead wrote it all, ${secs(leadAt)}`;
    } else if (r.edits.length) {
      if (!page) throw new Error('edits on a blank page');
      const fitted = await applyEditsWithFixer(page, r.edits, signal, spent);
      if (fitted.failed.length) throw misfit(fitted.failed);
      html = fitted.html;
      edited = true;
      how = `lead's ${r.edits.length} edits, ${secs(leadAt)}`;
    } else if (!field(lead.text, 'SAY')) {
      // Not a page, not edits, and not just talking: a reply we couldn't read.
      throw new Error("couldn't read the lead's reply");
    }

    // Every script should parse: one repair before it's shown.
    if (html) {
      const named = repairNames(html);
      if (named.html !== html) log('team: a piece named its function differently, so the name the plan uses was added');
      html = named.html;
      const problems = [...(await syntaxErrors(html)), ...blankProblems(html), ...named.problems];
      if (problems.length) {
        log(`team: page doesn't parse (${problems.join('; ').slice(0, 200)}), asking the fixer`);
        const repaired = await fix(html, `The page doesn't run: ${problems.join('\n')}\nFix just that.`, signal, spent);
        const left = [...(await syntaxErrors(repaired)), ...blankProblems(repaired), ...repairNames(repaired).problems];
        log(`team: fixer ${left.length ? `didn't manage (${left[0].slice(0, 120)})` : 'fixed it'} at ${secs()}`);
        if (left.length < problems.length || !left.length) html = repaired;
      }
    }

    await Promise.race([voice, new Promise(resolve => setTimeout(resolve, 1500))]);
    over = true;
    stopSketch.abort();
    log(`ok   claude team ${secs()} ${how}${stats.sketchMs ? `, first look at ${secs(t0 + stats.sketchMs)}` : ''}, ${html?.length ?? 0} chars, ${spent.tokens} tokens written`);
    // Only talking: the voice may have said something else first, so say the lead's answer too.
    const talkOnly = !html && r.say;
    return {
      say: voiceSay || r.say,
      done: talkOnly && voiceSay ? r.say : r.done,
      title: r.title,
      emoji: r.emoji,
      html,
      edited,
      backend: 'claude team',
      stats: { ...stats, ms: Date.now() - t0, how, tokens: spent.tokens },
    };
  } catch (err) {
    over = true;
    stopAll.abort();
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// A careful look at a team-built page right after it appears (the app asks: POST /api/check).

// What the checker is told about the page as it runs (from the app's stage, like the overwatch).
function running(report, shot) {
  const r = report || {};
  const lines = [
    `Running at ${r.fps ?? '?'} frames per second${r.canvas ? ` on a ${r.canvas} canvas` : ''}.`,
    `Errors while running: ${r.errors?.length ? r.errors.slice(-5).join(' | ') : 'none'}`,
  ];
  return `<how_it_is_running>\n${lines.join('\n')}\n</how_it_is_running>\n\n${
    shot ? `A screenshot of it right now is in the file ${path.basename(shot)} - look at it first.` : 'There is no screenshot, so judge from the page.'
  }`;
}

// Review a page; resolves with the fixed page (or null if nothing needs fixing) and why.
export async function reviewPage({ page, asked, told, report, shot, change = false, polish = false }) {
  const changed = !change
    ? ''
    : polish
      ? '\nThis was a change to a creation the kid already had: polish only what changed, and don\'t resize, move or restyle what was already there.'
      : '\nThis was a change to a creation the kid already had: check that the change is really there and that what they had still works, but don\'t resize, move or restyle what was already there.';
  const reply = await ask(polish ? 'polisher' : 'checker', {
    system: polish ? polishSystem() : checkerSystem(),
    prompt: `<page>\n${page}\n</page>\n\nThe kid asked for: "${asked}"\nThey were told: ${told || '(nothing)'}${changed}\n\n${running(report, shot)}`,
    tools: shot ? 'Read' : '',
  });
  const edits = parseReply(reply.text).edits;
  if (!edits.length) return { html: null, why: '' };
  const why = field(reply.text, 'WHY') || 'fixed a few things';
  const { html, failed } = applySome(page, edits);
  if (failed.length === edits.length) return { html: null, why, skipped: "edits didn't fit" };
  // Never make it worse: the page must parse at least as well as before.
  if ((await syntaxErrors(html)).length > (await syntaxErrors(page)).length) return { html: null, why, skipped: "the fix didn't parse" };
  return { html, why, edits: edits.length - failed.length };
}

function saveScreenshot(dataUrl) {
  const m = /^data:image\/(jpeg|png);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const file = path.join(WORK_DIR, `check-${Date.now()}.${m[1] === 'png' ? 'png' : 'jpg'}`);
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
  return file;
}
// Its fixes become a new version, which the app slides in at a calm moment, keeping the kid's
// progress. Only for pages the team built, once each, and never over newer work. Then (polish)
// the finishing touches, on the page as it is after the check.

// How many polish passes follow the check (team.polish: true is one, a number is that many).
export function polishPasses() {
  const v = config().team?.polish;
  return v === false ? 0 : v === true || v == null ? 1 : Math.max(0, Math.min(3, Math.round(Number(v)) || 0));
}

export async function check({ projectId, version, report, screenshot, polish = false }) {
  if (!enabled() || config().team.check === false || (polish && !polishPasses())) return { skipped: 'off' };
  let p = store.currentProject();
  if (!version || p.id !== projectId || p.current !== version) return { skipped: 'stale' };
  const v = p.versions.find(x => x.n === version);
  if (polish) {
    // Only on what the team built and checked, and only as many times as asked.
    const since = p.versions.slice(p.versions.findLastIndex(x => x.backend === 'claude team') + 1);
    if (!/^claude team( check| polish)?$/.test(v?.backend || '') || since.some(x => !/^claude team (check|polish)$/.test(x.backend || ''))) return { skipped: 'not checked by the team' };
    if (since.filter(x => x.backend === 'claude team polish').length >= polishPasses()) return { skipped: 'polished enough' };
  } else if (v?.backend !== 'claude team') return { skipped: 'not built by the team' };
  const what = polish ? 'POLISH' : 'CHECK';
  const page = store.html(p);
  const shot = saveScreenshot(screenshot);
  const t0 = Date.now();
  const took = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  try {
    const asked = p.history.filter(h => h.role === 'kid').at(-1)?.text || '';
    const told = p.history.filter(h => h.role === 'buddy').at(-1)?.text || '';
    const change = Boolean(v.continues);
    const r = await reviewPage({ page, asked, told, report, shot, change, polish });
    if (!r.html) {
      log(r.skipped ? `${what} skip ${took()} ${r.why} (${r.skipped})` : `${what} ok   ${took()}${shot ? ' (with a screenshot)' : ''}`);
      return r.skipped ? { skipped: r.skipped } : { ok: true };
    }
    // The kid may have moved on meanwhile: never overwrite newer work.
    p = store.currentProject();
    if (p.id !== projectId || p.current !== version || isBusy()) {
      log(`${what} stale ${took()} ${r.why}`);
      return { skipped: 'stale' };
    }
    p = store.addVersion(p, r.html, { request: `(team ${polish ? 'polish' : 'check'}) ${r.why}`, backend: polish ? 'claude team polish' : 'claude team check', continues: change });
    log(`${what} fix  ${took()} ${r.why} (${r.edits} edits${shot ? ', saw a screenshot' : ''}) → v${p.current}`);
    return { fixed: true, verdict: 'fix', why: r.why, html: store.html(p), version: p.current };
  } catch (err) {
    log(`${what} fail ${took()} ${err.message.replace(/\s+/g, ' ').slice(0, 200)}`);
    return { skipped: 'failed' };
  } finally {
    if (shot) fs.rmSync(shot, { force: true });
  }
}
