// Team mode, the agent way: one lead Claude that keeps the creation in mind - a session that takes
// turn after turn, like solo mode - and hands the work to helpers: subagents (Claude Code's Agent
// tool) that write their parts at the same time. When they're done, the lead reads what they wrote
// and makes it all fit, so it's one creation that works.
//
// The creation lives in files in its own folder, which the lead and its helpers work on:
//   page.html        the page, with a `// @part <name>` line wherever a part's code goes
//   parts/<name>.js  each part, written by a helper (and fixed by the lead to fit)
//   rules.md         the rules every helper follows, and what the kid asked for (written here, so
//                    the lead's jobs stay short)
// After each turn the page is put together from them (each `// @part` line becomes its file).
//
// After a creation appears, while the kid plays, the lead looks at screenshots of it and grows and
// polishes it - with helpers for anything big - in the same session, so it knows what every part
// is for. The kid's changes go to it too. If the page changes outside its files (undone, fixed by
// the overwatch), it's handed the page as it is.
import fs from 'node:fs';
import path from 'node:path';
import { config, helperSpeed, fastIn, fastEver } from './config.mjs';
import * as store from './store.mjs';
import { buddyIntro, talkingRules, worldRules, buildingRules, pickLook, parseReply, field, log, isBusy, WORK_DIR } from './ai.mjs';
import { Session } from './solo.mjs';
import { leadBrain } from './bins.mjs';
import { syntaxErrors, blankProblems, speakFirst, warmVoice, polishPasses as teamPolish } from './team.mjs';
import * as agyAgents from './agy-agents.mjs';
import * as crew from './crew.mjs';

// The agent way is team mode with team.agents on (Claude only; solo mode comes first) - or, when
// Gemini (agy) leads, how it builds unless agy.way is "classic".
export function enabled() {
  const c = config();
  if (leadBrain() === 'agy') return agyAgents.enabled();
  return Boolean(c.team?.enabled && c.team?.agents) && !c.solo?.enabled && c.backends[0] === 'claude';
}

// Passes after something new or a change: growing it, then looking again (team.polish more).
export const passes = () => (leadBrain() === 'agy' ? agyAgents.passes() : 1 + teamPolish());

// The Agent tool takes a model alias only (no full model names).
const ALIASES = ['sonnet', 'opus', 'haiku', 'fable'];
function helperAlias(want) {
  const v = String(want || 'sonnet').toLowerCase();
  return ALIASES.find(a => v.includes(a)) || 'sonnet';
}

// The model the subagents of a lead (or of the polisher) are started with in a phase, given that
// one's own fast setting: Opus in place of Sonnet where they're to be fast and it is (see lead()).
function helperModelWith(fast, phase) {
  const c = config();
  const helper = helperAlias(c.team?.agentHelper?.model);
  const speed = helperSpeed(c.team?.agentHelper, helper, phase);
  return fastIn(fast, phase) && speed.fast ? helperAlias(speed.model) : helper;
}

// The polisher (team.agentPolisher.enabled): a second agent that grows and polishes the creation
// while the kid plays - what the lead otherwise does itself, in its own conversation. It's a
// program of its own that remembers the creation too (one session per creation, like the lead's),
// working on the same files, with a model, an effort and a speed of its own: nobody waits for it,
// so it can be a slower, more careful model, and it never has to be fast because the lead is. The
// lead's conversation then holds only what the kid waited for - at one speed, so nothing is read
// again at another's prices. Each is told what the other did: the polisher everything the lead was
// (what the kid said, what Sparky answered, the jobs the lead handed out, its own words, the files
// it changed), the lead which files the polisher changed and why.
// model, effort: its own, or else the lead's. fast: its own, or else the main agent's switch for
// the polishing (claude.fast's play). thinking: how long it may think when it looks it over.
export function polisher() {
  const c = config();
  const r = c.team?.agentPolisher || {};
  const main = lead();
  const fast = r.fast ?? c.claude.fast;
  return {
    on: Boolean(r.enabled),
    model: r.model || main.model,
    effort: r.effort || main.effort,
    fast: fastIn(fast, 'play'),
    args: Array.isArray(r.args) ? r.args.map(String) : [],
    thinking: Number(r.thinking) || main.thinking.look,
    helperModel: main.helperModel, // (the one its instructions name)
    helperModelNow: helperModelWith(fast, 'play'), // (and the one its turns are told to use instead, when it's another)
  };
}

export function lead() {
  const c = config();
  const r = c.team?.agentLead || {};
  const model = r.model || c.claude.model || '';
  // Fast mode, phase by phase (what the kid is doing meanwhile: config.mjs): the lead's own setting,
  // or the main agent's.
  const fast = r.fast ?? c.claude.fast;
  // Its helpers are Claude Code subagents, which have no speed of their own: they run in the lead's
  // session and take its fast mode, wherever their model can run it (Opus or Fable). So they can
  // only be fast (claude.fastHelpers) in a phase where the lead is - then they write with the model
  // helperSpeed gives them, Opus in place of Sonnet. With the lead at normal speed they stay as they
  // are: Opus at its usual speed would write slower than Sonnet. (Direct helpers - crew.mjs - are
  // programs of their own, so their speed is set apart from the lead's.)
  const helper = helperAlias(c.team?.agentHelper?.model);
  const helperModelIn = phase => helperModelWith(fast, phase);
  return {
    model,
    effort: r.effort || c.claude.effort || '',
    fast,
    fastIn: phase => fastIn(fast, phase),
    args: Array.isArray(r.args) ? r.args.map(String) : [],
    helperModel: helper, // (the one its instructions name)
    helperModelIn, // (and the one a phase's turns are told to use instead, when it's another)
    // firstModel: who leads the turn that makes something new while the kid waits (the main model
    // takes over for everything else - its passes, the kid's changes, repairs). Only with a main
    // model set: without one there'd be nothing to switch back to.
    firstModel: model ? r.firstModel || '' : '',
    thinking: { build: 1500, look: 10000, ...(r.thinking || {}) },
  };
}

// ---------------------------------------------------------------------------------------------
// What it's told

function leadSystem() {
  const helperModel = lead().helperModel;
  return `${buddyIntro()}

# Reply format
TITLE: <one emoji> <2-4 word name>   (only when you start something new or it changes a lot)
Then do the work with your tools (below), and end your reply with:
DONE: <1-2 short sentences said when it appears: how to play with it. You may end with an open question like "What's next?" - never with a suggestion>
Someone else has already answered the kid out loud, so don't write SAY - unless there is nothing to build (you didn't understand, or they asked you something): then write only SAY: <what to say> and change no files.

# You lead a building team - and the creation lives in files
Your working folder holds the creation: page.html is the page, with a line \`// @part <name>\` wherever a part's code goes, and parts/<name>.js holds each part. Build Buddy puts them together (each \`// @part\` line becomes that part's file) and shows it the moment your reply ends. rules.md holds the rules every helper follows and what the kid asked for - Build Buddy writes it, so never change it. If your helpers need to know something about the whole creation (the coordinates, how the parts talk to each other), say it in a short comment in page.html's shared code: they read it there.

Your helpers are subagents (the Agent tool, subagent_type "general-purpose", model "${helperModel}"). They write at the same time as each other, so the kid gets it much sooner - but only if you hand the work out: every part file is written by a helper, never by you. Your own writing is page.html, the jobs, and the fixes that make the parts fit. You are the one who knows the whole creation, so you make it one thing that works.

## Something new - start writing straight away, all in your FIRST message, so it all runs at once
1. Write page.html (the Write tool) - about 40-60 lines: \`<!doctype html>\`, a style that fills the window with no scrollbars, and one \`<script type="module">\` holding, in order:
   - the shared code: every import any part needs, the palette and sizes, the shared state - the world's rules as a few plain numbers that one place updates every frame - the shared input object, and \`const keep = KB.keep({ ... })\` with every field the kid would miss when the page changes;
   - a \`// @part <name>\` line for each part, in the order they must load;
   - MAIN: it makes the page's elements, creates everything by calling the parts exactly as their jobs say, runs the one animation loop (dt and t in seconds, dt at most 0.05) and turns the arrow keys, taps and drags into the shared input object.
2. In the same message, an Agent call for every part, biggest first (the slowest helper starts first): 4 to 6 small parts, similar in size, about 25-40 lines each (for example: the rules, the place, the star, the other characters, the effects and sounds) - the kid waits for the slowest one, so split anything big (the star, a track, a whole scene) into two parts. Each job is short - the helper reads rules.md and page.html itself:
   "Read rules.md and page.html, then write parts/<name>.js defining exactly: <the code it defines, like drawSky(ctx, t) or makeFrog(scene) → { update(dt, t), hitTest(x, y) }>. <In under 40 words: how it looks, sounds and feels, what it does when poked, and the shared names and keep fields it reads or changes.>"
   Ask each helper for no more than fits in about 30 lines - at most three things it does. Extras come when you grow it, after the kid sees it.
3. When the helpers are done, Read every part (all the Reads in one message) and make it one creation that works: fix any name or call that doesn't match, anything missing or that would crash, anything that doesn't fit the plan or the look - with the Edit tool, in the part or in page.html. Then end with DONE.

## A change to what's there
The files are there from before - unless you're told the page changed, Read only what you need. A small change: make it yourself with the Edit tool. Several separate things, or something big: hand them out - each helper owns different files (a new part, which you add a \`// @part\` line for, or a part it rewrites), never two on the same file - then Read what they wrote, make it fit, and end with DONE. Keep the KB.keep names and what they mean, so the kid carries on where they were. Anything new the kid can make progress in gets its default in page.html's \`KB.keep({ ... })\` - only those fields carry over, and only you can add them, since helpers write only their own part - and its job names that keep field.

${
  polisher().on
    ? `## Between your turns, while the kid plays
Another agent on your team, the polisher, grows the creation into its full version and looks it over, in these same files - never while you work. Before your next turn you're told which files it changed and why: Read those before you change them, and build on what it added - it's part of the kid's creation now, so never take it out unless the kid asks.`
    : `## Later, while the kid plays
You'll be shown how it's running (a screenshot, the frame rate, any errors) and asked to grow it or look it over. Work the same way: hand out anything big, each helper on its own files, then make it fit. Never rewrite what works just to tidy it. New progress gets its keep field in page.html, as above.`
}

${talkingRules()}

${worldRules()}

${buildingRules()}`;
}

// What the polisher is told (team.agentPolisher): the same files and helpers as the lead, its own job.
function polisherSystem() {
  const c = config();
  const r = polisher();
  return `You are the polisher on ${c.buddyName}'s building team. ${c.buddyName} is a cheerful robot building buddy for a ${c.kidAge}-year-old${c.kidName ? ` named ${c.kidName}` : ''}: the kid says out loud what they want, and the team builds it on a big full-screen web page as a little world that works. The lead builds what the kid asks for while the kid waits - quickly, so it's the heart of it. You come in right after, while the kid plays with it: you grow it into its full version and look it over, again and again, so that what they play with keeps getting better. Nobody waits for you, so take the care it needs.

You never talk to the kid, and you don't decide what the creation is: the kid does, and the lead builds what they say. Their words come through speech-to-text and are sometimes misheard ("a rice car" is probably "a race car") - go by the most likely meaning, and by what the lead made of it.

# What you're told
Every time, you're told everything that happened since your last turn, in order: what the kid said, what ${c.buddyName} answered out loud, the jobs the lead handed to its helpers, the lead's own words, and the files it changed. That's what the creation is for and why it is the way it is - read it before you look at anything. Then how it's running now (a screenshot, the frame rate, any errors), and what to do this time.

# The creation lives in files, which you share with the lead
Your working folder holds the creation: page.html is the page, with a line \`// @part <name>\` wherever a part's code goes, and parts/<name>.js holds each part. Build Buddy puts them together (each \`// @part\` line becomes that part's file) and slides your version in at a calm moment, keeping the kid's progress. rules.md holds the rules every helper follows and what the kid asked for - Build Buddy writes it, so never change it. The lead works in these same files, never at the same time as you: when the kid asks for something, your turn is stopped and what you had changed so far is taken out - so finish one thing well rather than start five.

Your helpers are subagents (the Agent tool, subagent_type "general-purpose", model "${r.helperModel}"). They write at the same time as each other: hand out anything big, each helper on its own file (a new part, which you add a \`// @part\` line and a call in MAIN for, or a part it extends), never two on the same file. Each job is short - the helper reads rules.md and page.html itself:
   "Read rules.md and page.html, then write parts/<name>.js defining exactly: <the code it defines>. <In under 40 words: how it looks, sounds and feels, what it does when poked, and the shared names and keep fields it reads or changes.>"
Then Read what they wrote and make it fit. Small fixes you make yourself with the Edit tool. If your helpers need to know something about the whole creation, say it in a short comment in page.html's shared code: they read it there.

# How you work
- Keep it the kid's creation: never change what they chose, never take out what the lead built for them. Keep the controls, and the KB.keep names and what they mean, so the kid carries on where they were. Anything new the kid can make progress in gets its default in page.html's \`KB.keep({ ... })\` - only those fields carry over.
- Never rewrite what works just to tidy it: the lead knows the files as it left them, and is told only what you changed.
- When you changed something, end your reply with these two lines:
WHY: <what you improved, in one short sentence for the grown-ups' log>
LEAD: <for the lead, who builds the kid's next request in these files: what is new or works differently now - new parts, new shared names and keep fields, anything it would trip over - in one or two short sentences>

${worldRules()}

${buildingRules()}`;
}

// What every helper follows (the lead's jobs point to it).
// quick: the kid is waiting for this (something new or a change) - small parts; otherwise (the
// passes while the kid plays) fuller ones.
function helperRules({ asked, latest = '', look, freshLook = '', quick = true }) {
  return `# How to write your part

You are a helper on a small team building a web page for a ${config().kidAge}-year-old, from what the kid said out loud. The team lead wrote page.html: the shared code at the top, a \`// @part <name>\` line where each part goes, and MAIN at the bottom, which calls your part exactly as your job says. The comments in the shared code tell you how the parts fit together (the coordinates, how they talk to each other) - follow them. Other helpers write the other parts at the same time.

- Read rules.md and page.html together (both Reads at once), then write only the file your job names, with the Write tool (or Edit, if your job is to change a part that's there)${quick ? " - in one go: the lead checks every part afterwards, so don't polish it with more edits" : ''}. Then reply with one short line: what you defined.
- Define exactly what your job says (the same names and parameters, returning the same things): MAIN depends on it. Use the shared code's names as they are.
- Only define things at the top level: nothing runs until MAIN calls your part. No imports and no <script> tags (the shared code has every import). Extra top-level names you add start with your part's name and an underscore, so they can't clash. Whatever your piece needs before its first frame happens in the function MAIN calls first.
- Time is in seconds: use dt and t exactly as passed (never divide them by 1000). Read the arrow keys and the pointer from the shared input object, unless your job says otherwise.
- The world's rules belong to the lead's plan: read and change the shared numbers your job names, never a copy of your own, and add no rules your job doesn't ask for.
- No words on the page - pictures instead. Draw everything in the look, so it's all one picture - shapes, not emoji.
${quick ? '- About 25-40 short lines, never more than 2,500 characters - a hard limit: the kid is waiting for the slowest helper. Write the heart of your part well and leave the extras out; the lead grows the creation after it appears.' : '- About 30-60 short lines: the kid is playing with it, not waiting, so make your part rich and complete - what it does when poked, how it reacts to what happens, the little things to find.'} Smooth: no shadowBlur or CSS/SVG filters, at most about 40 moving things; in 3D, no new lights unless your job says so, reuse geometries and materials, InstancedMesh for many copies.
- What the kid would miss when the page changes lives in the fields of page.html's \`KB.keep({ ... })\` (only those carry over): put it back from there when your piece starts, and update it as it changes. Use the keep fields your job names; never call KB.keep yourself.
- If your piece is the star, make it easy to recognize at a glance, with a face, big enough to see - in proportion with its world. If it's the place, make it full and unmistakable: a few kinds of things, each made in a loop with varied sizes, colors and spots.
- Whatever the kid can touch or steer in your piece answers every time - a bounce, a sound, a burst - and moves the way the arrow points on the screen.

${worldRules()}

${buildingRules()}

# This creation
${asked ? `The kid asked for: "${asked}"` : ''}${latest ? `\nThen they said: "${latest}"` : ''}${look ? `\nThe look: ${look}.` : ''}${freshLook ? `\n(If the lead is making a fresh new page instead, its look is: ${freshLook}.)` : ''}
`;
}

// Growing it into its full version, while the kid plays (the first pass after something new).
const GROW = `Now grow it into its full, excellent version - about twice as much as there is now. Hand the additions out to helpers, all at the same time - each owns its own file (a new part, which you add a \`// @part\` line and a call in MAIN for, or a part it extends) - then Read what they wrote and make it fit:
- First fix anything you can see isn't working or showing yet, and make every word of what the kid said, and of the look, unmistakably there - the center of it, not a detail.
- Then add what it still lacks to be a world that works and a delight: everything a kid pictures for it (a farm has animals to feed), more of its place near and far (made in loops) with things moving on their own, the star and everyone in it reacting to the kid and to what happens, a big happy moment for each thing the kid sets going, one more thing a poke sets off (the full pond spills over its edge), something new that what the kid does adds up to, and things to discover until it has one or two, each with a spark of joy, from exactly what the kid said. In a game, a reward every time and a goal that grows (after a few, something new appears).
- Give it one big idea of its own, built from exactly what the kid said - a rule, a place with a story, or a character with a name and a wish that makes it unlike any other version - not a big new thing they didn't ask for.
- Every arrow key, a tap anywhere and a drag each get an answer the kid sees, and a finger can do all the arrow keys do.
- Keep it smooth (nothing made every frame, a costly look drawn the cheap way) and everything in the look.
End your reply with WHY: <what you improved, in one short sentence for the grown-ups' log>.`;

// Looking it over again, as a demanding parent would (the passes after that).
const LOOK = `Test it the way a demanding parent who designs kids' simulations and games would, before they play it with their kid - in the files and in the screenshot:
1. Every control: follow each arrow key, a tap anywhere and a drag from its handler to what moves on screen. Does each one do something the kid sees right away, and does left go left? Can a finger alone do all the arrow keys do, and is the main thing to poke easy to spot?
2. Every cause and effect: trace what each poke on the main things, each collision and each timer sets off - would it really fire (both things exist, are in range, and have what the check needs) and show on screen, not hidden behind something? Left alone, does it keep going? Then play it in your head for a few minutes, tapping fast, then doing nothing: can anything get stuck, pile up or never stop? In a game, can the goal be reached, again and again?
3. In 3D, also: the camera shows the star's face, not its back; everything faces the way it moves; nothing drives or flies through solid things; sky and clouds are where the camera sees them.
4. Score it 1 to 10 the way that parent would, on: what they asked for (all of it, in the look, in plain view from the first second), a world that works, delight (charming and polished, a full scene, everyone in it reacting, big happy moments), easy for a 5-year-old, solid (no bugs, glitches, or anything stuck, piling up, hidden or cut off), and its own.
Write the scores under NOTES:, and for each below 9, what keeps it there. Then fix as much of it as you can do well - small fixes yourself with Edit, anything bigger handed to helpers at the same time, each on its own file - and Read what they wrote to make it fit. End with WHY: <what you fixed, in one short sentence for the grown-ups' log>. Only if everything is a 9 or 10 and you changed nothing, reply with just: OK`;

// ---------------------------------------------------------------------------------------------
// The folder

// (Worked out when needed: ai.mjs, which sets WORK_DIR, loads this module first.)
const folderOf = projectId => path.join(WORK_DIR, 'agents', String(projectId).replace(/[^\w-]/g, '') || 'creation');

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

// An empty folder for the page and its parts (rules.md is written each turn).
function clear(dir) {
  fs.rmSync(path.join(dir, 'page.html'), { force: true });
  fs.rmSync(path.join(dir, 'parts'), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'parts'), { recursive: true });
}

// Before a turn: the files hold the creation as it is now. How they stand for the one about to work
// on them (the lead, or the polisher - each knows the page as it last worked on it):
//   ''         as it left them (or the screen is blank)
//   'inside'   they changed in the folder since: its teammate worked on them (or it's new to them)
//   'outside'  the page changed outside its files (undone, fixed by the overwatch, another way of
//              building): page.html now holds the whole page, with no parts - also what a teammate
//              finds after the other was handed the page that way
function syncState(s, page) {
  const dir = s.dir;
  const now = assemble(dir)?.html;
  if (!page) {
    if (now) clear(dir);
    s.files = '';
    return '';
  }
  if (now === page && s.files === page) return ''; // as it left them
  if (now !== page) {
    clear(dir);
    fs.writeFileSync(path.join(dir, 'page.html'), page);
  }
  s.files = page;
  const parts = path.join(dir, 'parts');
  return now === page && fs.existsSync(parts) && fs.readdirSync(parts).length ? 'inside' : 'outside';
}

const INSIDE = 'Your folder holds the creation as it is: page.html and its parts in parts/ (Read what you need before you change it).';
const OUTSIDE = 'The page changed since you last worked on it (or you are new to it): page.html now holds the whole page as it is, with no parts - Read it before you change it. When you hand out work, a helper can take over a piece of it as a new part.';

// ... and what it's told about them (inside: what's said when a teammate changed them).
function sync(s, page, inside = INSIDE) {
  const state = syncState(s, page);
  return state === 'inside' ? inside : state === 'outside' ? OUTSIDE : '';
}

// ---------------------------------------------------------------------------------------------
// The lead and the polisher tell each other what they did (team.agentPolisher): the polisher is
// told everything the lead was and did, the lead which files the polisher changed and why.

// What changed in the creation's files between two snapshots, file by file.
export function fileChanges(before, after) {
  const lines = text => text.replace(/\n$/, '').split('\n');
  const changes = [];
  for (const file of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const [was, now] = [before[file], after[file]];
    if (was === now) continue;
    if (was == null) changes.push({ file, kind: 'new', now: lines(now).length });
    else if (now == null) changes.push({ file, kind: 'removed', was: lines(was).length });
    else {
      const [old, fresh] = [new Set(lines(was)), new Set(lines(now))];
      const keep = list => list.map(l => l.trim()).filter(Boolean).map(l => l.slice(0, 160));
      changes.push({ file, kind: 'changed', was: lines(was).length, now: lines(now).length, added: keep(lines(now).filter(l => !old.has(l))), removed: keep(lines(was).filter(l => !fresh.has(l))) });
    }
  }
  return changes;
}

// ... in a line: "parts/truck.js changed (38 → 52 lines); parts/fire.js new (41 lines)".
export const changesSaid = changes =>
  changes.map(c => (c.kind === 'new' ? `${c.file} new (${c.now} lines)` : c.kind === 'removed' ? `${c.file} removed` : `${c.file} changed (${c.was} → ${c.now} lines)`)).join('; ');

// ... and the lines themselves, for the files that were changed: a few of what's new in each (and
// of what's gone), enough to see what the change was without reading the file again.
function changedLines(changes, files = 6, each = 10) {
  return changes
    .filter(c => c.kind === 'changed' && (c.added.length || c.removed.length))
    .slice(0, files)
    .map(c => [`${c.file}:`, ...c.added.slice(0, each).map(l => `  + ${l}`), ...(c.added.length > each ? [`  + (${c.added.length - each} more)`] : []), ...c.removed.slice(0, 4).map(l => `  - ${l}`), ...(c.removed.length > 4 ? [`  - (${c.removed.length - 4} more)`] : [])].join('\n'))
    .join('\n');
}

// The jobs a lead hands out in a turn - each helper's job, in the lead's own words: what every
// part is for.
function jobsHeard() {
  const jobs = new Map();
  return {
    onEvent(ev) {
      if (ev.parent_tool_use_id || ev.type !== 'assistant') return;
      for (const c of ev.message?.content || []) {
        if (c.type !== 'tool_use' || !/^(Agent|Task)$/.test(c.name) || jobs.has(c.id)) continue;
        jobs.set(c.id, { what: String(c.input?.description || 'a part').slice(0, 80), job: String(c.input?.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 600) });
      }
    },
    get jobs() {
      return [...jobs.values()];
    },
  };
}

// Something the lead did, kept for the polisher (the last STORY_KEPT of them): { kind, kid, alt,
// fix, said, lead, jobs, changes, secs }.
const STORY_KEPT = 30;
function tellPolisher(w, entry) {
  if (!polisher().on) return;
  w.story.push({ n: ++w.storyN, ...entry });
  if (w.story.length > STORY_KEPT) w.story.shift();
}

// What the polisher hasn't been told yet, as it's told it: { text, upTo }.
const clip = (text, max) => (String(text).length > max ? `${String(text).slice(0, max)} ...` : String(text));
export function storySaid(story, told = 0) {
  const c = config();
  const fresh = story.filter(e => e.n > told).slice(-8);
  if (!fresh.length) return { text: '', upTo: told };
  const one = (e, i) =>
    [
      `${i + 1}. ${e.kind === 'fix' ? `The page crashed when it was tried (${clip(String(e.fix || '').split('\n')[0], 200)}): the lead fixed it.` : `The kid said: "${e.kid}"`}`,
      e.kind !== 'fix' && e.alt && `(The other listener heard: "${e.alt}".)`,
      e.said && `${c.buddyName} answered out loud: "${e.said}"`,
      e.kind === 'talk' ? 'The lead only answered - it changed nothing.' : e.kind === 'new' ? `The lead built it as something new${e.secs ? ` (${e.secs} s)` : ''}.` : e.kind === 'change' ? `The lead changed what was there${e.secs ? ` (${e.secs} s)` : ''}.` : '',
      e.jobs?.length && `The jobs it handed to its helpers:\n${e.jobs.map(j => `  - ${j.what}: ${j.job}`).join('\n')}`,
      e.lead && `The lead's own words:\n${clip(e.lead.trim(), 1200)}`,
      e.changes?.length && `Files: ${changesSaid(e.changes)}`,
      e.changes?.length && changedLines(e.changes),
    ]
      .filter(Boolean)
      .join('\n');
  return { text: `<since_your_last_turn>\n${fresh.map(one).join('\n\n')}\n</since_your_last_turn>`, upTo: fresh.at(-1).n };
}

// What the polisher did since the lead's last turn, as the lead is told it ('' when nothing).
export function reportSaid(reports) {
  if (!reports.length) return '';
  const one = r => `- ${r.files || 'the files'}${r.why ? ` - ${r.why}` : ''}${r.lead ? ` What you should know: ${r.lead}` : ''}`;
  return `While the kid played, the polisher changed your files (they hold the creation as it is now):\n${reports.map(one).join('\n')}\nRead the files it changed before you change them, and build on what it added.`;
}

// ---------------------------------------------------------------------------------------------
// The session (one per creation; solo mode's, with its own tools and folder)

const MAX_TURNS = 24;
let session = null;

function sessionArgs() {
  const r = lead();
  const args = ['-p', '--safe-mode', '--tools', 'Agent,Read,Write,Edit', '--permission-mode', 'acceptEdits', '--permission-prompts', 'none', '--strict-mcp-config', '--no-session-persistence', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--system-prompt', leadSystem()];
  if (r.model) args.push('--model', r.model);
  if (r.effort) args.push('--effort', r.effort);
  // (Started in fast mode if any phase is to be fast: each turn then runs at its own phase's speed.)
  if (fastEver(r.fast)) args.push('--settings', JSON.stringify({ fastMode: true }));
  args.push(...r.args);
  return args;
}

// A phase whose helpers are to be fast: its turns say which model to start them with.
function helperNote(phase) {
  const r = lead();
  const model = r.helperModelIn(phase);
  return model === r.helperModel ? '' : `(For this turn, start your helpers with model "${model}" in place of "${r.helperModel}".)`;
}

function sessionFor(projectId, { renew = false } = {}) {
  const s = session;
  const usable = s?.alive && s.projectId === projectId;
  if (usable && (s.kidWaiting || !renew || (s.turns < MAX_TURNS && s.key === JSON.stringify(sessionArgs())))) return s;
  s?.end();
  const dir = folderOf(projectId);
  fs.mkdirSync(path.join(dir, 'parts'), { recursive: true });
  // (Helpers always work in the foreground: the lead's turn ends only once they're done.)
  session = new Session(projectId, { args: sessionArgs(), cwd: dir, label: 'agents', model: lead().model, env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }, fastFor: phase => lead().fastIn(phase), turnNote: helperNote, helperModel: phase => lead().helperModelIn(phase) });
  session.dir = dir;
  session.files = null; // the page its files held when it last worked on them (null: never)
  return session;
}

// The polisher's session (team.agentPolisher): one per creation too, in the same folder. A new one
// is started for another creation, when the old one ended or has had MAX_TURNS turns, or when it
// was started with other settings - never under a pass (check() runs one at a time). A new one is
// told the whole story again.
let polishSession = null;

function polisherArgs() {
  const r = polisher();
  const args = ['-p', '--safe-mode', '--tools', 'Agent,Read,Write,Edit', '--permission-mode', 'acceptEdits', '--permission-prompts', 'none', '--strict-mcp-config', '--no-session-persistence', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--system-prompt', polisherSystem()];
  if (r.model) args.push('--model', r.model);
  if (r.effort) args.push('--effort', r.effort);
  if (r.fast) args.push('--settings', JSON.stringify({ fastMode: true }));
  args.push(...r.args);
  return args;
}

function polisherFor(projectId) {
  const s = polishSession;
  const args = polisherArgs();
  if (s?.alive && s.projectId === projectId && s.turns < MAX_TURNS && s.key === JSON.stringify(args)) return s;
  s?.end();
  const dir = folderOf(projectId);
  fs.mkdirSync(path.join(dir, 'parts'), { recursive: true });
  const helperNote = () => (polisher().helperModelNow === polisher().helperModel ? '' : `(For this turn, start your helpers with model "${polisher().helperModelNow}" in place of "${polisher().helperModel}".)`);
  polishSession = new Session(projectId, { args, cwd: dir, label: 'polisher', model: polisher().model, env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }, fastFor: () => polisher().fast, turnNote: helperNote, helperModel: () => polisher().helperModelNow });
  polishSession.dir = dir;
  polishSession.files = null; // the page its files held when it last worked on them (null: never)
  polishSession.told = 0; // how much of the lead's story it has been told (the last entry's number)
  return polishSession;
}

function endPolisher() {
  polishSession?.end();
  polishSession = null;
}

// What's still to do for a creation (kept apart from the session, so a new one carries on).
// With a polisher: story is what the lead did, for the polisher to be told; reports is what the
// polisher changed since the lead's last turn, for the lead; polishNote is what the polisher is
// told about its own changes being taken out (note: the lead's).
let work = { projectId: null };
function workFor(projectId) {
  if (work.projectId !== projectId) work = { projectId, grow: false, passes: 0, tries: 0, lastPass: null, note: '', polishNote: '', story: [], storyN: 0, reports: [], checking: false, repairing: false, asked: '', rules: null };
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
  w[s === polishSession ? 'polishNote' : 'note'] = `Your last changes were taken out (${why}): the files are back to how they were before them - Read what you need.`;
}

// What the kid says comes first: a pass at work stops, and any waiting are dropped - the lead's
// own, and the polisher's on this creation.
function makeWay(s) {
  for (const one of [s, polishSession?.projectId === s.projectId ? polishSession : null]) {
    if (!one) continue;
    if (one.current?.kind === 'polish' || one.current?.kind === 'repair') one.interrupt();
    for (const t of one.queue.filter(t => t.kind === 'polish' || t.kind === 'repair')) {
      one.queue.splice(one.queue.indexOf(t), 1);
      t.finish(new Error('stale'));
    }
  }
}

export function warm() {
  if (leadBrain() === 'agy') return agyAgents.warm();
  if (crew.on()) return crew.warm(); // (its helpers are Build Buddy's own programs: crew.mjs)
  if (!enabled()) return { warm: 0 };
  const before = session;
  try {
    const s = sessionFor(store.currentProject().id, { renew: true });
    return { warm: (s === before ? 0 : 1) + (config().team?.warm === false ? 0 : warmVoice()) };
  } catch {
    return { warm: 0 };
  }
}

export function stop() {
  agyAgents.stop();
  crew.stop();
  session?.end();
  session = null;
  endPolisher();
}

// The agent way stays on after the settings were saved: the lead of the way its helpers aren't run
// any more (subagents here, or direct helpers - crew.mjs) stops, with any pass of its own at work. The
// next request starts the other way's lead, which is handed the creation as it is. (Nothing to stop,
// when the way wasn't changed.)
// (And a polisher that was switched off, or whose way isn't run any more, stops - unless it's in
// the middle of a pass, which ends it itself.)
export function stopOther() {
  if (crew.on()) {
    session?.end();
    session = null;
  } else crew.stop();
  if ((crew.on() || !polisher().on) && !work.checking) endPolisher();
}

// Was this version made by the agent way (itself, or an overwatch fix on top of one of its versions)?
export function madeByAgents(p, version) {
  let v = p.versions.find(x => x.n === version);
  for (let i = 0; v && /overwatch/.test(v.backend || '') && i < 50; i++) v = p.versions.find(x => x.n === v.from);
  return /^(claude|agy) agents/.test(v?.backend || '');
}

// The lead's helpers at work, for the app's little robots: Agent calls started and finished.
function helperTracker(onChange) {
  const helpers = new Map(); // id → done
  const seen = new Map(); // id → when it was last heard from
  const what = new Map(); // id → its job, in a few words
  return {
    helpers,
    onEvent(ev) {
      if (ev.parent_tool_use_id) {
        if (seen.has(ev.parent_tool_use_id)) seen.set(ev.parent_tool_use_id, Date.now());
        return;
      }
      if (ev.type === 'assistant') {
        for (const c of ev.message?.content || []) {
          if (c.type !== 'tool_use' || !/^(Agent|Task)$/.test(c.name) || helpers.has(c.id)) continue;
          helpers.set(c.id, false);
          seen.set(c.id, Date.now());
          what.set(c.id, String(c.input?.description || 'a part').slice(0, 80));
          onChange();
        }
      } else if (ev.type === 'user') {
        for (const c of ev.message?.content || []) if (c.type === 'tool_result' && helpers.get(c.tool_use_id) === false) helpers.set(c.tool_use_id, true), onChange();
      }
    },
    get done() {
      return [...helpers.values()].filter(Boolean).length;
    },
    // A helper still at work that hasn't been heard from in that long (its job), if any.
    stuck(ms) {
      for (const [id, done] of helpers) if (!done && Date.now() - seen.get(id) > ms) return what.get(id);
      return null;
    },
    // Every helper still at work (their jobs), then counted as done: stopping the lead's turn stops
    // them all.
    stopAll() {
      const jobs = [...helpers].filter(([, done]) => !done).map(([id]) => what.get(id));
      for (const [id, done] of helpers) if (!done) helpers.set(id, true);
      onChange();
      return jobs;
    },
  };
}

// A helper silent this long is stuck (they usually finish in well under a minute).
const HELPER_STALL_MS = 90000;

// For a session that's new to the creation: what the kid asked for lately.
function historyNote(history, last = config().historyTurns * 2) {
  const c = config();
  const lines = (history || []).slice(-last).map(h => `${h.role === 'kid' ? 'Kid' : c.buddyName}: ${h.text}`);
  return lines.length ? `<conversation_so_far>\n${lines.join('\n')}\n</conversation_so_far>` : '';
}

// The names in a page's KB.keep({ ... }) (what the kid's progress is kept in).
function keepNames(html) {
  const body = /KB\.keep\(\s*\{([\s\S]*?)\}\s*\)/.exec(html || '')?.[1] || '';
  return new Set([...body.matchAll(/(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*:/g)].map(m => m[1]));
}

// A change to the same creation (it kept most of the kid's progress fields), even if the lead gave
// it a new name: the kid carries on where they were.
function sameCreation(before, after) {
  const was = keepNames(before);
  if (!was.size) return false;
  const now = keepNames(after);
  return [...was].filter(k => now.has(k)).length * 2 >= was.size;
}

// Does the page run? Problems found before it's shown go back to the lead once.
async function problemsIn(built) {
  if (!built?.html) return ['there is no page.html'];
  return [...built.missing.map(n => `a \`// @part ${n}\` line has no file parts/${n}.js`), ...(await syntaxErrors(built.html)), ...blankProblems(built.html)];
}

// ---------------------------------------------------------------------------------------------
// One build. Resolves like the classic way: { say, done, title, emoji, html, edited, backend }.
// Throws if it couldn't (the classic way takes over).

// The app's answer to a 'peek' event (POST /api/peeked): how a page not shown yet looks and runs.
export const peeked = answer => crew.peeked(answer);

export async function build({ page, history, text, alt, fix, title = '', look = pickLook(), last = false, peeks = false }, emit, state) {
  if (leadBrain() === 'agy') return agyAgents.build({ page, history, text, alt, fix, title, look, last }, emit, state);
  if (crew.on()) return crew.build({ page, history, text, alt, fix, title, look, peeks }, emit, state);
  const t0 = Date.now();
  const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
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

  // (What the polisher changed since its last turn: it's told, and still knows the rest.)
  const report = reportSaid(w.reports);
  const polished = Boolean(report) && assemble(s.dir)?.html === page;
  const known = s.turns > 0 && Boolean(page) && (s.files === page || polished);
  const note = [sync(s, page, report || INSIDE), w.note].filter(Boolean).join(' ');
  [w.note, w.reports] = ['', []];
  const filesBefore = snapshot(s.dir);
  const jobs = jobsHeard(); // (what it hands out, for the polisher to be told)
  const creationLook = page ? p.versions.filter(x => x.look).at(-1)?.look || look : look;
  // What the creation was asked for (kept across turns; the first request after a restart).
  const first = page ? w.asked || p.versions.filter(x => !x.continues).at(-1)?.request || '' : text;
  const rules = path.join(s.dir, 'rules.md');
  // (Kept for its passes only once the page changes: a turn that only talked leaves them as they were.)
  const asks = !fix || !fs.existsSync(rules) ? { asked: first, latest: page && !fix && text !== first ? text : '', look: creationLook, freshLook: page && !fix && look !== creationLook ? look : '' } : null;
  if (asks) fs.writeFileSync(rules, helperRules(asks));

  let chars = 0;
  let heard = ''; // the lead's own words this build (an interrupted turn's TITLE line among them)
  const team = helperTracker(() => progress());
  const progress = () => emit({ type: 'progress', chars, helpers: team.helpers.size, helpersDone: team.done, team: true, leads: 1 });
  progress();
  const prompt = [
    page ? note || (known ? '' : 'Your folder holds the creation as it is.') : 'The screen is blank - nothing has been built yet: your folder is empty.',
    !fix && (page ? `If this turns into a fresh new page, try this look, unless the kid asked for something else: ${look} - giving every part a fresh file (parts/ still holds the old creation's).` : `For this new creation, try this look, unless the kid asked for something else: ${look}.`),
    !known && historyNote(history),
    fix ? `The page just crashed with this problem:\n${fix}\nFix it in the files without changing anything else. Keep DONE very short.` : `The kid just said: "${text}"`,
    !fix && alt && `(The other listener heard: "${alt}". Little kids are hard to hear - use both versions and the conversation to work out what they meant.)`,
  ].filter(Boolean).join('\n\n');
  const turn = {
    priority: true,
    timeoutSec: Math.max(config().timeoutSec, 360),
    stallSec: 120,
    onText: chunk => {
      heard += chunk;
      chars += chunk.length;
      progress();
    },
    onEvent: ev => {
      team.onEvent(ev);
      jobs.onEvent(ev);
      // (The helpers' writing keeps the building blocks coming too.)
      if (ev.parent_tool_use_id && ev.type === 'stream_event' && ev.event?.delta?.type === 'text_delta') {
        chars += ev.event.delta.text.length;
        progress();
      }
    },
  };
  let reply;
  let stuck = null;
  let stopped = [];
  // A helper gone silent stops the lead's turn - and with it every helper still at work. Once more
  // in the turn that follows, and the build fails (the classic way takes over).
  const watch = setInterval(() => {
    const job = s.current?.interrupted ? null : team.stuck(HELPER_STALL_MS);
    if (!job) return;
    [stuck, stopped] = [job, team.stopAll()];
    log(`agents: a helper got stuck (${job}), stopping the turn${stopped.length > 1 ? ` and ${stopped.length - 1} more helpers` : ''}`);
    s.interrupt();
  }, 5000);
  try {
    reply = await s.ask(prompt, turn).catch(err => {
      if (!stuck || err.message !== 'interrupted') throw err;
      // It knows everything it planned: it finishes the stopped helpers' jobs itself.
      const said = heard; // (its TITLE line came in the turn that was stopped)
      const others = stopped.filter(j => j !== stuck);
      const ask = `Your helper for "${stuck}" got stuck, so your turn was stopped${others.length ? ` - and with it your helpers for ${others.map(j => `"${j}"`).join(', ')}, before they finished` : ''}. Their files may be missing or half-written: write what they were doing yourself now (or hand it to new helpers), then make it all fit and end with DONE.`;
      return s.ask(ask, turn).then(r => ({ ...r, text: `${said}\n${r.text}` }));
    });
  } finally {
    clearInterval(watch);
    over = true;
  }
  const r = parseReply(reply.text);
  let built = assemble(s.dir);
  const changed = Boolean(built?.html) && built.html !== (page || '');
  if (!changed) {
    // It only talked (or changed nothing): the files stay as they were. Only its own SAY means
    // there was nothing to build - otherwise the classic way builds it.
    if (page) sync(s, page);
    if (asks && w.rules) fs.writeFileSync(rules, helperRules(w.rules));
    if (fix || !r.say) throw new Error(fix ? 'the fix changed nothing' : page ? 'it changed nothing' : "it didn't build anything");
    tellPolisher(w, { kind: 'talk', kid: text, alt, said: state.said, lead: reply.text });
    log(`ok   claude agents ${secs()} only talked, turn ${s.turns}`);
    // (When the quick voice spoke first, the lead's answer is said too, as in team mode.)
    return { say: state.said || r.say, done: state.said && state.said !== r.say ? r.say : '', title: r.title, emoji: r.emoji, html: null, edited: false, look, backend: 'claude agents' };
  }
  let problems = await problemsIn(built);
  if (problems.length) {
    fs.writeFileSync(path.join(s.dir, 'assembled.html'), built.html || '');
    log(`agents: page doesn't run (${problems.join('; ').slice(0, 160)}), asking it to fix that`);
    await s.ask(`Before it's shown: the page doesn't run -\n${problems.join('\n')}\n(Line numbers are in assembled.html: the page as it was put together.) Fix just that, in the files.`, { priority: true, timeoutSec: 180, stallSec: 90 }).catch(() => null);
    built = assemble(s.dir);
    problems = await problemsIn(built);
    if (!built?.html) throw new Error('its page is gone');
    if (problems.length) log(`agents: still doesn't run (${problems.join('; ').slice(0, 160)})`);
  }
  s.files = built.html;
  if (asks) w.rules = asks;
  // Something new: it's grown into its full version in the next pass.
  const fresh = !page || (r.title && r.title !== p.title && !sameCreation(page, built.html));
  if (fresh) {
    [w.grow, w.passes, w.tries, w.asked] = [true, 0, 0, text || w.asked];
    // (Its grow pass's helpers go by the new creation's request and look.)
    if (page) fs.writeFileSync(rules, helperRules((w.rules = { asked: text, look })));
  } else [w.passes, w.tries] = [0, 0];
  tellPolisher(w, { kind: fix ? 'fix' : fresh ? 'new' : 'change', kid: text, alt, fix, said: state.said, lead: reply.text, jobs: jobs.jobs, changes: fileChanges(filesBefore, snapshot(s.dir)), secs: Math.round((Date.now() - t0) / 1000) });
  log(`ok   claude agents ${secs()} ${team.helpers.size} helpers, ${built.html.length} chars, turn ${s.turns}`);
  const edited = Boolean(page) && sameCreation(page, built.html);
  return { say: state.said || r.say, done: r.done, title: r.title, emoji: r.emoji, html: built.html, edited, look, backend: 'claude agents' };
}

// ---------------------------------------------------------------------------------------------
// After it appears: the lead looks at a screenshot of its creation running and makes it better (the
// app asks: POST /api/check). Its changes become a new version that slides in at a calm moment.

function running(report, shot) {
  const r = report || {};
  const slow = r.fps != null && r.fps < 30 ? '\nIf that feels slow, make each frame lighter - never by taking away what the look asked for.' : '';
  return `<how_it_is_running>\nRunning at ${r.fps ?? '?'} frames per second${r.canvas ? ` on a ${r.canvas} canvas` : ''}.${slow}\nErrors while running: ${r.errors?.length ? r.errors.slice(-5).join(' | ') : 'none'}\n</how_it_is_running>\n\n${
    shot ? `A screenshot of it right now is in the file ${shot} - look at it first (with the Read tool).` : 'There is no screenshot, so judge from the files.'
  }`;
}

function saveScreenshot(dir, dataUrl) {
  const m = /^data:image\/(jpeg|png);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const file = path.join(dir, `screenshot-${Date.now()}.${m[1] === 'png' ? 'png' : 'jpg'}`);
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
  return file;
}

export async function check({ projectId, version, report, screenshot }) {
  if (leadBrain() === 'agy') return agyAgents.check({ projectId, version, report, screenshot });
  if (crew.on()) return crew.check({ projectId, version, report, screenshot });
  if (!enabled() || config().team.check === false) return { skipped: 'off' };
  let p = store.currentProject();
  if (p.id !== projectId || p.current !== version || isBusy() || !madeByAgents(p, version)) return { skipped: 'stale' };
  const w = workFor(projectId);
  if ((w.passes >= passes() && !w.grow) || w.tries >= passes() + 2) return { skipped: 'polished enough' };
  if (w.checking || w.repairing) return { skipped: 'busy' };
  // (The polisher's pass, in its own session - or else the lead's own.)
  const polish = polisher().on;
  const s = polish ? polisherFor(projectId) : sessionFor(projectId);
  const page = store.html(p);
  const t0 = Date.now();
  const took = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const stale = () => {
    const now = store.currentProject();
    return now.id !== projectId || now.current !== version || isBusy();
  };
  w.checking = true;
  let before = null;
  let rules = null;
  const shot = saveScreenshot(s.dir, screenshot);
  try {
    // What it's told first. The lead: how its files stand since its own last turn (and what a
    // polisher that's been switched off since had changed). The polisher: everything the lead did
    // since the polisher's last turn - a new one, the conversation too, and to read it all.
    let note;
    let story = null;
    if (polish) {
      const state = syncState(s, page);
      story = storySaid(w.story, s.told);
      note = [
        s.turns === 0 && [historyNote(p.history, 60), 'This is the creation you look after from now on. Your folder holds it as it is: page.html and its parts in parts/, and rules.md with what the kid asked for and the rules every helper follows. Read rules.md, page.html and every part first (all the Reads in one message).'].filter(Boolean).join('\n\n'),
        story.text,
        state === 'outside' ? OUTSIDE : state === 'inside' && s.turns > 0 && !story.text ? INSIDE : '',
        w.polishNote,
      ].filter(Boolean).join('\n\n');
    } else {
      const told = reportSaid(w.reports);
      note = [sync(s, page, told || INSIDE), w.note].filter(Boolean).join(' ');
      w.reports = [];
      if (note) note = `${historyNote(p.history)}\n\n${note}`;
    }
    before = snapshot(s.dir);
    // (Its helpers write fuller parts while the kid plays; the quick rules come back after.)
    rules = w.rules || { asked: w.asked || p.versions.filter(x => !x.continues).at(-1)?.request || '', look: p.versions.filter(x => x.look).at(-1)?.look || '' };
    fs.writeFileSync(path.join(s.dir, 'rules.md'), helperRules({ ...rules, freshLook: '', quick: false }));
    const grow = w.grow;
    const prompt = [
      note || 'Here it is, running - the kid has been playing with it.',
      running(report, shot && path.basename(shot)),
      grow ? GROW : LOOK,
      "Keep it the kid's creation: don't change what they chose, keep the controls and the KB.keep names.",
      polish && 'If you changed anything, the LEAD line comes after WHY.',
    ].filter(Boolean).join('\n\n');
    if (!polish) await s.use(lead().model);
    await s.think(polish ? polisher().thinking : lead().thinking.look);
    if (stale()) return { skipped: 'stale' };
    w[polish ? 'polishNote' : 'note'] = '';
    w.tries++;
    // (Once the turn has gone to it, the polisher knows the story so far.)
    const reply = await s.ask(prompt, { timeoutSec: 600, stallSec: 150, kind: 'polish', onSent: () => story && (s.told = story.upTo) });
    const why = field(reply.text, 'WHY') || 'made it better';
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
      fs.writeFileSync(path.join(s.dir, 'assembled.html'), built.html);
      await s.ask(`With your changes in, the page doesn't run: ${probs.slice(0, 3).join(' | ')}\n(Line numbers are in assembled.html.) Fix just that, in the files.`, { timeoutSec: 180, stallSec: 90, kind: 'polish' }).catch(() => null);
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
    w.lastPass = { version: p.current, grow, before, polisher: polish };
    // (The lead is told at its next turn: which files, why, and what the polisher says it should know.)
    if (polish) w.reports.push({ version: p.current, why, lead: field(reply.text, 'LEAD'), files: changesSaid(fileChanges(before, snapshot(s.dir))) });
    done();
    log(`AGENTS fix  ${took()} ${why} (pass ${w.passes}) → v${p.current}`);
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
    if (rules) fs.writeFileSync(path.join(s.dir, 'rules.md'), helperRules(rules));
    w.checking = false;
    if (shot) fs.rmSync(shot, { force: true });
    if (polish && !polisher().on) endPolisher(); // (switched off during its pass)
  }
}

// One of its passes crashed when the app tried it out of sight, so it was taken back (POST
// /api/drop-fix): its files go back to how they were, it's told why, and a lost grow happens again.
export function takenBack({ projectId, version, error }) {
  if (leadBrain() === 'agy') return agyAgents.takenBack({ projectId, version, error });
  if (crew.on()) return crew.takenBack({ projectId, version, error });
  const w = workFor(projectId);
  if (w.lastPass?.version !== version) return;
  // (Whoever made it - the polisher, or else the lead - has its files put back, and is told.)
  const by = w.lastPass.polisher ? polishSession : session;
  if (by?.projectId === projectId && w.lastPass.before) {
    restore(by.dir, w.lastPass.before);
    by.files = assemble(by.dir)?.html ?? null;
  }
  w[w.lastPass.polisher ? 'polishNote' : 'note'] = `Your last changes were taken back: with them in, it crashed when it was tried (${String(error || '').slice(0, 200)}).`;
  w.reports = w.reports.filter(r => r.version !== version); // (the lead never hears of them)
  if (w.lastPass.grow) w.grow = true;
  w.passes = Math.max(0, w.passes - 1);
  w.lastPass = null;
}

// ---------------------------------------------------------------------------------------------
// Its new page crashed when the app tried it out of sight, before showing it: the lead repairs it
// (proposed, then taken only if it runs - like the other ways of building).

const proposals = new Map();

export async function repair({ version, errors, keep, accept = false }) {
  if (leadBrain() === 'agy') return agyAgents.repair({ version, errors, keep, accept });
  if (crew.on()) return crew.repair({ version, errors, keep, accept });
  let p = store.currentProject();
  const v = p.versions.find(x => x.n === version);
  if (!enabled() || p.current !== version || v?.backend !== 'claude agents') return { skipped: 'stale' };
  const key = `${p.id}:${version}`;
  if (accept) {
    const prop = proposals.get(key);
    if (!prop || isBusy()) return { skipped: 'stale' };
    proposals.delete(key);
    const { n, at, ...meta } = v;
    p = store.addVersion(store.dropVersion(p, version), prop.html, meta);
    if (prop.by === session && prop.by?.alive) prop.by.files = prop.html;
    tellPolisher(workFor(p.id), prop.story);
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
    const reply = await s.ask(
      [
        note,
        keep
          ? `It crashes when it starts with the kid's saved progress (KB.keep hands it back these values):\n${JSON.stringify(keep).slice(0, 1500)}\nThe error:\n${String(errors).slice(0, 1500)}\nMake it carry on from those values instead, in the files, changing nothing else.`
          : `When it was tried, it crashed:\n${String(errors).slice(0, 2000)}\nFix just that, in the files.`,
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
    // (The polisher is told of it once it's taken.)
    proposals.set(key, { html: built.html, by: s, story: { kind: 'fix', fix: String(errors), lead: reply.text, changes: fileChanges(before, snapshot(s.dir)) } });
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
