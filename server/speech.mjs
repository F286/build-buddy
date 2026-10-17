// Speech in (Parakeet via sherpa-onnx, or whisper.cpp) and speech out (Kokoro via sherpa-onnx, or
// the faster but more robotic Piper). All local: the kid's voice never leaves the computer, and
// nothing costs per use.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, DATA, ROOT, resolvePath } from './config.mjs';
import { findBin, run } from './bins.mjs';

const TMP = path.join(DATA, 'tmp');
const TTS_CACHE = path.join(DATA, 'tts-cache');
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(TTS_CACHE, { recursive: true });

// The GPU (Vulkan) build is used when setup.sh could make one; it only uses the GPU when
// config.whisper.gpu is on (see config.mjs for why that's off by default).
const WHISPER_DIRS = ['build-vk/bin', 'build/bin', 'build/bin/Release'].map(d => path.join(ROOT, 'vendor/whisper.cpp', d));
const PIPER_DIRS = [path.join(ROOT, 'vendor/piper/piper')];
const KOKORO_DIRS = [path.join(ROOT, 'vendor/kokoro/sherpa-onnx/bin')];

// Kokoro v1.0 speakers, in model order (the index is the speaker id).
export const KOKORO_VOICES = 'af_alloy,af_aoede,af_bella,af_heart,af_jessica,af_kore,af_nicole,af_nova,af_river,af_sarah,af_sky,am_adam,am_echo,am_eric,am_fenrir,am_liam,am_michael,am_onyx,am_puck,am_santa,bf_alice,bf_emma,bf_isabella,bf_lily,bm_daniel,bm_fable,bm_george,bm_lewis'.split(',');

function kokoro() {
  const c = config().kokoro;
  const model = resolvePath(c.model);
  const bin = findBin('sherpa-onnx-offline-tts', c.bin, KOKORO_DIRS);
  const ok = Boolean(bin && fs.existsSync(path.join(model, 'model.onnx')));
  return { ok, bin, model, sid: Math.max(0, KOKORO_VOICES.indexOf(c.voice)), speed: c.speed, threads: c.threads };
}

function whisperModel() {
  const m = config().whisper.model;
  const file = /[/\\]|\.bin$/.test(m) ? resolvePath(m) : path.join(ROOT, `vendor/models/ggml-${m}.bin`);
  const fallback = path.join(ROOT, 'vendor/models/ggml-small.en.bin');
  return fs.existsSync(file) || !fs.existsSync(fallback) ? file : fallback;
}

// Parakeet TDT 0.6B (NVIDIA), run by sherpa-onnx's recognizer on the CPU (~1 s). On clean
// recordings of toddler-style speech it beat whisper small.en clearly; through the microphone the
// two were about even, but they get *different* words wrong. So by default both listen, and the AI
// gets both versions: picking the better one each time would cut mistakes by about a fifth.
function parakeet() {
  const c = config().parakeet;
  const model = resolvePath(c.model);
  const bin = findBin('sherpa-onnx-offline', c.bin, KOKORO_DIRS);
  return { ok: Boolean(bin && fs.existsSync(path.join(model, 'encoder.int8.onnx'))), bin, model, threads: c.threads };
}

const whisperOk = () => Boolean(findBin('whisper-cli', config().whisper.bin, WHISPER_DIRS) && fs.existsSync(whisperModel()));

export function status() {
  const c = config();
  return {
    // Parakeet falls back to whisper when it isn't installed.
    stt: ['parakeet', 'both'].includes(c.stt) ? parakeet().ok || whisperOk() : c.stt === 'whisper' ? whisperOk() : c.stt,
    tts:
      c.tts === 'kokoro' ? kokoro().ok
      : c.tts === 'piper' ? Boolean(findBin('piper', c.piper.bin, PIPER_DIRS) && fs.existsSync(resolvePath(c.piper.voice)))
      : c.tts,
  };
}

// Whisper invents these from silence or background noise.
const PHANTOMS = new Set(['', 'you', 'thank you', 'thanks', 'thanks for watching', 'thank you for watching', 'bye', 'okay', 'so', 'uh', 'um', 'hmm']);

const words = s => s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

// `context` is what the kid is building and has said lately. Young kids' words are easily
// misheard ("tomato" for "tornado"); telling whisper what the conversation is about fixes many
// of those. It must not contain made-up example sentences: whisper repeats its prompt when it
// hears next to nothing.
// Resolves with { text, alt }: alt is what the second listener heard, when it heard it differently.
export async function transcribe(wav, opts = {}) {
  const mode = config().stt;
  const p = mode === 'parakeet' || mode === 'both' ? parakeet() : null;
  if (!p?.ok) return { text: await transcribeWhisper(wav, opts) };
  if (mode === 'parakeet' || !whisperOk()) return { text: await transcribeParakeet(wav, p) };
  // Both at once, sharing the CPU cores between them (~2.2 s together on an M1 Pro).
  const cores = config().whisper.threads;
  const whisperThreads = Math.max(2, Math.round(cores * 0.6));
  const [w, k] = await Promise.allSettled([
    transcribeWhisper(wav, { ...opts, threads: whisperThreads }),
    transcribeParakeet(wav, { ...p, threads: Math.max(2, cores - whisperThreads + 1) }),
  ]);
  const heard = [w, k].map(r => (r.status === 'fulfilled' ? r.value : ''));
  if (!heard[0] && !heard[1] && w.status === 'rejected') throw w.reason;
  const [text, alt] = heard[0] ? heard : [heard[1], ''];
  return { text, alt: alt && words(alt) !== words(text) ? alt : '' };
}

// Little kids' mumbles are sometimes "heard" as rude words. They'd show up on screen (and in the
// log), so mask them before anything else sees the text.
const RUDE = /\b(n[i1]gg\w*|f+u+c+k\w*|sh[i1]t\w*|b[i1]tch\w*|cunts?|whores?|sluts?|fag(got)?s?|retard\w*|assholes?)\b/gi;

const tidy = text => {
  const t = text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ') // [BLANK_AUDIO], (music), *laughs*
    .replace(RUDE, '…')
    .replace(/\s+/g, ' ')
    .trim();
  return PHANTOMS.has(words(t)) ? '' : t;
};

async function transcribeParakeet(wav, p) {
  const file = path.join(TMP, `rec-${Date.now()}.wav`);
  fs.writeFileSync(file, wav);
  const m = f => path.join(p.model, f);
  try {
    const out = await run(p.bin, [
      `--encoder=${m('encoder.int8.onnx')}`, `--decoder=${m('decoder.int8.onnx')}`, `--joiner=${m('joiner.int8.onnx')}`,
      `--tokens=${m('tokens.txt')}`, '--model-type=nemo_transducer', '--decoding-method=modified_beam_search',
      '--max-active-paths=4', `--num-threads=${p.threads}`, file,
    ], { timeoutSec: 60 });
    // One JSON line per file: {"text": "...", "tokens": [...], ...}
    const line = out.split('\n').find(l => l.startsWith('{'));
    return tidy(line ? JSON.parse(line).text || '' : '');
  } finally {
    fs.rmSync(file, { force: true });
  }
}

async function transcribeWhisper(wav, { context = '', talkMs = Infinity, threads } = {}) {
  const c = config();
  const bin = findBin('whisper-cli', c.whisper.bin, WHISPER_DIRS);
  if (!bin) throw new Error('whisper-cli not found - run ./setup.sh');
  const file = path.join(TMP, `rec-${Date.now()}.wav`);
  fs.writeFileSync(file, wav);
  try {
    const args = ['-m', whisperModel(), '-f', file, '-l', 'en', '-nt', '-np', '-sns', '-t', String(threads || c.whisper.threads)];
    if (!c.whisper.gpu) args.push('-ng'); // the game needs the GPU more than whisper does
    if (context) args.push('--prompt', context.slice(-400));
    const text = tidy(await run(bin, args, { timeoutSec: 60 }));
    if (!text) return '';
    // A short mumble that comes back as one of the context sentences word for word is whisper
    // echoing its prompt, not the kid.
    const echoed = context.split(/(?<=[.!?])\s+/).some(sentence => words(sentence) === words(text));
    return echoed && talkMs < 1500 ? '' : text;
  } finally {
    fs.rmSync(file, { force: true });
  }
}

export function speakable(text) {
  return String(text || '')
    .replace(/\p{Extended_Pictographic}|[\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]|\p{Regional_Indicator}/gu, '')
    .replace(/[*_#`~<>|\\]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[-\s]+/, '') // never let it look like a command-line flag
    .trim()
    .slice(0, 600);
}

// The page asks for a sentence as soon as it knows it (to get it ready) and again when it's time
// to play it; both requests share one generation.
const making = new Map();

export function speak(text) {
  const key = `${config().tts}|${config().kokoro.voice}|${speakable(text)}`;
  if (!making.has(key)) making.set(key, synthesize(text).finally(() => making.delete(key)));
  return making.get(key);
}

async function synthesize(text) {
  const c = config();
  const clean = speakable(text);
  if (!clean) return null;
  let k = c.tts === 'kokoro' ? kokoro() : null;
  if (k && !k.ok) k = null; // not installed: fall back to Piper rather than go quiet
  const engine = k ? `kokoro|${k.sid}|${k.speed}` : `piper|${resolvePath(c.piper.voice)}|${c.piper.lengthScale}`;
  const key = crypto.createHash('sha1').update(`${engine}|${clean}`).digest('hex');
  const file = path.join(TTS_CACHE, `${key}.wav`);
  if (fs.existsSync(file)) return fs.readFileSync(file);

  const tmp = path.join(TMP, `${key}-${process.pid}-${Date.now()}.wav`);
  if (k) {
    const m = f => path.join(k.model, f);
    await run(k.bin, [
      `--kokoro-model=${m('model.onnx')}`, `--kokoro-voices=${m('voices.bin')}`, `--kokoro-tokens=${m('tokens.txt')}`,
      `--kokoro-data-dir=${m('espeak-ng-data')}`, `--kokoro-lexicon=${m('lexicon-us-en.txt')}`,
      `--kokoro-length-scale=${1 / k.speed}`, `--num-threads=${k.threads}`, `--sid=${k.sid}`,
      `--output-filename=${tmp}`, clean,
    ], { timeoutSec: 60 });
  } else {
    const bin = findBin('piper', c.piper.bin, PIPER_DIRS);
    if (!bin) throw new Error('piper not found - run ./setup.sh');
    await run(bin, ['-m', resolvePath(c.piper.voice), '-f', tmp, '--length_scale', String(c.piper.lengthScale), '--sentence_silence', '0.25'], {
      input: clean,
      timeoutSec: 30,
    });
  }
  fs.renameSync(tmp, file);
  pruneCache();
  return fs.readFileSync(file);
}

let pruning = false;
function pruneCache() {
  if (pruning) return;
  pruning = true;
  fs.readdir(TTS_CACHE, (err, names) => {
    pruning = false;
    if (err || names.length < 600) return;
    const files = names.map(n => path.join(TTS_CACHE, n)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
    files.slice(0, files.length - 400).forEach(f => fs.rm(f, { force: true }, () => {}));
  });
}
