// Hands-free mode ("just talk"): the voice in the middle. The microphone is always on; whatever
// the kids say comes here as text, and a quick model answers out loud. When they ask for
// something to be made or changed, it passes their request on to the builder (ai.mjs) in their
// own words. It never adds ideas and never offers choices: describing what they want is the
// kids' job - that's what they're here to learn.
//
// One Claude process stays running (claude -p with streaming input), so a turn doesn't pay the
// start-up time again: the first words come back in about a second.
import { spawn } from 'node:child_process';
import { config } from './config.mjs';
import { findBin } from './bins.mjs';
import * as store from './store.mjs';
import * as ai from './ai.mjs';

const MAX_TURNS = 40; // then a fresh process, so the conversation doesn't grow forever
const TURN_TIMEOUT_MS = 20000;
let agent = null; // { proc, buf, onEvent, turns }
let chain = Promise.resolve(); // one turn at a time, in the order they were said

function systemPrompt() {
  const c = config();
  const kids = `${c.kidName ? `${c.kidName} and friends` : 'young kids'} (about ${c.kidAge} years old, sometimes younger)`;
  return `You are ${c.buddyName}, a cheerful robot building buddy for ${kids}. This is hands-free mode: the microphone is always on, and whatever is said near the computer comes to you as text. Often two kids take turns talking to you.

You are the voice in the middle. A separate builder robot makes things on the big screen - pictures, toys, games, 3D worlds. You chat with the kids, and when they ask for something to be made or changed, you pass their request to the builder.

# The kids are learning to tell an AI what they want
The ideas, and saying them, are their job:
- Never suggest ideas, additions or next steps, and never offer choices - not even as a question ("A cat or a dog?", "Should it be red?"). That would turn their turn into just yes or no.
- Never add details they didn't say. The builder request is their idea in their words, only cleaned up: fix mishearings, put together what they said over the last turns, and say what "it" or "that" means.
- If they ask for something clearly enough - even simply, like "I want a car" or "make it go faster" - build it straight away. Little kids can't say much, and a simple request is fine.
- Ask only when you really can't tell what they want ("make something", "do the thing", "change it", "a game") - then ask one short, open question that gets them to describe it in their own words: "What do you want to make?", "What should change?", "What happens in the game?". Never ask twice in a row about the same thing: the second time, build what they said.
- If they ask how to play or ask you something, answer in one short sentence. If they say thanks or something friendly, answer warmly in a few words.
- Things only a grown-up can do (play time, closing the app, settings): kindly say a grown-up has to do that.

# Not everything is for you
The microphone hears everything. When they're talking to each other, playing along with the game ("vroom!", "pew pew", "I got it!"), singing, or it's noise, half a word, or the game's own sounds - and it isn't a request or a question for you - reply only: QUIET
If you're not sure it's meant for you and it isn't a request, reply QUIET.

# Speech-to-text
Their words come through speech-to-text, so they're often misheard ("a rice car" is probably "a race car", "die no sore" is "dinosaur"). Sometimes there's a second listener's version: use both to work out what they meant.

# Reply format (exactly this)
SAY: <what you say out loud: one short sentence, at most about 12 words, warm and excited, tiny simple words>
BUILD: <the request for the builder - only when there is something to make or change>
or only:
QUIET

When you BUILD, SAY just shows what you understood and that it's coming ("A red car that goes super fast? On it!"). Don't explain how to play - the builder says that when it's ready. If the builder is busy, the request waits its turn ("Okay, right after this one!").
Never say code, HTML, file, browser, bug or error. Nothing scary or mean.`;
}

function start() {
  const c = config();
  const bin = findBin('claude', c.claude.bin);
  if (!bin) throw new Error('hands-free mode needs Claude Code (install it and run `claude` once to sign in)');
  const args = [
    '-p', '--safe-mode', '--tools', '', '--strict-mcp-config', '--no-session-persistence',
    '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--system-prompt', systemPrompt(), '--model', c.talk.model,
    ...(c.talk.effort ? ['--effort', c.talk.effort] : []),
  ];
  const proc = spawn(bin, args, { cwd: ai.WORK_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
  const a = { proc, buf: '', onEvent: null, turns: 0 };
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', d => {
    a.buf += d;
    const lines = a.buf.split('\n');
    a.buf = lines.pop();
    for (const line of lines) {
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      a.onEvent?.(ev);
    }
  });
  proc.stderr.on('data', () => {});
  proc.stdin.on('error', () => {});
  proc.on('error', () => {});
  proc.on('exit', () => {
    if (agent === a) agent = null;
    a.onEvent?.({ type: 'exit' });
  });
  agent = a;
  return a;
}

export function stop() {
  agent?.proc.kill();
  agent = null;
}

// Start it ahead of time, so the very first thing a kid says gets a quick answer too.
export function warm() {
  if (!config().handsFree || agent) return;
  try {
    start();
  } catch (err) {
    ai.log(`TALK cannot start: ${err.message}`);
  }
}

// What's going on right now, sent along with every turn.
function situation(fresh) {
  const p = store.currentProject();
  const lastBuddy = p.history.findLast(h => h.role === 'buddy')?.text;
  const lines = [
    `On screen: ${p.title ? `${p.emoji} ${p.title}`.trim() : 'nothing yet (a blank page)'}`,
    ai.isBusy() ? 'The builder is busy making something right now.' : 'The builder is ready.',
  ];
  if (lastBuddy) lines.push(`The builder last said: "${lastBuddy}"`);
  // A fresh process doesn't remember the conversation: give it the latest requests.
  if (fresh) {
    const asked = p.history.filter(h => h.role === 'kid').slice(-4).map(h => `- ${h.text}`);
    if (asked.length) lines.push(`What they asked the builder for lately:\n${asked.join('\n')}`);
  }
  return lines.join('\n');
}

function once({ text, alt }, emit) {
  return new Promise((resolve, reject) => {
    if (agent && agent.turns >= MAX_TURNS) stop();
    const a = agent || start();
    const t0 = Date.now();
    let reply = '';
    let said = false;
    const fail = err => {
      clearTimeout(timer);
      a.onEvent = null;
      err.said = said;
      reject(err);
    };
    const timer = setTimeout(() => {
      stop();
      fail(new Error(`no answer in ${TURN_TIMEOUT_MS / 1000} s`));
    }, TURN_TIMEOUT_MS);
    a.onEvent = ev => {
      if (ev.type === 'exit') return fail(new Error('the talk process stopped'));
      const delta = ev.type === 'stream_event' && ev.event?.delta?.type === 'text_delta' ? ev.event.delta.text : null;
      if (delta) {
        reply += delta;
        // Speak as soon as the SAY line is complete, before the rest of the reply arrives.
        const m = !said && reply.match(/^[ \t*_]*SAY:[*_]*\s*(.+)\n/m);
        if (m) {
          said = true;
          emit({ type: 'say', text: m[1].replace(/[*_]+$/, '').trim() });
        }
      }
      if (ev.type !== 'result') return;
      clearTimeout(timer);
      a.onEvent = null;
      a.turns++;
      if (ev.is_error || !reply.trim()) return fail(new Error(String(ev.result || 'empty answer').slice(0, 200)));
      let say = ai.field(reply, 'SAY');
      const build = ai.field(reply, 'BUILD');
      // Answered in plain words instead of the format: still worth saying (unless it's QUIET).
      if (!say && !build && !/^\W*QUIET\b/i.test(reply.trim())) say = reply.trim().split('\n')[0].slice(0, 160);
      if (say && !said) emit({ type: 'say', text: say });
      if (build) emit({ type: 'build', text: build });
      const took = ((Date.now() - t0) / 1000).toFixed(1);
      ai.log(`TALK ${took}s "${text}"${alt ? ` / "${alt}"` : ''} → ${say ? JSON.stringify(say) : 'quiet'}${build ? ` BUILD ${JSON.stringify(build)}` : ''}`);
      resolve({ say, build, quiet: !say && !build });
    };
    const heard = `Heard: "${text}"${alt ? `\n(The second listener heard: "${alt}")` : ''}`;
    const content = `<now>\n${situation(a.turns === 0)}\n</now>\n\n${heard}`;
    a.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
  });
}

// One turn of the conversation: emits { type: 'say', text } as soon as there's something to
// say, then { type: 'build', text } when there's a request for the builder.
export function turn({ text, alt = '' }, emit) {
  const result = chain.then(() =>
    once({ text, alt }, emit).catch(err => {
      ai.log(`TALK fail ${err.message}`);
      stop();
      if (err.said) throw err;
      return once({ text, alt }, emit); // once more with a fresh process
    }),
  );
  chain = result.catch(() => {});
  return result;
}
