// Settings live in config.json next to package.json. Anything missing falls back to DEFAULTS,
// so config.json only needs the values you want to change.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.join(ROOT, 'data');
const FILE = path.join(ROOT, 'config.json');

export const DEFAULTS = {
  port: 4321,
  kidName: '',
  kidAge: 5,
  buddyName: 'Sparky',

  // AI "brains", tried in order. If the first fails (offline, usage limit hit, ...) the next is used.
  //   claude  - Claude Code CLI, signed in with a Claude subscription (or ANTHROPIC_API_KEY)
  //   codex   - OpenAI Codex CLI, signed in with a ChatGPT subscription (or an OpenAI API key)
  //   command - any program that reads a prompt on stdin and prints the reply (ollama, llm, gemini, ...)
  backends: ['claude', 'codex'],
  // Opus at low effort: in tests it answered out loud faster than Sonnet (2.8 s vs 7 s) and built
  // richer pages in about the same time (25 s vs 21 s). Higher effort roughly doubles the wait.
  // fast: Claude's fast mode for the builder - the same model, answering much sooner. On a Claude
  // subscription it's paid from extra usage credits; with none left it runs at normal speed.
  claude: { bin: '', model: 'opus', effort: 'low', fast: false },
  codex: { bin: '', model: '', reasoning: 'low' },
  command: { cmd: '', args: [] },

  // How the kids talk to it:
  //   false - hold the space bar (or the big button) while talking, one at a time
  //   true  - hands-free: the microphone is always on and Sparky chats back. A quick model in
  //           the middle (talk, below; needs Claude) answers, asks when it can't tell what they
  //           want, and passes their requests to the builder in their own words.
  handsFree: false,
  talk: { model: 'sonnet', effort: 'low' },

  // Speech in: both (whisper and Parakeet listen together and the AI gets both versions; whisper
  //            alone if Parakeet isn't installed) | whisper | parakeet (all local)
  //            | browser (Chrome's Web Speech API) | off
  stt: 'both',
  parakeet: { bin: '', model: 'vendor/parakeet/tdt-0.6b-v2', threads: Math.max(2, Math.min(8, os.cpus().length - 2)) },
  // On the CPU by default: on the GPU, whisper stalls the game's drawing for up to half a second
  // right after the kid speaks. small.en on the CPU takes ~1.5 s with no stutter. For better
  // hearing of little kids, { model: 'large-v3-turbo-q5_0', gpu: true } makes about a quarter
  // fewer mistakes (2.8 s per request on an M1 Pro GPU), at the cost of that stutter.
  whisper: { bin: '', model: 'small.en', gpu: false, threads: Math.max(2, Math.min(8, os.cpus().length - 2)) },

  // Speech out: kokoro (local, natural) | piper (local, faster, more robotic)
  //             | browser (OS voices via speechSynthesis) | off
  tts: 'kokoro',
  kokoro: { bin: '', model: 'vendor/kokoro/model', voice: 'af_heart', speed: 1.0, threads: Math.max(2, Math.min(6, os.cpus().length - 2)) },
  piper: { bin: '', voice: 'vendor/piper/voice.onnx', lengthScale: 1.1 },

  // The overwatch: a careful model that checks on a creation once the kid has played with it for
  // firstAfterSec, then every everySec while they keep playing the same version. It fixes it if
  // it's broken or stuck, and otherwise may make a tiny polish (once per version). Uses the first
  // of claude/codex in backends.
  watch: { enabled: true, model: 'opus', effort: 'medium', codexModel: '', firstAfterSec: 25, everySec: 180, timeoutSec: 300 },

  // The ⭐ button that opens My creations (every creation they've made, to pick one and carry on).
  // Hidden unless a grown-up turns it on.
  creationsButton: false,

  // Linux: switch the default microphone on at startup if it's muted in the system settings.
  unmuteMic: true,

  // Kid-proof mode: reopen the window if it gets closed (quit with Ctrl+Shift+P instead).
  keepOpen: false,

  timeoutSec: 240,
  historyTurns: 8,
  browser: '', // path to Chrome / Chromium / Edge; auto-detected when empty
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

function readUserConfig() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`config.json is not valid JSON, using defaults: ${err.message}`);
    return {};
  }
}

let current = merge(DEFAULTS, readUserConfig());
if (process.env.KIDBUILD_BACKENDS) current.backends = process.env.KIDBUILD_BACKENDS.split(',').map(s => s.trim());
if (process.env.KIDBUILD_PORT) current.port = Number(process.env.KIDBUILD_PORT);

export function config() {
  return current;
}

// config.json holds only the user's own overrides; merge the patch into it.
export function saveConfig(patch) {
  const user = merge(readUserConfig(), patch);
  fs.writeFileSync(FILE, JSON.stringify(user, null, 2) + '\n');
  current = merge(DEFAULTS, user);
  return current;
}

export function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}
