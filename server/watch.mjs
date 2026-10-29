// The overwatch: a careful model that checks on a creation after the kid has played with it for a
// while. It quietly fixes it if it's broken or stuck, and otherwise may give it one tiny polish
// (once per version) - always small enough that it's still entirely the kid's creation. The page sends a report of how the
// creation is running plus a screenshot (public/stage-shim.js → public/app.js → POST /api/watch).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import * as store from './store.mjs';
import * as ai from './ai.mjs';

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

// Which brain watches: the first configured one that can look at pictures.
function watcher() {
  const c = config();
  const name = c.backends.find(b => b === 'claude' || b === 'codex');
  if (name === 'claude') return { name, opts: { model: c.watch.model, effort: c.watch.effort, fast: false, tools: 'Read' } };
  if (name === 'codex') return { name, opts: { model: c.watch.codexModel || undefined, reasoning: 'high' } };
  return null;
}

export async function review({ projectId, version, report, screenshot }) {
  const c = config().watch;
  if (!c.enabled) return { skipped: 'off' };
  if (running || ai.isBusy()) return { skipped: 'busy' };
  let p = store.currentProject();
  if (!version || p.id !== projectId || p.current !== version) return { skipped: 'stale' };
  const who = watcher();
  if (!who) return { skipped: 'no brain that can look at screenshots' };

  running = true;
  const shot = saveScreenshot(screenshot);
  const t0 = Date.now();
  const took = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  try {
    const page = store.html(p);
    const asked = p.history.filter(h => h.role === 'kid').slice(-5).map(h => `- ${h.text}`).join('\n');
    // One polish per version of the kid's: never polish our own work.
    const madeByUs = String(p.versions.find(v => v.n === p.current)?.request || '').startsWith('(overwatch');
    const polish = madeByUs ? 'Polish is NOT allowed this time - only fix real problems.' : 'Polish is allowed this time.';
    const prompt = `<current_page>\n${page}\n</current_page>\n\n<what_the_kid_asked_for_lately>\n${asked || '- (nothing yet)'}\n</what_the_kid_asked_for_lately>\n\n${describe(report, shot)}\n\n${polish}`;
    const opts = { ...who.opts, ...(who.name === 'codex' && shot ? { images: [shot] } : {}), timeoutSec: c.timeoutSec };
    const text = await ai.runBackend(who.name, { system: systemPrompt(), prompt, ...opts });

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
