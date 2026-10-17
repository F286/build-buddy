// Build Buddy: the kid holds Space (or the big red button), says what to build, and the
// AI-made page appears on the stage. Everything else here is about making that loop feel
// friendly and hard to break.

const $ = s => document.querySelector(s);
const frame = $('#frame');
const micBtn = $('#micBtn');
const pick = list => list[Math.floor(Math.random() * list.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const state = {
  config: {},
  project: null,
  html: '',
  busy: false,
  queue: [], // things said while a build was running
  fixStreak: 0,
  fixedVersions: new Set(),
  pageErrors: [],
  lastActivity: Date.now(),
  loadedAt: 0, // when the current page was put on the stage
  restoredAt: 0, // ...and if it was handed the kid's progress, when
  kept: null, // the latest KB.keep values the page reported: { projectId, keep }
  timeUp: false, // the time limit ran out: the creation is put away until a grown-up adds time
  resumeKeep: null, // ...and this is the kid's progress to hand back when it returns
};

async function api(path, body) {
  const opts = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-kidbuild': '1' }, body: JSON.stringify(body) };
  const res = await fetch(path, opts);
  return res.json();
}

// ------------------------------------------------------------------------------------- robot

for (const slot of document.querySelectorAll('.robot-slot')) slot.append($('#robotTpl').content.cloneNode(true));
const buddyEls = [$('#buddy'), $('.big-buddy')];

function mood(name) {
  for (const el of buddyEls) {
    el.classList.remove('listening', 'thinking', 'talking');
    if (name) el.classList.add(name);
  }
}

function cheer() {
  for (const el of buddyEls) {
    el.classList.remove('happy');
    void el.offsetWidth;
    el.classList.add('happy');
  }
}

// ------------------------------------------------------------------------------------- sounds

const audio = new AudioContext();
const resumeAudio = () => audio.state === 'suspended' && audio.resume();
addEventListener('pointerdown', resumeAudio, true);
addEventListener('keydown', resumeAudio, true);

function tone(freq, at, dur, type = 'sine', gain = 0.12) {
  const t = audio.currentTime + at;
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(audio.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

const sfx = {
  listen: () => (tone(660, 0, 0.1), tone(990, 0.08, 0.14)),
  stop: () => (tone(800, 0, 0.08), tone(520, 0.07, 0.14)),
  pop: () => tone(380 + Math.random() * 500, 0, 0.07, 'triangle', 0.04),
  tada: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.3, 'triangle', 0.12)),
  oops: () => (tone(420, 0, 0.16, 'sawtooth', 0.05), tone(300, 0.14, 0.24, 'sawtooth', 0.05)),
  sparkle: () => [1319, 1568, 2093].forEach((f, i) => tone(f, i * 0.07, 0.25, 'sine', 0.05)),
  tick: () => tone(880, 0, 0.06, 'triangle', 0.06),
  timeUp: () => [784, 659, 523, 392].forEach((f, i) => tone(f, i * 0.18, 0.5, 'triangle', 0.12)),
};

// ------------------------------------------------------------------------------------- voice out

// Everything the buddy says on its own, in one place so it can be prepared ahead of time.
const LINES = {
  fixing: ['Oops! Let me fix a wobbly bit.'],
  filler: ['Ooh! Let me think...', 'Okay! Building now...', 'Hmm, let me build that!'],
  tangled: ['Oh no, my brain got a little tangled. Can you say that again?', 'Hmm, that one was tricky. Can you try again?'],
  queued: ["Okay! I'll do that next.", "Got it! That's next."],
  noMic: ["I can't hear you. Ask a grown-up to check the microphone."],
  muted: ['My ears are turned off! Ask a grown-up to turn on the microphone.'],
  silence: ["I didn't hear anything. Hold the space bar and talk to me!", 'Hold the space bar while you talk!'],
  unclear: ["Hmm, I didn't catch that. Can you say it again?", 'Say that one more time?'],
  wait: ["Wait a moment, I'm still building!"],
  atStart: ["We're already at the very beginning!"],
  wentBack: ['Okay, I went back!', 'Back one step!'],
  alreadyFresh: ['This page is fresh and empty! What should we build?'],
  freshPage: ['A fresh new page! What should we build?', "Brand new page! What's your idea?"],
  nothingYet: ["You haven't built anything yet. Let's make something!"],
  gallery: ['Here are the things you made! Pick one!'],
  oneMinute: ['One more minute!'],
  timeUp: ["Time's up! Great building today. See you next time!"],
  moreTime: ["More time! Let's keep building!"],
  // Nudges when the screen sits blank: open invitations only, never ideas (those are the kid's job).
  ideas: [
    'What do you want to build? Hold the space bar and tell me!',
    "I'm ready when you are! Hold the space bar and tell me your idea.",
    'Think of something fun, then hold the space bar and tell me all about it!',
  ],
};
const line = key => pick(LINES[key]);

const voice = { queue: [], current: null, hideTimer: null, preparing: Promise.resolve() };
const buddySaid = $('#buddySaid');
const serverVoice = () => ['kokoro', 'piper'].includes(state.config.tts);
const ttsUrl = text => `/api/tts?text=${encodeURIComponent(text)}`;

// Ask the server to make the audio now, one clip at a time, so it's ready when its turn comes.
function prepare(text) {
  voice.preparing = voice.preparing.then(() => fetch(ttsUrl(text)).catch(() => {}));
  return voice.preparing;
}

// Sentence by sentence, so the first can play while the rest are being made. Tiny bits like
// "Ooh!" stay attached to the next sentence.
function sentences(text) {
  const out = [];
  for (const part of text.match(/[^.!?]+(?:[.!?]+|$)\s*/g) || [text]) {
    if (out.length && out.at(-1).trim().length < 24) out[out.length - 1] += part;
    else out.push(part);
  }
  return out.map(t => t.trim()).filter(Boolean);
}

function say(text) {
  text = (text || '').trim();
  if (!text) return;
  for (const part of sentences(text)) {
    voice.queue.push({ text: part, caption: text });
    if (serverVoice()) prepare(part);
  }
  if (!voice.current && !mic.recording) nextLine(); // never talk over the kid
}

// Make all the stock phrases once, in quiet moments (they're cached on disk afterwards).
async function warmUp() {
  if (!serverVoice()) return;
  for (const text of Object.values(LINES).flat().flatMap(sentences)) {
    while (state.busy || voice.current || mic.recording || mic.transcribing) await sleep(2000);
    await prepare(text);
  }
}

function hush() {
  voice.queue = [];
  if (voice.current?.stop) voice.current.stop();
  voice.current = null;
  window.speechSynthesis?.cancel();
  mood(null);
  buddySaid.hidden = true;
}

function nextLine() {
  const item = voice.queue.shift();
  if (!item) {
    voice.current = null;
    if (!micBtn.classList.contains('listening')) mood(state.busy ? 'thinking' : null);
    clearTimeout(voice.hideTimer);
    voice.hideTimer = setTimeout(() => (buddySaid.hidden = true), 3500);
    return;
  }
  const { text } = item;
  clearTimeout(voice.hideTimer);
  buddySaid.textContent = item.caption;
  buddySaid.hidden = false;
  mood('talking');
  const line = { stop: null };
  voice.current = line;
  const finish = () => {
    if (voice.current === line) nextLine();
  };
  const mode = state.config.tts;

  if (serverVoice()) {
    const el = new Audio(ttsUrl(text));
    line.stop = () => el.pause();
    el.onended = finish;
    el.onerror = () => setTimeout(finish, readingTime(text));
    el.play().catch(() => setTimeout(finish, readingTime(text)));
  } else if (mode === 'browser' && window.speechSynthesis) {
    const u = new SpeechSynthesisUtterance(text.replace(/\p{Extended_Pictographic}/gu, ''));
    u.rate = 0.95;
    u.pitch = 1.25;
    u.voice = speechSynthesis.getVoices().find(v => /en[-_]US/i.test(v.lang) && /samantha|zira|female|aria|jenny/i.test(v.name)) || null;
    u.onend = u.onerror = finish;
    line.stop = () => speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } else {
    const t = setTimeout(finish, readingTime(text));
    line.stop = () => clearTimeout(t);
  }
}

const readingTime = text => 1200 + text.length * 55;

// ------------------------------------------------------------------------------------- the stage

let shim = '';
let expectLoad = false;
// Creations may load only the libraries this app ships (Phaser, Three.js); everything else is
// blocked.
const LIB = `${location.origin}/lib/`;
const IMPORT_MAP = JSON.stringify({
  imports: {
    phaser: `${LIB}phaser/phaser.esm.min.js`,
    three: `${LIB}three/build/three.module.js`,
    'three/addons/': `${LIB}three/addons/`,
  },
});
const CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' blob: ${LIB}`,
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  'worker-src blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

// `restore` (the kid's progress from the previous version) is handed to KB.keep in the page.
function wrap(html, restore) {
  const handOver = restore ? `<script>window.__kbRestore=${JSON.stringify(restore).replace(/</g, '\\u003c')}<\/script>` : '';
  const head =
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `${handOver}<script>${shim}<\/script><script type="importmap">${IMPORT_MAP}<\/script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => m + head);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, m => `${m}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

function showPage(html, { restore = null } = {}) {
  state.html = html || '';
  state.pageErrors = [];
  state.loadedAt = Date.now();
  state.restoredAt = restore ? Date.now() : 0;
  if (!restore) state.kept = null;
  $('#welcome').hidden = Boolean(state.html);
  void frame.offsetWidth; // make sure the frame has its real size before the page starts
  expectLoad = true;
  // While time is up, nothing runs: keep the page (and any progress for it) for later.
  if (state.timeUp && restore) state.resumeKeep = restore.keep;
  frame.srcdoc = state.html && !state.timeUp ? wrap(state.html, restore) : '';
}

// Ask the page something and wait (briefly) for its answer.
let askId = 0;
const answers = new Map();
function askPage(type, timeoutMs) {
  const id = ++askId;
  return new Promise(resolve => {
    const timer = setTimeout(() => answers.delete(id) && resolve(null), timeoutMs);
    answers.set(id, d => (clearTimeout(timer), resolve(d)));
    tellPage({ type, id });
  });
}

// Put a new version of the same creation on the stage without losing the kid's progress: grab
// the latest KB.keep values from the running page and hand them to the new one.
async function swapPage(html, { continues = true } = {}) {
  const projectId = state.project?.id;
  let keep = null;
  if (continues && state.html) {
    const fresh = await askPage('keep?', 300);
    keep = fresh?.keep ?? (state.kept?.projectId === projectId ? state.kept.keep : null);
  }
  showPage(html, { restore: keep ? { keep } : null });
}

// The page should never wander off: if it navigates or reloads itself, put it back.
frame.addEventListener('load', () => {
  if (!expectLoad && state.html) {
    expectLoad = true;
    frame.srcdoc = wrap(state.html);
    return;
  }
  expectLoad = false;
  focusStage();
});

function focusStage() {
  if (overlayOpen() || !state.html || state.timeUp) return;
  frame.focus();
  try {
    frame.contentWindow.focus();
  } catch {}
}

function tellPage(msg) {
  try {
    frame.contentWindow?.postMessage({ kidbuild: true, ...msg }, '*');
  } catch {}
}

addEventListener('message', e => {
  const d = e.data;
  if (e.source !== frame.contentWindow || !d?.kidbuild) return;
  if (d.type === 'key') handleKey(d);
  if (d.type === 'error') pageError(d.message);
  if (d.type === 'keep' && d.keep) state.kept = { projectId: state.project?.id, keep: d.keep };
  if (d.id && answers.has(d.id)) {
    answers.get(d.id)(d);
    answers.delete(d.id);
  }
  if (d.type === 'fps') {
    state.fps = d.fps;
    if (!$('#parent').hidden) showParentStatus();
  }
});

// When a page crashes, quietly ask the AI to fix it (at most twice in a row).
let fixTimer = null;
function pageError(message) {
  if (/ResizeObserver|^Script error/i.test(message)) return;
  // Crashed right after being handed the kid's progress? Maybe the old values don't suit the
  // new version: start this version fresh instead (no fix needed yet).
  if (state.restoredAt && Date.now() - state.restoredAt < 5000) {
    console.warn('crashed with restored progress, starting fresh:', message);
    showPage(state.html);
    return;
  }
  state.pageErrors.push(message);
  clearTimeout(fixTimer);
  fixTimer = setTimeout(() => {
    const v = `${state.project?.id}:${state.project?.version}`;
    // The quick fixes didn't stick: ask the overwatch to take a careful look.
    if (state.fixStreak >= 2 || state.fixedVersions.has(v)) return checkCreation({ urgent: true });
    if (state.busy || !state.pageErrors.length) return;
    state.fixedVersions.add(v);
    const errors = [...new Set(state.pageErrors)].slice(0, 5).join('\n');
    say(line('fixing'));
    build({ fix: errors });
  }, 1500);
}

// ------------------------------------------------------------------------------------- building

const blocksEl = $('#blocks');
const COLORS = ['#ff5a5f', '#ffb020', '#ffd93d', '#3ddc84', '#14b8a6', '#38bdf8', '#8b5cf6', '#f472b6'];
const GRID = { cols: 6, rows: 3, cell: 16 };
const progress = { target: 0, shown: 0, lastEvent: 0, started: 0, timer: null };

function startBlocks(body) {
  blocksEl.replaceChildren();
  Object.assign(progress, { target: 0, shown: 0, lastEvent: Date.now(), started: Date.now() });
  const name = state.config.buddyName || 'Sparky';
  $('#buildingLabel').textContent = body.fix ? `${name} is fixing` : `${name} is building`;
  $('#buildingWhat').textContent = body.fix ? 'A wobbly bit 🔧' : `“${body.text}”`;
  $('#buildingTime').textContent = '';
  showNext();
  $('#building').hidden = false;
  clearInterval(progress.timer);
  progress.timer = setInterval(() => {
    // Backends that don't stream still get a lively build: add a block every so often.
    if (Date.now() - progress.lastEvent > 2500 && progress.shown >= progress.target) {
      progress.target = progress.shown + 1;
      progress.lastEvent = Date.now() - 1800; // next pretend block in ~0.7 s
    }
    if (progress.shown < progress.target) addBlock();
    $('#buildingTime').textContent = `${Math.floor((Date.now() - progress.started) / 1000)}s`;
  }, 140);
}

// What the kid asked for while this build was running (it's built next).
function showNext() {
  const el = $('#buildingNext');
  el.hidden = !state.queue.length;
  el.textContent = state.queue.length ? `Next: “${state.queue.join(' … ')}”` : '';
}

function addBlock() {
  const i = progress.shown++ % (GRID.cols * GRID.rows);
  if (i === 0) blocksEl.replaceChildren();
  const b = document.createElement('div');
  b.className = 'block';
  b.style.left = `${(i % GRID.cols) * GRID.cell + 1}px`;
  b.style.bottom = `${Math.floor(i / GRID.cols) * GRID.cell}px`;
  b.style.background = COLORS[(progress.shown * 3) % COLORS.length];
  blocksEl.append(b);
  sfx.pop();
}

function stopBlocks() {
  clearInterval(progress.timer);
  $('#building').hidden = true;
}

async function build(body) {
  state.busy = true;
  state.fixStreak = body.fix ? state.fixStreak + 1 : 0;
  micBtn.classList.add('thinking');
  mood(voice.current ? 'talking' : 'thinking');
  startBlocks(body);

  // If the AI hasn't said anything after a few seconds, fill the silence.
  let heardBack = false;
  const filler = setTimeout(() => !heardBack && !body.fix && say(line('filler')), 4000);

  let result = null;
  try {
    const res = await fetch('/api/build', { method: 'POST', headers: { 'content-type': 'application/json', 'x-kidbuild': '1' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === 'progress') {
          progress.target = Math.max(progress.target, Math.floor(ev.chars / 110));
          progress.lastEvent = Date.now();
        } else if (ev.type === 'say') {
          heardBack = true;
          if (!body.fix) say(ev.text);
        } else if (ev.type === 'done' || ev.type === 'error') {
          result = ev;
        }
      }
    }
  } catch (err) {
    result = { type: 'error', message: err.message };
  }
  clearTimeout(filler);
  stopBlocks();
  micBtn.classList.remove('thinking');
  state.busy = false;

  const quiet = state.timeUp; // time ran out while it was building: keep the result for later
  if (!result || result.type === 'error') {
    console.warn('build failed', result?.message);
    if (!quiet) {
      sfx.oops();
      say(line('tangled'));
    }
  } else {
    state.project = { ...state.project, title: result.title, emoji: result.emoji, version: result.version };
    if (result.html) {
      await swapPage(result.html, { continues: result.continues });
      if (!quiet) {
        sfx.tada();
        cheer();
      }
    }
    if (!body.fix && !quiet) {
      if (result.done) say(result.done);
      else if (!result.saidEarly) say(result.say);
    }
  }
  if (!voice.current) mood(null);

  if (state.queue.length && !state.timeUp) {
    const text = state.queue.splice(0).join(' ... and then: ');
    build({ text });
  }
}

// `alt` is how the second speech listener heard it, when it heard something different.
function heard(text, alt = '') {
  if (state.timeUp) return;
  state.lastActivity = Date.now();
  if (state.busy) {
    state.queue.push(text);
    showNext();
    say(line('queued'));
  } else {
    build({ text, alt });
  }
}

// ------------------------------------------------------------------------------------- overwatch

// A stronger, slower model checks on the creation once the kid has played with it for a while,
// then every few minutes while they keep playing it (or straight away if quick fixes didn't
// help), and quietly fixes it if it's broken or stuck. See server/watch.mjs.
const overwatch = { running: false, lastCheck: new Map(), urgentDone: new Set(), note: '' };

async function checkCreation({ urgent = false } = {}) {
  const cfg = state.config.watch;
  if (!cfg?.enabled || !state.html || state.timeUp || overwatch.running || !state.project?.version) return;
  if (state.busy || mic.recording || mic.transcribing) return;
  const { id: projectId, version } = state.project;
  const key = `${projectId}:${version}`;
  const last = overwatch.lastCheck.get(key);
  if (urgent) {
    if (overwatch.urgentDone.has(key)) return;
  } else {
    const shownSec = (Date.now() - state.loadedAt) / 1000;
    const due = last ? Date.now() - last >= cfg.everySec * 1000 : shownSec >= cfg.firstAfterSec;
    if (!due || overlayOpen()) return;
  }

  const answer = await askPage('inspect?', 4000);
  const report = answer?.report;
  if (!report) return;
  // Nobody's played for a while since the last look: nothing new to learn, skip the check.
  if (!urgent && last && report.idleSec > 90) return;
  const { screenshot, ...rest } = report;
  overwatch.lastCheck.set(key, Date.now());
  if (urgent) overwatch.urgentDone.add(key);
  overwatch.running = true;
  try {
    const r = await api('/api/watch', {
      projectId,
      version,
      screenshot,
      report: { ...rest, shownSec: (Date.now() - state.loadedAt) / 1000, errors: [...new Set([...(rest.errors || []), ...state.pageErrors])] },
    });
    overwatch.note = r.fixed ? `${r.verdict === 'polish' ? 'polished' : 'fixed'}: ${r.why}` : r.verdict ? `all good (${r.why})` : `skipped (${r.skipped})`;
    overwatch.note += `, ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    if (r.fixed) await applyFix(projectId, version, r);
  } catch (err) {
    console.warn('overwatch check failed', err);
  } finally {
    overwatch.running = false;
  }
}

// Put the overwatch's fix in at a calm moment, keeping the kid's progress. If the kid has moved
// on to something newer meanwhile, the fix is for an old version: leave it.
async function applyFix(projectId, version, r) {
  while (state.busy || mic.recording || mic.transcribing || voice.current) await sleep(1000);
  if (state.project?.id !== projectId || state.project?.version !== version) return;
  state.project = { ...state.project, version: r.version };
  state.fixStreak = 0;
  await swapPage(r.html);
  if (r.verdict === 'fix') sfx.sparkle(); // a polish slips in without a sound
}

setInterval(() => checkCreation(), 15000);

// ------------------------------------------------------------------------------------- time limit

// Set from the grown-up panel (the server keeps the clock, so a reload can't reset it). For the
// last minute a clock counts down in the corner; when it runs out the creation is put away and
// the "Time's up!" screen stays until a grown-up adds time or removes the limit.
const timer = { endsAt: 0, warned: false, shownSec: -1 };
const timeLeft = () => (timer.endsAt ? timer.endsAt - Date.now() : null);
const clock = ms => `${Math.floor(Math.ceil(ms / 1000) / 60)}:${String(Math.ceil(ms / 1000) % 60).padStart(2, '0')}`;

function setTimer(info) {
  const left = info?.remainingMs;
  timer.endsAt = left == null ? 0 : Date.now() + left;
  timer.warned = left != null && left <= 60000; // already in the last minute: no announcement
  tickTimer();
}

function tickTimer() {
  const el = $('#countdown');
  const left = timeLeft() ?? Infinity;
  if (left <= 0) {
    el.hidden = true;
    if (!state.timeUp) timeIsUp();
    return;
  }
  if (state.timeUp) moreTime();
  if (left > 60000) {
    el.hidden = true;
    timer.warned = false;
    return;
  }
  const sec = Math.ceil(left / 1000);
  el.hidden = false;
  el.style.setProperty('--left', String(left / 60000));
  el.classList.toggle('hurry', sec <= 10);
  if (sec !== timer.shownSec) {
    timer.shownSec = sec;
    $('#countdownNum').textContent = sec;
    if (sec <= 10) sfx.tick();
  }
  if (!timer.warned) {
    timer.warned = true;
    say(line('oneMinute'));
  }
}

async function timeIsUp() {
  state.timeUp = true;
  state.queue = [];
  if (mic.recording) {
    mic.recording = false; // drop what was being said
    mic.chunks = [];
    micBtn.classList.remove('listening');
  }
  hush();
  $('#gallery').hidden = true;
  $('#typeBox').hidden = true;
  // Put the creation away so it really stops, remembering the kid's progress for when it's back.
  const fresh = state.html ? await askPage('keep?', 300) : null;
  state.resumeKeep = fresh?.keep ?? (state.kept?.projectId === state.project?.id ? state.kept.keep : null);
  expectLoad = true;
  frame.srcdoc = '';
  $('#timeUp').hidden = false;
  document.body.classList.add('time-is-up');
  sfx.timeUp();
  say(line('timeUp'));
}

function moreTime() {
  state.timeUp = false;
  $('#timeUp').hidden = true;
  document.body.classList.remove('time-is-up');
  hush();
  const keep = state.resumeKeep;
  state.resumeKeep = null;
  if (state.html) showPage(state.html, { restore: keep ? { keep } : null });
  say(line('moreTime'));
}

setInterval(tickTimer, 250);

// ------------------------------------------------------------------------------------- listening

const mic = {
  ready: false,
  recording: false,
  chunks: [],
  preroll: [],
  rate: 48000,
  startedAt: 0,
  tapMode: false,
  speechMs: 0,
  silenceMs: 0,
  peak: 0,
  transcribing: false,
  floor: 0.002,
  tail: null, // the short wait after the key is let go
  recognizer: null,
};

async function initMic() {
  if (state.config.stt === 'browser') return initBrowserRecognizer();
  try {
    // Noise suppression is off: it tends to smear small kids' high voices, and whisper copes with
    // background noise better than with those artifacts. Echo cancellation stays on so the
    // app's own sounds don't end up in the recording.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
    });
    // The microphone is open all the time (so recording starts instantly); if it goes away,
    // e.g. the sound system restarts, open it again.
    stream.getAudioTracks()[0].addEventListener('ended', () => {
      mic.ready = false;
      setTimeout(initMic, 1000);
    });
    await audio.audioWorklet.addModule('mic-worklet.js');
    const node = new AudioWorkletNode(audio, 'recorder');
    const silent = audio.createGain();
    silent.gain.value = 0;
    audio.createMediaStreamSource(stream).connect(node).connect(silent).connect(audio.destination);
    node.port.onmessage = e => onSamples(e.data);
    mic.rate = audio.sampleRate;
    mic.ready = true;
  } catch (err) {
    console.warn('no microphone', err);
    micBtn.classList.add('nomic');
  }
}

function onSamples(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  const rms = Math.sqrt(sum / frame.length);
  // "Talking" means clearly above the room's background noise. Built-in laptop mics can be
  // quiet, so keep the absolute minimum low.
  const loud = rms > Math.max(0.006, mic.floor * 4);
  if (!loud) mic.floor = mic.floor * 0.97 + rms * 0.03; // follow the room's background noise

  if (!mic.recording) {
    // Keep the last half second, so a word started just before the key went down is caught.
    mic.preroll.push(frame);
    if (mic.preroll.length > 12) mic.preroll.shift();
    return;
  }
  micBtn.style.setProperty('--level', String(1 + Math.min(0.5, rms * 12)));
  mic.chunks.push(frame);
  for (let i = 0; i < frame.length; i++) mic.peak = Math.max(mic.peak, Math.abs(frame[i]));
  const ms = (frame.length / mic.rate) * 1000;
  if (loud) {
    mic.speechMs += ms;
    mic.silenceMs = 0;
  } else {
    mic.silenceMs += ms;
  }
  const elapsed = performance.now() - mic.startedAt;
  // Tapped instead of held: stop by itself when they pause (or never start talking).
  if (mic.tapMode && mic.speechMs > 300 && mic.silenceMs > 1600) stopListening();
  else if (mic.tapMode && mic.speechMs < 150 && elapsed > 7000) stopListening();
  else if (elapsed > 30000) stopListening();
}

function pressTalk() {
  if (state.timeUp) return;
  state.lastActivity = Date.now();
  if (overlayOpen()) return closeOverlays();
  if (mic.recording) {
    if (!mic.tail) return stopListening(); // second tap finishes
    clearTimeout(mic.tail); // pressed again right after letting go: just keep listening
    mic.tail = null;
    return;
  }
  if (!mic.ready && !mic.recognizer) {
    sfx.oops();
    return say(line('noMic'));
  }
  hush();
  resumeAudio();
  sfx.listen();
  tellPage({ type: 'mute' });
  mood('listening');
  micBtn.classList.add('listening');
  Object.assign(mic, { recording: true, tapMode: false, startedAt: performance.now(), speechMs: 0, silenceMs: 0, peak: 0, chunks: [...mic.preroll] });
  if (mic.recognizer) mic.recognizer.start();
}

function releaseTalk() {
  if (!mic.recording || mic.tail) return;
  if (mic.recognizer) return stopListening();
  if (performance.now() - mic.startedAt > 700) {
    // Walkie-talkie style. Kids often let go just before their last word ends, so keep
    // listening a moment longer.
    mic.tail = setTimeout(stopListening, 400);
  } else {
    mic.tapMode = true; // a quick tap: keep listening until they pause
  }
}

async function stopListening() {
  if (!mic.recording) return;
  mic.recording = false;
  clearTimeout(mic.tail);
  mic.tail = null;
  sfx.stop();
  tellPage({ type: 'unmute' });
  micBtn.classList.remove('listening');
  micBtn.style.setProperty('--level', '1');
  mood(state.busy ? 'thinking' : null);
  focusStage();
  if (voice.queue.length && !voice.current) nextLine(); // anything the buddy held back

  if (mic.recognizer) return mic.recognizer.stop(); // result arrives via onresult

  const heldMs = performance.now() - mic.startedAt;
  const { peak, speechMs, chunks } = mic;
  mic.chunks = [];
  // Nothing but quiet: don't send it (whisper invents sentences from silence). If the sound
  // system has the microphone muted, say so.
  if (speechMs < 150 && peak < 0.05) {
    const { muted } = await api('/api/mic').catch(() => ({}));
    if (muted) {
      sfx.oops();
      return say(line('muted'));
    }
    return say(line('silence'));
  }

  // Quiet voices are easier to understand once they're turned up.
  // Speech engines want 16 kHz. The browser's own resampler does that cleanly (a quick average
  // muddied little voices, and the engines' built-in resamplers are rougher still).
  const samples = await resample(concat(chunks), mic.rate, 16000);
  const gain = Math.min(20, 0.9 / peak);
  if (gain > 1) for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  const wav = encodeWav(samples, 16000);
  mood('thinking');
  micBtn.classList.add('thinking');
  let text = '';
  let alt = '';
  let muted = false;
  mic.transcribing = true;
  try {
    const info = `ms=${Math.round(heldMs)}&speech=${Math.round(speechMs)}&peak=${peak.toFixed(4)}`;
    const res = await fetch(`/api/transcribe?${info}`, { method: 'POST', headers: { 'content-type': 'audio/wav', 'x-kidbuild': '1' }, body: wav });
    ({ text = '', alt = '', muted = false } = await res.json());
  } catch (err) {
    console.warn('transcribe failed', err);
  }
  mic.transcribing = false;
  if (!state.busy) micBtn.classList.remove('thinking');
  mood(state.busy ? 'thinking' : null);
  if (muted) {
    sfx.oops();
    return say(line('muted'));
  }
  if (!text) return say(line('unclear'));
  heard(text, alt);
}

function initBrowserRecognizer() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return micBtn.classList.add('nomic');
  const r = new SR();
  r.lang = 'en-US';
  r.interimResults = false;
  r.continuous = true;
  let text = '';
  r.onresult = e => {
    for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript + ' ';
  };
  r.onend = () => {
    const t = text.trim();
    text = '';
    if (t) heard(t);
    else say(line('unclear'));
  };
  mic.recognizer = r;
}

function concat(chunks) {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) out.set(c, (o += c.length) - c.length);
  return out;
}

async function resample(input, from, to) {
  if (from === to) return input;
  const ctx = new OfflineAudioContext(1, Math.ceil((input.length * to) / from), to);
  const buffer = ctx.createBuffer(1, input.length, from);
  buffer.copyToChannel(input, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  return (await ctx.startRendering()).getChannelData(0);
}

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// ------------------------------------------------------------------------------------- buttons

function onPress(el, fn) {
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); // don't steal keyboard focus from the creation
    fn(e);
  });
}

micBtn.addEventListener('pointerdown', e => {
  e.preventDefault();
  micBtn.setPointerCapture(e.pointerId);
  pressTalk();
});
micBtn.addEventListener('pointerup', releaseTalk);
micBtn.addEventListener('pointercancel', releaseTalk);

onPress($('#undoBtn'), async () => {
  if (state.busy) return say(line('wait'));
  hush();
  const r = await api('/api/undo', {});
  if (!r.project) {
    sfx.oops();
    return say(line('atStart'));
  }
  state.project = r.project;
  await swapPage(r.html);
  sfx.stop();
  say(line('wentBack'));
});

onPress($('#newBtn'), async () => {
  if (state.busy) return say(line('wait'));
  hush();
  if (!state.html && !state.project?.versions) return say(line('alreadyFresh'));
  const r = await api('/api/new', {});
  state.project = r.project;
  showPage('');
  sfx.tada();
  say(line('freshPage'));
});

onPress($('#galleryBtn'), openGallery);
onPress($('#galleryClose'), closeOverlays);

async function openGallery() {
  if (state.busy) return say(line('wait'));
  hush();
  const { projects, current } = await api('/api/projects');
  const grid = $('#galleryGrid');
  grid.replaceChildren();
  if (!projects.length) {
    say(line('nothingYet'));
    return;
  }
  for (const p of projects) {
    const card = document.createElement('button');
    card.className = `card${p.id === current ? ' current' : ''}`;
    card.tabIndex = -1;
    card.innerHTML = '<span class="emoji"></span><span class="name"></span>';
    card.querySelector('.emoji').textContent = p.emoji;
    card.querySelector('.name').textContent = p.title;
    onPress(card, async () => {
      hush();
      const r = await api('/api/open', { id: p.id });
      if (!r.project) return;
      state.project = r.project;
      closeOverlays();
      showPage(r.html);
      sfx.tada();
      say(`Here's your ${p.title}!`);
    });
    grid.append(card);
  }
  $('#gallery').hidden = false;
  say(line('gallery'));
}

// ------------------------------------------------------------------------------------- keyboard

const overlayOpen = () => !$('#gallery').hidden || !$('#parent').hidden || !$('#typeBox').hidden;

function closeOverlays() {
  $('#gallery').hidden = true;
  $('#parent').hidden = true;
  $('#typeBox').hidden = true;
  focusStage();
}

function handleKey(k) {
  state.lastActivity = Date.now();
  const down = k.event === 'keydown';
  if ((k.ctrl || k.meta) && k.shift && k.code === 'KeyP') {
    if (down) $('#parent').hidden ? openParent() : closeOverlays();
    return;
  }
  if (k.code === 'Escape') return down && closeOverlays();
  if (state.timeUp || !$('#parent').hidden) return;
  if (k.code === 'Space') {
    if (k.repeat) return;
    return down ? pressTalk() : releaseTalk();
  }
  if ((k.code === 'Enter' || k.code === 'NumpadEnter') && down) openTypeBox();
}

const APP_KEYS = new Set(['Space', 'Enter', 'NumpadEnter', 'Escape']);
for (const type of ['keydown', 'keyup']) {
  document.addEventListener(type, e => {
    if (e.target.closest?.('#typeBox, #parent')) {
      if (e.target.id === 'typeInput' && type === 'keydown' && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
        e.preventDefault();
        return $('#typeBox').requestSubmit();
      }
      if (e.code === 'Escape' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyP')) {
        e.preventDefault();
        handleKey({ event: type, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey });
      }
      return; // let grown-ups type normally
    }
    // Stop browser zoom and similar shortcuts from rearranging things.
    if ((e.ctrlKey || e.metaKey) && ['Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract'].includes(e.code)) return e.preventDefault();
    const code = e.key === ' ' ? 'Space' : e.code;
    if (APP_KEYS.has(code) || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyP')) {
      e.preventDefault();
      handleKey({ event: type, code, repeat: e.repeat, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey });
    } else if (state.html && !overlayOpen() && !state.timeUp) {
      // Focus slipped out of the creation (e.g. after a click on the dock): pass keys along.
      if (e.key.startsWith('Arrow')) e.preventDefault();
      tellPage({ type: 'key', event: type, key: e.key, code: e.code });
      focusStage();
    }
  });
}

function openTypeBox() {
  hush();
  $('#typeBox').hidden = false;
  $('#typeInput').value = '';
  $('#typeInput').focus();
}

$('#typeBox').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('#typeInput').value.trim();
  closeOverlays();
  if (text) heard(text);
});

addEventListener('contextmenu', e => e.preventDefault());
addEventListener('dragstart', e => e.preventDefault());
addEventListener('wheel', e => e.ctrlKey && e.preventDefault(), { passive: false });

// ------------------------------------------------------------------------------------- grown-ups

async function openParent() {
  const c = (state.config = await api('/api/config'));
  const f = $('#parentForm');
  const brains = c.backends.join(',');
  f.brains.value = [...f.brains.options].some(o => o.value === brains) ? brains : 'claude,codex';
  f.claudeModel.value = c.claudeModel || '';
  f.claudeFast.value = c.claudeFast ? 'fast' : '';
  f.codexModel.value = c.codexModel || '';
  f.stt.value = c.stt;
  f.tts.value = c.tts;
  const accent = { a: 'American', b: 'British' };
  f.voice.replaceChildren(
    ...c.voices.map(v => {
      const name = v.slice(3).replace(/^./, ch => ch.toUpperCase());
      const label = `${name} (${accent[v[0]]} ${v[1] === 'f' ? 'woman' : 'man'})${v === 'af_heart' ? ' - recommended' : ''}`;
      return new Option(label, v);
    }),
  );
  f.voice.value = c.voice;
  f.buddyName.value = c.buddyName;
  f.kidName.value = c.kidName;
  // Time limit: leave it as it is, remove it, or start a new countdown from now.
  const left = timeLeft();
  const asIs = left == null ? '' : left > 0 ? `Keep going (${clock(left)} left)` : "Time's up (stay stopped)";
  f.timeLimit.replaceChildren(
    ...(asIs ? [new Option(asIs, 'keep')] : []),
    new Option('No limit', '0'),
    ...[2, 5, 10, 15, 20, 30, 45, 60].map(m => new Option(`${m} minutes${asIs ? ' from now' : ''}`, String(m))),
  );
  f.timeLimit.value = asIs ? 'keep' : '0';
  state.fps = null;
  showParentStatus();
  $('#parent').hidden = false;
  if (state.html) tellPage({ type: 'fps?' }); // the answer fills in the frame rate
}

function showParentStatus() {
  const c = state.config;
  const s = c.speech || {};
  $('#parentStatus').textContent =
    `Listening: ${s.stt === false ? `${c.stt} NOT installed (run setup.sh)` : c.stt}. ` +
    `Talking: ${s.tts === false ? `${c.tts} NOT installed (run setup.sh)` : c.tts}. ` +
    (c.claudeFast && c.fastStatus?.note ? `Claude fast mode didn't run last time: ${c.fastStatus.note}. ` : '') +
    `Showing: ${state.project?.title || 'blank page'}` +
    (state.fps ? `, running at ${state.fps} frames per second.` : '.') +
    (overwatch.note ? ` Overwatch: ${overwatch.note}.` : '') +
    (timeLeft() == null ? '' : timeLeft() > 0 ? ` Time left: ${clock(timeLeft())}.` : " Time's up.");
}

$('#parentForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const c = await api('/api/config', {
    backends: f.brains.value.split(','),
    claudeModel: f.claudeModel.value,
    claudeFast: f.claudeFast.value === 'fast',
    codexModel: f.codexModel.value,
    stt: f.stt.value,
    tts: f.tts.value,
    voice: f.voice.value,
    buddyName: f.buddyName.value,
    kidName: f.kidName.value,
  });
  const sttChanged = c.stt !== state.config.stt;
  state.config = c;
  const limit = f.timeLimit.value;
  if (limit !== 'keep' && (limit !== '0' || timer.endsAt)) setTimer(await api('/api/timer', { minutes: Number(limit) }));
  closeOverlays();
  if (sttChanged) location.reload();
});
$('#parentClose').addEventListener('click', closeOverlays);
$('#voicePreview').addEventListener('click', async () => {
  const f = $('#parentForm');
  state.config = await api('/api/config', { tts: f.tts.value, voice: f.voice.value });
  hush();
  say(`Hi! I'm ${state.config.buddyName}. What do you want to build today?`);
});
$('#quitBtn').addEventListener('click', () => api('/api/quit', {}).finally(() => window.close()));

// ------------------------------------------------------------------------------------- start

// Nudge with ideas if the screen sits blank and quiet for a while.
let nudges = 0;
setInterval(() => {
  if (state.html || state.busy || state.timeUp || voice.current || mic.recording || overlayOpen() || nudges >= 3) return;
  if (Date.now() - state.lastActivity < 75000) return;
  state.lastActivity = Date.now();
  nudges++;
  say(line('ideas'));
}, 5000);

(async function start() {
  let s;
  for (;;) {
    // The server may still be starting up: keep trying rather than show an error page.
    try {
      shim = await fetch('stage-shim.js').then(r => r.text());
      s = await api('/api/state');
      break;
    } catch {
      await sleep(1000);
    }
  }
  state.config = s.config;
  state.project = s.project;
  setTimer(s.timer); // before the page: if time is already up, it stays put away
  showPage(s.html);
  await initMic();
  await sleep(600);
  const name = state.config.kidName ? ` ${state.config.kidName}` : '';
  if (state.timeUp) return;
  if (s.html) say(`Welcome back${name}! Hold the space bar to tell me what to change.`);
  else say(`Hi${name}! I'm ${state.config.buddyName}. Hold the space bar and tell me what you want to build!`);
  setTimeout(warmUp, 8000);
})();
