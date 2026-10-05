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
    codexModel: c.codex.model,
    stt: c.stt,
    tts: c.tts,
    voice: c.kokoro.voice,
    three: fs.existsSync(path.join(THREE_DIR, 'build/three.module.js')),
    voices: speech.KOKORO_VOICES,
    speech: speech.status(),
  };
}

const routes = {
  'GET /api/state': () => {
    const p = store.currentProject();
    return { project: projectInfo(p), html: store.html(p), busy: ai.isBusy(), config: publicConfig() };
  },

  'POST /api/build': async (req, res) => {
    const { text, fix } = await readJson(req);
    if (!text?.trim() && !fix) return send(res, 400, { error: 'say something' });
    if (ai.isBusy()) return send(res, 409, { error: 'busy' });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    const emit = ev => {
      if (!res.destroyed) res.write(JSON.stringify(ev) + '\n');
    };
    try {
      await ai.build({ text: text?.trim(), fix }, emit);
    } catch (err) {
      console.error('build failed:', err.message);
      emit({ type: 'error', message: err.message });
    }
    res.end();
  },

  'POST /api/transcribe': async (req, res, url) => {
    const t0 = Date.now();
    const text = await speech.transcribe(await readBody(req));
    const muted = !text && micMuted();
    const q = url.searchParams;
    ai.log(`HEAR ${(q.get('ms') / 1000).toFixed(1)}s peak=${q.get('peak')} talk=${q.get('speech')}ms → ${JSON.stringify(text)}${muted ? ' (MIC MUTED)' : ''} (${Date.now() - t0}ms)`);
    return { text, muted };
  },

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
    if (typeof b.codexModel === 'string') patch.codex = { model: b.codexModel.trim() };
    for (const k of ['buddyName', 'kidName']) if (typeof b[k] === 'string') patch[k] = b[k].trim().slice(0, 30);
    if (['whisper', 'browser', 'off'].includes(b.stt)) patch.stt = b.stt;
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

const THREE_DIR = path.join(ROOT, 'vendor/three');

function serveStatic(res, pathname) {
  // Libraries creations may import (Three.js). Creations run in a sandboxed frame with no origin
  // of their own, so these need CORS; they never change, so let the browser keep them.
  const lib = pathname.startsWith('/lib/three/');
  const base = lib ? THREE_DIR : PUBLIC;
  const rel = lib ? pathname.slice('/lib/three/'.length) : pathname === '/' ? 'index.html' : pathname;
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
  const start = () => {
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
  console.log(`  brains: ${config().backends.join(' → ')}   ears: ${config().stt}${s.stt === false ? ' (NOT installed - run ./setup.sh)' : ''}   voice: ${config().tts}${s.tts === false ? ' (NOT installed - run ./setup.sh)' : ''}`);
  console.log('  grown-ups: press Ctrl+Shift+P in the app for settings and Quit.');
  unmuteMicrophone();
  if (!args.has('--no-browser')) launchBrowser(!args.has('--window'));
});
server.on('error', err => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is busy - is Build Buddy already running?` : err.message);
  process.exit(1);
});
