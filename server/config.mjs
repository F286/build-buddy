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
  claude: { bin: '', model: 'sonnet', effort: 'low' },
  codex: { bin: '', model: '', reasoning: 'low' },
  command: { cmd: '', args: [] },

  // Speech in:  whisper (local whisper.cpp, private, offline) | browser (Chrome's Web Speech API) | off
  stt: 'whisper',
  whisper: { bin: '', model: 'small.en', threads: Math.max(2, Math.min(8, os.cpus().length - 2)) },

  // Speech out: kokoro (local, natural) | piper (local, faster, more robotic)
  //             | browser (OS voices via speechSynthesis) | off
  tts: 'kokoro',
  kokoro: { bin: '', model: 'vendor/kokoro/model', voice: 'af_heart', speed: 1.0, threads: Math.max(2, Math.min(6, os.cpus().length - 2)) },
  piper: { bin: '', voice: 'vendor/piper/voice.onnx', lengthScale: 1.1 },

  // Linux: switch the default microphone on at startup if it's muted in the system settings.
  unmuteMic: true,

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
