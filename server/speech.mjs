// Speech in (whisper.cpp) and speech out (Kokoro via sherpa-onnx, or the faster but more robotic
// Piper). All local: the kid's voice never leaves the computer, and nothing costs per use.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, DATA, ROOT, resolvePath } from './config.mjs';
import { findBin, run } from './bins.mjs';

const TMP = path.join(DATA, 'tmp');
const TTS_CACHE = path.join(DATA, 'tts-cache');
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(TTS_CACHE, { recursive: true });

const WHISPER_DIRS = [path.join(ROOT, 'vendor/whisper.cpp/build/bin'), path.join(ROOT, 'vendor/whisper.cpp/build/bin/Release')];
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
  return /[/\\]|\.bin$/.test(m) ? resolvePath(m) : path.join(ROOT, `vendor/models/ggml-${m}.bin`);
}

export function status() {
  const c = config();
  return {
    stt: c.stt === 'whisper' ? Boolean(findBin('whisper-cli', c.whisper.bin, WHISPER_DIRS) && fs.existsSync(whisperModel())) : c.stt,
    tts:
      c.tts === 'kokoro' ? kokoro().ok
      : c.tts === 'piper' ? Boolean(findBin('piper', c.piper.bin, PIPER_DIRS) && fs.existsSync(resolvePath(c.piper.voice)))
      : c.tts,
  };
}

// Whisper invents these from silence or background noise.
const PHANTOMS = new Set(['', 'you', 'thank you', 'thanks', 'thanks for watching', 'thank you for watching', 'bye', 'okay', 'so', 'uh', 'um', 'hmm']);

export async function transcribe(wav) {
  const c = config();
  const bin = findBin('whisper-cli', c.whisper.bin, WHISPER_DIRS);
  if (!bin) throw new Error('whisper-cli not found - run ./setup.sh');
  const file = path.join(TMP, `rec-${Date.now()}.wav`);
  fs.writeFileSync(file, wav);
  try {
    const out = await run(bin, [
      '-m', whisperModel(), '-f', file, '-l', 'en', '-nt', '-np', '-sns',
      '-t', String(c.whisper.threads),
      '--prompt', 'A kid tells a robot what to build. I want a red race car! Make it go faster.',
    ], { timeoutSec: 60 });
    const text = out
      .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ') // [BLANK_AUDIO], (music), *laughs*
      .replace(/\s+/g, ' ')
      .trim();
    return PHANTOMS.has(text.toLowerCase().replace(/[^a-z ]/g, '').trim()) ? '' : text;
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
