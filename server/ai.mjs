// The "brain": turns what the kid said into a new version of the page.
//
// Every backend gets the same two strings (instructions + this turn's prompt) and returns plain
// text in the reply format described in systemPrompt(). That keeps backends interchangeable:
// adding one is just "run something that takes a prompt and returns text".
import fs from 'node:fs';
import path from 'node:path';
import { config, DATA, ROOT } from './config.mjs';
import { findBin, run } from './bins.mjs';
import * as store from './store.mjs';
import * as team from './team.mjs';

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

// How to build a page. Shared with the overwatch (watch.mjs), so its fixes follow the same rules.
export function buildingRules() {
  const c = config();
  const phaser = libVersion('phaser');
  const three = libVersion('three');
  const libs = [];
  if (phaser) {
    libs.push(`- For games and anything that moves in 2D (characters, racing, jumping, catching, bouncing, physics) use Phaser ${phaser}, already available offline: \`<script type="module">import Phaser from 'phaser';\`. Fill the window with \`scale: { mode: Phaser.Scale.RESIZE }\`, and use Arcade physics, tweens, particles and camera effects. This is Phaser 4: there is no Phaser.Geom.Point - use Phaser.Math.Vector2. There are no image files: make sprites from big emoji (\`this.add.text(x, y, '🐸', { fontSize: '96px', padding: { y: 16 } })\` - without the padding the top of the emoji is cut off) or from Graphics turned into textures (\`generateTexture\`). Plain HTML, SVG and CSS are still best for drawings, simple toys and stories.`);
  }
  if (three) {
    libs.push(`- For anything 3D use Three.js (r${three.split('.')[1]}, already available offline): \`<script type="module">import * as THREE from 'three'; import { OrbitControls } from 'three/addons/controls/OrbitControls.js';\` (any 'three/addons/...' path works). Never hand-draw 3D on a 2D canvas.`);
  }
  if (libs.length) libs.push("- Those are the only libraries. Don't add your own import map.");
  return `# Building rules
- One self-contained HTML page. No external files, images, fonts or network requests - they are blocked. Draw with emoji, SVG, CSS or <canvas>. Make sounds and music with the Web Audio API. Don't use speechSynthesis - you do the talking.
${libs.join('\n')}
- Emoji on a 2D canvas are drawn with the current fillStyle's transparency: set an opaque fillStyle and globalAlpha = 1 right before fillText-ing them, or they come out faint.
- Fill the whole window with no scrollbars (100vw x 100vh, overflow hidden) and handle resizing. Keep the player and everything the kid needs to see or tap inside the window at any window size: stop things at the edges, and make toolbars and buttons shrink to fit. Bright colors, big friendly shapes, smooth animation. Make it look delightful.
- Make it feel alive: things gently bob, blink, sway or twinkle even when nobody touches them, and every action gets a response - a bounce, a burst of particles, a happy sound.
- Pages can't close, exit or lock the app, and can't limit play time. If the kid asks for that, tell them kindly that only a grown-up can set play time. A countdown inside a game is fine, but it never stops them playing.
- Controls a ${c.kidAge}-year-old can manage: arrow keys, mouse clicks and drags (and touch). Make clickable things big. NEVER use the space bar or the Enter key - those are the talk buttons.
- No alert/prompt/confirm, forms, links, popups, new windows, localStorage or cookies.
- Be forgiving: no reading needed and no harsh "game over" - if something can be lost, restart quickly and kindly.
- Keep it friendly. Nothing scary, gory or mean: for fighting or monsters, make a silly cartoony version (zaps turn things into confetti, monsters are goofy).
- When they ask for a change, keep everything they already built. Only start a fresh page when they clearly want a different thing.
- Keep the kid's progress when the page changes. Put what matters while playing (score, level, the player's position, things collected or unlocked) in one object made with \`const keep = KB.keep({ score: 0, x: 200, y: 300 })\`, and read and change it there (\`keep.score += 1\`). When the page is updated, those values come back, so the kid carries on where they were. Only numbers, text, true/false and lists of those. When the page starts, make sure the values still make sense (for example, put the player back on screen). When changing a page, keep the existing keep names and what they mean.
- Make sure it runs without errors. Keep it small and simple (aim for under 250 lines) so it builds fast.
- In edits, FIND must match the current page exactly and only once; include a couple of lines of context.

# Make it special
- Every new creation should feel like its own little world, not a copy of the last one. Give it a look that fits it - a palette, a shape style, a mood - and vary it from thing to thing.
- Fill the scene with depth: a background (sky, hills, a horizon, a room) behind the action, not just things on a flat color.
- Give characters personality: faces with eyes that blink or follow, a wiggle when idle, a funny sound when touched.
- Hide one or two small surprises that fit what they asked for, waiting to be found - something that reacts when clicked, a little background detail that moves. Never mention or hint at them; they're for discovering. Don't add big new things the kid didn't ask for.

# Keep it smooth (60 frames per second on a laptop)
- One animation loop (requestAnimationFrame, or Phaser's update); move things by elapsed time, not by frame count.
- 2D canvas: no shadowBlur or filters, no getImageData in the loop; draw backgrounds that don't change once onto an offscreen canvas; keep particles under about 200.
- HTML and SVG: no CSS or SVG filters (drop-shadow, blur, feDropShadow) or box-shadow - they slow down every frame; for a soft shadow, draw a darker, see-through copy of the shape a little below it. Animate with transform and opacity.
- Phaser: create things in create(), not every frame; reuse particle emitters; destroy things that leave the screen.
- 3D: renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); simple low-poly shapes; make geometries and materials once and reuse them; InstancedMesh for many copies (trees, coins, stars); one light that casts a small shadow at most (or no shadows); fog to hide what's far away; never create objects inside the animation loop.
- If they say it's slow or choppy, simplify what's drawn rather than adding more.`;
}

// Who the buddy is and who it's talking to. Shared with team mode (team.mjs).
export function buddyIntro() {
  const c = config();
  const who = `a ${c.kidAge}-year-old${c.kidName ? ` named ${c.kidName}` : ''}`;
  return `You are ${c.buddyName}, a cheerful robot building buddy for ${who}. The kid talks to you out loud, and you build what they ask for on a big full-screen web page: pictures, animated scenes, toys, little games, musical instruments, stories - anything they can imagine. This is how they learn to build with AI: they describe an idea, see it, and make it better one small step at a time. The ideas must always be theirs: you build what they ask for, but you never tell them what to build.

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
- If you can't tell what they want, say what you heard and ask them to tell you more in their own words. Don't guess options for them.`;
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
  if (!out.say && !out.done && !out.html && !out.edits.length) out.say = text.trim().split('\n')[0].slice(0, 200);
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
  for (const name of config().backends) {
    const backend = backends[name];
    if (!backend) continue;
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
      lastErr = err;
      log(`FAIL ${name} ${((Date.now() - started) / 1000).toFixed(1)}s ${err.message.replace(/\s+/g, ' ').slice(0, 300)}`);
      emit({ type: 'progress', chars: 0, note: `${name} failed, trying the next brain` });
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

export async function build({ text, alt, fix }, emit) {
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
    if (team.enabled()) {
      try {
        r = await team.build({ page, history, text, alt, fix, title: titleBefore }, emit, state);
      } catch (err) {
        log(`FAIL claude team ${err.message.replace(/\s+/g, ' ').slice(0, 300)} - building the classic way instead`);
        emit({ type: 'progress', chars: 0, note: 'the team got stuck, building the classic way' });
      }
    }
    r ||= await classic({ page, history, text, alt, fix }, emit, state);
    const newHtml = r.html;

    // Changes to the same creation carry the kid's progress over (KB.keep). Edits always do; a
    // whole new page under a new name is a new thing and starts fresh.
    const continues = Boolean(page) && (r.edited || !(r.title && r.title !== titleBefore));

    if (text) p = store.addHistory(p, 'kid', text);
    if (newHtml) p = store.addVersion(p, newHtml, { request: text || `(fix) ${fix.slice(0, 200)}`, backend: r.backend });
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
  }
}
