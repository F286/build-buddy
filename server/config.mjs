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
  // Team mode (Claude only, see server/team.mjs): instead of one AI writing the whole page, a
  // lead plans it and up to `helpers` helpers write its pieces at the same time. In blind tests
  // its creations beat the classic way's (all 12) and arrived sooner; it uses more of your plan.
  // enabled: false builds the classic way (one AI writes it all).
  // Each role is its own Claude Code run: model, effort, fast (fast mode), advisor (a stronger
  // model it can ask, e.g. "opus" for a sonnet helper) and args (any other `claude` options).
  // Left empty, the lead, helpers and fixer use the Claude settings above; the voice, which only
  // answers out loud, is a quick small model.
  // warm: start the team's programs while the kid is still talking.
  // check: right after a creation appears, the checker takes a careful look (is everything they
  // asked for there, do the pieces fit, do the controls work, can it be played, is it smooth) and
  // its fixes slide in at a calm moment.
  // leads: how many leads start on each request at once; the first to start a plan is used and
  // the others stop (how long a lead thinks first varies a lot, so this saves the slow starts).
  team: {
    enabled: true,
    helpers: 6,
    leads: 2,
    warm: true,
    check: true,
    voice: { model: 'haiku', effort: 'low' },
    lead: { model: '', effort: '', advisor: '' },
    helper: { model: '', effort: '', advisor: '' },
    fixer: { model: '', effort: '' },
    checker: { model: '', effort: '' },
  },
  codex: { bin: '', model: '', reasoning: 'low' },
  command: { cmd: '', args: [] },

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

// Team mode for this run only, without changing config.json: `./start.sh --team` (or
// `--classic`), or KIDBUILD_TEAM=1 (or 0). Picking a way of building in the panel replaces it.
let runTeam = process.argv.includes('--team') || process.env.KIDBUILD_TEAM === '1' ? true : process.argv.includes('--classic') || process.env.KIDBUILD_TEAM === '0' ? false : null;
const withRunTeam = c => (runTeam === null ? c : { ...c, team: { ...c.team, enabled: runTeam } });

let current = withRunTeam(merge(DEFAULTS, readUserConfig()));
if (process.env.KIDBUILD_BACKENDS) current.backends = process.env.KIDBUILD_BACKENDS.split(',').map(s => s.trim());
if (process.env.KIDBUILD_PORT) current.port = Number(process.env.KIDBUILD_PORT);

export function config() {
  return current;
}

// config.json holds only the user's own overrides; merge the patch into it.
export function saveConfig(patch) {
  const user = merge(readUserConfig(), patch);
  fs.writeFileSync(FILE, JSON.stringify(user, null, 2) + '\n');
  if (patch.team && 'enabled' in patch.team) runTeam = null;
  current = withRunTeam(merge(DEFAULTS, user));
  return current;
}

export function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}
