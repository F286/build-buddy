// Build Buddy: a local web server plus a full-screen browser pointed at it.
//
//   node server/main.mjs              server + full-screen browser (closing it quits the app)
//   node server/main.mjs --window     server + normal app window (for grown-ups testing)
//   node server/main.mjs --no-browser server only; open http://127.0.0.1:4321 yourself
//   add --debug to let Chrome DevTools tooling attach to the browser on port 9222
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { config, saveConfig, ROOT, DATA } from './config.mjs';
import * as store from './store.mjs';
import * as ai from './ai.mjs';
import * as speech from './speech.mjs';
import * as watch from './watch.mjs';
import * as team from './team.mjs';
import { findBin } from './bins.mjs';

const PUBLIC = path.join(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};
const args = new Set(process.argv.slice(2));
const port = config().port;

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const readJson = async req => JSON.parse((await readBody(req)).toString('utf8') || '{}');

function projectInfo(p) {
  return { id: p.id, title: p.title, emoji: p.emoji, version: p.current, versions: p.versions.length };
}

function publicConfig() {
  const c = config();
  return {
    buddyName: c.buddyName,
    kidName: c.kidName,
    backends: c.backends,
    allBackends: ai.backendNames,
    claudeModel: c.claude.model,
    claudeFast: Boolean(c.claude.fast),
    team: Boolean(c.team.enabled),
    teamActive: team.enabled(),
    polishPasses: team.polishPasses(),
    creationsButton: Boolean(c.creationsButton),
    fastStatus: ai.fastStatus(),
    codexModel: c.codex.model,
    stt: c.stt,
    tts: c.tts,
    voice: c.kokoro.voice,
    voices: speech.KOKORO_VOICES,
    watch: { enabled: c.watch.enabled, firstAfterSec: c.watch.firstAfterSec, everySec: c.watch.everySec },
    speech: speech.status(),
  };
}

// The time limit. It's off unless a grown-up turns it on in the panel (the kid can't set it by
// talking). It's kept on disk so closing and reopening the app doesn't get around it - but only
// for a while: started half an hour or more after it ran out, the app starts with no limit.
const TIMER_FILE = path.join(DATA, 'timer.json');
const TIMER_GRACE_MS = 30 * 60000;
let timerEndsAt = 0;
let timerUpLog = null;

function setTimerEnd(endsAt) {
  timerEndsAt = endsAt;
  clearTimeout(timerUpLog);
  if (endsAt > Date.now()) timerUpLog = setTimeout(() => ai.log("TIMER time's up"), endsAt - Date.now());
  try {
    if (endsAt) fs.writeFileSync(TIMER_FILE, JSON.stringify({ endsAt }));
    else fs.rmSync(TIMER_FILE, { force: true });
  } catch {}
}
try {
  const { endsAt } = JSON.parse(fs.readFileSync(TIMER_FILE, 'utf8'));
  if (endsAt && Date.now() - endsAt < TIMER_GRACE_MS) {
    setTimerEnd(endsAt);
    ai.log(`TIMER carried over (${endsAt > Date.now() ? `${Math.ceil((endsAt - Date.now()) / 60000)} min left` : "time's up"})`);
  } else setTimerEnd(0);
} catch {}

const timerInfo = () => ({ remainingMs: timerEndsAt ? Math.max(0, timerEndsAt - Date.now()) : null });
const timeIsUp = () => Boolean(timerEndsAt) && Date.now() >= timerEndsAt;

// The kid was still saying what they wanted when time ran out (app.js: overtime): that one
// request still gets built, if it arrives within a minute.
let graceUsedFor = 0;
function graceAllowed() {
  if (Date.now() - timerEndsAt > 60000 || graceUsedFor === timerEndsAt) return false;
  graceUsedFor = timerEndsAt;
  return true;
}

// What whisper should expect to hear: what's being built and what the kid said lately.
function speechContext() {
  const p = store.currentProject();
  const said = p.history.filter(h => h.role === 'kid').slice(-3).map(h => h.text);
  return [p.title, ...said].filter(Boolean).join('. ').replace(/\.\./g, '.');
}

const routes = {
  'GET /api/state': () => {
    const p = store.currentProject();
    return { project: projectInfo(p), html: store.html(p), busy: ai.isBusy(), config: publicConfig(), timer: timerInfo() };
  },

  // { minutes: 20 } starts (or restarts) the countdown from now; 0 removes the limit.
  'POST /api/timer': async req => {
    const minutes = Number((await readJson(req)).minutes);
    setTimerEnd(minutes > 0 ? Date.now() + Math.min(minutes, 600) * 60000 : 0);
    ai.log(`TIMER ${minutes > 0 ? `${minutes} min` : 'off'}`);
    return timerInfo();
  },

  'POST /api/build': async (req, res) => {
    const { text, alt, fix, grace } = await readJson(req);
    if (!text?.trim() && !fix) return send(res, 400, { error: 'say something' });
    if (timeIsUp() && !(grace && text && graceAllowed())) return send(res, 423, { error: 'time is up' });
    if (ai.isBusy()) return send(res, 409, { error: 'busy' });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    const emit = ev => {
      if (!res.destroyed) res.write(JSON.stringify(ev) + '\n');
    };
    const started = Date.now();
    const endsAt = timerEndsAt;
    try {
      await ai.build({ text: text?.trim(), alt: alt?.trim(), fix }, emit);
    } catch (err) {
      console.error('build failed:', err.message);
      emit({ type: 'error', message: err.message });
    }
    // Fixing a wobbly bit doesn't use up play time: add it back (unless a grown-up changed the
    // limit meanwhile).
    if (fix && endsAt && timerEndsAt === endsAt) {
      setTimerEnd(endsAt + (Date.now() - started));
      emit({ type: 'timer', ...timerInfo() });
    }
    res.end();
  },

  // The kid started talking (or typing): in team mode, start the team's programs now so they're
  // ready when the request arrives.
  'POST /api/warm': () => team.warm(),

  // A team-built creation just appeared: take a careful look and fix what would spoil it.
  'POST /api/check': async req => team.check(await readJson(req)),

  // The page reports how the creation is running (and a screenshot); see watch.mjs.
  'POST /api/watch': async req => watch.review(await readJson(req)),

  'POST /api/transcribe': async (req, res, url) => {
    const t0 = Date.now();
    const q = url.searchParams;
    const { text, alt = '' } = await speech.transcribe(await readBody(req), { context: speechContext(), talkMs: Number(q.get('speech')) });
    const muted = !text && micMuted();
    ai.log(`HEAR ${(q.get('ms') / 1000).toFixed(1)}s peak=${q.get('peak')} talk=${q.get('speech')}ms → ${JSON.stringify(text)}${alt ? ` / ${JSON.stringify(alt)}` : ''}${muted ? ' (MIC MUTED)' : ''} (${Date.now() - t0}ms)`);
    return { text, alt, muted };
  },

  // Nothing was heard: is that because the microphone is muted?
  'GET /api/mic': () => ({ muted: micMuted() }),

  'GET /api/tts': async (req, res, url) => {
    const wav = await speech.speak(url.searchParams.get('text'));
    if (!wav) return send(res, 204, '', 'text/plain');
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'max-age=86400' });
    res.end(wav);
  },

  'POST /api/undo': () => {
    if (ai.isBusy()) return { error: 'busy' };
    const p = store.undo();
    return p ? { project: projectInfo(p), html: store.html(p) } : { nothing: true };
  },

  // A fix from the team's checker or polisher, or the overwatch, threw errors when the app tried
  // it out of sight: take it back, so the creation stays as it was.
  'POST /api/drop-fix': async req => {
    const { projectId, version, error } = await readJson(req);
    const p = store.currentProject();
    const v = p.versions.find(x => x.n === version);
    if (p.id !== projectId || p.current !== version || !/check|polish|overwatch/.test(v?.backend || '')) return { dropped: false };
    store.dropVersion(p, version);
    ai.log(`FIX dropped v${version} (${v.backend}): it crashed when tried - ${String(error || '').slice(0, 160)}`);
    return { dropped: true };
  },

  'POST /api/new': () => {
    if (ai.isBusy()) return { error: 'busy' };
    const p = store.newProject();
    return { project: projectInfo(p), html: '' };
  },

  'GET /api/projects': () => ({ projects: store.list(), current: store.currentProject().id }),

  'POST /api/open': async req => {
    if (ai.isBusy()) return { error: 'busy' };
    const p = store.open((await readJson(req)).id);
    return p ? { project: projectInfo(p), html: store.html(p) } : { error: 'not found' };
  },

  'GET /api/config': () => publicConfig(),

  'POST /api/config': async req => {
    const b = await readJson(req);
    const patch = {};
    if (Array.isArray(b.backends)) patch.backends = b.backends.filter(n => ai.backendNames.includes(n));
    if (typeof b.claudeModel === 'string') patch.claude = { model: b.claudeModel.trim() };
    if (typeof b.claudeFast === 'boolean') patch.claude = { ...patch.claude, fast: b.claudeFast };
    if (typeof b.team === 'boolean') patch.team = { enabled: b.team };
    if (typeof b.codexModel === 'string') patch.codex = { model: b.codexModel.trim() };
    if (typeof b.creationsButton === 'boolean') patch.creationsButton = b.creationsButton;
    for (const k of ['buddyName', 'kidName']) if (typeof b[k] === 'string') patch[k] = b[k].trim().slice(0, 30);
    if (['both', 'parakeet', 'whisper', 'browser', 'off'].includes(b.stt)) patch.stt = b.stt;
    if (['kokoro', 'piper', 'browser', 'off'].includes(b.tts)) patch.tts = b.tts;
    if (speech.KOKORO_VOICES.includes(b.voice)) patch.kokoro = { voice: b.voice };
    saveConfig(patch);
    return publicConfig();
  },

  'POST /api/quit': () => {
    setTimeout(shutdown, 100);
    return { ok: true };
  },
};

// Libraries creations may import, served from vendor/ (see the import map in public/app.js).
const LIBS = ['three', 'phaser'];

function serveStatic(res, pathname) {
  // Creations run in a sandboxed frame with no origin of their own, so libraries need CORS; they
  // never change, so let the browser keep them.
  const libName = /^\/lib\/([a-z]+)\//.exec(pathname)?.[1];
  const lib = LIBS.includes(libName);
  const base = lib ? path.join(ROOT, 'vendor', libName) : PUBLIC;
  const rel = lib ? pathname.slice(`/lib/${libName}/`.length) : pathname === '/' ? 'index.html' : pathname;
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep)) return send(res, 404, { error: 'not found' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': lib ? 'max-age=31536000, immutable' : 'no-cache',
      ...(lib && { 'Access-Control-Allow-Origin': '*' }),
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  // Only this computer may use the app: refuse other Host names (DNS rebinding) and
  // cross-site POSTs (other web pages cannot add the custom header without CORS approval).
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return send(res, 403, { error: 'forbidden' });
  if (req.method === 'POST' && req.headers['x-kidbuild'] !== '1') return send(res, 403, { error: 'forbidden' });

  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = routes[`${req.method} ${url.pathname}`];
  if (!route) return req.method === 'GET' ? serveStatic(res, url.pathname) : send(res, 404, { error: 'not found' });
  try {
    const result = await route(req, res, url);
    if (result !== undefined && !res.headersSent) send(res, 200, result);
  } catch (err) {
    console.error(`${req.method} ${url.pathname}:`, err.message);
    if (!res.headersSent) send(res, 500, { error: err.message });
    else res.end();
  }
});

// ---------------------------------------------------------------------------------------------
// Kiosk browser

function findBrowser() {
  const c = config();
  if (c.browser) return c.browser;
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ].find(f => fs.existsSync(f));
  }
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    const rel = ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'];
    return roots.flatMap(r => rel.map(x => path.join(r, x))).find(f => fs.existsSync(f));
  }
  for (const n of ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome', 'brave-browser', 'microsoft-edge-stable']) {
    const f = findBin(n);
    if (f) return f;
  }
  return null;
}

let browser = null;
let quitting = false;

// A microphone muted in the system settings sounds exactly like a kid who isn't talking
// (Chrome even adds faint noise), so ask the sound system directly. Linux/PipeWire only.
function micMuted() {
  const wpctl = process.platform === 'linux' && findBin('wpctl');
  if (!wpctl) return false;
  try {
    return execFileSync(wpctl, ['get-volume', '@DEFAULT_AUDIO_SOURCE@'], { encoding: 'utf8' }).includes('MUTED');
  } catch {
    return false;
  }
}

function unmuteMicrophone() {
  if (!config().unmuteMic || !micMuted()) return;
  try {
    execFileSync(findBin('wpctl'), ['set-mute', '@DEFAULT_AUDIO_SOURCE@', '0']);
    console.log('  the microphone was muted in the system settings - switched it on');
  } catch {}
}

// Pre-approve the microphone for the app's own address in its private browser profile, so
// there's never a permission pop-up (the same setting Chrome saves when you click "Allow").
function allowMicrophone(profile) {
  const file = path.join(profile, 'Default', 'Preferences');
  let prefs = {};
  try {
    prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') return; // unreadable: leave Chrome's file alone
  }
  const exceptions = (((prefs.profile ??= {}).content_settings ??= {}).exceptions ??= {});
  const key = `http://127.0.0.1:${port},*`;
  if (exceptions.media_stream_mic?.[key]?.setting === 1) return;
  (exceptions.media_stream_mic ??= {})[key] = { setting: 1 };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(prefs));
}

// A copy that is just quitting may still be closing its window. Chrome hands a second window on
// the same profile to the one already running (and the new one exits at once), so wait for the
// old one to let go of it.
async function profileFree(profile) {
  for (let i = 0; i < 50; i++) {
    let pid = 0;
    try {
      pid = Number(fs.readlinkSync(path.join(profile, 'SingletonLock')).split('-').pop());
      process.kill(pid, 0);
    } catch {
      return; // no lock, or its owner is gone
    }
    await new Promise(r => setTimeout(r, 200));
  }
}

function launchBrowser(kiosk) {
  const bin = findBrowser();
  if (!bin) {
    console.log(`No Chrome/Chromium/Edge found. Open http://127.0.0.1:${port} in one, full screen.`);
    return;
  }
  const profile = path.join(DATA, 'browser-profile');
  const flags = [
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--password-store=basic',
    '--autoplay-policy=no-user-gesture-required', // the buddy may talk before the first click
    '--overscroll-history-navigation=0', '--disable-pinch', '--noerrdialogs',
    '--disable-session-crashed-bubble', '--disable-infobars', '--hide-crash-restore-bubble',
    '--disable-features=Translate,TranslateUI,MediaRouter,GlobalMediaControls,DownloadBubble',
    '--check-for-update-interval=31536000',
    kiosk ? '--kiosk' : '--window-size=1280,860',
    ...(args.has('--debug') ? ['--remote-debugging-port=9222'] : []),
    `--app=http://127.0.0.1:${port}/`,
  ];
  let quickExits = 0;
  const start = async () => {
    await profileFree(profile);
    if (quitting) return;
    allowMicrophone(profile);
    const t0 = Date.now();
    browser = spawn(bin, flags, { stdio: 'ignore' });
    browser.on('exit', () => {
      browser = null;
      if (quitting) return;
      if (!config().keepOpen) return shutdown(); // closing the window quits the app
      // Kid-proof mode: closed by accident (or by a curious kid)? Bring it straight back. Back
      // off if it keeps exiting immediately, e.g. because the profile is locked by another copy.
      quickExits = Date.now() - t0 < 5000 ? quickExits + 1 : 0;
      setTimeout(start, quickExits > 3 ? 15000 : 800);
    });
  };
  start();
}

function shutdown() {
  if (quitting) return;
  quitting = true;
  console.log('Bye!');
  browser?.kill();
  server.close();
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// A kid is using this unattended: log surprises instead of dying and leaving a dead screen.
process.on('uncaughtException', err => console.error('unexpected error:', err));
process.on('unhandledRejection', err => console.error('unexpected rejection:', err));

server.listen(port, '127.0.0.1', () => {
  const s = speech.status();
  console.log(`Build Buddy is running at http://127.0.0.1:${port}`);
  const building = team.enabled() ? `a team (lead + up to ${team.maxHelpers()} helpers)` : config().team.enabled ? 'classic (team mode needs claude first in backends)' : 'classic';
  console.log(`  building: ${building}`);
  console.log(`  brains: ${config().backends.join(' → ')}   ears: ${config().stt}${s.stt === false ? ' (NOT installed - run ./setup.sh)' : ''}   voice: ${config().tts}${s.tts === false ? ' (NOT installed - run ./setup.sh)' : ''}`);
  console.log('  grown-ups: press Ctrl+Shift+P in the app for settings and Quit.');
  unmuteMicrophone();
  if (!args.has('--no-browser')) launchBrowser(!args.has('--window'));
});
// Already running? That copy may have lost its window, or be an older version: ask it to quit
// and take over, so starting Build Buddy always gives a fresh window.
let takeover = 0;
server.on('error', async err => {
  if (err.code === 'EADDRINUSE' && takeover < 20) {
    if (!takeover++) {
      const quit = await fetch(`http://127.0.0.1:${port}/api/quit`, { method: 'POST', headers: { 'x-kidbuild': '1', 'content-type': 'application/json' }, body: '{}' })
        .then(r => r.json())
        .catch(() => null);
      if (!quit?.ok) takeover = 20; // something else has the port
      else console.log('Build Buddy was already running - starting it fresh');
    }
    if (takeover < 20) return setTimeout(() => server.listen(port, '127.0.0.1'), 500);
  }
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is busy - is something else using it?` : err.message);
  process.exit(1);
});
