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
import { config } from './config.mjs';
import * as store from './store.mjs';
import { buddyIntro, talkingRules, worldRules, buildingRules, pickLook, parseReply, field, log, isBusy, WORK_DIR, AgySession, agyHelper, agyVoice, keepAgyWarm } from './ai.mjs';
import { Session } from './solo.mjs';
import { leadBrain } from './bins.mjs';
import { kitApi, kitPage, KIT_NAMES } from './kit.mjs';
import { syntaxErrors, blankProblems, speakFirst, warmVoice, warmHelpers, maxHelpers, polishPasses as teamPolish, EDIT_FORMAT, PlanReader, helperCrew, applyEditsWithFixer, assemble as teamAssemble, repairNames, renameClashes } from './team.mjs';

// The agent way is team mode with team.agents on, when Claude leads (solo mode comes first) - or,
// when Gemini (agy) leads, how it builds unless agy.way is "classic": an Argon lead that remembers the
// creation writes the plan, and Argon helpers write its parts at the same time (one Argon writing a
// whole page took about 100 s; this way about 38 s, where Claude's took 33 s).
export function enabled() {
  const c = config();
  const brain = leadBrain();
  if (brain === 'agy') return c.agy?.way !== 'classic';
  return Boolean(c.team?.enabled && c.team?.agents) && !c.solo?.enabled && brain === 'claude';
}
const onAgy = () => leadBrain() === 'agy';
// agy.way "fast": the team way on agy with quicker changes - Argon changes more than the kid asked
// for, and copies whole blocks of the page to change a little of them (about 22 s a change instead
// of 24.5 s, a little less done; Claude's take about 15 s).
const agyFast = () => onAgy() && config().agy?.way === 'fast';
// (What its versions are called: 'claude agents' or 'agy agents'.)
const brainName = () => (onAgy() ? 'agy' : 'claude');

// Passes after something new or a change: growing it, then looking again (team.polish more). On agy
// there's only the wire pass (in text): growing and looking it over use Claude Code's tools.
export const passes = () => (onAgy() ? 0 : 1 + teamPolish());

// The Agent tool takes a model alias only (no full model names).
const ALIASES = ['sonnet', 'opus', 'haiku', 'fable'];
function helperAlias(want) {
  const v = String(want || 'sonnet').toLowerCase();
  return ALIASES.find(a => v.includes(a)) || 'sonnet';
}

function lead() {
  const c = config();
  if (onAgy()) return { model: c.agy.model || '', effort: '', fast: false, args: [], helperModel: c.agy.helperModel || c.agy.model || '', firstModel: '', thinking: { build: 0, wire: 0, look: 0 } };
  const r = c.team?.agentLead || {};
  const model = r.model || c.claude.model || '';
  return {
    model,
    effort: r.effort || c.claude.effort || '',
    fast: r.fast ?? Boolean(c.claude.fast),
    args: Array.isArray(r.args) ? r.args.map(String) : [],
    helperModel: helperAlias(c.team?.agentHelper?.model),
    // firstModel: who leads the turn that makes something new while the kid waits (the main model
    // takes over for everything else - its passes, the kid's changes, repairs). Only with a main
    // model set: without one there'd be nothing to switch back to.
    firstModel: model ? r.firstModel || '' : '',
    thinking: { build: 0, wire: 8000, look: 10000, ...(r.thinking || {}) },
  };
}

// ---------------------------------------------------------------------------------------------
// What it's told

function leadSystem() {
  const helperModel = lead().helperModel;
  // (On agy there are no tools: while the kid plays, it only makes its helpers' parts fit, in text.)
  const agy = onAgy();
  return `${buddyIntro()}

# You lead a building team, and you keep the creation in mind
You make the creation with helpers, turn after turn: while the kid waits for it (something new, a change they asked for), and then while they play with it, when you ${agy ? 'make its parts fit' : 'grow it and look it over'}. The kid waits for every second you take while they're waiting, so then you only write - fast, in text, no tools - and your helpers write at the same time. While they play, you take your time${agy ? '' : ' with your tools'}.

# While the kid waits: reply in text only - no tools
Build Buddy reads your reply as you write it: each helper starts the moment its job line is written, and the page is put together and shown the moment your reply ends. Start writing straight away.

Reply format:
TITLE: <one emoji> <2-4 word name>   (only when you start something new or it changes a lot)
DONE: <1-2 short sentences said when it appears: how to play with it. You may end with an open question like "What's next?" - never with a suggestion>
then the edits or the plan (below).

Someone else has already answered the kid out loud, so don't write SAY - unless there is nothing to build (you didn't understand, or they asked you something): then write only SAY: <what to say> and nothing else.

${quickPlanRules()}

When you change a page, its FIND lines are copied exactly from the current page you're shown (or, if you're told it's as you last saw it, from the page as you last saw it - your own last edits in).

${agy ? AGY_PLAYING : `# While the kid plays: your tools and your helpers
Then your working folder holds the creation: page.html is the page, with a line \`// @part <name>\` wherever a part's code goes, and parts/<name>.js holds each part (your helpers' parts from the plan; Build Buddy's kit, the shared code and the run([...]) line are in page.html). Build Buddy puts them together (each \`// @part\` line becomes that part's file) when your reply ends. rules.md holds the rules every helper follows and what the kid asked for - Build Buddy writes it, so never change it. If your helpers need to know something about the whole creation (the coordinates, how the parts talk to each other), say it in a short comment in page.html's shared code: they read it there.

You'll be shown how it's running (a screenshot, the frame rate, any errors) and asked to grow it or look it over. Your helpers are then subagents (the Agent tool, subagent_type "general-purpose", model "${helperModel}"): hand out anything big, all in one message so they work at the same time - each helper owns different files (a new part, which you add a \`// @part\` line for and put in run([...]), or a part it extends or rewrites), never two on the same file. Each job is short - the helper reads rules.md and page.html itself: "Read rules.md and page.html, then write parts/<name>.js defining exactly: <what it defines>. <how it looks, sounds and feels, what it does when poked, the events it emits and answers, and the shared names and keep fields it reads>". Then Read what they wrote and make it one creation that works: fix any name or call that doesn't match, anything missing or that would crash - with the Edit tool. Small fixes you make yourself with Edit. Never rewrite what works just to tidy it. Anything new the kid can make progress in gets its default in page.html's \`KB.keep({ ... })\` - only those fields carry over, and only you can add them - and its job names that keep field. Counting, growing, goals and timers go in the rules part (parts/rules.js), which you change yourself - on a page without one, add a \`// @part rules\` line and put rules first in run([...]).`}

${talkingRules()}

${worldRules()}

${buildingRules()}`;
}

// On agy, what the lead does while the kid plays: the wire pass, in text (no tools, no screenshot).
const AGY_PLAYING = `# While the kid plays
Once it's on screen, you'll be shown the page and how it's running (the frame rate and any errors - there is no screenshot) and asked to make your helpers' parts fit together: always in text (no tools, no files), with the edits you're asked for. Never rewrite what works just to tidy it.`;

// While the kid waits, every piece of the plan is small: the kid sees it sooner, and it's grown
// while they play.
const QUICK_SIZE = { shared: 10, jobWords: 20, main: '15-25', partLines: 18, partChars: 1400, maxChars: 2000 };
// How many helpers write at once while the kid waits (more, smaller parts: the kid waits for the
// slowest), and how many are kept started and waiting: three more, for the first job's twin and
// second tries on slow jobs.
// (Each waiting one is a claude program, about 170 MB.)
const QUICK_HELPERS = 8;
const WARM_HELPERS = QUICK_HELPERS + 3;
// They wait a while: starting ten at once takes the computer's attention just when the kid asks, so
// they're kept through the minutes the kid plays.
const WARM_MS = 15 * 60000;
// (On agy: as many Argon helpers as write at once, and the quick voice, for a few minutes - one more
// of the helpers' model when the voice is that model too. None with team.warm off, as for Claude's.)
function keepHelpersWarm() {
  if (!onAgy()) return warmHelpers(WARM_HELPERS, WARM_MS, true);
  const c = config();
  if (c.team?.warm === false) return 0;
  const need = { [lead().helperModel]: QUICK_HELPERS };
  if (c.agy.voiceModel) need[c.agy.voiceModel] = (need[c.agy.voiceModel] || 0) + 1;
  return keepAgyWarm(need);
}

// Who writes for the team on agy - its helpers' parts, and the fixer's edits that didn't fit - is an
// Argon helper (null: a Claude one). Like a helper, the fixer is given up once it goes quiet for 20 s
// (and after its 60 s, as Claude's is).
const runner = () => (onAgy() ? o => agyHelper({ stallSec: 20, ...o }) : null);

// How it hands out the work while the kid waits: the plan for something new (on the kit, so it only
// writes what's this creation's own), edits or new parts for a change.
function quickPlanRules(n = QUICK_HELPERS, fast = agyFast()) {
  const z = QUICK_SIZE;
  return `You have up to ${n} helpers who write code at the same time as each other. Hand out the work rather than writing it all yourself - and keep your own writing short: helpers start only once their line is written.

${fast ? 'Keep every change quick (the kid is waiting): edit only the lines their words need - nothing they didn\'t ask for. Each FIND is just enough to find the spot: usually one line that appears only once on the page, copied exactly. To add something, FIND the one line it goes after and REPLACE it with that line and the new ones. Never copy a whole block to change a little of it.\n\n' : ''}For a change to the current page that is one thing - a color, a size, a speed, a rule - write the edits yourself, each as:
${EDIT_FORMAT}

For a change that adds new things (a new character, a new place, a new toy - "add a bear who wants the honey and a rainbow"), helpers write each new thing as a new part, at the same time, while you wire them in:
ADD:
//@part <name>: const <name> = { <what other parts use of it> } - <the job, in under ${z.jobWords} words>
then your own edits that wire them in: add each new part's name to the run([...]) list (where it's drawn: back to front), anything the page's other parts now do with it, and any new keep fields in KB.keep. Each new part goes into the page just before the run([...]) line; its helper sees the page as it is, so it can use the page's names and answer its events (on(...)) - and a new event the page should react to is one of your edits. Write the ADD lines first, straight away - each helper starts the moment its line is written - then your edits.

When the kid asks for several separate changes to what's there at once ("make it night and give the car headlights"), hand them out - helpers write the edits, one thing each, at the same time:
CHANGES:
//@change <name>: <the job>
Each job says, in under 30 words, exactly what to change in which part of the page and what it should become. Never two jobs that change the same lines; anything one job adds and another uses is named exactly in both.
Whichever way you change it, the kid carries on where they were: keep the KB.keep names and what they mean, and anything new they can make progress in goes into keep too.

For anything new, or when most of the page has to change, write the plan - start writing it straight away (each helper starts the moment its line appears, and the details are theirs):
PLAN:            (or PLAN: 3d, for a 3D creation)
\`\`\`js
<the shared code>
\`\`\`
//@part <name>: const <name> = { <what other parts use of it> } - <the job>
//@part <name>: ...
RUN: <every part's name, back to front>
RULES:
\`\`\`js
const rules = { <the world's rules, which you write yourself while your helpers write their parts> };
\`\`\`

The page is Build Buddy's kit, your shared code, each part, then run([...]) in your RUN order - there's no main code to write: the kit runs it.
2D: ${kitApi('2d')}
3D: ${kitApi('3d')}

- The shared code (at most about ${z.shared} short lines): the palette and sizes; where the main places are, as functions of W and H everyone uses (const at = { ground: () => H * 0.8, hive: () => ({ x: W * 0.7, y: H * 0.35 }) }) - and of the world's numbers when they change (a crater that rises with the volcano); the world's numbers (const world = { ... }); const keep = KB.keep({ ... }); and a comment naming every event, with what it carries and when it happens (// events: basket(x, y) when a ball goes in; miss() when it lands). Nothing else (the kit has the canvas, input, sounds and loop).
- The parts are written apart, at the same time, and each helper sees only the jobs written before its own - so what happens between parts goes through those events: the part where it happens emits it, and every part that reacts answers it (on('basket', ...)). Each job says which events its part emits and which it answers, and every reaction you want (the crowd cheers, sparkles burst, the net swishes, the score goes up) is in the job of the part that reacts. Never a method one part has to call on a part that comes later.
- Each thing on screen belongs to exactly one part, which draws it, moves it and answers pokes on it - never one part for a thing's look and another for its moves. A part that needs to know where another part's things are reads them from that part's object or from at, never works them out itself.
- Each job starts with the part's object and what other parts read of it, written as code - fields bare and methods with their parentheses: const hive = { x, y, cells } or const ball = { x, y, flying }. Then, in under ${z.jobWords} words, how it looks, sounds and feels, what pokes do, and its events. Your helpers know the kit, the kid's words and the look - they fill in the details.
- Write the jobs biggest first (the slowest helper starts first), then RUN, then the rules part yourself (at most about 15 short lines; it runs first): it updates the world's numbers every frame, and answers the events that add up - the score, the goal, what grows - emitting the big moments (emit('jarFull')) for the parts that react. The world's numbers and keep's counts - counting, growing, the goal, any timer - belong to the rules part alone: the jobs say what each part emits and reads, never that it changes one of them (a part changes only its own things: where they are, how they look); and no tap is handled by two parts. Pace it for a 5-year-old: something changes in the first two seconds, each poke shows at once, and a big moment comes within a few pokes or half a minute of play - never after hundreds. It's the one part that knows them all, so it's what makes the parts one world. Never give a helper a job named rules.
- Plan how it works, not just the look: its 2 or 3 real rules, as a few numbers in world that the rules part updates every frame, pokes nudge and everything else reads; what each poke sets off; and what keeps going when the kid does nothing (the sun moves, the flowers get thirsty, the fish get hungry - and the parts show it). No score or goal unless they ask for a game - then also one clear thing to do, a reward every time and a goal that grows. The star of it - the thing they asked for - is big, near the middle of the action, and the kid can see its face (in 3D, where the camera sees it).
- Hide two surprises a kid finds by playing, never told - small extras on the thing they asked for, never instead of it: each in the job of the part it's on, set off by doing something a few times or in a new way (tap the moon three times and it winks and rains stars; the fifth fly gets the frog a crown; a drag across the strings plays a tune).
- Anything one part makes and another uses - an object's fields, a function - is named exactly in both jobs (or in the shared code).
- Everything they'd be sad to lose when the page changes (where the player is, the level, the score, what they collected, placed, drew or chose - a picture as a list of flat dots or stamps, never a canvas) lives in keep - every field in its defaults there, since only those carry over - and each job says which keep fields its part puts back when it starts and updates.
- Give it everything a kid pictures for that kind of thing (a soccer game has a goalie to beat, a train has tracks and a station), each in a job. Everything is drawn in the look - shapes, not emoji.
- The kid's main action works end to end, with the arrow keys and the pointer: the star's job says what its key(), tap() and drag() do - a finger alone can do all the arrow keys do. Arrow keys move things the way they point on the screen (left goes left; seen from above, never steering-wheel turns), and a quick tap gets a clear answer right away (a hop, a sparkle and a sound where they tapped) - the front part that wants a tap takes it; the background's tap() can answer taps anywhere else.
- <name> is one lowercase word, and the part's object has that name (never kit, main, or a name the kit gives: ${KIT_NAMES.join(', ')}). The kid waits for the slowest helper: ${n - 2}-${n} small parts of about ${z.partLines} short lines each (about ${z.partChars.toLocaleString('en')} characters), similar in size - for example the sky, the ground, the star, the other characters, the effects. Keep the star's part to the star itself (what it pokes off - sparkles, sounds, a score - goes to other parts as events), and split anything else big (a whole world, a game's rules) into two parts, each owning its own things.
- When you plan over an existing page, the helpers also see the page as it was, so they can keep what the kid already built. Keep the same KB.keep names.`;
}

// What every helper follows (the lead's jobs point to it).
// quick: the kid is waiting for this (something new or a change) - small parts; otherwise (the
// passes while the kid plays) fuller ones.
function helperRules({ asked, latest = '', look, freshLook = '', quick = true }) {
  return `# How to write your part

You are a helper on a small team building a web page for a ${config().kidAge}-year-old, from what the kid said out loud. page.html has Build Buddy's kit at the top (when it starts with \`// ---- kit\`), then the lead's shared code, a \`// @part <name>\` line where each part goes, and at the bottom run([...]) (or, on older pages, MAIN), which uses your part exactly as your job says. On the kit: ${kitApi('2d')} (In 3D: the kit gives THREE, scene, camera, renderer and sun, and tap(x, y, ray) gets a THREE.Raycaster.) The comments in the shared code tell you how the parts fit together (the coordinates, how they talk to each other) - follow them. Other helpers write the other parts at the same time.

- Read rules.md and page.html together (both Reads at once), then write only the file your job names, with the Write tool (or Edit, if your job is to change a part that's there)${quick ? " - in one go: the lead checks every part afterwards, so don't polish it with more edits" : ''}. Then reply with one short line: what you defined.
- Define exactly what your job says (the same names and parameters, returning the same things): MAIN depends on it. Use the shared code's names as they are.
- Only define things at the top level: nothing runs until MAIN calls your part. No imports and no <script> tags (the shared code has every import). Extra top-level names you add start with your part's name and an underscore, so they can't clash. Whatever your piece needs before its first frame happens in the function MAIN calls first.
- Time is in seconds: use dt and t exactly as passed (never divide them by 1000). Read the arrow keys and the pointer from the shared input object, unless your job says otherwise.
- The world's rules belong to the lead: read the shared numbers your job names; on Build Buddy's kit the rules part changes the counts and world numbers and your part emits what happens (elsewhere, change one only when your job says your part does). Never a copy of your own, and no rules your job doesn't ask for.
- No words on the page - pictures instead. Draw everything in the look, so it's all one picture - shapes, not emoji.
${quick ? '- About 25-40 short lines, never more than 2,500 characters - a hard limit: the kid is waiting for the slowest helper. Write the heart of your part well and leave the extras out; the lead grows the creation after it appears.' : '- About 30-60 short lines: the kid is playing with it, not waiting, so make your part rich and complete - what it does when poked, how it reacts to what happens, the little things to find.'} Smooth: no shadowBlur or CSS/SVG filters, at most about 40 moving things; in 3D, no new lights unless your job says so, reuse geometries and materials, InstancedMesh for many copies.
- What the kid would miss when the page changes lives in the fields of page.html's \`KB.keep({ ... })\` (only those carry over): put it back from there when your piece starts, and update the fields of your own things as they change (where they are, what's placed or chosen) - a count you only read. Use the keep fields your job names; never call KB.keep yourself.
- If your piece is the star, make it easy to recognize at a glance, with a face, big enough to see - in proportion with its world. If it's the place, make it full and unmistakable: a few kinds of things, each made in a loop with varied sizes, colors and spots.
- Whatever the kid can touch or steer in your piece answers every time - a bounce, a sound, a burst - and moves the way the arrow points on the screen.

${worldRules()}

${buildingRules()}

# This creation
${asked ? `The kid asked for: "${asked}"` : ''}${latest ? `\nThen they said: "${latest}"` : ''}${look ? `\nThe look: ${look}.` : ''}${freshLook ? `\n(If the lead is making a fresh new page instead, its look is: ${freshLook}.)` : ''}
`;
}

// Growing it into its full version, while the kid plays (the first pass after something new).
const GROW = `Now grow it into its full, excellent version - about twice as much as there is now. Hand the additions out to helpers, all at the same time - each owns its own file (a new part, which you add a \`// @part\` line for and put in run([...]) - or, on a page with MAIN, a call in MAIN - or a part it extends) - then Read what they wrote and make it fit:
- First fix anything you can see isn't working or showing yet, and make every word of what the kid said, and of the look, unmistakably there - the center of it, not a detail.
- Then add what it still lacks to be a world that works and a delight: everything a kid pictures for it (a farm has animals to feed), more of its place near and far (made in loops) with things moving on their own, the star and everyone in it reacting to the kid and to what happens, a big happy moment for each thing the kid sets going, one more thing a poke sets off (the full pond spills over its edge), something new that what the kid does adds up to, and things to discover until it has one or two, each with a spark of joy, from exactly what the kid said. In a game, a reward every time and a goal that grows (after a few, something new appears).
- Give it one big idea of its own, built from exactly what the kid said - a rule, a place with a story, or a character with a name and a wish that makes it unlike any other version - not a big new thing they didn't ask for.
- Every arrow key, a tap anywhere and a drag each get an answer the kid sees, and a finger can do all the arrow keys do.
- Keep it smooth (nothing made every frame, a costly look drawn the cheap way) and everything in the look.
End your reply with WHY: <what you improved, in one short sentence for the grown-ups' log>.`;

// Right after its helpers' parts appear (and the kid starts playing): it reads them for the first
// time and makes them one world that works - in text, quickly, before it grows it.
const WIRE = `Your helpers' parts are in and the kid is playing with it now - here's the page put together, and you haven't seen their code until now. Make it one world that works, as it is - nothing new:
- Follow every control - each arrow key, a tap, a drag - from the kit's hook to what moves on screen, and every event from each emit to each on. Fix what's dead (never emitted or never answered, a method nobody calls, a hook the kit never calls), what lands somewhere else than what's drawn (a place worked out twice), and what fights (two parts moving the same thing).
- Fix what would crash, and what can't be seen (off the screen, hidden behind or inside something, too small to notice).
- Fix what's done twice (two parts changing the same number, one tap handled by two parts), and a tap() that takes every tap instead of only taps on its own thing.
- Then play it in your head for half a minute as a 5-year-old would - tapping, holding, dragging, doing nothing - working the numbers through the code: does what they asked for show from the first second (rain already falling, the fish already swimming), can the main thing really succeed (the ball can reach the hoop, the rocket lands once and stays), does what adds up visibly build with each poke, and does anything fire over and over, pile up or never happen? Fix what doesn't.
Reply in text only. First TRACE: a few short lines working it through the code's real numbers - each control from its hook to what moves on screen, and the main thing from the first poke to its big moment (the ball's highest point against the rim's height; how many pokes fill the jar; where the star is after ten seconds of doing nothing) - each line ending in works or broken. Then FIND/REPLACE edits for everything broken, each FIND copied exactly from the page above, then WHY: <what you fixed, in one short sentence for the grown-ups' log>. If nothing is broken, end with just: OK`;

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

// The lead's own rules part, written after its plan (RULES: and a code block).
const RULES_BLOCK = /^[ \t>*_#]*RULES[*_]*:[^\n]*\n+[ \t]*```[a-z]*[ \t]*\n([\s\S]*?)\n[ \t]*```/m;

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

// The page as files: each piece of it (a \`// ---- <name>\` line and the code after it, as pages are
// put together) goes into parts/<name>.js, with a \`// @part <name>\` line in its place in page.html.
// Returns the page as assemble() puts it back together - the same page, or else (a piece it
// couldn't give back exactly) it's all kept in page.html.
function keepAsFiles(dir, html) {
  clear(dir);
  const marks = [...html.matchAll(/^\/\/ ---- ([\w-]+)[ \t]*$/gm)];
  const names = new Set();
  let out = '';
  let at = 0;
  marks.forEach((m, i) => {
    const name = m[1];
    if (name === 'main' || names.has(name)) return;
    const from = m.index + m[0].length + 1;
    let to = marks[i + 1]?.index ?? html.indexOf('</script>', from);
    if (to < 0) to = html.length;
    const region = html.slice(from, to);
    const code = region.trimEnd();
    if (!code.trim()) return;
    names.add(name);
    out += `${html.slice(at, m.index)}// @part ${name}${region.slice(code.length)}`;
    fs.writeFileSync(path.join(dir, 'parts', `${name}.js`), code);
    at = to;
  });
  fs.writeFileSync(path.join(dir, 'page.html'), out + html.slice(at));
  if (assemble(dir)?.html === html) return html;
  clear(dir);
  fs.writeFileSync(path.join(dir, 'page.html'), html);
  return html;
}

// Before a turn: the files hold the creation as it is now. Returns what the lead is told about them.
function sync(s, page) {
  const dir = s.dir;
  const now = assemble(dir)?.html;
  if (!page) {
    if (now) clear(dir);
    s.files = '';
    return '';
  }
  if (now === page && s.files === page) return ''; // as it left them
  // The page changed outside its files (undone, fixed by the overwatch, another way of building).
  if (now !== page) keepAsFiles(dir, page);
  s.files = page;
  const parts = fs.readdirSync(path.join(dir, 'parts')).length;
  return now === page
    ? 'Your folder holds the creation as it is: page.html and its parts in parts/ (Read what you need before you change it).'
    : `The page changed since you last worked on it (or you are new to it): your folder holds it as it is now - ${parts ? 'page.html and its parts in parts/' : 'page.html, the whole page, with no parts'}. Read it before you change it.${parts ? '' : ' When you hand out work, a helper can take over a piece of it as a new part.'}`;
}

// ---------------------------------------------------------------------------------------------
// The session (one per creation; solo mode's, with its own tools and folder)

const MAX_TURNS = 24;
let session = null;
// On agy, the kid's request ends a pass at work (agy can't stop a turn halfway), and with it the lead's
// conversation: while they talk, a new one is started and waits, so their request doesn't wait for agy
// to start. (Stopped if it isn't needed after all.)
let spare = null;
let warmedAt = 0; // (when the kid last started talking or typing: the app warms up then)
function spareFor(s) {
  if (!onAgy() || !['polish', 'repair'].includes(s.current?.kind) || (spare?.alive && spare.projectId === s.projectId && spare.key === s.key)) return 0;
  spare?.end();
  const mine = (spare = new AgySession(s.projectId, { system: leadSystem(), model: lead().model, label: 'agents' }));
  setTimeout(() => spare === mine && dropSpare(), 3 * 60000);
  return 1;
}
function dropSpare() {
  spare?.end();
  spare = null;
}

function sessionArgs() {
  const r = lead();
  const args = ['-p', '--safe-mode', '--tools', 'Agent,Read,Write,Edit', '--permission-mode', 'acceptEdits', '--permission-prompts', 'none', '--strict-mcp-config', '--no-session-persistence', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--system-prompt', leadSystem()];
  if (r.model) args.push('--model', r.model);
  if (r.effort) args.push('--effort', r.effort);
  if (r.fast) args.push('--settings', JSON.stringify({ fastMode: true }));
  args.push(...r.args);
  return args;
}

function sessionFor(projectId, { renew = false } = {}) {
  const s = session;
  const usable = s?.alive && s.projectId === projectId;
  const key = onAgy() ? JSON.stringify(['agy', lead().model, leadSystem()]) : JSON.stringify(sessionArgs());
  // (Never the other brain's for a pass - the brains were switched - unless the kid waits for it.)
  const same = (s instanceof AgySession) === onAgy();
  if (usable && (s.kidWaiting || (!renew && same) || (s.turns < MAX_TURNS && s.key === key))) return s;
  s?.end();
  const dir = folderOf(projectId);
  fs.mkdirSync(path.join(dir, 'parts'), { recursive: true });
  // (On agy, the one started while the kid talked, if it's for this creation.)
  const ready = spare?.alive && spare.projectId === projectId && spare.key === key ? spare : null;
  if (ready) spare = null;
  // (Helpers always work in the foreground: the lead's turn ends only once they're done.)
  session = onAgy()
    ? ready || new AgySession(projectId, { system: leadSystem(), model: lead().model, label: 'agents' })
    : new Session(projectId, { args: sessionArgs(), cwd: dir, label: 'agents', model: lead().model, env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' } });
  session.dir = dir;
  session.files = null; // the page its files held when it last worked on them (null: never)
  session.shown = null; // the page as it last saw it, every line (its own edits in): no need to show it again
  return session;
}

// What's still to do for a creation (kept apart from the session, so a new one carries on).
let work = { projectId: null };
function workFor(projectId) {
  if (work.projectId !== projectId) work = { projectId, grow: false, wire: false, passes: 0, tries: 0, lastPass: null, note: '', checking: false, repairing: false, asked: '', rules: null };
  return work;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Is a pass (or a repair) at work on the creation? (The overwatch waits for it.)
export const busy = () => Boolean(work.checking || work.repairing);

// A pass still finishing (stopped for the kid): wait until it has put its files back.
async function settled(w) {
  for (let i = 0; (w.checking || w.repairing) && i < 100; i++) await sleep(100);
}

// Its own changes were taken out of the files (a pass stopped or that didn't run, a repair that
// didn't fix it): it's told, and it reads the files again before changing them.
// (On agy there are no files - it's shown the page again - and a conversation that ended, stopped for
// the kid, has nothing to be told: a new one takes over.)
function undone(s, w, why) {
  s.files = null;
  s.shown = null;
  if (!onAgy()) w.note = `Your last changes were taken out (${why}): the files are back to how they were before them - Read what you need.`;
  else if (s.alive) w.note = `Your last changes weren't used (${why}).`;
}

// What the kid says comes first: a pass at work stops (its fixer too), and any waiting are dropped.
let fixing = null;
function makeWay(s) {
  fixing?.abort();
  if (s.current?.kind === 'polish' || s.current?.kind === 'repair') s.interrupt();
  for (const t of s.queue.filter(t => t.kind === 'polish' || t.kind === 'repair')) {
    s.queue.splice(s.queue.indexOf(t), 1);
    t.finish(new Error('stale'));
  }
}

export function warm() {
  warmedAt = Date.now();
  if (!enabled()) return { warm: 0 };
  const before = session;
  try {
    const s = sessionFor(store.currentProject().id, { renew: true });
    // (Its helpers too: while the kid waits, they start on each job the moment it's written.)
    return { warm: (s === before ? 0 : 1) + spareFor(s) + (config().team?.warm === false ? 0 : (onAgy() ? 0 : warmVoice()) + keepHelpersWarm()) };
  } catch {
    return { warm: 0 };
  }
}

export function stop() {
  session?.end();
  session = null;
  dropSpare();
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
function historyNote(history) {
  const c = config();
  const lines = (history || []).slice(-c.historyTurns * 2).map(h => `${h.role === 'kid' ? 'Kid' : c.buddyName}: ${h.text}`);
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

// New parts for a change go in just before the main code (after the parts there are), so the main
// code can create them - or, on a page with no main code marked, at the end of its module script.
function addParts(html, parts) {
  const code = parts.map(x => `// ---- ${x.name}\n${x.code}\n\n`).join('');
  const at = html.search(/^\/\/ ---- main[ \t]*$/m);
  if (at >= 0) return html.slice(0, at) + code + html.slice(at);
  const end = html.lastIndexOf('</script>');
  log("agents: the page has no main code marked, so its new parts went at the end of its script");
  return end < 0 ? html : `${html.slice(0, end)}\n${code}${html.slice(end)}`;
}

// Methods one part calls on another (track.loopAt(x)) that the other never defines: the parts were
// written apart, and on the kit each is one object. (A field that isn't there is only undefined; a
// call is a crash.)
function missingMethods(html) {
  const pieces = html.split(/^\/\/ ---- ([\w-]+)[ \t]*$/m); // text, name, code, name, code, ...
  const uncomment = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1'); // (calls, not comments)
  const missing = [];
  for (let i = 1; i < pieces.length; i += 2) {
    const name = pieces[i];
    const own = pieces[i + 1];
    if (!new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`).test(own)) continue; // (an object of its own)
    // (Not in a part that has a name of its own like it - a local const sky = ctx.createLinearGradient(...),
    // or a parameter: (fish) => ..., update(dt, fish) { - but passing the part along, emit('ate', fish),
    // is no name of its own.)
    const word = new RegExp(`(?<![\\w$.])${name}(?![\\w$])`);
    const params = p => [...p.matchAll(/(?<!\b(?:if|for|while|switch|with)\s*)\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?:=>|\{)/g)].some(m => word.test(m[1].replace(/=[^,]*/g, '')));
    const local = p => new RegExp(`\\b(?:const|let|var)\\s+${name}\\b|(?<![\\w$.])${name}\\s*=>`).test(p) || params(p);
    const code = uncomment(pieces.filter((p, k) => k % 2 === 0 && (k === i + 1 || !local(p))).join('\n'));
    const called = new Set([...code.matchAll(new RegExp(`(?<![\\w$.])${name}\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g'))].map(m => m[1]));
    for (const m of called) if (!new RegExp(`(?:^|[\\s,{;])(?:async\\s+)?${m.replace(/\$/g, '\\$')}\\s*(?:\\(|:)|\\.${m.replace(/\$/g, '\\$')}\\s*=(?!=)|\\[\\s*['"]${m}['"]\\s*\\]\\s*=(?!=)`, 'm').test(own)) missing.push(`${name}.${m}()`);
  }
  return missing.length ? [`The parts call ${missing.join(', ')}, but ${missing.length > 1 ? 'those parts never define them' : 'that part never defines it'} (they were written apart): add ${missing.length > 1 ? 'them' : 'it'} to the part, or call what it has.`] : [];
}

// Parts in the kit's run([...]) that their part never declares (it named its object differently).
function missingParts(html) {
  const main = html.split(/^\/\/ ---- main[ \t]*$/m)[1] || '';
  const named = [...main.matchAll(/typeof ([A-Za-z_$][\w$]*) === 'undefined'/g)].map(m => m[1]);
  const gone = named.filter(id => !new RegExp(`^[ \\t]*(?:const|let|var|class|function)\\s+${id.replace(/\$/g, '\\$')}\\b`, 'm').test(html));
  return gone.length ? [`run([...]) runs ${gone.join(', ')}, but nothing declares ${gone.length > 1 ? 'them' : 'it'}: the part${gone.length > 1 ? 's' : ''} named ${gone.length > 1 ? 'their objects' : 'its object'} differently - use one name.`] : [];
}

// Names the page assigns to but never declares (fx_add = (...) => ..., const k = KB_ = keep): the
// page is a module, so the line throws the moment it runs - and the kit leaves that hook out from
// then on. Each gets a `var` (hoisted: it's there wherever it's first used) just before run([...]).
const KEYWORDS = new Set('break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield await async of static get set true false null undefined NaN Infinity implements interface package private protected public enum eval arguments'.split(' '));
export function undeclared(html) {
  // (Strings, template text and comments out, so only code is read.)
  const codeOf = scripts =>
    scripts
      .map(m => m[2])
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/`(?:\\[\s\S]|\$\{[^}]*\}|[^`\\])*`/g, '``')
      .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''")
      .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const bare = codeOf(scripts.filter(m => /\btype=["']?module\b/i.test(m[1])));
  // (Names any script declares count, so the page's other scripts are read for declarations too.)
  const all = codeOf(scripts);
  const declared = new Set();
  const add = text => { for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) declared.add(m[0]); };
  // Every name a const/let/var list declares (a = 1, b = 2, { c, d } = o), to the end of the list.
  for (const m of all.matchAll(/\b(?:const|let|var)\b/g)) {
    let depth = 0;
    let expect = true;
    let last = '';
    for (let i = m.index + m[0].length; i < all.length; i++) {
      const ch = all[i];
      if (/\s/.test(ch)) {
        if (ch === '\n' && depth === 0 && !expect && !/[,=+\-*/%&|^?:([{<>!~.]$/.test(last)) break;
        continue;
      }
      if (expect && depth === 0) {
        if (ch === '{' || ch === '[') {
          let d = 0;
          let j = i;
          for (; j < all.length; j++) {
            if ('{['.includes(all[j])) d++;
            else if ('}]'.includes(all[j]) && --d === 0) break;
          }
          add(all.slice(i, j + 1));
          [i, expect, last] = [j, false, ']'];
          continue;
        }
        const id = /^[A-Za-z_$][\w$]*/.exec(all.slice(i, i + 80))?.[0];
        if (id) {
          declared.add(id);
          [i, expect, last] = [i + id.length - 1, false, 'x'];
          continue;
        }
      }
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) {
        if (--depth < 0) break;
      } else if (ch === ';' && depth === 0) break;
      else if (ch === ',' && depth === 0) expect = true;
      last = ch;
    }
  }
  for (const m of all.matchAll(/\b(?:function\s*\*?|class)\s*([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of all.matchAll(/\bimport\s+(?:\*\s+as\s+)?([\s\S]*?)\s+from\b/g)) add(m[1]);
  // (Parameters: function (...) {, method(...) {, (...) =>, x =>, catch (e).)
  for (const m of all.matchAll(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?:=>|\{)/g)) add(m[1].replace(/=[^,]*/g, ''));
  for (const m of all.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) declared.add(m[1]);
  for (const m of all.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  // (And the window's own: window.level = 1 makes level a name every script can use.)
  for (const m of all.matchAll(/\b(?:window|globalThis|self)\.([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  const names = new Set();
  for (const m of bare.matchAll(/(?<![\w$.\])}'"`?:][ \t]*|[\w$.])([A-Za-z_$][\w$]*)[ \t]*(?:[-+*/%|&^]|\*\*|<<|>>>?|\|\||&&|\?\?)?=(?![=>])/g)) {
    const n = m[1];
    // (The window's own properties - onresize = ..., name = ... - are there already.)
    if (!KEYWORDS.has(n) && !declared.has(n) && !/^on[a-z]+$/.test(n) && !['name', 'status', 'location'].includes(n)) names.add(n);
  }
  return [...names];
}

// (Only if the page still parses as well as it did: a declaration this missed would make it twice.)
async function declareMissing(html) {
  const names = undeclared(html);
  if (!names.length || !/^\/\/ ---- main[ \t]*$/m.test(html)) return html;
  const next = html.replace(/^\/\/ ---- main[ \t]*$/m, m => `var ${names.join(', ')}; // (assigned, but never declared)\n\n${m}`);
  if ((await syntaxErrors(next)).length > (await syntaxErrors(html)).length) return html;
  log(`agents: the page assigned ${names.join(', ')} without declaring ${names.length > 1 ? 'them' : 'it'}, so ${names.length > 1 ? 'they were' : 'it was'} declared`);
  return next;
}

// Events emitted that nothing answers, and answered that nothing emits (for the log: wiring that
// didn't meet).
function eventGaps(html) {
  const names = re => new Set([...html.matchAll(re)].map(m => m[1]));
  const sent = names(/\bemit\(\s*['"]([\w-]+)['"]/g);
  const heard = names(/\bon\(\s*['"]([\w-]+)['"]/g);
  const deaf = [...sent].filter(n => !heard.has(n));
  const mute = [...heard].filter(n => !sent.has(n));
  return deaf.length || mute.length ? `events ${sent.size}${deaf.length ? `, unanswered: ${deaf.join(' ')}` : ''}${mute.length ? `, never sent: ${mute.join(' ')}` : ''}` : sent.size ? `events ${sent.size}, all met` : '';
}

// Does the page run? Problems found before it's shown go back to the lead once.
async function problemsIn(built) {
  if (!built?.html) return ['there is no page.html'];
  return [...built.missing.map(n => `a \`// @part ${n}\` line has no file parts/${n}.js`), ...(await syntaxErrors(built.html)), ...blankProblems(built.html)];
}

// ---------------------------------------------------------------------------------------------
// One build. Resolves like the classic way: { say, done, title, emoji, html, edited, backend }.
// Throws if it couldn't (the classic way takes over).

export { missingMethods, missingParts }; // (for tests)

export async function build({ page, history, text, alt, fix, title = '', look = pickLook(), last = false }, emit, state) {
  const t0 = Date.now();
  const secs = (t = Date.now()) => `${((t - t0) / 1000).toFixed(1)}s`;
  const p = store.currentProject();
  const w = workFor(p.id);
  let s = sessionFor(p.id, { renew: true });
  makeWay(s);
  await settled(w);
  // (Normally they're warm already: the app warms the team up while the kid talks.)
  keepHelpersWarm();
  await s.use(page ? lead().model : lead().firstModel || lead().model);
  await s.think(lead().thinking.build);
  makeWay(s); // (one that started meanwhile)
  // (agy can't stop a turn halfway: making way for the kid ended its conversation, so a new one takes
  // over - it's handed the page as it is.)
  if (!s.alive) s = sessionFor(p.id, { renew: true });
  dropSpare(); // (not needed after all: the pass had finished)

  const stopAll = new AbortController();
  const signal = stopAll.signal;
  const spent = { tokens: 0 };
  // Sparky answers out loud right away, while the team builds.
  let over = false;
  const sayNow = line => {
    if (over || state.said) return;
    state.said = line;
    emit({ type: 'say', text: line });
  };
  if (!fix) (onAgy() ? agyVoice : speakFirst)({ history, text, alt, title }, sayNow).catch(err => log(`agents voice failed: ${err.message.replace(/\s+/g, ' ').slice(0, 160)}`));

  const known = s.turns > 0 && Boolean(page) && s.files === page;
  sync(s, page); // (its files hold the page as it is, for when it works on them while the kid plays)
  const told = w.note;
  w.note = '';
  const creationLook = page ? p.versions.filter(x => x.look).at(-1)?.look || look : look;
  // What the creation was asked for (kept across turns; the first request after a restart).
  const first = page ? w.asked || p.versions.filter(x => !x.continues).at(-1)?.request || '' : text;
  const rules = path.join(s.dir, 'rules.md');
  // (Kept for its passes only once the page changes: a turn that only talked leaves them as they were.)
  const asks = !fix || !fs.existsSync(rules) ? { asked: first, latest: page && !fix && text !== first ? text : '', look: creationLook, freshLook: page && !fix && look !== creationLook ? look : '' } : null;
  if (asks) fs.writeFileSync(rules, helperRules(asks));

  // While the kid waits, the lead writes in text and its helpers start on each job as it's written.
  let chars = 0;
  const team = helperTracker(() => progress()); // (subagents, if it uses its tools after all)
  const progress = (n = 0) => {
    chars += n;
    emit({ type: 'progress', chars, helpers: crew.jobs.length + team.helpers.size, helpersDone: crew.done + team.done, team: true, leads: 1 });
  };
  const crew = helperCrew({ page, text: text || '(fixing a crash)', alt, look, signal, tally: spent, progress, size: QUICK_SIZE, hedgeMs: onAgy() ? 9000 : 5000, runner: runner(), max: QUICK_HELPERS, maxHedges: 2, twinFirst: true, kit: true });
  // A plan on the kit: its helpers are told what the kit gives them, along with the shared code.
  let own = null;
  const kind = () => (/^[ \t>*_#]*PLAN[*_]*:[ \t]*3d/im.test(reader.text) ? '3d' : '2d');
  const started = new Map(); // name → its job, as handed out
  const reader = new PlanReader(
    job => {
      // (A job read again - its stream started over - keeps the helper already on it.)
      if (started.get(job.name) === job.job) return;
      started.set(job.name, job.job);
      crew.start(job, reader);
    },
    () => {
      if (reader.shared != null) [own, reader.shared] = [reader.shared, `/* ${kitApi(kind())} */\n${reader.shared}`];
      return true;
    },
    { add: true },
  );
  progress();
  // It sees the code it may change: the page as it is, unless it's the page it last saw.
  const sees = Boolean(page) && s.shown !== page;
  const sawPage = s.shown; // (set again once this turn's outcome is known; a failed turn leaves it unknown)
  s.shown = null;
  const prompt = [
    !page ? 'The screen is blank - nothing has been built yet.' : sees ? `<current_page>\n${page}\n</current_page>` : 'The page is as you last saw it (with your last edits in).',
    told,
    !fix && `${page ? 'If this turns into a fresh new page, try' : 'For this new creation, try'} this look, unless the kid asked for something else: ${look}.`,
    !known && historyNote(history),
    fix ? `The page just crashed with this problem:\n${fix}\nFix it without changing anything else. Keep DONE very short.` : `The kid just said: "${text}"`,
    !fix && alt && `(The other listener heard: "${alt}". Little kids are hard to hear - use both versions and the conversation to work out what they meant.)`,
    'The kid is waiting: reply in text only, no tools.',
  ].filter(Boolean).join('\n\n');
  let heard = ''; // the lead's own words this build (an interrupted turn's TITLE line among them)
  let open = false; // a message of its own being written, and where its text began
  let from = 0;
  let heardFrom = 0;
  let planAt = null;
  let firstAt = null;
  let thought = 0;
  const turn = {
    priority: true,
    timeoutSec: Math.max(config().timeoutSec, 240),
    stallSec: 60,
    onText: chunk => {
      firstAt ??= Date.now();
      heard += chunk;
      reader.push(chunk);
      if (planAt == null && (reader.shared != null || reader.changes)) planAt = Date.now();
      progress(chunk.length);
    },
    onEvent: ev => {
      // A message that starts again without ending (its stream was retried): what it wrote is taken
      // back (the session drops it too), and the plan is read again from there.
      const se = ev.type === 'stream_event' && !ev.parent_tool_use_id ? ev.event : null;
      if (se?.type === 'message_start') {
        if (open) {
          reader.rewind(from);
          heard = heard.slice(0, heardFrom);
        }
        [open, from, heardFrom] = [true, reader.text.length, heard.length];
      } else if (se?.type === 'message_stop') open = false;
      team.onEvent(ev);
      if (!ev.parent_tool_use_id && ev.event?.delta?.type === 'thinking_delta') thought += ev.event.delta.thinking.length;
      // (The helpers' writing keeps the building blocks coming too.)
      if (ev.parent_tool_use_id && ev.type === 'stream_event' && ev.event?.delta?.type === 'text_delta') progress(ev.event.delta.text.length);
    },
  };
  let reply;
  let stuck = null;
  let stopped = [];
  // A subagent gone silent stops the lead's turn - and with it every one still at work. Once more
  // in the turn that follows, and the build fails (the classic way takes over).
  const watch = setInterval(() => {
    const job = s.current?.interrupted ? null : team.stuck(HELPER_STALL_MS);
    if (!job) return;
    [stuck, stopped] = [job, team.stopAll()];
    log(`agents: a helper got stuck (${job}), stopping the turn${stopped.length > 1 ? ` and ${stopped.length - 1} more helpers` : ''}`);
    s.interrupt();
  }, 5000);
  let html = null;
  let edited = false;
  let how = '';
  let r;
  let exact = true; // (the page holds every line it wrote, as it wrote it)
  try {
    try {
      reply = await s.ask(prompt, turn).catch(err => {
        if (!stuck || err.message !== 'interrupted') throw err;
        const said = heard; // (its TITLE line came in the turn that was stopped)
        const others = stopped.filter(j => j !== stuck);
        const ask = `Your helper for "${stuck}" got stuck, so your turn was stopped${others.length ? ` - and with it your helpers for ${others.map(j => `"${j}"`).join(', ')}, before they finished` : ''}. Their files may be missing or half-written: write what they were doing yourself now (or hand it to new helpers), then make it all fit and end with DONE.`;
        return s.ask(ask, turn).then(r => ({ ...r, text: `${said}\n${r.text}` }));
      });
    } finally {
      clearInterval(watch);
    }
    // (Anything of its reply that didn't stream is read too.)
    if (reply.text.length > reader.text.length && reply.text.startsWith(reader.text)) reader.push(reply.text.slice(reader.text.length));
    reader.push('\n');
    const leadAt = Date.now();
    r = parseReply(reply.text);
    fs.writeFileSync(path.join(s.dir, 'lead-reply.txt'), reply.text); // (what it wrote last, for a look)
    // Edits that don't fit after the fixer: a few are left out (the app tries the page first);
    // more, and the classic way takes over.
    const fitOrThrow = async (fitted, all) => {
      if (fitted.failed.length || fitted.fixed) exact = false;
      if (!fitted.failed.length) return fitted.html;
      if (fitted.failed.length > 2 || fitted.failed.length * 3 > all.length || (await syntaxErrors(fitted.html)).length) throw new Error(`edits didn't fit: ${fitted.failed[0].find.trim().split('\n')[0].slice(0, 60)}`);
      log(`agents: ${fitted.failed.length} of ${all.length} edits still didn't fit, shown without ${fitted.failed.length > 1 ? 'them' : 'it'}`);
      return fitted.html;
    };
    const slowest = parts => ` (${parts.map(x => `${x.name} ${secs(x.startedAt)}→${x.firstAt ? `${secs(x.firstAt)}→` : ''}${secs(x.doneAt)} ${(x.code || x.reply).length}c`).join(', ')})`;
    if (reader.shared != null) {
      if (!reader.jobs.length) throw new Error('the plan has no parts');
      const parts = await Promise.all(reader.jobs.map(j => crew.running.get(j.name)));
      const main = reader.main();
      const order = (/^[ \t>*_#]*RUN[*_]*:[ \t]*(.+)$/im.exec(reply.text)?.[1] || '').split(/[^\w-]+/).map(x => x.toLowerCase()).filter(Boolean);
      // (Its own main code, if it wrote one; otherwise the kit runs the parts - its own rules part first.)
      const rules = RULES_BLOCK.exec(reply.text)?.[1]?.trim();
      const all = rules && !parts.some(x => x.name === 'rules') ? [{ name: 'rules', code: rules }, ...parts] : parts;
      html = main != null && !order.length ? teamAssemble(own, parts, main) : kitPage(kind(), own, all, rules ? ['rules', ...order.filter(n => n !== 'rules')] : order);
      how = `${thought ? `thought ${thought}c, ` : ''}first word ${secs(firstAt)}, shared code ${secs(planAt)}, lead done ${secs(leadAt)} (${reply.text.length}c), ${parts.length} helpers${slowest(parts)}`;
    } else if (reader.adding && reader.jobs.length) {
      if (!page) throw new Error('new parts on a blank page');
      const parts = await Promise.all(reader.jobs.map(j => crew.running.get(j.name)));
      const wired = r.edits.length ? await fitOrThrow(await applyEditsWithFixer(page, r.edits, signal, spent, runner()), r.edits) : page;
      html = addParts(wired, parts);
      edited = true;
      how = `lead done ${secs(leadAt)} (${reply.text.length}c, ${r.edits.length} edits), ${parts.length} new parts${slowest(parts)}`;
    } else if (reader.changes && reader.jobs.length) {
      if (!page) throw new Error('changes on a blank page');
      const changes = await Promise.all(reader.jobs.map(j => crew.running.get(j.name)));
      const edits = [...r.edits, ...changes.flatMap(c => parseReply(c.reply).edits)];
      if (!edits.length) throw new Error('the helpers wrote no changes');
      html = await fitOrThrow(await applyEditsWithFixer(page, edits, signal, spent, runner()), edits);
      edited = true;
      how = `lead done ${secs(leadAt)}, ${changes.length} helpers changing it with ${edits.length} edits${slowest(changes)}`;
    } else if (r.edits.length) {
      if (!page) throw new Error('edits on a blank page');
      html = await fitOrThrow(await applyEditsWithFixer(page, r.edits, signal, spent, runner()), r.edits);
      edited = true;
      how = `its own ${r.edits.length} edits, ${secs(leadAt)}`;
    } else if (r.html) {
      html = r.html;
      how = `it wrote it all, ${secs(leadAt)}`;
    } else {
      // It used its tools after all: what its files hold now.
      const files = assemble(s.dir);
      if (files?.html && files.html !== (page || '') && !files.missing.length) {
        html = files.html;
        how = `with its tools, ${secs(leadAt)}`;
      }
    }
  } catch (err) {
    stopAll.abort();
    over = true;
    if (page) sync(s, page);
    throw err;
  }

  if (!html || html === page) {
    over = true;
    // It only talked (or changed nothing): the files stay as they were. Only its own SAY means
    // there was nothing to build - otherwise the classic way builds it.
    if (page) sync(s, page);
    if (asks && w.rules) fs.writeFileSync(rules, helperRules(w.rules));
    if (fix || !r.say) throw new Error(fix ? 'the fix changed nothing' : page ? 'it changed nothing' : "it didn't build anything");
    s.shown = sawPage === page || sees ? page : null; // (it saw the page, now or before, and changed nothing)
    log(`ok   ${brainName()} agents ${secs()} only talked, turn ${s.turns}`);
    // (When the quick voice spoke first, the lead's answer is said too, as in team mode.)
    return { say: state.said || r.say, done: state.said && state.said !== r.say ? r.say : '', title: r.title, emoji: r.emoji, html: null, edited: false, look, backend: `${brainName()} agents` };
  }

  // Every script should parse before it's shown: what can be put right here is, the rest goes back
  // to the lead once (as edits, in text).
  const raw = html;
  html = await renameClashes(html);
  const named = repairNames(html);
  html = await declareMissing(named.html);
  let problems = [...(await syntaxErrors(html)), ...blankProblems(html), ...named.problems, ...missingMethods(html), ...missingParts(html)];
  // (Did it write every line of the change itself, and is each in as it wrote it?)
  let mine = exact && html === raw && !crew.jobs.length && !team.helpers.size;
  if (problems.length) {
    log(`agents: page doesn't run (${problems.join('; ').slice(0, 160)}), asking it to fix that`);
    const fixReply = await s
      .ask(`<page_as_put_together>\n${html}\n</page_as_put_together>\n\nBefore it's shown: it doesn't run -\n${problems.join('\n')}\nReply with only FIND/REPLACE edits to the page above that fix just that (text only, no tools).`, { priority: true, timeoutSec: 90, stallSec: 45 })
      .catch(() => null);
    const fixed = fixReply && parseReply(fixReply.text).edits.length ? await applyEditsWithFixer(html, parseReply(fixReply.text).edits, signal, spent, runner()).catch(() => null) : null;
    if (fixed) {
      const left = [...(await syntaxErrors(fixed.html)), ...blankProblems(fixed.html), ...repairNames(fixed.html).problems, ...missingMethods(fixed.html), ...missingParts(fixed.html)];
      log(`agents: ${left.length ? `still doesn't run (${left[0].slice(0, 120)})` : 'fixed'} at ${secs()}`);
      if (left.length < problems.length) [html, problems] = [fixed.html, left];
    }
    mine = false;
  }
  over = true;

  // The page as files (its passes work on them), put together again exactly as it's shown.
  const built = keepAsFiles(s.dir, html);
  s.files = built;
  s.shown = mine ? built : null; // (its helpers' code it hasn't seen yet)
  if (asks) w.rules = asks;
  // Its helpers wrote code it hasn't seen: the next pass makes it fit first. (On agy, where that pass is
  // the only one, one still to come - stopped for the kid, or not run yet - stays to come after a change
  // made with its own edits.)
  if (crew.jobs.length || !(onAgy() && edited && w.wire)) [w.wire, w.wireTries] = [crew.jobs.length > 0, 0];
  // (The version it'll be: a pass still to come is for it and the versions made from it, not one undone.)
  if (crew.jobs.length) w.wireFor = store.currentProject().versions.reduce((m, v) => Math.max(m, v.n), 0) + 1;
  // Something new: it's grown into its full version in the next pass.
  const fresh = !page || (!edited && r.title && r.title !== p.title && !sameCreation(page, built));
  if (fresh) {
    [w.grow, w.passes, w.tries, w.asked] = [true, 0, 0, text || w.asked];
    // (Its grow pass's helpers go by the new creation's request and look.)
    if (page) fs.writeFileSync(rules, helperRules((w.rules = { asked: text, look })));
  } else [w.passes, w.tries] = [0, 0];
  // (Starting programs takes the computer's attention: the helpers taken are replaced once the page is
  // ready, for the kid's next turn - on agy, not after the last thing they could ask for: ai.build
  // stops the ones still waiting then.)
  if (!(last && onAgy())) keepHelpersWarm();
  // (agy's helpers don't say how many tokens they wrote.)
  log(`ok   ${brainName()} agents ${secs()} ${how}, ${built.length} chars, ${onAgy() ? '' : `${spent.tokens} helper tokens, `}${eventGaps(built) || 'no events'}, turn ${s.turns}`);
  const sameOne = Boolean(page) && (edited || sameCreation(page, built));
  return { say: state.said || r.say, done: r.done, title: r.title, emoji: r.emoji, html: built, edited: sameOne, look, backend: `${brainName()} agents` };
}

// ---------------------------------------------------------------------------------------------
// After it appears: the lead looks at a screenshot of its creation running and makes it better (the
// app asks: POST /api/check). Its changes become a new version that slides in at a calm moment.

function running(report, shot) {
  const r = report || {};
  const slow = r.fps != null && r.fps < 30 ? '\nIf that feels slow, make each frame lighter - never by taking away what the look asked for.' : '';
  return `<how_it_is_running>\nRunning at ${r.fps ?? '?'} frames per second${r.canvas ? ` on a ${r.canvas} canvas` : ''}.${slow}\nErrors while running: ${r.errors?.length ? r.errors.slice(-5).join(' | ') : 'none'}\n</how_it_is_running>\n\n${
    shot ? `A screenshot of it right now is in the file ${shot} - look at it first (with the Read tool).` : onAgy() ? 'There is no screenshot, so judge from the page above and how it runs.' : 'There is no screenshot, so judge from the files.'
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
  if (!enabled() || config().team.check === false) return { skipped: 'off' };
  let p = store.currentProject();
  if (p.id !== projectId || p.current !== version || isBusy() || !madeByAgents(p, version)) return { skipped: 'stale' };
  const w = workFor(projectId);
  // (On agy the wire pass is the only one: polished enough unless it's still to come for this version -
  // answered before the lead is touched, so it still knows the page as it last saw it.)
  if (onAgy() && w.wire && !wireIsFor(p, version, w)) w.wire = false;
  if (onAgy() ? !w.wire : (w.passes >= passes() && !w.grow) || w.tries >= passes() + 2) return { skipped: 'polished enough' };
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
  let rules = null;
  const shot = onAgy() ? null : saveScreenshot(s.dir, screenshot); // (agy's lead has no tools to look at one)
  try {
    // (Its helpers wrote parts of it while the kid waited: it reads them before it changes them.)
    const unseen = s.shown !== page && "Some of its code you haven't seen yet (your helpers wrote it while the kid waited): Read page.html and the parts before you change them.";
    const note = [sync(s, page), unseen, w.note].filter(Boolean).join(' ');
    s.shown = null;
    before = snapshot(s.dir);
    // (Its helpers write fuller parts while the kid plays; the quick rules come back after.)
    rules = w.rules || { asked: w.asked || p.versions.filter(x => !x.continues).at(-1)?.request || '', look: p.versions.filter(x => x.look).at(-1)?.look || '' };
    fs.writeFileSync(path.join(s.dir, 'rules.md'), helperRules({ ...rules, freshLook: '', quick: false }));
    if (w.wire) return await wirePass({ s, w, p, page, report, shot, stale, took, before });
    if (onAgy()) return { skipped: 'polished enough' }; // (growing and looking it over need Claude Code's tools)
    const grow = w.grow;
    const prompt = [
      note ? `${historyNote(p.history)}\n\n${note}` : 'Here it is, running - the kid has been playing with it.',
      running(report, shot && path.basename(shot)),
      grow ? GROW : LOOK,
      "Keep it the kid's creation: don't change what they chose, keep the controls and the KB.keep names.",
    ].filter(Boolean).join('\n\n');
    await s.use(lead().model);
    await s.think(lead().thinking.look);
    if (stale()) return { skipped: 'stale' };
    w.note = '';
    w.tries++;
    const reply = await s.ask(prompt, { timeoutSec: 600, stallSec: 150, kind: 'polish' });
    const why = field(reply.text, 'WHY') || 'made it better';
    const done = () => {
      w.passes++;
      if (grow) w.grow = false;
    };
    let built = assemble(s.dir);
    if (built?.html && !built.missing.length) {
      const declared = await declareMissing(built.html);
      if (declared !== built.html) built = { html: keepAsFiles(s.dir, declared), missing: [] };
    }
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
    p = store.addVersion(store.currentProject(), built.html, { request: `(agents polish) ${why}`, backend: `${brainName()} agents polish`, continues: true });
    s.files = built.html;
    w.lastPass = { version: p.current, grow, before };
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
  }
}

// The next pass makes the page fit first (a page it hasn't read - the bench uses it to try the wire
// pass on a page put in from outside).
export function wireNext(projectId) {
  Object.assign(workFor(projectId), { wire: true, wireFor: null });
}

// Is version n the one with its helpers' code the wire pass is for, or made from it? (Not after the kid
// went back to before it.)
function wireIsFor(p, n, w) {
  if (w.wireFor == null) return true;
  for (let v = p.versions.find(x => x.n === n), i = 0; v && i < 500; v = p.versions.find(x => x.n === v.from), i++) {
    if (v.n === w.wireFor) return true;
    if (v.n < w.wireFor) return false;
  }
  return false;
}

// The wire pass (see WIRE): edits in text, with a look at the screenshot (on agy, without one).
async function wirePass({ s, w, p, page, report, shot, stale, took, before }) {
  // (A wire turn that fails - a refusal, a stall - is tried once more on the next check.)
  w.wireTries = (w.wireTries || 0) + 1;
  if (w.wireTries >= 2) w.wire = false;
  const gaps = [...missingMethods(page), ...missingParts(page), eventGaps(page)].filter(x => x && !/all met$/.test(x));
  const prompt = [
    `<current_page>\n${page}\n</current_page>`,
    running(report, shot && path.basename(shot)),
    gaps.length && `Build Buddy noticed: ${gaps.join(' ')}`,
    WIRE,
  ].filter(Boolean).join('\n\n');
  // (On agy, a pass that ends without its version - stopped for the kid - is still to come, after them.)
  const later = () => onAgy() && ([w.wire, w.wireTries] = [true, w.wireTries - 1]);
  await s.use(lead().model);
  await s.think(lead().thinking.wire);
  if (stale()) {
    later();
    return { skipped: 'stale' };
  }
  const asking = s.ask(prompt, { timeoutSec: 240, stallSec: 90, kind: 'polish' }).catch(err => {
    if (err.message === 'interrupted') later();
    throw err;
  });
  // (The kid started talking just before it began: their request will end it, so a new lead waits.)
  if (Date.now() - warmedAt < 30000) spareFor(s);
  const reply = await asking;
  const edits = parseReply(reply.text).edits;
  // (On agy, a reply with no edits that doesn't say OK - empty, or a tool it tried to use - is a turn
  // that failed.)
  if (onAgy() && !edits.length && !/^[ \t>*_`#]*OK\b/m.test(reply.text)) {
    log(`AGENTS wire fail ${took()} ${reply.text.trim() ? 'no edits and no OK' : 'an empty reply'}${w.wire ? ', tried again on the next check' : ''}`);
    return { skipped: 'failed' };
  }
  w.wire = false;
  const why = field(reply.text, 'WHY') || 'made its parts fit';
  if (!edits.length || stale()) {
    s.shown = page;
    if (edits.length) later();
    log(`AGENTS wire ${took()} ${edits.length ? 'stale' : 'OK'}`);
    return edits.length ? { skipped: 'stale' } : { ok: true };
  }
  const stop = (fixing = new AbortController());
  const fitted = await applyEditsWithFixer(page, edits, stop.signal, null, runner())
    .catch(err => (stop.signal.aborted ? null : Promise.reject(err)))
    .finally(() => fixing === stop && (fixing = null));
  if (!fitted) {
    later();
    log(`AGENTS wire stop ${took()} (the kid asked for something)`);
    return { skipped: 'stale' };
  }
  const html = await declareMissing(await renameClashes(fitted.html));
  if ((await syntaxErrors(html)).length > (await syntaxErrors(page)).length || stale()) {
    if (stale()) later();
    log(`AGENTS wire skip ${took()} ${why} (${stale() ? 'stale' : "it didn't run"})`);
    return { skipped: stale() ? 'stale' : "the change didn't run" };
  }
  const built = keepAsFiles(s.dir, html);
  p = store.addVersion(store.currentProject(), built, { request: `(agents wire) ${why}`, backend: `${brainName()} agents polish`, continues: true });
  s.files = built;
  s.shown = !fitted.failed.length && !fitted.fixed && html === fitted.html ? built : null;
  w.lastPass = { version: p.current, grow: false, wire: true, before };
  log(`AGENTS wire ${took()} ${why} (${edits.length} edits${fitted.failed.length ? `, ${fitted.failed.length} didn't fit` : ''}) → v${p.current}`);
  return { fixed: true, verdict: 'fix', why, html: store.html(p), version: p.current };
}

// One of its passes crashed when the app tried it out of sight, so it was taken back (POST
// /api/drop-fix): its files go back to how they were, it's told why, and a lost grow happens again.
export function takenBack({ projectId, version, error }) {
  const w = workFor(projectId);
  if (w.lastPass?.version !== version) return;
  if (session?.projectId === projectId && w.lastPass.before) {
    restore(session.dir, w.lastPass.before);
    session.files = assemble(session.dir)?.html ?? null;
  }
  w.note = `Your last changes were taken back: with them in, it crashed when it was tried (${String(error || '').slice(0, 200)}).`;
  if (w.lastPass.grow) w.grow = true;
  if (!w.lastPass.wire) w.passes = Math.max(0, w.passes - 1); // (the wire pass isn't one of the counted ones)
  w.lastPass = null;
}

// ---------------------------------------------------------------------------------------------
// Its new page crashed when the app tried it out of sight, before showing it: the lead repairs it
// (proposed, then taken only if it runs - like the other ways of building).

const proposals = new Map();

export async function repair({ version, errors, keep, accept = false }) {
  let p = store.currentProject();
  const v = p.versions.find(x => x.n === version);
  if (!enabled() || p.current !== version || !/^(claude|agy) agents$/.test(v?.backend || '')) return { skipped: 'stale' };
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
  sync(s, page);
  const before = snapshot(s.dir);
  w.repairing = true;
  try {
    await s.use(lead().model);
    await s.think(lead().thinking.build); // (the kid is waiting)
    // In text, like its changes while the kid waits: edits to the page as it is.
    const sees = s.shown !== page;
    const reply = await s.ask(
      [
        sees ? `<current_page>\n${page}\n</current_page>` : 'The page is as you last saw it (with your last edits in).',
        keep
          ? `It crashes when it starts with the kid's saved progress (KB.keep hands it back these values):\n${JSON.stringify(keep).slice(0, 1500)}\nThe error:\n${String(errors).slice(0, 1500)}\nMake it carry on from those values instead, changing nothing else.`
          : `When it was tried, it crashed:\n${String(errors).slice(0, 2000)}\nFix just that.`,
        'The kid is waiting: reply with only FIND/REPLACE edits (text only, no tools).',
      ].join('\n\n'),
      { priority: true, timeoutSec: 120, stallSec: 60, kind: 'repair' },
    );
    const edits = parseReply(reply.text).edits;
    const fitted = edits.length ? await applyEditsWithFixer(page, edits, null, null, runner()) : null;
    // (Or it used its tools after all: what its files hold now.)
    const html = fitted && !fitted.failed.length ? fitted.html : assemble(s.dir)?.html;
    if (!html || html === page || (await syntaxErrors(html)).length > (await syntaxErrors(page)).length) {
      restore(s.dir, before);
      undone(s, w, "they didn't fix the crash");
      return { skipped: 'no fix' };
    }
    const built = { html: keepAsFiles(s.dir, html) };
    s.shown = fitted && !fitted.failed.length && !fitted.fixed ? built.html : null;
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
