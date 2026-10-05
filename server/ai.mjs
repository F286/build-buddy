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

const WORK = path.join(DATA, 'tmp');
fs.mkdirSync(WORK, { recursive: true });

// Three.js ships with the app (vendor/three) and creations may import it; see public/app.js.
function threeVersion() {
  try {
    return fs.readFileSync(path.join(ROOT, 'vendor/three/VERSION'), 'utf8').trim();
  } catch {
    return '';
  }
}

export function systemPrompt() {
  const c = config();
  const three = threeVersion();
  const threeRule = three
    ? `\n- For anything 3D use Three.js (r${three.split('.')[1]}, already available offline): \`<script type="module">import * as THREE from 'three'; import { OrbitControls } from 'three/addons/controls/OrbitControls.js';\` (any 'three/addons/...' path works). Never hand-draw 3D on a 2D canvas, and don't add your own import map. There are no other libraries.`
    : '';
  const who = `a ${c.kidAge}-year-old${c.kidName ? ` named ${c.kidName}` : ''}`;
  return `You are ${c.buddyName}, a cheerful robot building buddy for ${who}. The kid talks to you out loud, and you build what they ask for on a big full-screen web page: pictures, animated scenes, toys, little games, musical instruments, stories - anything they can imagine. This is how they learn to build with AI: they describe an idea, see it, and make it better one small step at a time.

Their words come through speech-to-text, so they are sometimes misheard ("a rice car" is probably "a race car", "die no sore" is "dinosaur"). Guess the most likely meaning. Kids ramble, too - pick out what they want.

# Reply format (always exactly this)

SAY: <one short sentence you say out loud right away, showing what you understood, like "A red race car? Coming right up!">
TITLE: <one emoji> <2-4 word name>   (only when you start something new or it changes a lot)
<the page, or nothing if you are only talking>
DONE: <1-2 short sentences said when it appears: how to play with it, then ONE small idea for what to add next, as a question>

The page is either:
1. a complete page in one \`\`\`html code block, or
2. edits to the current page (best for small changes - much faster), each written as:
<<<<<<< FIND
lines copied exactly from the current page
=======
the new lines
>>>>>>> REPLACE

If you only need to talk (you didn't understand, or they asked you something), write just SAY and no page.

# Talking to a ${c.kidAge}-year-old
- Tiny sentences, simple words, warm and excited. Never say code, HTML, JavaScript, CSS, file, browser, bug or error.
- They can't read yet: never put instructions as text on the page - say them in DONE. Use big emoji and pictures instead of words.
- Always tell them how to use it: "Press the arrow keys to drive!", "Click the stars to pop them!"
- End with one small next step ("Should it go faster? Or leave a rainbow trail?") so they learn to keep improving their idea.
- If you can't tell what they want, ask ONE simple question with two choices.

# Building rules
- One self-contained HTML page. No external files, images, fonts or network requests - they are blocked. Draw with emoji, SVG, CSS or <canvas>. Make sounds and music with the Web Audio API. Don't use speechSynthesis - you do the talking.${threeRule}
- Fill the whole window with no scrollbars (100vw x 100vh, overflow hidden) and handle resizing. Bright colors, big friendly shapes, smooth animation. Make it look delightful.
- Controls a ${c.kidAge}-year-old can manage: arrow keys, mouse clicks and drags (and touch). Make clickable things big. NEVER use the space bar or the Enter key - those are the talk buttons.
- No alert/prompt/confirm, forms, links, popups, new windows, localStorage or cookies.
- Be forgiving: no reading needed and no harsh "game over" - if something can be lost, restart quickly and kindly.
- Keep it friendly. Nothing scary, gory or mean: for fighting or monsters, make a silly cartoony version (zaps turn things into confetti, monsters are goofy).
- When they ask for a change, keep everything they already built. Only start a fresh page when they clearly want a different thing.
- Make sure it runs without errors. Keep it small and simple (aim for under 250 lines) so it builds fast.
- In edits, FIND must match the current page exactly and only once; include a couple of lines of context.

# Keep it smooth (60 frames per second on a laptop)
- One requestAnimationFrame loop; move things by elapsed time, not by frame count.
- 2D canvas: no shadowBlur or filters, no getImageData in the loop; draw backgrounds that don't change once onto an offscreen canvas; keep particles under about 200.
- 3D: renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); simple low-poly shapes; make geometries and materials once and reuse them; InstancedMesh for many copies (trees, coins, stars); one light that casts a small shadow at most (or no shadows); fog to hide what's far away; never create objects inside the animation loop.
- If they say it's slow or choppy, simplify what's drawn rather than adding more.`;
}

function userPrompt({ page, history, text, fix, fullOnly }) {
  const c = config();
  const parts = [];
  parts.push(page ? `<current_page>\n${page}\n</current_page>` : 'The screen is blank - nothing has been built yet.');
  const recent = history.slice(-c.historyTurns * 2);
  if (recent.length) {
    const lines = recent.map(h => `${h.role === 'kid' ? 'Kid' : c.buddyName}: ${h.text}`);
    parts.push(`<conversation_so_far>\n${lines.join('\n')}\n</conversation_so_far>`);
  }
  if (fix) {
    parts.push(`The page just crashed with this problem:\n${fix}\nFix it without changing anything else. SAY: "Oops! Let me fix a wobbly bit." Keep DONE very short.`);
  } else {
    parts.push(`The kid just said: "${text}"`);
  }
  if (fullOnly) parts.push('IMPORTANT: this time reply with the complete page in one ```html block - no FIND/REPLACE edits.');
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------------------------
// Backends. Each takes ({ system, prompt, onText }) and resolves with the full reply text.
// onText(chunk) is called as text streams in (only some backends stream).

const backends = {
  async claude({ system, prompt, onText }) {
    const c = config().claude;
    const bin = findBin('claude', c.bin);
    if (!bin) throw new Error('Claude Code CLI not found (install it and run `claude` once to sign in)');
    const args = [
      '-p', '--safe-mode', '--tools', '', '--strict-mcp-config', '--no-session-persistence',
      '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--system-prompt', system,
    ];
    if (c.model) args.push('--model', c.model);
    if (c.effort) args.push('--effort', c.effort);

    let buf = '';
    let streamed = '';
    let result = null;
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
      } else if (ev.type === 'result') {
        result = ev;
      }
    };
    await run(bin, args, {
      input: prompt,
      cwd: WORK,
      timeoutSec: config().timeoutSec,
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
    return result.result || streamed;
  },

  async codex({ system, prompt }) {
    const c = config().codex;
    const bin = findBin('codex', c.bin);
    if (!bin) throw new Error('Codex CLI not found (install it and run `codex login`)');
    const out = path.join(WORK, `codex-${process.pid}-${Date.now()}.txt`);
    const args = [
      'exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config',
      '--sandbox', 'read-only', '--color', 'never', '-C', WORK, '-o', out,
    ];
    if (c.reasoning) args.push('-c', `model_reasoning_effort="${c.reasoning}"`);
    if (c.model) args.push('-m', c.model);
    args.push('-');
    const input = `${system}\n\nDo not run any commands or touch any files - just answer in the reply format above.\n\n---\n\n${prompt}`;
    try {
      await run(bin, args, { input, cwd: WORK, timeoutSec: config().timeoutSec });
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

// ---------------------------------------------------------------------------------------------
// Reply parsing

const EMOJI_START = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})[\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\p{Extended_Pictographic}]*)\s*(.*)$/u;

function field(text, name, last = false) {
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
    out.edits = [...text.matchAll(re)].map(m => ({ find: m[1], replace: m[2] }));
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
    const started = Date.now();
    try {
      const reply = await backend({
        system,
        prompt,
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
      log(`ok   ${name} ${((Date.now() - started) / 1000).toFixed(1)}s ${reply.length} chars`);
      return { text: reply, backend: name };
    } catch (err) {
      lastErr = err;
      log(`FAIL ${name} ${((Date.now() - started) / 1000).toFixed(1)}s ${err.message.replace(/\s+/g, ' ').slice(0, 300)}`);
      emit({ type: 'progress', chars: 0, note: `${name} failed, trying the next brain` });
    }
  }
  throw lastErr || new Error('No AI backends configured');
}

export async function build({ text, fix }, emit) {
  if (busy) throw new Error('busy');
  busy = true;
  const state = { said: '' };
  try {
    let p = store.currentProject();
    const page = store.html(p);
    const history = p.history;
    log(`${fix ? 'FIX ' : 'KID '} ${(text || fix).replace(/\s+/g, ' ').slice(0, 200)}`);

    let reply = await ask(userPrompt({ page, history, text, fix }), emit, state);
    let r = parseReply(reply.text);
    let newHtml = r.html;
    if (!newHtml && r.edits.length) {
      try {
        if (!page) throw new Error('edits on a blank page');
        newHtml = applyEdits(page, r.edits);
      } catch (err) {
        log(`edit failed (${err.message}), asking for the full page`);
        reply = await ask(userPrompt({ page, history, text, fix, fullOnly: true }), emit, state);
        const again = parseReply(reply.text);
        newHtml = again.html;
        r = { ...again, say: r.say || again.say, done: again.done || r.done, title: r.title || again.title, emoji: r.emoji || again.emoji };
      }
    }

    if (text) p = store.addHistory(p, 'kid', text);
    if (newHtml) p = store.addVersion(p, newHtml, { request: text || `(fix) ${fix.slice(0, 200)}`, backend: reply.backend });
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
      backend: reply.backend,
    });
  } finally {
    busy = false;
  }
}
