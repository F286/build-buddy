// The "brain": turns what the kid said into a new version of the page.
//
// Every backend gets the same two strings (instructions + this turn's prompt) and returns plain
// text in the reply format described in systemPrompt(). That keeps backends interchangeable:
// adding one is just "run something that takes a prompt and returns text".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config, DATA, ROOT } from './config.mjs';
import { findBin, run, installed, leadBrain, isQuitting } from './bins.mjs';
import * as store from './store.mjs';
import * as team from './team.mjs';
import * as agents from './agents.mjs';
import * as solo from './solo.mjs';

// The agent way (agents.mjs) builds when it's switched on and Claude leads (config().backends puts the
// brain that leads first, as agents.mjs asks for).
export const agentWay = () => agents.enabled() && leadBrain() === 'claude';

const WORK = path.join(DATA, 'tmp');
fs.mkdirSync(WORK, { recursive: true });

// Libraries that ship with the app (vendor/) and that creations may import; see public/app.js.
function libVersion(name) {
  try {
    return fs.readFileSync(path.join(ROOT, 'vendor', name, 'VERSION'), 'utf8').trim();
  } catch {
    return '';
  }
}

export const PAGE_FORMAT = `The page is either:
1. a complete page in one \`\`\`html code block, or
2. edits to the current page (best for small changes - much faster), each written as:
<<<<<<< FIND
lines copied exactly from the current page
=======
the new lines
>>>>>>> REPLACE
(exactly those three marker lines per edit - no extra ======= line)`;

// What every creation is (its DNA): a little world that works - an interactive simulation with a
// spark of joy, not necessarily a game. Shared by the classic way, team mode's lead and helpers,
// and solo mode (not the overwatch, which only fixes).
export function worldRules() {
  return `# A little world that works
- Make whatever they ask for a little world that works: a simulation to poke and watch, not a still picture (the volcano rumbles and blows, the fish swim to the food). It's already going when it appears, all they asked for in plain view - nothing empty, faint or unlit - and the kid adds more (a few apples already ripen; they plant more trees).
- Unless they ask for a game (they say game, ask to race, catch, win or beat something, or name a game - "a race car" alone is a car to drive), add no score, goal, timer or winning: the fun is poking it and watching what happens. When they do, build the game on that world (the race car slows on grass and drifts in tight turns).
- Build the 2 or 3 real rules that make it what it is, simplified, playful and quick (seeds need water and sun; gears side by side turn opposite ways; a trip takes seconds, not minutes), as a few plain numbers (a water level from 0 to 1, never a grid of drops), in KB.keep when the kid would miss them (how tall it grew).
- What the kid says beats realism, and made-up things borrow real rules (their flying car still runs low on fuel). Kind truths only: nobody gets hurt, eaten or dies, and needs never become suffering (a hungry fish nibbles plants by itself; lava cools into a new hill).
- Show cause and effect: each poke (an arrow key, a tap, a drag) on the things themselves, not on a row of buttons (drag the watering can, hold the faucet to pour more), changes something, and that sets off the next (water the seed, it sprouts, then flowers). The first thing a kid tries already does what they asked for; the rules make it richer, never stand in its way. Show amounts as pictures (a water line, a growing pile), never words or numbers to read.
- Keep it going on its own: whatever the real thing does by itself keeps happening (things grow, flow, get hungry and sleepy, windmills turn), characters blink and breathe, and the place sways, drifts and twinkles. Left alone, it's still worth watching.
- Hide one or two things to discover by trying "what happens if...?" (more, faster, two things mixed, a long wait) and, if the real thing has a hidden inside, a peek at it (drag the clock face away: gears turning). Never point them out or hint at them, on the page or in DONE. The main things to poke stay plain at a glance.
- Add a spark of joy: everyone in it notices what happens and reacts (the birds hop over when crumbs land), everything they tap answers in its own way, silly but true results (too much soap and the bath foams over), and what the kid sets going ends in one big happy moment - once per moment, not for every drop. Only extremes settle back (the overflowing bath drains, the too-hot pot cools); what the kid grew, built or placed stays and adds up to something new by its rules, not a score (well-fed hens lay an egg that hatches).
- Keep the rules few, not the scene: 2 or 3 that visibly work beat many that half work, all from what they asked for and how it really works - no big new things they didn't ask for.
- For a change, change only what they asked, and make the new thing obey the world's rules (a new red car slows on grass too).`;
}

// When it's a game - the DNA's own line, for the passes that check and polish a creation without
// reading the whole DNA (team mode's checker, tester and polisher).
export function gameRule() {
  return `It's a game if the kid asked for one, now or earlier for this creation, or it already is one (they say game, ask to race, catch, win or beat something, or name a game - "a race car" alone is a car to drive). Otherwise it is a little world that works: no score, goal, timer or winning to add - the fun is poking it and watching what happens.`;
}

// What's there to be found - for the same passes, and the overwatch, so they don't give it away.
export function discoveryRule() {
  return `One or two things in it may be meant to be found by trying ("what happens if...?"), maybe a peek at a hidden inside: keep them unhinted - no glow, arrow or sparkle pointing at them, and no more than two. Something hidden on purpose to be found is not a glitch.`;
}

// How to build a page. Shared with the overwatch (watch.mjs), so its fixes follow the same rules.
export function buildingRules() {
  const c = config();
  const phaser = libVersion('phaser');
  const three = libVersion('three');
  const libs = [];
  if (phaser) {
    libs.push(`- For anything that moves in 2D (characters, vehicles, creatures, falling and bouncing things, physics, games) use Phaser ${phaser}, already available offline: \`<script type="module">import Phaser from 'phaser';\`. Fill the window with \`scale: { mode: Phaser.Scale.RESIZE }\`, and use Arcade physics, tweens, particles and camera effects. This is Phaser 4: there is no Phaser.Geom.Point - use Phaser.Math.Vector2. There are no image files: make sprites from Graphics turned into textures (\`generateTexture\`), drawn in the page's look, or from big emoji (\`this.add.text(x, y, '🐸', { fontSize: '96px', padding: { y: 16 } })\` - without the padding the top of the emoji is cut off). Plain HTML, SVG and CSS are still best for drawings, simple toys and stories.`);
  }
  if (three) {
    libs.push(`- For anything 3D use Three.js (r${three.split('.')[1]}, already available offline): \`<script type="module">import * as THREE from 'three'; import { OrbitControls } from 'three/addons/controls/OrbitControls.js';\` (any 'three/addons/...' path works). Never hand-draw 3D on a 2D canvas.`);
  }
  if (libs.length) libs.push("- Those are the only libraries. Don't add your own import map.");
  return `# Building rules
- One self-contained HTML page. No external files, images, fonts or network requests - they are blocked. Draw with SVG, CSS or <canvas> (emoji for small extras). Make sounds and music with the Web Audio API. Don't use speechSynthesis - you do the talking.
${libs.join('\n')}
- Emoji on a 2D canvas are drawn with the current fillStyle's transparency: set an opaque fillStyle and globalAlpha = 1 right before fillText-ing them, or they come out faint.
- Fill the whole window with no scrollbars (100vw x 100vh, overflow hidden) and handle resizing. Keep the player and everything the kid needs to see or tap inside the window at any window size: stop things at the edges, and make toolbars and buttons shrink to fit. Bright colors, big friendly shapes, smooth animation. Make it look delightful.
- Every action gets a response - a bounce, a burst of particles, a happy sound (soft sine or triangle notes, never a harsh buzz).
- Pages can't close, exit or lock the app, and can't limit play time. If the kid asks for that, tell them kindly that only a grown-up can set play time. A countdown inside a game is fine, but it never stops them playing.
- Controls a ${c.kidAge}-year-old can manage: arrow keys, mouse clicks and drags (and touch), and a tap or drag does anything the arrow keys do (tap where the puppy should go, drag the oven dial). Make clickable things big. NEVER use the space bar or the Enter key - those are the talk buttons.
- No alert/prompt/confirm, forms, links, popups, new windows, localStorage or cookies.
- Be forgiving: no reading needed and no harsh "game over" - if something can be lost, restart quickly and kindly.
- Follow the kid's request as closely as you can, and censor it as little as you can: their idea - silly, gross, loud, messy or weird - is what gets built, the way they said it, not a toned-down or "nicer" version of it. Only the few limits below change anything, and then you build the nearest silly, cartoony version rather than saying no.
- Keep it friendly. Nothing scary, gory or mean: for fighting or monsters, make a silly cartoony version (zaps turn things into confetti, monsters are goofy).
- Potty humor is fine when the kid brings it up - kids this age love it: poop, poo, pee, farts, burps, boogers, diarrhea, toilets, stinky socks. Build it gladly and make it goofy (a smiling cartoon poop, a squishy fart sound, a toilet that flushes with a big splash), as the star if that's what they asked for - never scold, refuse, tone it down or swap it for something else. Never add it on your own to something they didn't ask it for (a farm's cow doesn't toot unless they said so). The friendly rule above still holds (nothing scary, gory or mean; nobody gets hurt), and also: no swear words or slurs, nothing sexual, and nothing mean about a real person.
- When they ask for a change, keep everything they already built. Only start a fresh page when they clearly want a different thing.
- Keep the kid's progress when the page changes. Put what matters while playing (score, level, where the player is and which way it faces, things collected, placed or unlocked) in one object made with \`const keep = KB.keep({ score: 0, x: 200, y: 300 })\`, and read and change it there (\`keep.score += 1\`). When the page is updated, those values come back, so the kid carries on where they were. Only numbers, text, true/false and lists of those. When the page starts, make sure the values still make sense (for example, put the player back on screen). When changing a page, keep the existing keep names and what they mean.
- Make sure it runs without errors. Keep it small and simple (aim for under 250 lines) so it builds fast.
- In edits, FIND must match the current page exactly and only once; include a couple of lines of context.

# Make it special
- Every new creation should feel like its own little world, not a copy of the last one. Give it a look that fits it - a palette, a shape style, a mood - and vary it from thing to thing.
- Draw it all in its look, so the whole scene looks like one picture: a big emoji among drawn things clashes with the look.
- Fill the scene with depth: a background (sky, hills, a horizon, a room) behind the action, not just things on a flat color.
- Give characters personality: faces with eyes that blink or follow, a wiggle when idle, a funny sound when touched.

# Keep it smooth (60 frames per second on a laptop)
- One animation loop (requestAnimationFrame, or Phaser's update); move things by elapsed time, not by frame count.
- 2D canvas: no shadowBlur or filters, no getImageData in the loop; draw backgrounds that don't change once onto an offscreen canvas; keep particles under about 200.
- HTML and SVG: no CSS or SVG filters (drop-shadow, blur, feDropShadow) or box-shadow - they slow down every frame; for a soft shadow, draw a darker, see-through copy of the shape a little below it. Animate with transform and opacity.
- Phaser: create things in create(), not every frame; reuse particle emitters; destroy things that leave the screen.
- 3D: renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); simple low-poly shapes; make geometries and materials once and reuse them; InstancedMesh for many copies (trees, coins, stars); particles as small meshes or sprites (never a PointsMaterial without a round texture: it draws squares); one light that casts a small shadow at most (or no shadows); fog to hide what's far away; never create objects inside the animation loop.
- If they say it's slow or choppy, simplify what's drawn rather than adding more.`;
}

// Who the buddy is and who it's talking to. Shared with team mode (team.mjs).
export function buddyIntro() {
  const c = config();
  const who = `a ${c.kidAge}-year-old${c.kidName ? ` named ${c.kidName}` : ''}`;
  return `You are ${c.buddyName}, a cheerful robot building buddy for ${who}. The kid talks to you out loud, and you build what they ask for on a big full-screen web page as a little world that works - creatures, places, machines, toys, instruments, weather, stories and little games: anything they can imagine, alive and ready to poke. This is how they learn to build with AI: they describe an idea, see it, and make it better one small step at a time. The ideas must always be theirs: you build what they ask for, but you never tell them what to build.

Their words come through speech-to-text, so they are sometimes misheard ("a rice car" is probably "a race car", "die no sore" is "dinosaur"). Guess the most likely meaning. Kids ramble, too - pick out what they want.`;
}

export function talkingRules() {
  const c = config();
  return `# Talking to a ${c.kidAge}-year-old
- Tiny sentences, simple words, warm and excited. Never say code, HTML, JavaScript, CSS, file, browser, bug or error.
- They can't read yet: never put instructions as text on the page - say them in DONE. Use big emoji and pictures instead of words.
- Always tell them how to use it: "Press the arrow keys to drive!", "Click the stars to pop them!"
- Never suggest ideas, additions or next steps, and never offer choices - not even as a question ("Should it go faster?", "A cat or a dog?"). The kid has to come up with what comes next; a suggestion turns their turn into just saying yes or no. An open question like "What's next?" or "What do you want to change?" is fine.
- If they ask you for ideas, don't give any. Turn it back to them: "What do you love? What would be fun to see?"
- If you can't tell what they want, say what you heard and ask them to tell you more in their own words. Don't guess options for them.
- Say back what they asked for in their own words, as closely as you can - never a softer or "nicer" version of it.
- Silly potty words are fine to say: poop, pee, fart, diarrhea - say them back in the kid's own words and giggle along ("A dinosaur with diarrhea? Ewww, hee hee - coming right up!"), never a softer word for it ("a tummy ache"). Never tell them it's rude or change the subject.`;
}

export function systemPrompt() {
  return `${buddyIntro()}

# Reply format (always exactly this)

SAY: <one short sentence you say out loud right away, showing what you understood, like "A red race car? Coming right up!">
TITLE: <one emoji> <2-4 word name>   (only when you start something new or it changes a lot)
<the page, or nothing if you are only talking>
DONE: <1-2 short sentences said when it appears: how to play with it. You may end with an open question like "What's next?" - never with a suggestion>

${PAGE_FORMAT}

If you only need to talk (you didn't understand, or they asked you something), write just SAY and no page.

${talkingRules()}

${worldRules()}

${buildingRules()}`;
}

// A different look suggested for each new creation, so they don't all come out the same. Only
// the visual treatment: what's in it is always up to the kid.
const LOOKS = [
  'bold cartoon - thick dark outlines, flat bright colors, big expressive eyes',
  'picture book - soft gradient sky, rounded shapes, gentle pastel colors',
  'paper cut-out - layered flat shapes with soft drop shadows, like construction paper',
  'glowing night - deep blue background with bright neon glowing shapes and twinkling stars',
  'toy box - chunky shapes in primary colors, like plastic toys and building blocks',
  'golden afternoon - warm yellow and orange light, long soft shadows, puffy clouds',
  'candy colors - pinks, mint and lemon, with sparkles and sprinkles',
  'pixel art - chunky retro pixels and a small bright palette',
  'chalkboard - dark green-grey board with chalky white and colored lines',
  'watercolor - soft blended colors with gentle uneven edges',
  'felt and stitches - soft fabric-like colors with dashed stitch lines',
  'comic book - halftone dots, bold colors and "POW" style bursts on actions',
];

export const pickLook = () => LOOKS[Math.floor(Math.random() * LOOKS.length)];

export function userPrompt({ page, history, text, alt, fix, fullOnly, look = pickLook() }) {
  const c = config();
  const parts = [];
  parts.push(page ? `<current_page>\n${page}\n</current_page>` : 'The screen is blank - nothing has been built yet.');
  if (!fix) {
    parts.push(`${page ? 'If this turns into a fresh new page, try' : 'For this new creation, try'} this look, unless the kid asked for something else: ${look}.`);
  }
  const recent = history.slice(-c.historyTurns * 2);
  if (recent.length) {
    const lines = recent.map(h => `${h.role === 'kid' ? 'Kid' : c.buddyName}: ${h.text}`);
    parts.push(`<conversation_so_far>\n${lines.join('\n')}\n</conversation_so_far>`);
  }
  if (fix) {
    parts.push(`The page just crashed with this problem:\n${fix}\nFix it without changing anything else. SAY: "Oops! Let me fix a wobbly bit." Keep DONE very short.`);
  } else {
    parts.push(`The kid just said: "${text}"`);
    // Two speech-to-text listeners; when they disagree, both versions help work out the words.
    if (alt) parts.push(`(The other listener heard: "${alt}". Little kids are hard to hear - use both versions and the conversation to work out what they meant.)`);
  }
  if (fullOnly) parts.push('IMPORTANT: this time reply with the complete page in one ```html block - no FIND/REPLACE edits.');
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------------------------
// Backends. Each takes ({ system, prompt, onText, ...overrides }) and resolves with the full reply
// text. onText(chunk) is called as text streams in (only some backends stream). Overrides let the
// overwatch use a stronger model and look at a screenshot.

const backends = {
  async claude({ system, prompt, onText = () => {}, onSpeed = () => {}, model, effort, fast, tools = '', timeoutSec }) {
    const c = config().claude;
    const bin = findBin('claude', c.bin);
    if (!bin) throw new Error('Claude Code CLI not found (install it and run `claude` once to sign in)');
    const args = [
      '-p', '--safe-mode', '--tools', tools, '--strict-mcp-config', '--no-session-persistence',
      '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--system-prompt', system,
    ];
    if (tools) args.push('--permission-prompts', 'none'); // read-only tools only, never ask
    if (model || c.model) args.push('--model', model || c.model);
    if (effort || c.effort) args.push('--effort', effort || c.effort);
    // Fast mode: the same model, answering much sooner. On a subscription it's billed as extra
    // usage; without extra usage credits Claude says why and answers at normal speed instead.
    const wantFast = fast ?? c.fast;
    if (wantFast) args.push('--settings', JSON.stringify({ fastMode: true }));

    let buf = '';
    let streamed = '';
    let result = null;
    let fastNote = '';
    const handle = line => {
      if (!line.trim()) return;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      const d = ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' ? ev.event.delta : null;
      if (d?.type === 'text_delta') {
        streamed += d.text;
        onText(d.text);
      } else if (ev.type === 'system' && ev.subtype === 'notification' && /fast/i.test(ev.key || '')) {
        fastNote = ev.text || ev.key;
      } else if (ev.type === 'result') {
        result = ev;
      }
    };
    await run(bin, args, {
      input: prompt,
      cwd: WORK,
      timeoutSec: timeoutSec || config().timeoutSec,
      onStdout: chunk => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop();
        lines.forEach(handle);
      },
    }).catch(err => {
      handle(buf);
      throw new Error(result?.result || err.message);
    });
    handle(buf);
    if (!result) throw new Error('Claude returned no result');
    if (result.is_error) throw new Error(result.result || result.subtype || 'Claude error');
    if (wantFast) onSpeed(result.usage?.speed || 'unknown', result.usage?.speed === 'fast' ? '' : fastNote);
    return result.result || streamed;
  },

  async codex({ system, prompt, model, reasoning, images = [], timeoutSec }) {
    const c = config().codex;
    const bin = findBin('codex', c.bin);
    if (!bin) throw new Error('Codex CLI not found (install it and run `codex login`)');
    const out = path.join(WORK, `codex-${process.pid}-${Date.now()}.txt`);
    const args = [
      'exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config',
      '--sandbox', 'read-only', '--color', 'never', '-C', WORK, '-o', out,
    ];
    if (reasoning || c.reasoning) args.push('-c', `model_reasoning_effort="${reasoning || c.reasoning}"`);
    if (model || c.model) args.push('-m', model || c.model);
    for (const img of images) args.push('-i', img);
    args.push('-');
    const input = `${system}\n\nDo not run any commands or touch any files - just answer in the reply format above.\n\n---\n\n${prompt}`;
    try {
      await run(bin, args, { input, cwd: WORK, timeoutSec: timeoutSec || config().timeoutSec });
      const text = fs.readFileSync(out, 'utf8');
      if (!text.trim()) throw new Error('Codex returned an empty reply');
      return text; // not streamed, so there's no early SAY: the kid hears DONE when it appears
    } finally {
      fs.rmSync(out, { force: true });
    }
  },

  // Google's Antigravity CLI, signed in with a Google account: Gemini (or any model `agy models`
  // lists). agy is an agent with tools, so it runs in an empty folder of its own with its strictest
  // permissions and a sandboxed terminal, and is asked only for text. Its reply streams in. (One
  // started while the kid talks is used if there is one - see warmAgy.)
  async agy({ system, prompt, onText = () => {}, model, timeoutSec }) {
    const content = `${system}\n\nDo not use any tools, run any commands or touch any files - just answer in the reply format above.\n\n---\n\n${prompt}`;
    return askAgy(model || config().agy.model, content, { onText, timeoutSec: timeoutSec || config().timeoutSec });
  },

  async command({ system, prompt, onText }) {
    const c = config().command;
    if (!c.cmd) throw new Error('No custom command set (config.json → command.cmd)');
    const bin = findBin(c.cmd, path.isAbsolute(c.cmd) ? c.cmd : '') || c.cmd;
    return run(bin, c.args || [], {
      input: `${system}\n\n---\n\n${prompt}`,
      cwd: WORK,
      timeoutSec: config().timeoutSec,
      onStdout: onText,
    });
  },
};

// ---------------------------------------------------------------------------------------------
// Antigravity (agy): each run is one agy program in an empty folder of its own (outside Build
// Buddy's folder, so agy has no project to look at), reading one message as stream-json. Starting
// one takes about 3 s, so while the kid talks (POST /api/warm) the builder and the voice are started
// and wait for their message; they're closed after a few minutes unused.
//
// agy keeps every run as a conversation, listed with the grown-up's own (and on their phone). So
// Build Buddy's runs use an agy home of their own (data/agy-home), sharing only the sign-in, and old
// runs are cleared out of it now and then (agy.keepHistory runs them in the grown-up's own home).

const AGY_SETTINGS = JSON.stringify({ toolPermission: 'strict', allowNonWorkspaceAccess: false, enableTerminalSandbox: true });
const agyArgs = model => ['-p=', '--input-format', 'stream-json', '--output-format', 'stream-json', '--sandbox', '--settings', AGY_SETTINGS, ...(model ? ['--model', model] : [])];
const AGY_WARM_MS = 3 * 60000;
let agyPool = []; // { model, proc, timer }
const agyLive = new Set(); // every agy program still running

const AGY_HOME = path.join(DATA, 'agy-home');
const AGY_KEEP_MS = 60 * 60000; // (old runs in its own home are cleared after an hour)
let agyPruned = 0;

// The environment an agy program gets: its own home with the grown-up's sign-in linked in.
function agyEnv() {
  if (config().agy.keepHistory) return process.env;
  const real = path.join(os.homedir(), '.gemini', 'antigravity-cli');
  const mine = path.join(AGY_HOME, '.gemini', 'antigravity-cli');
  fs.mkdirSync(mine, { recursive: true });
  for (const f of ['antigravity-oauth-token', 'installation_id']) {
    const from = path.join(real, f);
    const to = path.join(mine, f);
    try {
      if (fs.readlinkSync(to) === from) continue;
    } catch {}
    fs.rmSync(to, { force: true });
    if (!fs.existsSync(from)) continue;
    try {
      fs.symlinkSync(from, to);
    } catch {
      fs.copyFileSync(from, to); // (Windows without symlink rights)
    }
  }
  if (Date.now() - agyPruned > AGY_KEEP_MS / 4) {
    agyPruned = Date.now();
    pruneAgyHome(mine);
  }
  return { ...process.env, HOME: AGY_HOME, USERPROFILE: AGY_HOME };
}

// Runs over an hour old are removed from Build Buddy's own agy home (its list there is never shown),
// and so are agy's logs of them.
function pruneAgyHome(home) {
  const old = Date.now() - AGY_KEEP_MS;
  for (const sub of ['conversations', 'brain', 'presence', 'annotations', 'implicit', 'log', 'crashes']) {
    let names = [];
    try {
      names = fs.readdirSync(path.join(home, sub));
    } catch {}
    for (const n of names) {
      const f = path.join(home, sub, n);
      try {
        if (fs.statSync(f).mtimeMs < old) fs.rmSync(f, { recursive: true, force: true });
      } catch {}
    }
  }
}

function startAgy(model) {
  if (isQuitting()) throw new Error('Build Buddy is quitting'); // (nothing new starts once it quits)
  const bin = findBin('agy', config().agy.bin);
  if (!bin) throw new Error('Antigravity CLI (agy) not found (install it and run `agy` once to sign in)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildbuddy-agy-'));
  const child = spawn(bin, agyArgs(model), { cwd: dir, env: agyEnv(), stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' && /\.cmd$/i.test(bin) });
  // (Output that comes before anyone listens - while it waits - is kept for them.)
  const proc = { child, dir, early: [], onData: null, onClose: null, closed: null, err: '' };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', d => (proc.onData ? proc.onData(d) : proc.early.push(d)));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', d => (proc.err = (proc.err + d).slice(-2000)));
  agyLive.add(proc);
  const closed = info => {
    if (proc.closed) return;
    proc.closed = info;
    agyLive.delete(proc);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
    proc.onClose?.();
  };
  child.on('error', error => closed({ code: -1, error }));
  child.on('close', code => closed({ code }));
  child.stdin.on('error', () => {}); // it may exit before reading
  return proc;
}

function takeAgy(model) {
  const i = agyPool.findIndex(w => w.model === model && !w.proc.closed);
  if (i < 0) return null;
  const [w] = agyPool.splice(i, 1);
  clearTimeout(w.timer);
  return w.proc;
}

// Build Buddy is quitting (bins.mjs stopRuns() says so first): its agy programs stop now, and their
// folders go with them (and no other brain takes over from the ones stopped - see ask()).
export function stopAgy() {
  for (const w of agyPool) clearTimeout(w.timer);
  agyPool = [];
  for (const proc of agyLive) {
    proc.child.kill('SIGKILL');
    try {
      fs.rmSync(proc.dir, { recursive: true, force: true });
    } catch {}
  }
  agyLive.clear();
}

// The kid started talking: with agy as the first brain (and so building the classic way), have its
// builder and its voice started and waiting. Returns how many were started.
export function warmAgy() {
  const c = config();
  if (leadBrain() !== 'agy') return { warm: 0 };
  // (The builder, and the voice if there is one.)
  return { warm: keepAgyWarm({ [c.agy.model || '']: 1, ...(c.agy.voiceModel ? { [c.agy.voiceModel]: (c.agy.voiceModel === (c.agy.model || '') ? 2 : 1) } : {}) }) };
}

// After the last thing at time's up, the agy programs still waiting are stopped (nothing will use them).
export const coolAgy = () => agyPool.splice(0).forEach(w => (clearTimeout(w.timer), w.proc.child.kill()));

// Have this many agy programs of each model started and waiting (each for a few minutes). Returns
// how many were started.
export function keepAgyWarm(need, ms = AGY_WARM_MS) {
  agyPool = agyPool.filter(w => !w.proc.closed);
  let started = 0;
  for (const [model, count] of Object.entries(need)) {
    for (let n = agyPool.filter(w => w.model === model).length; n < count; n++) {
      let proc;
      try {
        proc = startAgy(model);
      } catch {
        return started;
      }
      const w = { model, proc };
      w.timer = setTimeout(() => {
        agyPool = agyPool.filter(x => x !== w);
        proc.child.kill();
      }, ms);
      agyPool.push(w);
      started++;
    }
  }
  return started;
}

// One message to agy; resolves with its reply once its turn is over (the program then exits on its
// own). A turn Gemini's safety filter stopped is a failure (the next brain is tried), never a reply.
// stallSec: once it has started writing, a reply that goes quiet that long has stalled - it's
// stopped, so it can be asked again (as a Claude helper is).
function askAgy(model, content, { onText = () => {}, timeoutSec = 120, stallSec = 0, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('stopped'));
    let proc;
    try {
      proc = takeAgy(model || '') || startAgy(model || '');
    } catch (err) {
      return reject(err);
    }
    let buf = '';
    let streamed = '';
    let result = null;
    let finished = false;
    let quietSince = Date.now();
    const finish = err => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearInterval(stall);
      if (err) proc.child.kill('SIGKILL');
      proc.onClose = null;
      signal?.removeEventListener('abort', stop);
      if (isQuitting()) return reject(new Error('Build Buddy is quitting'));
      if (err) return reject(err);
      if (!result) return reject(new Error(`agy returned no result${proc.closed?.code ? ` (exit ${proc.closed.code}: ${proc.err.trim().slice(-300)})` : ''}`));
      if (result.status !== 'SUCCESS') return reject(new Error(result.error || `agy ${result.status || 'failed'}`));
      const text = result.response?.trim() ? result.response : streamed;
      if (!text.trim()) return reject(new Error('agy returned an empty reply'));
      if (/blocked by Gemini'?s filters/i.test(text)) return reject(new Error("Gemini's safety filter stopped it"));
      resolve(text);
    };
    const handle = line => {
      if (!line.trim()) return;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      const step = ev.step_update;
      if (step?.step_type === 'agent_response' && step.text_delta) {
        streamed += step.text_delta;
        onText(step.text_delta);
      } else if (ev.event === 'result') {
        result = ev.result || {};
        finish();
      }
    };
    const onData = chunk => {
      quietSince = Date.now();
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(handle);
    };
    const timer = setTimeout(() => finish(new Error(`agy took longer than ${timeoutSec}s`)), timeoutSec * 1000);
    const stall = stallSec ? setInterval(() => streamed && Date.now() - quietSince > stallSec * 1000 && finish(new Error(`agy stalled, quiet for ${stallSec}s`)), 1000) : null;
    const stop = () => finish(new Error('stopped'));
    signal?.addEventListener('abort', stop);
    proc.onData = onData;
    proc.early.splice(0).forEach(onData);
    proc.onClose = () => {
      handle(buf);
      finish();
    };
    if (proc.closed) return proc.onClose();
    proc.child.stdin.end(`${JSON.stringify({ event: 'user', message: { role: 'user', content } })}\n`);
  });
}

// While agy builds the classic way, a quick model (agy.voiceModel, Gemini Flash: about 2 s to its
// first word, where the builder takes 5 to 10) says the first line out loud, as team mode's voice
// does - with the same instructions. sayNow(line) gets it the moment it's written.
export function agyVoice({ history, text, alt, title }, sayNow) {
  const voiceModel = config().agy.voiceModel;
  if (!voiceModel) return Promise.resolve();
  let said = '';
  const content = `${team.voiceSystem()}\n\nDo not use any tools, run any commands or touch any files - just answer with the one line.\n\n---\n\n${team.voicePrompt({ history, text, alt, title })}`;
  return askAgy(voiceModel, content, {
    timeoutSec: 60,
    onText: chunk => {
      said += chunk;
      const m = said.match(/^[ \t>*_]*SAY:[*_]*\s*(.+)\n/m);
      if (m) sayNow(m[1].replace(/[*_]+$/, '').trim());
    },
  }).then(reply => {
    const line = field(reply, 'SAY');
    if (line) sayNow(line);
  });
}

export const backendNames = Object.keys(backends);
export const runBackend = (name, opts) => backends[name](opts);
export const WORK_DIR = WORK;

// ---------------------------------------------------------------------------------------------
// Reply parsing

const EMOJI_START = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})[\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\p{Extended_Pictographic}]*)\s*(.*)$/u;

export function field(text, name, last = false) {
  const all = [...text.matchAll(new RegExp(`^[ \\t>*_]*${name}:[*_]*\\s*(.+)$`, 'gm'))];
  const m = last ? all.at(-1) : all[0];
  return m ? m[1].replace(/[*_]+$/, '').trim() : '';
}

export function parseReply(raw) {
  const text = raw.replace(/\r\n/g, '\n');
  const out = { say: field(text, 'SAY'), done: field(text, 'DONE', true), title: '', emoji: '', html: null, edits: [] };

  const t = field(text, 'TITLE');
  if (t) {
    const m = t.match(EMOJI_START);
    out.emoji = m ? m[1] : '';
    out.title = (m ? m[2] : t).replace(/^["']|["']$/g, '').slice(0, 40);
  }

  const fence = text.match(/```html[^\n]*\n([\s\S]*)\n```/i);
  if (fence) out.html = fence[1].trim();
  else {
    const bare = text.match(/<!doctype html[\s\S]*<\/html>/i);
    if (bare) out.html = bare[0];
  }

  if (!out.html) {
    const re = /^<{5,9} ?FIND[^\n]*\n([\s\S]*?)\n?^={5,9}[ \t]*\n([\s\S]*?)\n?^>{5,9} ?REPLACE[^\n]*$/gm;
    // Models often add a second ======= before >>>>>>> REPLACE, like a merge conflict. Left in,
    // it crashes the page, so drop any marker line from the new lines.
    const unmark = s => s.split('\n').filter(l => !/^(={5,9}|<{5,9} ?FIND.*|>{5,9} ?REPLACE.*)[ \t]*$/.test(l)).join('\n');
    out.edits = [...text.matchAll(re)].map(m => ({ find: m[1], replace: unmark(m[2]) }));
  }

  // A reply that ignored the format entirely is still worth saying out loud.
  if (!out.say && !out.done && !out.html && !out.edits.length) [out.say, out.offFormat] = [text.trim().split('\n')[0].slice(0, 200), true];
  return out;
}

export function applyEdits(page, edits) {
  let html = page;
  for (const { find, replace } of edits) {
    if (!find.trim()) throw new Error('empty FIND');
    const i = html.indexOf(find);
    if (i >= 0) {
      html = html.slice(0, i) + replace + html.slice(i + find.length);
      continue;
    }
    // Models sometimes get indentation slightly wrong: retry matching whole lines, trimmed.
    const lines = html.split('\n');
    const want = find.split('\n').map(s => s.trim());
    while (want.length && !want[0]) want.shift();
    while (want.length && !want.at(-1)) want.pop();
    let at = -1;
    for (let k = 0; k + want.length <= lines.length && at < 0; k++) {
      if (want.every((w, j) => lines[k + j].trim() === w)) at = k;
    }
    if (at < 0) throw new Error(`edit did not match: ${want[0]?.slice(0, 60)}`);
    lines.splice(at, want.length, ...replace.split('\n'));
    html = lines.join('\n');
  }
  return html;
}

// ---------------------------------------------------------------------------------------------
// Do two lines say much the same (the quick voice already answered what the builder answers)?
function sameGist(a, b) {
  const words = s => new Set(String(s).toLowerCase().match(/[a-z']{3,}/g) || []);
  const [x, y] = [words(a), words(b)];
  const shared = [...x].filter(w => y.has(w)).length;
  return shared >= Math.min(x.size, y.size) * 0.5;
}

// One build = one turn of the conversation.

let busy = false;
export const isBusy = () => busy;

// How the last build that asked for fast mode actually ran, for the grown-ups' panel.
let fastSeen = null;
export const fastStatus = () => fastSeen;
export function noteSpeed(speed, note) {
  fastSeen = { speed, note, at: Date.now() };
}

export function log(line) {
  fs.appendFile(path.join(DATA, 'log.txt'), `${new Date().toISOString()} ${line}\n`, () => {});
}

// Try each configured backend in order until one answers. While text streams in, report
// progress and announce the SAY line as soon as it is complete, so the kid hears a reply
// within a couple of seconds even when the page takes much longer to build.
async function ask(prompt, emit, state) {
  const system = systemPrompt();
  let lastErr;
  const order = config().backends;
  for (const name of order) {
    const backend = backends[name];
    // (A brain that isn't installed is passed over quietly: the first installed one leads.)
    if (!backend || !installed(name)) continue;
    let text = '';
    let speed = '';
    const started = Date.now();
    try {
      const reply = await backend({
        system,
        prompt,
        onSpeed: (s, note) => {
          speed = ` ${s}${note ? ` (${note})` : ''}`;
          fastSeen = { speed: s, note, at: Date.now() };
        },
        onText: chunk => {
          text += chunk;
          emit({ type: 'progress', chars: text.length });
          if (!state.said) {
            const say = text.match(/^[ \t>*_]*SAY:[*_]*\s*(.+)\n/m);
            if (say) {
              state.said = say[1].replace(/[*_]+$/, '').trim();
              emit({ type: 'say', text: state.said });
            }
          }
        },
      });
      log(`ok   ${name} ${((Date.now() - started) / 1000).toFixed(1)}s ${reply.length} chars${speed}`);
      return { text: reply, backend: name };
    } catch (err) {
      if (isQuitting()) throw err; // (no other brain is started while Build Buddy quits)
      lastErr = err;
      log(`FAIL ${name} ${((Date.now() - started) / 1000).toFixed(1)}s ${err.message.replace(/\s+/g, ' ').slice(0, 300)}`);
      if (order.slice(order.indexOf(name) + 1).some(installed)) emit({ type: 'progress', chars: 0, note: `${name} failed, trying the next brain` });
    }
  }
  throw lastErr || new Error('No AI backends configured');
}

// The classic way: one AI writes the whole reply (with a full-page retry if its edits don't fit).
async function classic({ page, history, text, alt, fix }, emit, state) {
  let reply = await ask(userPrompt({ page, history, text, alt, fix }), emit, state);
  let r = parseReply(reply.text);
  let newHtml = r.html;
  let edited = false;
  if (!newHtml && r.edits.length) {
    try {
      if (!page) throw new Error('edits on a blank page');
      newHtml = applyEdits(page, r.edits);
      edited = true;
    } catch (err) {
      log(`edit failed (${err.message}), asking for the full page`);
      reply = await ask(userPrompt({ page, history, text, alt, fix, fullOnly: true }), emit, state);
      const again = parseReply(reply.text);
      newHtml = again.html;
      r = { ...again, say: r.say || again.say, done: again.done || r.done, title: r.title || again.title, emoji: r.emoji || again.emoji };
    }
  }
  return { ...r, html: newHtml, edited, backend: reply.backend };
}

export async function build({ text, alt, fix, last = false }, emit) {
  if (busy) throw new Error('busy');
  busy = true;
  const state = { said: '' };
  try {
    let p = store.currentProject();
    const page = store.html(p);
    const history = p.history;
    const titleBefore = p.title;
    log(`${fix ? 'FIX ' : 'KID '} ${(text || fix).replace(/\s+/g, ' ').slice(0, 200)}`);

    // Team mode (team.mjs): a lead and helpers build it together. If the team can't, the
    // classic way still answers.
    let r = null;
    // (Gemini leading builds the classic way - Claude's team and solo settings aren't for it: worth a
    // line only for another brain.)
    if (leadBrain() !== 'agy' && ((!team.enabled() && config().team?.enabled) || (!solo.enabled() && config().solo?.enabled))) log(`${config().solo?.enabled ? 'solo' : 'team'} mode is on, but Claude is not the first brain: building the classic way`);
    // Solo mode (solo.mjs): one Claude that remembers the creation. If it can't, the classic way.
    if (solo.enabled()) {
      try {
        r = await solo.build({ page, history, text, alt, fix }, emit, state);
      } catch (err) {
        if (isQuitting()) throw err; // (stopped because Build Buddy quits: nothing builds it again)
        log(`FAIL claude solo ${err.message.replace(/\s+/g, ' ').slice(0, 300)} - building the classic way instead`);
        emit({ type: 'progress', chars: 0, note: 'building the classic way' });
      }
    } else if (agentWay() || team.enabled()) {
      // (The agent way - agents.mjs - is team mode with one lead that keeps the creation in mind.)
      const way = agentWay() ? 'agents' : 'team';
      try {
        r = way === 'agents' ? await agents.build({ page, history, text, alt, fix, title: titleBefore, last }, emit, state) : await team.build({ page, history, text, alt, fix, title: titleBefore }, emit, state);
      } catch (err) {
        if (isQuitting()) throw err; // (stopped because Build Buddy quits: nothing builds it again)
        log(`FAIL claude ${way} ${err.message.replace(/\s+/g, ' ').slice(0, 300)} - building the classic way instead`);
        emit({ type: 'progress', chars: 0, note: 'the team got stuck, building the classic way' });
      }
    }
    if (!r) {
      // With agy first, a quick voice answers out loud while agy builds (whichever line comes first
      // is said: the builder's own SAY isn't said twice).
      let over = false;
      const voiced = !fix && leadBrain() === 'agy' && !state.said; // (not if a line was already said)
      if (voiced) {
        agyVoice({ history, text, alt, title: titleBefore }, line => {
          if (over || state.said) return;
          state.said = line;
          emit({ type: 'say', text: line });
        }).catch(err => log(`agy voice failed: ${err.message.replace(/\s+/g, ' ').slice(0, 160)}`));
      }
      try {
        r = await classic({ page, history, text, alt, fix }, emit, state);
      } finally {
        over = true;
      }
      // (If agy only talked - it asked what they meant, or answered a question - that's said too.)
      if (voiced && state.said) r = { ...r, say: state.said, done: !r.html && !r.offFormat && r.say && !sameGist(r.say, state.said) ? [r.say, r.done].filter(Boolean).join(' ') : r.done };
      // A page that doesn't parse would only crash when shown: it's fixed first, once.
      if (r.html && !fix) {
        const broken = await team.syntaxErrors(r.html);
        if (broken.length) {
          log(`the new page doesn't run (${broken[0].slice(0, 120)}), fixing it before it's shown`);
          emit({ type: 'progress', chars: 0, note: 'fixing a wobbly bit' });
          const fixed = await classic({ page: r.html, history, text: '', alt, fix: broken.join('\n') }, emit, { said: state.said || 'quiet' }).catch(() => null);
          // (Taken only if it's still the whole page - not a bit of it - and runs better.)
          const whole = fixed?.html && fixed.html.length > r.html.length * 0.6 && /<\/html>|<\/body>|<\/script>/i.test(fixed.html);
          if (whole && (await team.syntaxErrors(fixed.html)).length < broken.length) r = { ...r, html: fixed.html };
        }
      }
    }
    // (Time's up and this was the last thing they could ask for: Sparky doesn't ask what's next.)
    if (last && r.done) r = { ...r, done: r.done.replace(/\s*[^.!?]*\?\s*$/, '').trim() };
    const newHtml = r.html;

    // Changes to the same creation carry the kid's progress over (KB.keep). Edits always do; a
    // whole new page under a new name is a new thing and starts fresh.
    const continues = Boolean(page) && (r.edited || !(r.title && r.title !== titleBefore));

    if (text) p = store.addHistory(p, 'kid', text);
    // A new creation keeps the look it was given, for the team's checker and polisher.
    if (newHtml) p = store.addVersion(p, newHtml, { request: text || `(fix) ${fix.slice(0, 200)}`, backend: r.backend, continues, ...(r.look && !continues ? { look: r.look } : {}) });
    if (r.title) p = store.setTitle(p, r.title, r.emoji);
    if (!fix) p = store.addHistory(p, 'buddy', [r.say, r.done].filter(Boolean).join(' '));

    emit({
      type: 'done',
      html: newHtml ? store.html(p) : null,
      say: r.say,
      done: r.done,
      saidEarly: Boolean(state.said),
      title: p.title,
      emoji: p.emoji,
      version: p.current,
      continues,
      backend: r.backend,
    });
  } finally {
    busy = false;
    // (The last thing they could ask for: agy's waiting programs won't be needed again.)
    if (last && leadBrain() === 'agy') coolAgy();
  }
}
