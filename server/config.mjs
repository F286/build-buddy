// Settings live in config.json next to package.json. Anything missing falls back to DEFAULTS,
// so config.json only needs the values you want to change.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// (KIDBUILD_DATA: another folder for everything Build Buddy keeps - for trying things side by side.)
export const DATA = process.env.KIDBUILD_DATA ? path.resolve(process.env.KIDBUILD_DATA) : path.join(ROOT, 'data');
const FILE = path.join(ROOT, 'config.json');

export const DEFAULTS = {
  port: 4321,
  kidName: '',
  kidAge: 5,
  buddyName: 'Sparky',

  // AI "brains", tried in order. If the first fails (offline, usage limit hit, ...) the next is used,
  // and one that isn't installed is passed over (the first installed one leads: see bins.mjs).
  //   claude  - Claude Code CLI, signed in with a Claude subscription (or ANTHROPIC_API_KEY). First by
  //             default: it builds the agent way (team.agents below).
  //   agy     - Google's Antigravity CLI, signed in with a Google account (Gemini 4 Argon). When it
  //             leads, one Argon writes the whole page (the classic way).
  //   codex   - OpenAI Codex CLI, signed in with a ChatGPT subscription (or an OpenAI API key)
  //   command - any program that reads a prompt on stdin and prints the reply (ollama, llm, gemini, ...)
  backends: ['claude', 'agy', 'codex'],
  // Opus at low effort: in tests it answered out loud faster than Sonnet (2.8 s vs 7 s) and built
  // richer pages in about the same time (25 s vs 21 s). Higher effort roughly doubles the wait.
  // fast: Claude's fast mode for the main agent - the one AI of the classic way and of solo mode,
  // the lead of a team (and team mode's fixer, checker, polisher and tester): the same model,
  // answering much sooner. fastHelpers: fast mode for the helpers that write a team's parts (the
  // builders), on a switch of its own. Fast mode runs on Opus and Fable only - on Sonnet and Haiku,
  // Claude Code leaves it off - so fast helpers write with Opus instead (helperSpeed, below).
  // Each is true or false for everything, or set apart for when the kid waits for something new,
  // waits for a change, and plays while it's polished: { new: true, change: true, play: false }
  // (fastIn, below). On a Claude subscription fast mode is paid from extra usage credits; with none
  // left it runs at normal speed. What each of them cost is kept in data/usage.jsonl (usage.mjs).
  //
  // By default only the main agent is fast, and only for something new. That's the longest wait
  // (about 70 s the agent way, most of it the lead's own writing: fast mode takes about a third
  // off), and the cheapest moment to be fast: the lead has just started, so there's next to nothing
  // to read again, and it writes a few thousand tokens. The rest isn't worth it by default:
  //   - a change: the lead is one long conversation, and fast and normal speed each keep a cache of
  //     their own - so a fast change reads at fast prices everything the polishing since added
  //     (tens of thousands of tokens), to take 3 s off a small change (17 s off a big one);
  //   - the helpers: they're Sonnet, which fast mode doesn't run on, so they'd move to Opus and
  //     write two thirds of a creation's tokens at the highest price, for about 5 s;
  //   - the polishing: the biggest share of the tokens, and nobody waits for it.
  // (Estimates from the timings in the README and Claude Code's prices - Opus in fast mode is 1.6
  // times its usual price, all of it from extra usage credits on a subscription. *What it cost* in
  // the grown-ups' panel shows what each of these really came to.)
  claude: { bin: '', model: 'opus', effort: 'low', fast: { new: true, change: false, play: false }, fastHelpers: false },
  // Team mode (Claude only, see server/team.mjs): instead of one AI writing the whole page, a
  // lead plans it and up to `helpers` helpers write its pieces at the same time. In blind tests
  // its creations beat the classic way's (11 of 12) and arrived much sooner (about 27 s instead of
  // 45 s on average); it uses more of your plan.
  // enabled: false builds the classic way (one AI writes it all).
  // Each role is its own Claude Code run: model, effort, fast (fast mode), advisor (a stronger
  // model it can ask, e.g. "opus" for a sonnet helper) and args (any other `claude` options).
  // Left empty, a role uses the Claude settings above (for speed: claude.fast, or for the helper,
  // claude.fastHelpers). By default the voice, which only answers out loud, is a quick small
  // model; helpers (small pieces, from a detailed plan) and the first look use Sonnet, which
  // writes about 40% faster; the checker, which works after the creation is already on screen,
  // takes more care (medium effort).
  // warm: start the team's programs while the kid is still talking.
  // check: right after a creation appears, the checker takes a careful look (is everything they
  // asked for there, do the pieces fit, do the controls work, can it be played, is it smooth) and
  // its fixes slide in at a calm moment. polish: then the polisher gives it its finishing touches
  // (the two or three things a demanding parent would want most), the same way - this many times
  // (true is once, false never). Each polish pass starts with the tester, which looks at it the
  // same way and lists what it would mark down, for the polisher to fix (tester: false skips it).
  // leads: how many leads start on each request at once; the first to start a plan is used and
  // the others stop (how long a lead thinks first varies a lot, so this saves the slow starts).
  // firstLook: for something new, a quick sketch of it (by the sketch role, a fast model) is on
  // screen within seconds and can be played with until the team's version replaces it. Off by
  // default: the sketch took the place of what was on screen, and kids took it for a reset.
  team: {
    enabled: true,
    helpers: 6,
    leads: 3,
    warm: true,
    check: true,
    polish: 2,
    firstLook: false,
    voice: { model: 'haiku', effort: 'low' },
    sketch: { model: 'sonnet', effort: 'low' },
    lead: { model: '', effort: '', advisor: '' },
    helper: { model: 'sonnet', effort: 'low', advisor: '' },
    fixer: { model: '', effort: '' },
    checker: { model: '', effort: 'medium' },
    polisher: { model: '', effort: 'high' },
    tester: { model: '', effort: 'medium' },
    // agents: true (the default) builds team mode the agent way: one lead Claude that keeps the
    // creation in mind and hands its parts to helpers, then makes them fit. false: team mode's usual
    // way. agentLead is the lead (model, effort and args as for a role; thinking: how long it may
    // think while the kid waits, when it's handed the parts, and when it looks its creation over);
    // agentHelper.model is the helpers' model, as an alias (sonnet, opus, haiku or fable: the Agent
    // tool takes no full model names).
    agents: true,
    // agentHelpers: who writes the agent way's parts. "subagents" (the default): Claude Code
    // subagents the lead calls one after another (server/agents.mjs). "direct": programs of Build
    // Buddy's own, each started on its job the moment the lead has written it (server/crew.mjs) -
    // in test runs something new appeared in about two thirds of the time. Also `./start.sh --direct`.
    agentHelpers: 'subagents',
    // peek: with direct helpers, before something new or a big change is shown, the app runs it out
    // of sight and the lead is handed a screenshot of it with its helpers' parts (about 2 s): what's
    // black, hidden, cut off or missing shows in a picture, not in the code.
    peek: true,
    agentLead: { model: '', firstModel: '', effort: '', thinking: { build: 1500, fit: 700, look: 10000 } },
    agentHelper: { model: 'sonnet' },
    // agentPolisher: who grows and polishes the creation while the kid plays, the agent way with
    // subagents. By default the lead does, as more turns of its own conversation. enabled: true
    // makes it a second agent - the polisher: a program of its own that remembers the creation
    // too, working on the same files, with a model, an effort and a speed of its own (model and
    // effort: '' is the lead's; fast: left out, the main agent's switch for the polishing,
    // claude.fast's play; thinking: how long it may think, in tokens - left out, the lead's look).
    // Nobody waits for it, so it can be a slower, more careful model ("fable"), and the lead's
    // conversation holds only what the kid waited for. Each is told what the other did: the
    // polisher everything the lead was and did (what the kid said, what Sparky answered, the jobs
    // it handed out, its own words, the files it changed), the lead which files the polisher
    // changed and why (server/agents.mjs).
    agentPolisher: { enabled: false, model: '', effort: '' },
  },
  // Solo mode (Claude only, see server/solo.mjs): one Claude builds the whole creation and keeps it
  // in mind - no team. Its first reply is the heart of it, on screen quickly; then, while the kid
  // plays, it looks at screenshots of it running, grows it into its full version and polishes it
  // (polish: how many of those passes), and it makes the kid's changes from memory. model, effort
  // and args as for a team role; left empty, it uses the Claude settings above.
  // enabled: true builds this way (it comes before team mode).
  // thinking: how long it may think (tokens) while the kid waits (build) and when it looks its
  // creation over (look).
  // firstModel: the quicker model that writes something new while the kid waits (the same
  // session then switches to the main model for everything else).
  solo: { enabled: false, polish: 3, model: '', firstModel: 'sonnet', effort: '', thinking: { build: 2000, look: 12000 } },
  codex: { bin: '', model: '', reasoning: 'low' },
  // Antigravity (agy): model is any id `agy models` lists. When agy leads, one Argon writes the whole
  // page (the classic way: the team and solo settings above are Claude's). voiceModel: a quick model
  // that says the first line out loud while agy builds (Gemini Flash answers in about 2 s; the builder
  // takes 5 to 10 s to start writing); "" lets the builder's own first line be said. keepHistory: true
  // runs agy in your own agy home, so Build Buddy's runs are listed with your conversations (by
  // default they use one of their own, data/agy-home, sharing only the sign-in).
  agy: { bin: '', model: 'gemini-4-argon-low', helperModel: 'gemini-4-argon-low', voiceModel: 'gemini-3.8-flash-low', way: 'agents', keepHistory: false },
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
  // of claude/codex in backends, which can look at a screenshot, or else agy (with agyModel; it
  // judges from the page and how it's running: Argon high took 1 to 5 minutes, so low).
  watch: { enabled: true, model: 'opus', effort: 'medium', codexModel: '', agyModel: 'gemini-4-argon-low', firstAfterSec: 25, everySec: 180, timeoutSec: 300 },

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

// The way of building for this run only, without changing config.json: `./start.sh --solo`,
// `--agents`, `--direct` (the agent way with direct helpers), `--team` or `--classic` (or
// KIDBUILD_SOLO=1, KIDBUILD_AGENTS=1, KIDBUILD_DIRECT=1, KIDBUILD_TEAM=1 or 0).
// Picking a way of building in the panel replaces it.
let runMode =
  process.argv.includes('--solo') || process.env.KIDBUILD_SOLO === '1'
    ? 'solo'
    : process.argv.includes('--direct') || process.env.KIDBUILD_DIRECT === '1'
      ? 'direct'
      : process.argv.includes('--agents') || process.env.KIDBUILD_AGENTS === '1'
        ? 'agents'
        : process.argv.includes('--team') || process.env.KIDBUILD_TEAM === '1'
          ? 'team'
          : process.argv.includes('--classic') || process.env.KIDBUILD_TEAM === '0'
            ? 'classic'
            : null;
// (Team, the agent way and solo are Claude's ways of building, so asking for one puts Claude first.
// That lasts the whole run - picking how Claude builds in the panel doesn't end it - unless a grown-up
// picks brains there: theirs win, and the run's own order is never saved.)
const claudeFirst = list => ['claude', ...list.filter(b => b !== 'claude')];
const run = { claudeFirst: runMode !== null && runMode !== 'classic' };
const withRunTeam = c => ({
  ...c,
  ...(run.claudeFirst && { backends: claudeFirst(c.backends) }),
  ...(runMode !== null && {
    // (--agents is the agent way with its subagents, --direct with direct helpers, whatever is saved.)
    team: {
      ...c.team,
      enabled: ['team', 'agents', 'direct'].includes(runMode),
      agents: runMode === 'agents' || runMode === 'direct',
      ...((runMode === 'agents' || runMode === 'direct') && { agentHelpers: runMode === 'direct' ? 'direct' : 'subagents' }),
    },
    solo: { ...c.solo, enabled: runMode === 'solo' },
  }),
});

// The brains: config().backends is the order as set with the brain that leads first - brains listed
// before the first installed one go to the end (they're passed over anyway) - so Claude leading counts
// as Claude first everywhere (the agent way, agents.mjs, asks for Claude first in `backends`). It's
// worked out each time it's read, so a brain installed while Build Buddy runs leads from then on.
// brainsAsSet() is the order as set: the panel shows it, and it's what a grown-up saves.
let isInstalled = () => true; // (bins.mjs says how to tell)
export const tellInstalled = f => {
  isInstalled = f;
};
let asSet = [];
export const brainsAsSet = () => asSet;
function leadFirst(c) {
  asSet = c.backends;
  Object.defineProperty(c, 'backends', {
    enumerable: true,
    configurable: true,
    get: () => {
      const at = asSet.findIndex(b => isInstalled(b));
      return at > 0 ? [...asSet.slice(at), ...asSet.slice(0, at)] : asSet;
    },
    set: v => {
      asSet = v;
    },
  });
  return c;
}

let current = leadFirst(withRunTeam(merge(DEFAULTS, readUserConfig())));
if (process.env.KIDBUILD_BACKENDS) current.backends = process.env.KIDBUILD_BACKENDS.split(',').map(s => s.trim());
if (process.env.KIDBUILD_PORT) current.port = Number(process.env.KIDBUILD_PORT);

export function config() {
  return current;
}

// A fast-mode setting (claude.fast, claude.fastHelpers, a role's own `fast`) is true or false for
// everything, or says it apart for each phase - what the kid is doing while Claude works:
//   new     waiting for something new (the screen was blank)
//   change  waiting for a change to what's there (or for a crash to be fixed)
//   play    playing, while the creation is grown, checked and polished: nobody waits for that
// like { "new": true, "change": true, "play": false }.
export const PHASES = ['new', 'change', 'play'];
export const fastIn = (setting, phase) => Boolean(isObj(setting) ? setting[phase] : setting);
export const fastEver = setting => PHASES.some(p => fastIn(setting, p));
export const fastPhases = setting => Object.fromEntries(PHASES.map(p => [p, fastIn(setting, p)]));

// How a helper (one of the builders: team.helper, team.agentHelper) runs for speed in a phase: in
// fast mode or not, and with which model. Its own `fast`, when it has one, is passed on as it's
// written. Otherwise claude.fastHelpers decides - and since Claude Code leaves fast mode off on
// Sonnet and Haiku, a fast helper set to one of those writes with Opus instead (which in fast mode
// writes sooner than Sonnet does at its usual speed).
export const runsFastMode = model => !/sonnet|haiku/i.test(String(model || ''));
export function helperSpeed(own, model = '', phase = 'change') {
  if (own?.fast != null) return { fast: fastIn(own.fast, phase), model };
  if (!fastIn(current.claude.fastHelpers, phase)) return { fast: false, model };
  return { fast: true, model: runsFastMode(model) ? model : 'opus' };
}

// config.json holds only the user's own overrides; merge the patch into it.
export function saveConfig(patch) {
  // (The brains in the order this run shows them, Claude first, are the run's: not kept.)
  if (run.claudeFirst && String(patch.backends) === String(asSet)) {
    const { backends, ...rest } = patch;
    patch = rest;
  }
  if (patch.backends) run.claudeFirst = false;
  const user = merge(readUserConfig(), patch);
  fs.writeFileSync(FILE, JSON.stringify(user, null, 2) + '\n');
  if ((patch.team && 'enabled' in patch.team) || (patch.solo && 'enabled' in patch.solo)) runMode = null;
  current = leadFirst(withRunTeam(merge(DEFAULTS, user)));
  // (KIDBUILD_BACKENDS stays this run's brains until a grown-up picks others in the panel.)
  if (patch.backends) delete process.env.KIDBUILD_BACKENDS;
  else if (process.env.KIDBUILD_BACKENDS) current.backends = process.env.KIDBUILD_BACKENDS.split(',').map(s => s.trim());
  return current;
}

export function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}
