// The overwatch: a careful model that checks on a creation after the kid has played with it for a
// while. It quietly fixes it if it's broken or stuck, and otherwise may give it one tiny polish
// (once per version) - always small enough that it's still entirely the kid's creation. The page sends a report of how the
// creation is running plus a screenshot (public/stage-shim.js → public/app.js → POST /api/watch).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import * as store from './store.mjs';
import * as ai from './ai.mjs';
import { installed } from './bins.mjs';
import * as agents from './agents.mjs';
import * as solo from './solo.mjs';

let running = false;

function systemPrompt() {
  const c = config();
  return `You are the careful helper behind ${c.buddyName}, a robot that builds things for a ${c.kidAge}-year-old from what they say out loud. A quicker helper builds what the kid asks for. Your job is to check on the result after the kid has played with it for a while. The kid is the one building: everything you do must be small enough that it's still entirely their creation.

1. Fix real problems that stop the kid from playing or enjoying it (VERDICT: fix):
- errors or crashes
- frozen or blank, or nothing moving when it should
- the player or important things stuck, off screen, invisible or out of reach
- controls that can't work, or a game that can't go on (no way to keep playing or start again)
- something the kid recently asked for that clearly isn't there or doesn't work
- running choppy (under about 30 frames per second)

2. Only if it works and polish is allowed (VERDICT: polish): at most two tiny touches that make what is already there look or feel a little better - smoother movement, something overlapping or cut off, something too small to see or too fast to catch, a missing bounce or sound when it's touched. Never add new things, never change what the kid chose (colors, sizes, characters, rules, how it's played), never restyle it. If you're not sure a touch is clearly better, don't make it.

Otherwise leave it alone (VERDICT: ok) - that's the usual answer. Never add suggestions: the ideas are the kid's.

# Reply format (always exactly this)
VERDICT: ok   or   VERDICT: fix   or   VERDICT: polish
WHY: <one short sentence for the grown-ups' log>
then, only when fixing or polishing, the changed page. Make the smallest change that does it.

${ai.PAGE_FORMAT}

${ai.discoveryRule()}

When fixing, follow the rules below, and keep the KB.keep names and their meaning so the kid keeps their progress.

${ai.buildingRules()}`;
}

function describe(report, shot) {
  const r = report || {};
  const lines = [
    `On screen for ${Math.round(r.shownSec || 0)} s; ${r.fps ?? '?'} frames per second; last key press or click ${r.idleSec == null ? 'unknown' : `${Math.round(r.idleSec)} s ago`}.`,
    `Errors: ${r.errors?.length ? r.errors.slice(-5).join(' | ') : 'none'}`,
    `Kept values (KB.keep): ${r.keep ? JSON.stringify(r.keep).slice(0, 600) : 'none'}`,
    `Page: ${r.canvas ? `canvas ${r.canvas}` : 'no canvas'}${r.blank ? ', the screen looks blank (all one color)' : ''}; ${r.elements ?? '?'} elements; text: ${JSON.stringify((r.text || '').slice(0, 200))}`,
  ];
  return `<how_it_is_running>\n${lines.join('\n')}\n</how_it_is_running>\n\n${
    shot
      ? `A screenshot of it right now is in the file ${path.basename(shot)} - look at it first.`
      : 'There is no screenshot, so judge from the page and the numbers.'
  }`;
}

function saveScreenshot(dataUrl) {
  const m = /^data:image\/(jpeg|png);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const file = path.join(ai.WORK_DIR, `screen-${Date.now()}.${m[1] === 'png' ? 'png' : 'jpg'}`);
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
  return file;
}

// The brains that can watch, in the order they're tried (the next if one fails - not installed, or
// at its usage limit): the configured ones that can look at the screenshot (claude, codex), then agy,
// which judges from the page and how it's running.
function watchers() {
  const c = config();
  const order = [...c.backends.filter(b => b === 'claude' || b === 'codex'), ...c.backends.filter(b => b === 'agy')].filter(installed);
  return order.map(name =>
    name === 'claude'
      ? { name, opts: { model: c.watch.model, effort: c.watch.effort, fast: false, tools: 'Read' } }
      : name === 'codex'
        ? { name, opts: { model: c.watch.codexModel || undefined, reasoning: 'high' } }
        : { name, opts: { model: c.watch.agyModel || undefined }, blind: true },
  );
}

export async function review({ projectId, version, report, screenshot }) {
  const c = config().watch;
  if (!c.enabled) return { skipped: 'off' };
  // (Not while the agent way or solo mode is working on it: a pass would be thrown away.)
  if (running || ai.isBusy() || agents.busy?.() || solo.busy()) return { skipped: 'busy' };
  let p = store.currentProject();
  if (!version || p.id !== projectId || p.current !== version) return { skipped: 'stale' };
  const list = watchers();
  if (!list.length) return { skipped: 'no brain that can watch' };

  running = true;
  const shot = list.some(w => !w.blind) ? saveScreenshot(screenshot) : null;
  let who = list[0];
  const t0 = Date.now();
  const took = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  try {
    const page = store.html(p);
    const asked = p.history.filter(h => h.role === 'kid').slice(-5).map(h => `- ${h.text}`).join('\n');
    // One polish per version of the kid's: never polish our own work.
    const madeByUs = String(p.versions.find(v => v.n === p.current)?.request || '').startsWith('(overwatch');
    const polish = madeByUs ? 'Polish is NOT allowed this time - only fix real problems.' : 'Polish is allowed this time.';
    let text = '';
    for (const [i, w] of list.entries()) {
      who = w;
      const seen = w.blind ? null : shot;
      const prompt = `<current_page>\n${page}\n</current_page>\n\n<what_the_kid_asked_for_lately>\n${asked || '- (nothing yet)'}\n</what_the_kid_asked_for_lately>\n\n${describe(report, seen)}\n\n${polish}`;
      const opts = { ...w.opts, ...(w.name === 'codex' && seen ? { images: [seen] } : {}), timeoutSec: c.timeoutSec };
      try {
        text = await ai.runBackend(w.name, { system: systemPrompt(), prompt, ...opts });
        break;
      } catch (err) {
        if (i === list.length - 1) throw err;
        ai.log(`WATCH fail ${w.name} ${took()} ${err.message.replace(/\s+/g, ' ').slice(0, 160)}, trying ${list[i + 1].name}`);
      }
    }

    const said = ai.field(text, 'VERDICT').toLowerCase();
    const verdict = said.startsWith('fix') ? 'fix' : said.startsWith('polish') && !madeByUs ? 'polish' : 'ok';
    const why = ai.field(text, 'WHY') || (verdict === 'ok' ? 'looks fine' : 'made a small change');
    if (verdict === 'ok') {
      ai.log(`WATCH ok   ${who.name} ${took()} ${why}`);
      return { verdict, why };
    }

    const r = ai.parseReply(text);
    let html = r.html;
    if (!html && r.edits.length) {
      try {
        html = ai.applyEdits(page, r.edits);
      } catch (err) {
        ai.log(`WATCH fix-failed ${who.name} ${took()} ${why} (${err.message})`);
        return { verdict, why, skipped: 'edit did not apply' };
      }
    }
    if (!html) {
      ai.log(`WATCH fix-missing ${who.name} ${took()} ${why}`);
      return { verdict, why, skipped: 'no fix in reply' };
    }

    // The kid may have changed things while we were looking; never overwrite newer work.
    p = store.currentProject();
    if (p.id !== projectId || p.current !== version || ai.isBusy()) {
      ai.log(`WATCH stale ${who.name} ${took()} ${why}`);
      return { verdict, why, skipped: 'stale' };
    }
    p = store.addVersion(p, html, { request: `(overwatch ${verdict}) ${why}`, backend: `${who.name} overwatch` });
    ai.log(`WATCH ${verdict.toUpperCase().padEnd(6)} ${who.name} ${took()} ${why} → v${p.current}`);
    return { verdict, why, fixed: true, html: store.html(p), version: p.current };
  } catch (err) {
    ai.log(`WATCH fail ${who.name} ${took()} ${err.message.replace(/\s+/g, ' ').slice(0, 200)}`);
    return { skipped: 'failed' };
  } finally {
    running = false;
    if (shot) fs.rmSync(shot, { force: true });
  }
}
