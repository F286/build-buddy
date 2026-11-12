// Team mode, the agent way with direct helpers: the same lead as agents.mjs - one Claude that keeps
// the creation in mind, plans it, hands its parts out and then makes what came back one creation that
// works - with the waiting taken out of the handing out.
//
// In agents.mjs the lead writes the page, then a message to each helper (a Claude Code subagent), one
// after another; each helper starts when its own message is finished, reads the files, writes its
// part and reports back; then the lead reads the parts. Measured on a kid's request, of 70 s the
// helpers were writing for about 20. Here:
//   - the lead writes the page as its reply, and each part's job is a line of it (`// @part <name>:
//     <job>`): a helper starts the moment its line is written, while the lead writes the rest;
//   - a helper is a `claude` program of Build Buddy's own (started while the kid talks), handed the
//     page so far and its job, that answers with its part's code - no files to read, nothing to report;
//   - the lead is handed every part in one message, and makes them fit (the same check as before:
//     it's what finds the truck that jumps over the cars but never crushes them);
//   - its fixes and changes are written into its reply (FIX blocks), which Build Buddy takes into the
//     files. It has no tools at all - the parts, a screenshot, a page that changed are put in front of
//     it - so a check or a small change is one answer, not three, and never a detour to read a file;
//   - for a big change, the helpers write while the lead makes its own changes.
//
// The creation lives in files in its own folder, as in agents.mjs:
//   page.html        the page, with a `// @part <name>` line wherever a part's code goes
//   parts/<name>.js  each part, written by a helper (and fixed by the lead to fit)
// After each turn the page is put together from them. While the kid plays, the lead looks at
// screenshots of it and grows and polishes it in the same session; the kid's changes go to it too.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import * as store from './store.mjs';
import { buddyIntro, talkingRules, worldRules, buildingRules, pickLook, parseReply, field, log, isBusy, WORK_DIR } from './ai.mjs';
import { Session } from './solo.mjs';
import { leadBrain } from './bins.mjs';
import { syntaxErrors, blankProblems, speakFirst, warmVoice, polishPasses as teamPolish, maxHelpers, askRole, keepRoleWarm } from './team.mjs';

// On when the agent way is (agents.mjs enabled()) and its helpers are Build Buddy's own programs
// (team.agentHelpers "direct") rather than Claude Code subagents ("subagents": agents.mjs as it was).
export function on() {
  const c = config();
  return Boolean(c.team?.enabled && c.team?.agents) && !c.solo?.enabled && c.backends[0] === 'claude' && leadBrain() === 'claude' && c.team?.agentHelpers !== 'subagents';
}

// Passes after something new or a change: growing it, then looking again (team.polish more).
export const passes = () => 1 + teamPolish();

function lead() {
  const c = config();
  const r = c.team?.agentLead || {};
  const model = r.model || c.claude.model || '';
  return {
    model,
    effort: r.effort || c.claude.effort || '',
    fast: r.fast ?? Boolean(c.claude.fast),
    args: Array.isArray(r.args) ? r.args.map(String) : [],
    // firstModel: who leads the turn that makes something new while the kid waits (the main model
    // takes over for everything else). Only with a main model set.
    firstModel: model ? r.firstModel || '' : '',
    // thinking: how long it may think (in tokens) before it plans or changes something while the kid
    // waits (build), when it's handed the parts to make them fit (fit), and when it looks its creation
    // over while the kid plays (look).
    thinking: { build: 1500, fit: 700, look: 10000, ...(r.thinking || {}) },
  };
}

// ---------------------------------------------------------------------------------------------
// What it's told

const TAG = '[<one emoji> <what it is, in a few words a kid would say, like: the monster truck>]';
const JOB = '<exactly the code it defines, like drawSky(ctx, t) or makeFrog(scene) → { update(dt, t), hitTest(x, y) }> - <in under 40 words: how it looks, sounds and feels, what it does when poked, the shared names and keep fields it reads or changes, and what it tells or hears>';

function leadSystem() {
  return `${buddyIntro()}

# Reply format
TITLE: <one emoji> <2-4 word name>   (only when you start something new or it changes a lot)
Then the work (below), and at the end of your last reply:
DONE: <1-2 short sentences said when it appears: how to play with it. You may end with an open question like "What's next?" - never with a suggestion>
Someone else has already answered the kid out loud, so don't write SAY - unless there is nothing to build (you didn't understand, or they asked you something): then write only SAY: <what to say> and change nothing.

# You lead a building team - and the creation lives in files
The creation is a folder: page.html is the page, with a line \`// @part <name>\` wherever a part's code goes, and parts/<name>.js holds each part. Build Buddy puts them together (each \`// @part\` line becomes that part's file) and shows it the moment your work on it is done.

You write, and Build Buddy acts on it as you write - there's no tool to wait for:
- A job line starts a helper on a part (below).
- A change to a file is a FIX block:
FIX <page.html or parts/<name>.js>
<<<<<<< FIND
<lines copied exactly from the file as it is now - just enough of them to match one place only>
=======
<what replaces them - nothing at all, to take them out>
>>>>>>> REPLACE
- A whole file is \`FILE <path>\` on a line of its own, then the file in a \`\`\` block.
You have no tools and need none - you know the files: you wrote page.html, you're shown every part when it's written, and whatever changes outside your own work is shown to you.

Your helpers each write one part file, all at the same time, so the kid gets it much sooner - but only if you hand the work out: every part file is written by a helper, never by you. A helper starts the moment its job line is written. It sees the page as it is at that moment, and its job - nothing else. So whatever your helpers need to know about the whole creation (the coordinates, the shared state, how the parts talk to each other) is a short comment in page.html's shared code, above the jobs. Your own writing is page.html, the jobs, and the fixes that make the parts fit. You are the one who knows the whole creation, so you make it one thing that works.

## Something new - start writing straight away
Your whole reply is the TITLE line and then page.html in one \`\`\`html block. Start with the TITLE line at once - the page's first comments are where you plan it, so don't think it through before you write. About 40-60 lines of your own, in this order:
- \`<!doctype html>\`, a style that fills the window with no scrollbars, and one \`<script type="module">\` holding:
- the shared code, kept short - your helpers are waiting for it, so only what the parts go by (what only MAIN needs comes after the jobs). Its first line is \`// ASKED: <each thing the kid asked for, one after another, in their words>\`. Then every import any part needs, the palette and sizes (worked out from the window's width and height, so it all fits whatever the screen), the shared state - the world's rules as a few plain numbers that one place updates every frame - the shared input object, how the parts tell each other what happens (a crush, a catch, a landing) - this line as it is: \`const hear = {}, on = (name, fn) => (hear[name] ||= []).push(fn), tell = (name, what) => (hear[name] || []).forEach(fn => fn(what));\` with a comment naming each thing told, who tells it and what it carries, never a list of events that's emptied every frame (a part that runs earlier in the frame would miss them) - and \`const keep = KB.keep({ ... })\` with every field the kid would miss when the page changes;
- a job line for each part, the biggest job first (its helper starts first): 5 to 7 small parts, similar in size, about 25-40 lines each (for example: the rules, the place, the star, the other characters, the effects, the sounds), each thing in one part only - the kid waits for the slowest one, so split anything big (the star, a track, a whole scene, effects and sounds) into two parts. Each job is one line:
  \`// @part <name> ${TAG}: ${JOB}\`
  (The tag in brackets is shown and said to the kid while they wait: "I'm making the monster truck!") A helper writes about 30 lines in the time the kid can wait, and writes everything its job names - so name at most three things it does, in a job line of 300 characters at most, and keep the shared code to what the parts need. Extras come when you grow it, after the kid sees it.
- MAIN: it makes the page's elements, creates everything by calling the parts exactly as their jobs say, runs the one animation loop (dt and t in seconds, dt at most 0.05) and turns the arrow keys, taps and drags into the shared input object.
Plan it for a ${config().kidAge}-year-old's first ten seconds, and say so in the jobs it touches: every thing they asked for is on the first screen, whole and big enough to know at a glance - so a world just big enough to hold them (three places a short drive apart, not a map shown tiny), filling the screen, the star big; an arrow key moves the star the way it points on the screen (left goes left, up goes up - never turn-and-go steering) and a quick tap does something every time; and the main thing they asked for happens however they go at it, not only when they get it just right (the truck crushes the cars it drives into, too, not only the ones it lands on).
Stop after the block. When your helpers are done you're handed every part as they wrote it, and you make it one creation that works - with FIX blocks - and end with DONE.

## A change to what's there
Start writing straight away here too - your reply's first lines are where you plan it, so don't think it through before you write. A small change: make it yourself, with FIX blocks, and end with DONE. Several separate things, or something big: hand the big pieces out first - their helpers write while you make your own changes. Begin with \`PLAN: <in one line: which pieces go to helpers, and what you change yourself>\`, then the jobs, one line each, before anything else - each helper starts the moment its line is written:
  \`PART <name> ${TAG}: ${JOB}\`
  for a new part - say in it anything new you're adding to the shared code that it goes by, and add its \`// @part <name>\` line and its calls to page.html yourself (FIX blocks), in this same reply; or
  \`PART <name> ${TAG} (again): <what changes, and what stays as it is>\`
  for a part that's there: its helper writes the whole file again, so leave that file alone meanwhile.
Each helper sees the whole page as it is now, and never two helpers get the same file. When they're done you're handed what they wrote: make it fit, and end with DONE (after handing parts out, DONE comes then, not before). Keep the KB.keep names and what they mean, so the kid carries on where they were. Anything new the kid can make progress in gets its default in page.html's \`KB.keep({ ... })\` - only those fields carry over, and only you can add them, since helpers write only their own part - and its job names that keep field.

## Later, while the kid plays
You'll be shown how it's running (a screenshot, the frame rate, any errors) and asked to grow it or look it over. Work the same way: hand out anything big with PART lines (each helper on its own file), make your own changes with FIX blocks, then make what the helpers wrote fit. Never rewrite what works just to tidy it. New progress gets its keep field in page.html, as above.

${talkingRules()}

${worldRules()}

${buildingRules()}`;
}

// What every helper follows. Nothing about one creation is in it, so helpers can be started (and
// wait) before the kid has finished talking.
// quick: the kid is waiting for this (something new or a change) - small parts; otherwise (the
// passes while the kid plays) fuller ones.
function helperSystem(quick = true) {
  return `# How to write your part

You are a helper on a small team building a web page for a ${config().kidAge}-year-old, from what the kid said out loud. The team lead wrote page.html: the shared code at the top, a \`// @part <name>\` line where each part goes, and MAIN at the bottom, which calls your part exactly as your job says. The comments in the shared code tell you how the parts fit together (the coordinates, how they talk to each other) - follow them. Other helpers write the other parts at the same time. (For something new you see the page as far as the lead has written it - the shared code and the jobs so far: the other jobs and MAIN follow.)

- Reply with only the code of your part - the whole file, and nothing else: no explanation and no \`\`\` fences${quick ? ". Write it once, as well as you can: the lead checks every part afterwards" : ''}.
- Define exactly what your job says (the same names and parameters, returning the same things): MAIN depends on it. Use the shared code's names as they are.
- Only define things at the top level: nothing runs until MAIN calls your part. No imports and no <script> tags (the shared code has every import). Extra top-level names you add start with your part's name and an underscore (\`truck_speed\`), so they can't clash - never your part's name alone, which MAIN may use for what you return. Whatever your piece needs before its first frame happens in the function MAIN calls first.
- Time is in seconds: use dt and t exactly as passed (never divide them by 1000). Read the arrow keys and the pointer from the shared input object, unless your job says otherwise.
- The world's rules belong to the lead's plan: read and change the shared numbers your job names, never a copy of your own, and add no rules your job doesn't ask for.
- No words on the page - pictures instead. Draw everything in the look, so it's all one picture - shapes, not emoji.
${quick ? '- About 25-40 short lines, never more than 2,500 characters - a hard limit: the kid is waiting, and the whole creation appears only when the slowest helper is done. Write the heart of your part well - compact code, no comments beyond a word or two - and leave the extras out; the lead grows the creation after it appears.' : '- About 30-60 short lines: the kid is playing with it, not waiting, so make your part rich and complete - what it does when poked, how it reacts to what happens, the little things to find.'} Smooth: no shadowBlur or CSS/SVG filters, at most about 40 moving things; in 3D, no new lights unless your job says so, reuse geometries and materials, InstancedMesh for many copies.
- What the kid would miss when the page changes lives in the fields of page.html's \`KB.keep({ ... })\` (only those carry over): put it back from there when your piece starts, and update it as it changes. Use the keep fields your job names; never call KB.keep yourself.
- Whatever your piece draws, a kid knows at a glance: your first line is a comment naming the three or four features that make it unmistakable (a T-rex: huge head, big teeth, tiny arms, thick tail; a shop: striped awning, big window, things for sale) - then draw each of them, big enough to see. The star has a face and is in proportion with its world. The place is full: a few kinds of things, each made in a loop with varied sizes, colors and spots.
- What happens between the parts goes the way the shared code says. With its \`tell\` and \`on\`: tell what your job says you tell the moment it happens (\`tell('crush', car)\`), and hear what you react to with \`on('crush', car => ...)\`, set up in the function MAIN calls first - a listener only notes what happened; the drawing stays in your own update.
- Whatever the kid can touch or steer in your piece answers every time - a bounce, a sound, a burst - and moves the way the arrow points on the screen.

${worldRules()}

${buildingRules()}`;
}

// What one helper is handed: the creation, the page as it is, and its job.
function helperPrompt({ asked, latest, look }, job, quick = true) {
  return [
    `# This creation\n${asked ? `The kid asked for: "${asked}"` : ''}${latest ? `\nThen they said: "${latest}"` : ''}${look ? `\nThe look: ${look}.` : ''}`,
    `# The page${job.partial ? ' (as far as the lead has written it: the other jobs and MAIN follow)' : ' as it is now (each part\'s code follows its `// ---- <name>` line)'}\n<page>\n${job.page}\n</page>`,
    job.again
      ? `# Your job: write parts/${job.name}.js again - the whole file (its code now follows \`// ---- ${job.name}\` in the page), with this change:\n${job.job}`
      : `# Your job: write parts/${job.name}.js\n// @part ${job.name}: ${job.job}`,
    // (Without this line a helper thinks for 10 to 20 s before the harder parts - a truck, a row of
    // cars - and the whole creation waits for it: measured, 24-34 s for the slowest of six, 14 s with it.)
    quick && 'Start writing the code at once - no planning or thinking it through first: the kid is waiting, and the lead checks it afterwards.',
  ].filter(Boolean).join('\n\n');
}

// Growing it into its full version, while the kid plays (the first pass after something new).
const GROW = `Now grow it into its full, excellent version - about twice as much as there is now. Hand the additions out to helpers with PART lines, all at once, before your own changes - each owns its own file (a new part, which you add a \`// @part\` line and a call in MAIN for, or a part it writes again, fuller) - then make what they wrote fit:
- First fix anything you can see isn't working or showing yet, and make every word of what the kid said, and of the look, unmistakably there - the center of it, not a detail.
- Then add what it still lacks to be a world that works and a delight: everything a kid pictures for it (a farm has animals to feed), more of its place near and far (made in loops) with things moving on their own, the star and everyone in it reacting to the kid and to what happens, a big happy moment for each thing the kid sets going, one more thing a poke sets off (the full pond spills over its edge), something new that what the kid does adds up to, and things to discover until it has one or two, each with a spark of joy, from exactly what the kid said. In a game, a reward every time and a goal that grows (after a few, something new appears).
- Give it one big idea of its own, built from exactly what the kid said - a rule, a place with a story, or a character with a name and a wish that makes it unlike any other version - not a big new thing they didn't ask for.
- Every arrow key, a tap anywhere and a drag each get an answer the kid sees, and a finger can do all the arrow keys do.
- Keep it smooth (nothing made every frame, a costly look drawn the cheap way) and everything in the look.
End your last reply with WHY: <what you improved, in one short sentence for the grown-ups' log>.`;

// Looking it over again, as a demanding parent would (the passes after that).
const LOOK = `Test it the way a demanding parent who designs kids' simulations and games would, before they play it with their kid - in the files and in the screenshot:
1. Every control: follow each arrow key, a tap anywhere and a drag from its handler to what moves on screen. Does each one do something the kid sees right away, and does left go left? Can a finger alone do all the arrow keys do, and is the main thing to poke easy to spot?
2. Every cause and effect: trace what each poke on the main things, each collision and each timer sets off - would it really fire (both things exist, are in range, and have what the check needs) and show on screen, not hidden behind something? Left alone, does it keep going? Then play it in your head for a few minutes, tapping fast, then doing nothing: can anything get stuck, pile up or never stop? In a game, can the goal be reached, again and again?
3. In 3D, also: the camera shows the star's face, not its back; everything faces the way it moves; nothing drives or flies through solid things; sky and clouds are where the camera sees them.
4. Score it 1 to 10 the way that parent would, on: what they asked for (all of it, in the look, in plain view from the first second), a world that works, delight (charming and polished, a full scene, everyone in it reacting, big happy moments), easy for a 5-year-old, solid (no bugs, glitches, or anything stuck, piling up, hidden or cut off), and its own.
Write the scores under NOTES:, and for each below 9, what keeps it there. Then fix as much of it as you can do well - small fixes yourself with FIX blocks, anything bigger handed to helpers with PART lines, each on its own file - and make what they wrote fit. End your last reply with WHY: <what you fixed, in one short sentence for the grown-ups' log>. Only if everything is a 9 or 10 and you changed nothing, reply with just: OK`;

// ---------------------------------------------------------------------------------------------
// The folder

// (Worked out when needed: ai.mjs, which sets WORK_DIR, loads this module first.)
const folderOf = projectId => path.join(WORK_DIR, 'crew', String(projectId).replace(/[^\w-]/g, '') || 'creation');

// The page, put together: each `// @part <name>` line becomes that part's file. Null without a page.
export function assemble(dir) {
  let page;
  try {
    page = fs.readFileSync(path.join(dir, 'page.html'), 'utf8');
  } catch {
    return null;
  }
  const missing = [];
  const html = page.replace(/^[ \t]*\/\/ ?@part[ \t]+([\w-]+).*$/gm, (line, name) => {
    try {
      return `// ---- ${name}\n${fs.readFileSync(path.join(dir, 'parts', `${name}.js`), 'utf8').trim()}`;
    } catch {
      missing.push(name);
      return line;
    }
  });
  return { html, missing };
}

// The page and its parts as they are now (to put back if a pass doesn't work out).
function snapshot(dir) {
  const files = {};
  const read = rel => {
    try {
      files[rel] = fs.readFileSync(path.join(dir, rel), 'utf8');
    } catch {}
  };
  read('page.html');
  for (const f of fs.existsSync(path.join(dir, 'parts')) ? fs.readdirSync(path.join(dir, 'parts')) : []) read(path.join('parts', f));
  return files;
}

function restore(dir, files) {
  clear(dir);
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text);
}

// An empty folder for the page and its parts.
function clear(dir) {
  fs.rmSync(path.join(dir, 'page.html'), { force: true });
  fs.rmSync(path.join(dir, 'parts'), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'parts'), { recursive: true });
}

// The files as they are, to show the lead.
function shown(dir) {
  const files = snapshot(dir);
  return Object.keys(files).sort((a, b) => (a === 'page.html' ? -1 : b === 'page.html' ? 1 : a.localeCompare(b))).map(rel => `=== ${rel}\n${files[rel].trimEnd()}`).join('\n\n');
}

// Before a turn: the files hold the creation as it is now. Returns what the lead is told about them -
// the files themselves, when it doesn't know them as they are (it's new to them, or they changed
// outside its own work).
function sync(s, page) {
  const dir = s.dir;
  const now = assemble(dir)?.html;
  if (!page) {
    if (now) clear(dir);
    s.files = '';
    return '';
  }
  if (now === page && s.files === page) return ''; // as it left them
  if (now !== page) {
    // The page changed outside its files (undone, fixed by the overwatch, another way of building).
    clear(dir);
    fs.writeFileSync(path.join(dir, 'page.html'), page);
  }
  s.files = page;
  return now === page
    ? `The creation's files, as they are now:\n\n${shown(dir)}`
    : `The page changed since you last worked on it (or you are new to it): page.html now holds the whole page as it is, with no parts. When you hand out work, a helper can take over a piece of it as a new part.\n\n${shown(dir)}`;
}

// ---------------------------------------------------------------------------------------------
// The session (one per creation; solo mode's, with its own tools and folder)

const MAX_TURNS = 24;
let session = null;

function sessionArgs() {
  const r = lead();
  const args = ['-p', '--safe-mode', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--system-prompt', leadSystem()];
  if (r.model) args.push('--model', r.model);
  if (r.effort) args.push('--effort', r.effort);
  if (r.fast) args.push('--settings', JSON.stringify({ fastMode: true }));
  args.push(...r.args);
  return args;
}

function sessionFor(projectId, { renew = false } = {}) {
  const s = session;
  const usable = s?.alive && s.projectId === projectId;
  if (usable && (s.kidWaiting || !renew || (s.turns < MAX_TURNS && s.key === JSON.stringify(sessionArgs())))) return s;
  s?.end();
  const dir = folderOf(projectId);
  fs.mkdirSync(path.join(dir, 'parts'), { recursive: true });
  session = new Session(projectId, { args: sessionArgs(), cwd: dir, label: 'agents', model: lead().model });
  session.dir = dir;
  session.files = null; // the page its files held when it last worked on them (null: never)
  return session;
}

// What's still to do for a creation (kept apart from the session, so a new one carries on).
let work = { projectId: null };
function workFor(projectId) {
  if (work.projectId !== projectId) work = { projectId, grow: false, passes: 0, tries: 0, lastPass: null, note: '', checking: false, repairing: false, asked: '', rules: null };
  return work;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// A pass still finishing (stopped for the kid): wait until it has put its files back.
async function settled(w) {
  for (let i = 0; (w.checking || w.repairing) && i < 100; i++) await sleep(100);
}

// Its own changes were taken out of the files (a pass stopped or that didn't run, a repair that
// didn't fix it): it's told, and it reads the files again before changing them.
function undone(s, w, why) {
  s.files = null;
  w.note = `Your last changes were taken out (${why}): the files are back to how they were before them, as shown here.`;
}

// What the kid says comes first: a pass at work stops, and any waiting are dropped.
function makeWay(s) {
  if (s.current?.kind === 'polish' || s.current?.kind === 'repair') s.interrupt();
  for (const t of s.queue.filter(t => t.kind === 'polish' || t.kind === 'repair')) {
    s.queue.splice(s.queue.indexOf(t), 1);
    t.finish(new Error('stale'));
  }
}

// The kid started talking: the lead, the voice and the helpers are started, and wait.
export function warm() {
  if (!on()) return { warm: 0 };
  const before = session;
  try {
    const s = sessionFor(store.currentProject().id, { renew: true });
    const others = config().team?.warm === false ? 0 : warmVoice() + keepRoleWarm('agentHelper', helperSystem(true), Math.max(7, maxHelpers()));
    return { warm: (s === before ? 0 : 1) + others };
  } catch {
    return { warm: 0 };
  }
}

export function stop() {
  session?.end();
  session = null;
}

// Is a pass or a repair of its own at work on the creation? (The overwatch waits for it.)
export const busy = () => Boolean(work.checking || work.repairing);

// For a session that's new to the creation: what the kid asked for lately.
function historyNote(history) {
  const c = config();
  const lines = (history || []).slice(-c.historyTurns * 2).map(h => `${h.role === 'kid' ? 'Kid' : c.buddyName}: ${h.text}`);
  return lines.length ? `<conversation_so_far>\n${lines.join('\n')}\n</conversation_so_far>` : '';
}

// The fields of a page's `KB.keep({ ... })` (what the kid's progress is kept in): its top-level names,
// with braces matched so a field that is itself an object or a list doesn't end it early. Null when
// the page has none.
function keepFields(html) {
  const text = String(html || '');
  const at = text.search(/KB\.keep\(\s*\{/);
  if (at < 0) return null;
  const names = new Set();
  const named = key => {
    if (key.trim().startsWith('...')) names.open = true; // (more fields than can be read here)
    else if (/^[A-Za-z_$][\w$]*$/.test(key.trim())) names.add(key.trim());
  };
  let [depth, quote, key, value] = [0, '', '', false]; // (value: past a field's colon, until its comma)
  for (let i = text.indexOf('{', at); i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') {
      if (--depth > 0) continue;
      if (!value) named(key); // (just `score`, as the last one)
      return names;
    } else if (depth === 1) {
      if (ch === ':' && !value) {
        named(key);
        [key, value] = ['', true];
      } else if (ch === ',') {
        if (!value) named(key); // (just `score`)
        [key, value] = ['', false];
      } else if (!value) key += ch;
    }
  }
  return names;
}
const keepNames = html => keepFields(html) || new Set();

// A change to the same creation (it kept most of the kid's progress fields), even if the lead gave
// it a new name: the kid carries on where they were.
function sameCreation(before, after) {
  const was = keepNames(before);
  if (!was.size) return false;
  const now = keepNames(after);
  return [...was].filter(k => now.has(k)).length * 2 >= was.size;
}

// A page line a problem names, with the lines around it (the lead has no file to look it up in).
function around(problems, html) {
  const lines = String(html || '').split('\n');
  return problems.map(p => {
    const at = Number(/page line (\d+)/.exec(p)?.[1]);
    if (!at || at > lines.length) return p;
    const from = Math.max(1, at - 3);
    return `${p}\n${lines.slice(from - 1, at + 2).map((l, i) => `${from + i === at ? '>' : ' '} ${from + i}: ${l.slice(0, 200)}`).join('\n')}`;
  });
}

// Does the page run? Problems found before it's shown go back to the lead once.
async function problemsIn(built) {
  if (!built?.html) return ['there is no page.html'];
  return [...built.missing.map(n => `a \`// @part ${n}\` line has no file parts/${n}.js`), ...(await syntaxErrors(built.html)), ...blankProblems(built.html)];
}

// ---------------------------------------------------------------------------------------------
// The lead's reply, read as it's written: the jobs in it, and the page of something new.

const PART_LINE = /^[ \t]*\/\/ ?@part[ \t]+([\w-]+)[ \t]*(?:\[([^\]\n]*)\])?[ \t]*:[ \t]*(\S.*)$/; // in the page: a part, its tag and its job
const HAND_OUT = /^[ \t>*_`-]*PART[ \t]+`?([\w-]+)`?[ \t]*(?:\[([^\]\n]*)\])?[ \t]*(\((?:again|rewrite)\))?[ \t]*:[ \t]*(\S.*?)`?[ \t]*$/; // in a reply

// The loose ends between a page and its parts that no syntax check finds and that are plain to see in
// the files - so the lead is told, rather than having to notice: something heard that nothing tells,
// a keep field with no default, a function its job names that nothing defines, a color of the wrong
// kind for what draws with it (it comes out black).
// files: { 'page.html': text, 'parts/<name>.js': text }.
function looseEnds(files) {
  const page = files['page.html'] || '';
  // (Whole-line comments aside: a job line names what its part defines, and isn't a call.)
  const code = text => text.split('\n').filter(l => !/^[ \t]*\/\//.test(l)).join('\n');
  const each = Object.entries(files)
    .map(([rel, text]) => [rel.replace(/\\/g, '/'), code(text)])
    .filter(([rel]) => rel === 'page.html' || rel.startsWith('parts/'))
    .sort(([a], [b]) => (a === 'page.html' ? -1 : b === 'page.html' ? 1 : a.localeCompare(b)));
  const all = each.map(([, text]) => text).join('\n');
  const out = [];
  // What's heard and never told (with the shared code's `on` and `tell`).
  if (/\bconst hear\b/.test(page)) {
    // (Heard with the bare on(...): sprite.on('pointerdown') is Phaser's. Told with tell(...) however
    // it's reached - the page may hand it to its parts as S.tell.)
    const named = (before, word, text) => [...text.matchAll(new RegExp(`(?<![${before}\\w$])${word}\\(\\s*(['"\`])([^'"\`\\n]+)\\1`, 'g'))].map(m => m[2]);
    const told = new Set(named('', 'tell', all));
    // (Something told under a name worked out as it runs could be any of them: nothing to say then.)
    const anyName = /(?<![\w$])tell\(\s*[^'"`\s)]/.test(all);
    for (const [rel, text] of anyName ? [] : each) {
      const deaf = [...new Set(named('.', 'on', text))].filter(n => !told.has(n));
      if (deaf.length) out.push(`${rel} hears ${deaf.map(n => `'${n}'`).join(' and ')} with on(...), which nothing tells${told.size ? ` (told: ${[...told].map(n => `'${n}'`).join(', ')})` : ''}`);
    }
  }
  // A keep field that isn't among KB.keep's defaults (it starts undefined, and isn't carried over).
  const kept = keepFields(page);
  for (const [rel, text] of kept?.size && !kept.open ? each : []) {
    const missing = [...new Set([...text.matchAll(/(?<![.\w$])keep\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]))].filter(n => !kept.has(n));
    if (missing.length) out.push(`${rel} uses ${missing.map(n => `keep.${n}`).join(' and ')}, which page.html's KB.keep({ ... }) has no default for`);
  }
  // A color of the wrong kind: Phaser's fillStyle(...) and lineStyle(...) take numbers (0xff8800),
  // a canvas's fillStyle = ... takes text ('#ff8800'). The other kind draws black, with no error.
  const kinds = new Map(); // 'C.red' -> 'text' | 'number', from the shared code's color lists
  for (const [, name, body] of each[0]?.[1].matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\{([^{}]*)\}/g) || []) {
    for (const [, key, text, number] of body.matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*:\s*(?:(['"`])(?:#[0-9a-fA-F]{3,8}|rgba?\([^'"`]*|hsla?\([^'"`]*)\2|(0x[0-9a-fA-F]{3,8}))\s*(?=,|$)/g)) kinds.set(`${name}.${key}`, text ? 'text' : number ? 'number' : '');
  }
  for (const [rel, text] of kinds.size ? each : []) {
    const wrong = new Set();
    for (const [, args] of text.matchAll(/\.(?:fillStyle|lineStyle|setTint|setFillStyle|setStrokeStyle)\(([^()]*)\)/g)) for (const [ref] of args.matchAll(/[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*/g)) if (kinds.get(ref) === 'text') wrong.add(`${ref} is text, and Phaser draws with numbers (0xff8800)`);
    for (const [, ref] of text.matchAll(/\.(?:fillStyle|strokeStyle|shadowColor)\s*=\s*([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)\s*(?=[;,)\n}]|$)/gm)) if (kinds.get(ref) === 'number') wrong.add(`${ref} is a number, and a canvas draws with text ('#ff8800')`);
    if (wrong.size) out.push(`${rel} draws with colors of the wrong kind, which come out black: ${[...wrong].slice(0, 4).join('; ')}${wrong.size > 4 ? `; and ${wrong.size - 4} more` : ''}`);
  }
  // What a job says its part defines, that the page calls and nothing defines.
  for (const line of page.split('\n')) {
    const m = PART_LINE.exec(line);
    if (!m) continue;
    let defs = m[3].split(/\s[-–—]\s/)[0];
    while (/\{[^{}]*\}/.test(defs)) defs = defs.replace(/\{[^{}]*\}/g, ' '); // (what it returns isn't a top-level name)
    for (const [, name] of defs.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\(/g)) {
      const n = name.replace(/\$/g, '\\$');
      const called = new RegExp(`(?<![.\\w$])${n}\\(`).test(each[0]?.[1] || '');
      // (Defined: declared, assigned - on window too - or named anywhere it isn't being called, as in
      // `const { makeA, makeB } = ...`. Generous on purpose: a wrong alarm costs the kid's time.)
      const defined = new RegExp(`\\b(?:function\\*?|const|let|var|class)\\s+${n}\\b|(?:^|[,;{\\s]|\\b(?:window|globalThis|self)\\.)${n}\\s*=[^=]|(?<![.\\w$])${n}(?![\\w$])(?!\\s*\\()`, 'm').test(all);
      if (called && !defined) out.push(`page.html calls ${name}(...), which parts/${m[1]}.js was to define, and nothing defines it`);
    }
  }
  return out;
}

// A job's tag, apart: its picture and its words ("🚚 the monster truck").
function tagOf(tag) {
  const t = String(tag || '').trim();
  const m = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})[\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\p{Extended_Pictographic}]*)\s*(.*)$/u.exec(t);
  return { emoji: m ? m[1] : '', words: (m ? m[2] : t).replace(/[^\p{L}\p{N} '-]/gu, '').trim().slice(0, 40) };
}

class JobReader {
  constructor(onJob, onPage = () => {}) {
    this.onJob = onJob;
    this.onPage = onPage; // (the page of something new has begun)
    this.text = '';
    this.at = 0; // read up to here (whole lines)
    this.block = null; // where the page's block began (its first line), while inside it
    this.fence = false; // an html block has begun: its first line shows whether it's a page
    this.other = false; // inside some other fenced block
    this.fixing = false; // inside a FIX block's FIND/REPLACE
    this.page = null; // the page of something new, once its block has closed
    this.names = new Set();
  }

  push(chunk) {
    this.text += chunk.replace(/\r/g, '');
    for (let nl; (nl = this.text.indexOf('\n', this.at)) >= 0; this.at = nl + 1) this.line(this.text.slice(this.at, nl), this.at, nl);
  }

  // The reply is over: its last line counts too, and a page whose block was never closed.
  end() {
    if (this.at < this.text.length) this.line(this.text.slice(this.at), this.at, this.text.length);
    this.at = this.text.length;
    if (this.block != null && this.page == null) this.page = this.text.slice(this.block).replace(/\n?```\s*$/, '');
  }

  line(l, from, to) {
    if (this.page != null && this.block == null) return this.handOut(l); // (after the page)
    if (this.block == null) {
      // Inside a FIX block, or some other fenced block (a whole file, a snippet): nothing in it counts.
      if (this.fixing || this.other) {
        if (this.fixing ? /^[ \t]*>{5,9} ?REPLACE\b/.test(l) : /^[ \t]*```[ \t]*$/.test(l)) this.fixing = this.other = false;
        return;
      }
      if (/^[ \t]*<{5,9} ?FIND\b/.test(l)) return void (this.fixing = true);
      const whole = /^[ \t]*<(!doctype html|html\b)/i.test(l);
      // An html block: the page of something new, if a whole page is what it holds.
      if (this.fence) {
        if (!l.trim()) return;
        this.fence = false;
        if (!whole) return void (this.other = !/^[ \t]*```[ \t]*$/.test(l));
        [this.block, this.fenced] = [from, true];
        return this.onPage();
      }
      if (/^[ \t]*```/.test(l)) return void (/^[ \t]*```html\b/i.test(l) ? (this.fence = true) : (this.other = true));
      if (!whole) return this.handOut(l);
      [this.block, this.fenced] = [from, false]; // (a bare page, without the block around it)
      return this.onPage();
    }
    if (this.fenced ? /^[ \t]*```[ \t]*$/.test(l) : /<\/html>[ \t]*$/i.test(l)) {
      this.page = this.text.slice(this.block, this.fenced ? from : to).replace(/\n$/, '');
      this.block = null;
      return;
    }
    const m = PART_LINE.exec(l);
    if (m && !this.names.has(m[1])) {
      this.names.add(m[1]);
      this.onJob({ name: m[1], ...tagOf(m[2]), job: m[3].trim(), again: false, partial: true, page: this.text.slice(this.block, to) });
    }
  }

  handOut(l) {
    const m = HAND_OUT.exec(l);
    if (!m || this.names.has(m[1])) return;
    this.names.add(m[1]);
    this.onJob({ name: m[1], ...tagOf(m[2]), job: m[4].trim(), again: Boolean(m[3]), partial: false, page: null });
  }
}

// The files the lead may write: the page and its parts.
const filePath = (dir, rel) => (/^(page\.html|parts\/[\w-]+\.js)$/.test(rel) ? path.join(dir, rel) : null);

// The changes in a reply, in the order it wrote them: whole files (FILE <path>, then a ``` block) and
// FIX blocks (FIX <path>, then one or more FIND/REPLACE blocks).
const MARKER = /^[ \t]*(={5,9}|<{5,9} ?FIND\b.*|>{5,9} ?REPLACE\b.*)[ \t]*$/; // a line of a FIX block's own, never a file's
function changesIn(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  const head = (word, l) => new RegExp(`^[ \\t>*_\`#-]*${word}[ \\t]+\`?([\\w./-]+)\`?[*_\`:]*[ \\t]*$`).exec(l)?.[1];
  let fixing = null;
  for (let i = 0; i < lines.length; i++) {
    const file = head('FILE', lines[i]);
    if (file && /^[ \t]*```/.test(lines[i + 1] || '')) {
      const end = lines.findIndex((l, j) => j > i + 1 && /^[ \t]*```[ \t]*$/.test(l));
      if (end < 0) break;
      out.push({ path: file, content: lines.slice(i + 2, end).join('\n') });
      [i, fixing] = [end, null];
      continue;
    }
    fixing = head('FIX', lines[i]) || fixing;
    if (fixing && /^[ \t]*<{5,9} ?FIND\b/.test(lines[i])) {
      const mid = lines.findIndex((l, j) => j > i && /^[ \t]*={5,9}[ \t]*$/.test(l));
      const end = mid < 0 ? -1 : lines.findIndex((l, j) => j > mid && /^[ \t]*>{5,9} ?REPLACE\b/.test(l));
      if (end < 0) break;
      // (To take lines out it sometimes writes the divider twice, with nothing between: that's an
      // empty replacement, not a line of ='s.)
      const put = lines.slice(mid + 1, end);
      out.push({ path: fixing, find: lines.slice(i + 1, mid).join('\n'), replace: put.every(l => MARKER.test(l)) ? '' : put.join('\n') });
      i = end;
    }
  }
  return out;
}

// One FIX on a file's text: FIND must be there exactly once (its lines may differ in their spaces at
// either end). Returns the new text, or why it didn't fit.
function fixed(text, { find, replace }) {
  if (!find.trim()) return { why: 'its FIND is empty' };
  if (replace.split('\n').some(l => MARKER.test(l))) return { why: 'what replaces it holds a ======= line (one FIND, one =======, one REPLACE per block; leave the part after ======= empty to take lines out)' };
  const hits = text.split(find).length - 1;
  if (hits === 1) return { text: text.replace(find, () => replace) };
  if (hits > 1) return { why: `its FIND matches ${hits} places` };
  const lines = text.split('\n');
  const want = find.split('\n').map(l => l.trim());
  const at = [];
  for (let k = 0; k + want.length <= lines.length; k++) if (want.every((w, j) => lines[k + j].trim() === w)) at.push(k);
  if (at.length !== 1) return { why: at.length ? `its FIND matches ${at.length} places` : "its FIND isn't in the file" };
  lines.splice(at[0], want.length, ...replace.split('\n'));
  return { text: lines.join('\n') };
}

// Take a reply's changes into the files. Returns the ones that didn't fit: { path, find, replace, why }.
function applyReply(dir, text) {
  const misses = [];
  for (const c of changesIn(text)) {
    const file = filePath(dir, c.path);
    if (!file) {
      misses.push({ ...c, why: `${c.path} isn't one of the creation's files (page.html, parts/<name>.js)` });
    } else if (c.content != null) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${c.content.replace(/\n+$/, '')}\n`);
    } else {
      let was = null;
      try {
        was = fs.readFileSync(file, 'utf8');
      } catch {}
      const r = was == null ? { why: "that file isn't there" } : fixed(was, c);
      if (r.text != null) fs.writeFileSync(file, r.text);
      else misses.push({ ...c, why: r.why });
    }
  }
  return misses;
}

// Ask the lead, and take what it wrote into the files. Changes that didn't fit go back to it once,
// with those files as they are. Resolves with all it said.
async function askLead(s, prompt, opts) {
  const reply = await s.ask(prompt, opts);
  return { text: await taken(s, reply.text, opts) };
}

async function taken(s, text, { onText, onEvent, ...opts } = {}) {
  let misses = applyReply(s.dir, text);
  if (!misses.length) return text;
  log(`agents: ${misses.length} of its changes didn't fit (${misses[0].path}: ${misses[0].why}), asking it again`);
  const files = [...new Set(misses.map(m => m.path))].filter(rel => filePath(s.dir, rel) && fs.existsSync(filePath(s.dir, rel)));
  const again = await s
    .ask(
      [
        `${misses.length > 1 ? 'These changes' : 'This change'} didn't fit (your other changes are in):`,
        ...misses.map(m => `FIX ${m.path} - ${m.why}\n<<<<<<< FIND\n${m.find ?? ''}\n=======\n${m.replace ?? ''}\n>>>>>>> REPLACE`),
        ...files.map(rel => `=== ${rel}, as it is now\n${fs.readFileSync(filePath(s.dir, rel), 'utf8')}`),
        'Write just those again, as FIX blocks whose FIND is copied exactly from the file as it is now. Nothing else.',
      ].join('\n\n'),
      opts,
    )
    .catch(err => {
      if (err.message === 'interrupted') throw err;
      return { text: '' };
    });
  misses = applyReply(s.dir, again.text);
  if (misses.length) log(`agents: ${misses.length} still didn't fit (${misses[0].path}: ${misses[0].why})`);
  return text; // (what it said the first time is what counts: its DONE, its WHY)
}

// A peek at a page before it's shown: the app runs it out of sight and answers with a screenshot and
// the errors it threw (a 'peek' event in the build's stream; POST /api/peeked brings the answer). What's
// black, hidden, cut off or missing shows in a picture, not in the code. Not answered in time (an
// app that can't, a slow page): the lead goes by the code alone, as before - and after two in a row
// with no picture, on a computer too slow to take one in time, it isn't asked again until Build
// Buddy restarts (the kid would wait those seconds for nothing).
const peekMs = () => Number(config().team?.peekMs) || 3500;
const peeks = new Map();
let peekCount = 0;
let peekMisses = 0;
function peekThrough(emit) {
  if (peekMisses >= 2) return null;
  return html =>
    new Promise(resolve => {
      const id = `${Date.now().toString(36)}-${++peekCount}`;
      const t0 = Date.now();
      const answer = seen => {
        clearTimeout(timer);
        peeks.delete(id);
        peekMisses = seen?.screenshot ? 0 : peekMisses + 1;
        log(`agents: ${seen?.screenshot ? `a peek at it, out of sight, in ${((Date.now() - t0) / 1000).toFixed(1)}s` : `no picture of it within ${((Date.now() - t0) / 1000).toFixed(1)}s`}${seen?.errors?.length ? ` - it threw: ${seen.errors[0].slice(0, 100)}` : ''}${peekMisses >= 2 ? ' (not asking again)' : ''}`);
        resolve(seen);
      };
      const timer = setTimeout(() => answer(null), peekMs());
      peeks.set(id, answer);
      emit({ type: 'peek', id, html });
    });
}

export function peeked({ id, screenshot, errors, blank } = {}) {
  const answer = peeks.get(id);
  if (!answer) return { late: true };
  answer({ screenshot: typeof screenshot === 'string' ? screenshot : '', blank: Boolean(blank), errors: Array.isArray(errors) ? errors.map(e => String(e).slice(0, 300)).slice(0, 5) : [] });
  return {};
}

// A part's code, from a helper's reply (which should be nothing but it).
function codeOf(reply) {
  const text = String(reply || '').replace(/\r/g, '');
  const blocks = [...text.matchAll(/```[a-z]*[ \t]*\n([\s\S]*?)\n[ \t]*```/gi)].map(m => m[1]);
  const code = blocks.length ? blocks.sort((a, b) => b.length - a.length)[0] : text.replace(/^[ \t]*```[a-z]*[ \t]*\n/i, '');
  return code.trim();
}

// A helper that hasn't written a word after this long gets a second one on the same job (how soon
// the service answers varies a lot): whichever finishes first is used.
const HEDGE_MS = 8000;

// The helpers of one turn: each starts on its job the moment the lead has written it.
function makeCrew(s, about, { quick, onChange = () => {} }) {
  const stopAll = new AbortController();
  const jobs = []; // { name, job, again, state: 'writing' | 'done' | 'failed', code, error, startedAt, doneAt, chars }
  const write = (job, prompt) => {
    const stops = [new AbortController(), new AbortController()];
    let wrote = false;
    const one = i =>
      askRole('agentHelper', {
        system: helperSystem(quick),
        prompt,
        timeoutSec: 120,
        stallSec: 20,
        signal: AbortSignal.any([stopAll.signal, stops[i].signal]),
        onText: chunk => {
          if (i === 0) wrote = true;
          job.chars += chunk.length;
          onChange(chunk.length);
        },
      }).then(reply => ({ reply, i }));
    const first = one(0);
    const second = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // (Not while the kid plays: a helper may think a fuller part through first.)
        if (wrote || stopAll.signal.aborted || !quick) return reject(new Error('not needed'));
        log(`agents: the helper for ${job.name} hasn't started writing after ${HEDGE_MS / 1000}s, starting a second one`);
        one(1).then(resolve, reject);
      }, HEDGE_MS);
      first.then(() => (clearTimeout(timer), reject(new Error('not needed'))), () => {});
    });
    return Promise.any([first, second]).then(
      ({ reply, i }) => (stops[1 - i].abort(), reply),
      err => {
        stops.forEach(c => c.abort());
        throw err.errors?.[0] || err;
      },
    );
  };
  return {
    jobs,
    get done() {
      return jobs.filter(j => j.state !== 'writing').length;
    },
    start(found, pageNow) {
      const job = { ...found, page: found.page ?? pageNow, state: 'writing', code: '', error: '', chars: 0, startedAt: Date.now(), doneAt: 0 };
      jobs.push(job);
      const prompt = helperPrompt(about(job), job, quick);
      // One more try if a helper fails.
      job.finished = write(job, prompt)
        .catch(err => {
          if (stopAll.signal.aborted) throw err;
          log(`agents: the helper for ${job.name} failed (${err.message.replace(/\s+/g, ' ').slice(0, 120)}), trying again`);
          return write(job, prompt);
        })
        .then(reply => {
          const code = codeOf(reply.text);
          if (!code) throw new Error('it wrote nothing');
          if (stopAll.signal.aborted) throw new Error('stopped');
          fs.mkdirSync(path.join(s.dir, 'parts'), { recursive: true });
          fs.writeFileSync(path.join(s.dir, 'parts', `${job.name}.js`), `${code}\n`);
          [job.state, job.code, job.doneAt] = ['done', code, Date.now()];
        })
        .catch(err => {
          [job.state, job.error, job.doneAt] = ['failed', err.message.replace(/\s+/g, ' ').slice(0, 160), Date.now()];
        })
        .finally(() => onChange(0));
      onChange(0);
    },
    settled: () => Promise.all(jobs.map(j => j.finished)),
    stop: () => stopAll.abort(),
  };
}

// One turn of the lead's, with its helpers: its reply is read as it's written and every job in it
// starts a helper; when it and they are done, it's handed what they wrote and makes it fit (another
// reply of the same turn, as far as the caller goes). Resolves with all it said, and what was handed out.
//   about(job)   what its helpers are told about the creation ({ asked, latest, look })
//   fit          how the handing-back message ends (what it's to do with the parts)
//   peek(html)   a look at the page running before it's shown ({ screenshot, blank, errors }, or null)
async function leadTurn(s, prompt, { about, fit, quick = true, pageNow = '', onProgress = () => {}, narrate = null, peek = null, ...opts }) {
  const crew = makeCrew(s, about, { quick, onChange: n => onProgress(n, crew) });
  let before = null; // its reply is a whole new page: the files as they were (the folder starts again)
  // (What its helpers are making, said to the kid once three of them are at it - or, with fewer, a
  // moment after the last one so far: a change's one or two helpers are named while they write.)
  let told = !narrate;
  let soon = null;
  const announce = (all = false) => {
    const making = crew.jobs.map(j => j.words).filter(Boolean).slice(0, 3);
    if (told || !making.length || (!all && making.length < 3) || crew.done === crew.jobs.length) return;
    told = true;
    narrate(`I'm making ${making.length > 1 ? `${making.slice(0, -1).join(', ')} and ${making.at(-1)}` : making[0]}!`);
  };
  const reader = new JobReader(
    job => {
      crew.start(job, pageNow);
      announce();
      clearTimeout(soon);
      if (!told) soon = setTimeout(() => announce(true), 3000);
    },
    () => {
      before = snapshot(s.dir);
      clear(s.dir);
    },
  );
  try {
    const first = await s.ask(prompt, { ...opts, onText: chunk => (reader.push(chunk), onProgress(chunk.length, crew)) });
    reader.end();
    if (reader.page != null) fs.writeFileSync(path.join(s.dir, 'page.html'), `${reader.page}\n`);
    await taken(s, first.text, opts);
    let page = '';
    try {
      page = fs.readFileSync(path.join(s.dir, 'page.html'), 'utf8');
    } catch {}
    for (const l of page.split('\n')) {
      const name = /^[ \t]*\/\/ ?@part[ \t]+([\w-]+)/.exec(l)?.[1];
      if (!name || crew.jobs.some(j => j.name === name) || fs.existsSync(path.join(s.dir, 'parts', `${name}.js`))) continue;
      // (A part the new page still names, as it was...)
      if (before?.[`parts/${name}.js`] != null) fs.writeFileSync(path.join(s.dir, 'parts', `${name}.js`), before[`parts/${name}.js`]);
      // (... and a job written into page.html some other way: its helper starts now.)
      else if (PART_LINE.test(l)) crew.start({ name, ...tagOf(PART_LINE.exec(l)[2]), job: PART_LINE.exec(l)[3].trim(), again: false, partial: false, page: assemble(s.dir)?.html || page }, pageNow);
    }
    if (!crew.jobs.length) return { text: first.text, jobs: [], fresh: Boolean(before) };
    announce(true);
    await crew.settled();
    const failed = crew.jobs.filter(j => j.state === 'failed');
    const built = assemble(s.dir);
    const problems = failed.length ? [] : await problemsIn(built);
    const loose = failed.length ? [] : looseEnds(snapshot(s.dir));
    if (narrate && before) narrate("Now I'm putting it all together!"); // (something new: the longest wait)
    const seen = peek && built?.html && !failed.length && !problems.length ? await peek(built.html).catch(() => null) : null;
    const shot = picture(seen?.screenshot);
    const back = [
      `Your helper${crew.jobs.length > 1 ? 's are' : ' is'} done - ${crew.jobs.length > 1 ? 'every part' : 'the part'}, as written and saved:`,
      ...crew.jobs.filter(j => j.state === 'done').map(j => `=== parts/${j.name}.js\n${j.code}`),
      failed.length && `${failed.map(j => `parts/${j.name}.js`).join(' and ')} didn't get written (${failed.length > 1 ? 'those helpers' : 'that helper'} failed): write ${failed.length > 1 ? 'them' : 'it'} yourself now - FILE parts/<name>.js, then the code in a \`\`\` block.`,
      problems.length && `Put together, the page doesn't run yet (page lines count the page with every part in place):\n${around(problems, built?.html).join('\n')}`,
      loose.length && `Build Buddy read the files and found ${loose.length > 1 ? 'these loose ends' : 'this loose end'} between the parts - to fix:\n${loose.map(l => `- ${l}`).join('\n')}`,
      seen?.errors.length && `Run just now, out of sight, it threw:\n${seen.errors.join('\n')}`,
      shot && (seen.blank ? PEEK_BLANK : PEEK),
      fit,
    ].filter(Boolean).join('\n\n');
    if (opts.fitThinking != null) await s.think(opts.fitThinking);
    const second = await askLead(s, shot ? [{ type: 'text', text: back }, shot] : back, opts);
    return { text: `${first.text}\n${second.text}`, jobs: crew.jobs, fresh: Boolean(before) };
  } catch (err) {
    crew.stop();
    throw err;
  } finally {
    clearTimeout(soon);
  }
}

// (With the parts: what the page looks like, run out of sight just now.)
const PEEK = `A screenshot of it running right now, put together from these parts, is attached. Look at it before the code - it shows what the kid would see: anything they asked for that's missing from it, black or blank where it should have its color, hidden behind something else, cut off at an edge or too small to know is yours to fix now.`;
const PEEK_BLANK = `A screenshot of it running right now is attached: the whole screen is one color - nothing is showing. Find why in the code (what's drawn where, in what order, with what sizes) and fix that first.`;

const FIT_NEW = `Now make it one creation that works. Go through your ASKED line, thing by thing: is each one there, on the first screen, big enough to see - and does what they wanted to happen really happen when this code runs, with its numbers as they are (a jump high and long enough to clear what it must, a thing that can be reached), from the key or the tap, through the parts - everything one part tells, heard by each part that should react - to the screen? Then the kid's first ten seconds: is the star whole on the screen from the start; does an arrow key move it the way it points, and a quick tap do something; and does the main thing happen however a 5-year-old goes at it, not only when they get it just right? Fix what's missing or wouldn't happen, any name or call that doesn't match, anything that would crash when it runs (a name nothing defines, a radius or size that can go below zero) or doesn't fit the plan or the look - with FIX blocks, in the part or in page.html. Change only what needs it - the kid is waiting - then end with DONE.`;
const FIT_CHANGE = `Now make it fit: is everything the kid just asked for there - where they'll see it without looking for it - and working, with what was there before, from the key or the tap, through the parts, to the screen? Fix any name or call that doesn't match and anything missing or that would crash when it runs (a name nothing defines, a radius or size that can go below zero), with FIX blocks. Then end with DONE.`;
const FIT_PASS = `Now make what they wrote fit: fix any name or call that doesn't match and anything missing or that would crash, with FIX blocks. Then end with the WHY line.`;

// ---------------------------------------------------------------------------------------------
// One build. Resolves like the classic way: { say, done, title, emoji, html, edited, backend }.
// Throws if it couldn't (the classic way takes over).

export async function build({ page, history, text, alt, fix, title = '', look = pickLook(), peeks = false }, emit, state) {
  const t0 = Date.now();
  const secs = (t = Date.now()) => `${((t - t0) / 1000).toFixed(1)}s`;
  const p = store.currentProject();
  const w = workFor(p.id);
  const s = sessionFor(p.id, { renew: true });
  makeWay(s);
  await settled(w);
  await s.use(page ? lead().model : lead().firstModel || lead().model);
  await s.think(lead().thinking.build);
  makeWay(s); // (one that started meanwhile)

  // Sparky answers out loud right away, while the team builds.
  let over = false;
  const sayNow = line => {
    if (over || state.said) return;
    state.said = line;
    emit({ type: 'say', text: line });
  };
  if (!fix) speakFirst({ history, text, alt, title }, sayNow).catch(err => log(`agents voice failed: ${err.message.replace(/\s+/g, ' ').slice(0, 160)}`));

  const known = s.turns > 0 && Boolean(page) && s.files === page;
  const files = sync(s, page);
  const note = [w.note, files].filter(Boolean).join('\n\n');
  w.note = '';
  const creationLook = page ? p.versions.filter(x => x.look).at(-1)?.look || look : look;
  // What the creation was asked for (kept across turns; the first request after a restart).
  const first = page ? w.asked || p.versions.filter(x => !x.continues).at(-1)?.request || '' : text;
  // What its helpers are told about the creation: a part of something new goes by the new request and look.
  const asks = { asked: first, latest: page && !fix && text !== first ? text : '', look: creationLook };
  const about = job => (job.partial && page ? { asked: text, latest: '', look } : asks);

  let chars = 0;
  let helpers = { jobs: [], done: 0 };
  const progress = (n = 0, crew = helpers) => {
    chars += n;
    helpers = crew;
    emit({ type: 'progress', chars, helpers: crew.jobs.length, helpersDone: crew.done, team: true, leads: 1, parts: crew.jobs.map(j => ({ emoji: j.emoji || '', done: j.state !== 'writing' })) });
  };
  progress();
  // (It wrote page.html turns ago and has changed it since: with it in front of it, its FIX blocks'
  // FINDs fit. The parts it's shown when they're written.)
  let pageFile = '';
  try {
    if (page && !files) pageFile = `page.html, as it is now:\n${fs.readFileSync(path.join(s.dir, 'page.html'), 'utf8').trimEnd()}`;
  } catch {}
  const prompt = [
    page ? note || (known ? '' : 'Your folder holds the creation as it is.') : 'The screen is blank - nothing has been built yet: your folder is empty.',
    pageFile,
    !fix && (page ? `If this turns into a fresh new page, try this look, unless the kid asked for something else: ${look}.` : `For this new creation, try this look, unless the kid asked for something else: ${look}.`),
    !known && historyNote(history),
    fix ? `The page just crashed with this problem:\n${fix}\nFix it (FIX blocks) without changing anything else. Keep DONE very short.` : `The kid just said: "${text}"`,
    !fix && alt && `(The other listener heard: "${alt}". Little kids are hard to hear - use both versions and the conversation to work out what they meant.)`,
  ].filter(Boolean).join('\n\n');
  let reply;
  try {
    reply = await leadTurn(s, prompt, { about, fit: page ? FIT_CHANGE : FIT_NEW, quick: true, pageNow: page || '', onProgress: progress, narrate: fix ? null : text => emit({ type: 'narrate', text }), peek: peeks && !fix && config().team?.peek !== false ? peekThrough(emit) : null, fitThinking: lead().thinking.fit, priority: true, timeoutSec: Math.max(config().timeoutSec, 360), stallSec: 120 });
  } finally {
    over = true;
  }
  const r = parseReply(reply.text);
  let built = assemble(s.dir);
  const changed = Boolean(built?.html) && built.html !== (page || '');
  if (!changed) {
    // It only talked (or changed nothing): the files stay as they were. Only its own SAY means
    // there was nothing to build - otherwise the classic way builds it.
    if (page) sync(s, page);
    if (fix || !r.say) throw new Error(fix ? 'the fix changed nothing' : page ? 'it changed nothing' : "it didn't build anything");
    log(`ok   claude agents ${secs()} only talked, turn ${s.turns}`);
    // (When the quick voice spoke first, the lead's answer is said too, as in team mode.)
    return { say: state.said || r.say, done: state.said && state.said !== r.say ? r.say : '', title: r.title, emoji: r.emoji, html: null, edited: false, look, backend: 'claude agents' };
  }
  let problems = await problemsIn(built);
  if (problems.length) {
    log(`agents: page doesn't run (${problems.join('; ').slice(0, 160)}), asking it to fix that`);
    await askLead(s, `Before it's shown: the page doesn't run (page lines count the page with every part in place) -\n${around(problems, built.html).join('\n')}\nFix just that, with FIX blocks.`, { priority: true, timeoutSec: 180, stallSec: 90 }).catch(() => null);
    built = assemble(s.dir);
    problems = await problemsIn(built);
    if (!built?.html) throw new Error('its page is gone');
    if (problems.length) log(`agents: still doesn't run (${problems.join('; ').slice(0, 160)})`);
  }
  s.files = built.html;
  // Something new: it's grown into its full version in the next pass.
  const fresh = !page || reply.fresh || (r.title && r.title !== p.title && !sameCreation(page, built.html));
  if (fresh) {
    [w.grow, w.passes, w.tries, w.asked] = [true, 0, 0, text || w.asked];
    w.rules = { asked: text || w.asked, look };
  } else {
    [w.passes, w.tries] = [0, 0];
    w.rules = { asked: asks.asked, latest: asks.latest, look: asks.look };
  }
  const parts = reply.jobs.map(j => `${j.name} ${secs(j.startedAt)}→${secs(j.doneAt)} ${j.code.length}c${j.state === 'failed' ? ' FAILED' : ''}`);
  log(`ok   claude agents ${secs()} ${reply.jobs.length} helpers${parts.length ? ` (${parts.join(', ')})` : ''}, ${built.html.length} chars, turn ${s.turns}`);
  const edited = Boolean(page) && !reply.fresh && sameCreation(page, built.html);
  return { say: state.said || r.say, done: r.done, title: r.title, emoji: r.emoji, html: built.html, edited, look, backend: 'claude agents' };
}

// ---------------------------------------------------------------------------------------------
// After it appears: the lead looks at a screenshot of its creation running and makes it better (the
// app asks: POST /api/check). Its changes become a new version that slides in at a calm moment.

function running(report, shot) {
  const r = report || {};
  const slow = r.fps != null && r.fps < 30 ? '\nIf that feels slow, make each frame lighter - never by taking away what the look asked for.' : '';
  return `<how_it_is_running>\nRunning at ${r.fps ?? '?'} frames per second${r.canvas ? ` on a ${r.canvas} canvas` : ''}.${slow}\nErrors while running: ${r.errors?.length ? r.errors.slice(-5).join(' | ') : 'none'}\n</how_it_is_running>\n\n${
    shot ? 'A screenshot of it right now is attached - look at it first.' : 'There is no screenshot, so judge from the files.'
  }`;
}

// A screenshot (a data: URL from the app), as a picture in the lead's message.
function picture(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(dataUrl || '');
  return m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : null;
}

const madeByCrew = (p, version) => {
  let v = p.versions.find(x => x.n === version);
  for (let i = 0; v && /overwatch/.test(v.backend || '') && i < 50; i++) v = p.versions.find(x => x.n === v.from);
  return /^claude agents/.test(v?.backend || '');
};

export async function check({ projectId, version, report, screenshot }) {
  if (!on() || config().team.check === false) return { skipped: 'off' };
  let p = store.currentProject();
  if (p.id !== projectId || p.current !== version || isBusy() || !madeByCrew(p, version)) return { skipped: 'stale' };
  const w = workFor(projectId);
  if ((w.passes >= passes() && !w.grow) || w.tries >= passes() + 2) return { skipped: 'polished enough' };
  if (w.checking || w.repairing) return { skipped: 'busy' };
  const s = sessionFor(projectId);
  const page = store.html(p);
  const t0 = Date.now();
  const took = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const stale = () => {
    const now = store.currentProject();
    return now.id !== projectId || now.current !== version || isBusy();
  };
  w.checking = true;
  let before = null;
  const shot = picture(screenshot);
  try {
    const files = sync(s, page);
    const note = [w.note, files].filter(Boolean).join('\n\n');
    before = snapshot(s.dir);
    const rules = w.rules || { asked: w.asked || p.versions.filter(x => !x.continues).at(-1)?.request || '', look: p.versions.filter(x => x.look).at(-1)?.look || '' };
    const grow = w.grow;
    const prompt = [
      note ? `${historyNote(p.history)}\n\n${note}` : 'Here it is, running - the kid has been playing with it.',
      running(report, shot),
      grow ? GROW : LOOK,
      "Keep it the kid's creation: don't change what they chose, keep the controls and the KB.keep names.",
    ].filter(Boolean).join('\n\n');
    await s.use(lead().model);
    await s.think(lead().thinking.look);
    if (stale()) return { skipped: 'stale' };
    w.note = '';
    w.tries++;
    // (Its helpers write fuller parts while the kid plays.)
    const reply = await leadTurn(s, shot ? [{ type: 'text', text: prompt }, shot] : prompt, { about: () => rules, fit: FIT_PASS, quick: false, pageNow: page, timeoutSec: 600, stallSec: 150, kind: 'polish' });
    const why = field(reply.text, 'WHY', true) || 'made it better';
    const done = () => {
      w.passes++;
      if (grow) w.grow = false;
    };
    let built = assemble(s.dir);
    if (!built?.html || built.html === page) {
      if (!built?.html) {
        restore(s.dir, before);
        undone(s, w, 'page.html was gone');
      }
      done();
      log(`AGENTS ok   ${took()} (pass ${w.passes})`);
      return { ok: true };
    }
    // With its changes in, the page should still run as well as before.
    const was = (await syntaxErrors(page)).length;
    const worse = async b => {
      const probs = [...b.missing.map(n => `a \`// @part ${n}\` line has no file parts/${n}.js`), ...(await syntaxErrors(b.html))];
      return probs.length > was ? probs : null;
    };
    let probs = await worse(built);
    if (probs && !stale()) {
      await askLead(s, `With your changes in, the page doesn't run (page lines count the page with every part in place):\n${around(probs.slice(0, 3), built.html).join('\n')}\nFix just that, with FIX blocks.`, { timeoutSec: 180, stallSec: 90, kind: 'polish' }).catch(() => null);
      built = assemble(s.dir) || built;
      probs = await worse(built);
    }
    if (probs || stale()) {
      restore(s.dir, before);
      undone(s, w, probs ? "with them in, the page didn't run" : 'the page changed meanwhile');
      log(`AGENTS skip ${took()} ${why} (${probs ? "it didn't run" : 'stale'})`);
      return { skipped: probs ? "the change didn't run" : 'stale' };
    }
    p = store.addVersion(store.currentProject(), built.html, { request: `(agents polish) ${why}`, backend: 'claude agents polish', continues: true });
    s.files = built.html;
    w.lastPass = { version: p.current, grow, before };
    done();
    log(`AGENTS fix  ${took()} ${why} (pass ${w.passes}, ${reply.jobs.length} helpers) → v${p.current}`);
    return { fixed: true, verdict: 'fix', why, html: store.html(p), version: p.current };
  } catch (err) {
    // Stopped for the kid, or it failed: its half-done changes are taken out of the files.
    if (before) {
      restore(s.dir, before);
      undone(s, w, err.message === 'interrupted' ? 'the kid asked for something first' : 'that turn failed');
    }
    log(err.message === 'interrupted' ? `AGENTS stop ${took()} (the kid asked for something)` : `AGENTS fail ${took()} ${err.message.replace(/\s+/g, ' ').slice(0, 160)}`);
    return { skipped: err.message === 'interrupted' ? 'stale' : 'failed' };
  } finally {
    w.checking = false;
  }
}

// One of its passes crashed when the app tried it out of sight, so it was taken back (POST
// /api/drop-fix): its files go back to how they were, it's told why, and a lost grow happens again.
export function takenBack({ projectId, version, error }) {
  const w = workFor(projectId);
  if (w.lastPass?.version !== version) return;
  if (session?.projectId === projectId && w.lastPass.before) {
    restore(session.dir, w.lastPass.before);
    session.files = null; // (it's shown the files as they are again)
  }
  w.note = `Your last changes were taken back: with them in, it crashed when it was tried (${String(error || '').slice(0, 200)}). The files are as they were before them, as shown here.`;
  if (w.lastPass.grow) w.grow = true;
  w.passes = Math.max(0, w.passes - 1);
  w.lastPass = null;
}

// ---------------------------------------------------------------------------------------------
// Its new page crashed when the app tried it out of sight, before showing it: the lead repairs it
// (proposed, then taken only if it runs - like the other ways of building).

const proposals = new Map();

export async function repair({ version, errors, keep, accept = false }) {
  let p = store.currentProject();
  const v = p.versions.find(x => x.n === version);
  if (!on() || p.current !== version || v?.backend !== 'claude agents') return { skipped: 'stale' };
  const key = `${p.id}:${version}`;
  if (accept) {
    const prop = proposals.get(key);
    if (!prop || isBusy()) return { skipped: 'stale' };
    proposals.delete(key);
    const { n, at, ...meta } = v;
    p = store.addVersion(store.dropVersion(p, version), prop.html, meta);
    if (prop.by === session && prop.by?.alive) prop.by.files = prop.html;
    log(`AGENTS repair taken → v${p.current}`);
    return { version: p.current };
  }
  if (!errors) return { skipped: 'no errors' };
  const page = store.html(p);
  const w = workFor(p.id);
  const s = sessionFor(p.id);
  await settled(w);
  const note = sync(s, page);
  const before = snapshot(s.dir);
  w.repairing = true;
  await s.use(lead().model);
  try {
    await askLead(
      s,
      [
        note,
        keep
          ? `It crashes when it starts with the kid's saved progress (KB.keep hands it back these values):\n${JSON.stringify(keep).slice(0, 1500)}\nThe error:\n${String(errors).slice(0, 1500)}\nMake it carry on from those values instead, with FIX blocks, changing nothing else.`
          : `When it was tried, it crashed:\n${String(errors).slice(0, 2000)}\nFix just that, with FIX blocks.`,
      ].filter(Boolean).join('\n\n'),
      { priority: true, timeoutSec: 120, stallSec: 90, kind: 'repair' },
    );
    const built = assemble(s.dir);
    if (!built?.html || built.html === page || (await syntaxErrors(built.html)).length > (await syntaxErrors(page)).length) {
      if (built?.html !== page) {
        restore(s.dir, before);
        undone(s, w, "they didn't fix the crash");
      }
      return { skipped: 'no fix' };
    }
    // (Until it's taken, the files are ahead of the page: the next turn sees that and catches up.)
    proposals.set(key, { html: built.html, by: s });
    while (proposals.size > 5) proposals.delete(proposals.keys().next().value);
    log(`AGENTS repair ${String(errors).split('\n')[0].slice(0, 100)}`);
    return { html: built.html };
  } catch (err) {
    restore(s.dir, before);
    undone(s, w, err.message === 'interrupted' ? 'the kid asked for something first' : 'that repair failed');
    log(`AGENTS repair fail ${err.message.replace(/\s+/g, ' ').slice(0, 160)}`);
    return { skipped: 'failed' };
  } finally {
    w.repairing = false;
  }
}

// (For server/crew.test.mjs.)
export { JobReader, changesIn, fixed, applyReply, codeOf, tagOf, keepFields, looseEnds };
