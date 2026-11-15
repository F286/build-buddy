// What Claude's work costs, and what it was for.
//
// Every Claude Code program reports, with each answer, the tokens it used and Claude Code's own
// estimate of their price at API rates. Build Buddy keeps them in data/usage.jsonl, one line each,
// with who it was (the main agent, the builders, the voice) and what the kid was doing meanwhile -
// waiting for something new, waiting for a change, or playing while it's polished (the phases of
// config.mjs, which fast mode is set by too). The grown-ups' panel shows them a day at a time: kids
// play about once a day, so a day is a play session.
//
// On a Claude subscription only fast mode is paid for (from extra usage credits); the rest counts
// against the plan's limits. With an API key, all of it is the bill.
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DATA, PHASES } from './config.mjs';

const file = () => path.join(DATA, 'usage.jsonl');

// ---------------------------------------------------------------------------------------------
// What the work under way is for: { phase, ask } - the phase, and the kid's request it belongs to.
// It's carried along everything started from within `during`, so the programs asked along the way
// know without being told.

const scope = new AsyncLocalStorage();
export const during = (what, fn) => scope.run({ ...scope.getStore(), ...what }, fn);
export const now = () => scope.getStore() || {};
// For what runs when a program's output arrives - which happens outside any of this: `fn` as part
// of the work `what` was read from (with now()).
export const within = (what, fn) => scope.run(what, fn);

// ---------------------------------------------------------------------------------------------
// Writing it down

// (Kept to what the panel shows: once a run, a file that has grown big loses what's older than
// three months.)
const KEEP_MS = 92 * 24 * 3600 * 1000;
let trimmed = false;
function trim() {
  if (trimmed) return;
  trimmed = true;
  if (fs.statSync(file(), { throwIfNoEntry: false })?.size > 4e6) fs.writeFileSync(file(), rows().filter(r => r.t > Date.now() - KEEP_MS).map(r => `${JSON.stringify(r)}\n`).join(''));
}

function write(row) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    trim();
    fs.appendFileSync(file(), `${JSON.stringify({ t: Date.now(), ...row })}\n`);
  } catch {} // (never in the way of building)
}

function rows() {
  let text = '';
  try {
    text = fs.readFileSync(file(), 'utf8');
  } catch {}
  return text.split('\n').flatMap(line => {
    try {
      return line ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
}

// The phase of what the kid is about to wait for: something new on a blank screen, or else a change.
export const waitingFor = page => (page ? 'change' : 'new');

// The last thing the kid asked for on a creation (after a restart: the last one written down) -
// what's done for that creation afterwards (a repair before it's shown, the polishing, the
// overwatch) belongs to it. Null when nothing was asked for on it since this was kept.
const lastAsks = new Map(); // creation's id → its last request
export function lastAsk(project) {
  if (!lastAsks.has(project)) lastAsks.set(project, rows().findLast(r => r.kind === 'ask' && r.project === project) || null);
  return lastAsks.get(project);
}

// The kid asked for something (or a crash is being fixed for them): what follows belongs to it.
export function asked({ phase, text, project }) {
  const ask = { kind: 'ask', id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, phase, project, text: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 140) };
  lastAsks.set(project, ask);
  write(ask);
  return ask;
}

// ... and it's on screen (or it failed), after this long.
export function shown(ask, { ms, ok, title = '', backend = '' }) {
  ask.shown = { ms, ok, title, backend };
  write({ kind: 'shown', ask: ask.id, ...ask.shown });
}

// ... or not quite yet: it crashed when the app tried it, and was repaired first - the kid waited
// that much longer. (The last line written for a request is the one that counts.)
export function waitedLonger(ask, ms) {
  if (!ask?.shown) return;
  ask.shown = { ...ask.shown, ms: ask.shown.ms + ms };
  write({ kind: 'shown', ask: ask.id, ...ask.shown });
}

// The tokens of a program's result, all its models together: { in, out, cr, cw } - fresh input,
// output, input read from the cache and input written to it.
export function tokensOf(result) {
  const models = Object.values(result?.modelUsage || {});
  if (models.length) return models.reduce((sum, m) => add(sum, modelTokens(m)), { in: 0, out: 0, cr: 0, cw: 0 });
  const u = result?.usage || {};
  return { in: u.input_tokens || 0, out: u.output_tokens || 0, cr: u.cache_read_input_tokens || 0, cw: u.cache_creation_input_tokens || 0 };
}
export const modelTokens = m => ({ in: m?.inputTokens || 0, out: m?.outputTokens || 0, cr: m?.cacheReadInputTokens || 0, cw: m?.cacheCreationInputTokens || 0 });
const add = (a, b) => ({ in: a.in + b.in, out: a.out + b.out, cr: a.cr + b.cr, cw: a.cw + b.cw });

// A program used this much. who: 'main' (the lead, or the one AI that builds alone - and team mode's
// fixer, checker, polisher and tester, which run at its speed), 'builders' (the helpers), 'voice' or
// 'watch' (the overwatch). cost: Claude Code's estimate in dollars - null when the program was
// stopped before it reported one (its tokens are still counted). what: what it was for (now(), read
// when it was asked) - outside any request, which shouldn't happen, it counts as a change, the
// phase whose speed it ran at (PHASE_UNKNOWN).
export const PHASE_UNKNOWN = 'change';
export function used({ who, role = '', model = '', fast = false, tokens = {}, cost = null, ms = 0, approx = false }, what = now()) {
  const t = { in: 0, out: 0, cr: 0, cw: 0, ...tokens };
  if (!t.in && !t.out && !t.cr && !t.cw && !cost) return;
  const phase = PHASES.includes(what.phase) ? what.phase : PHASE_UNKNOWN;
  write({ kind: 'use', ask: what.ask ?? null, phase, who: what.who || who, role, model, fast: Boolean(fast), ...t, cost: cost == null ? null : Math.round(cost * 1e6) / 1e6, ms: Math.round(ms), ...(approx && { approx: true }) });
}

// ---------------------------------------------------------------------------------------------
// Reading it back, a day at a time

const dayOf = t => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const cell = () => ({ cost: 0, fast: 0, in: 0, out: 0, cr: 0, cw: 0, runs: 0, unpriced: 0 });
function into(c, r) {
  c.cost += r.cost || 0;
  if (r.fast) c.fast += r.cost || 0;
  for (const k of ['in', 'out', 'cr', 'cw']) c[k] += r[k] || 0;
  c.runs++;
  if (r.cost == null) c.unpriced++;
  return c;
}
const COLUMNS = ['main', 'builders', 'other']; // (other: the voice and the overwatch)
const column = who => (who === 'main' || who === 'builders' ? who : 'other');

// What a day cost (the latest day with anything in it, unless one is asked for): the days there
// are, the day's total, each phase by who did it, and each thing the kid asked for with what its
// wait cost and what the polishing after it cost.
export function summary(day, all = rows()) {
  // (One pass: each day's requests and what was used that day.)
  const byDay = new Map();
  const shown = new Map(); // (a request's last line counts)
  for (const r of all) {
    if (r.kind === 'shown') {
      shown.set(r.ask, r);
      continue;
    }
    const d = dayOf(r.t);
    if (!byDay.has(d)) byDay.set(d, { asks: [], uses: [] });
    if (r.kind === 'ask') byDay.get(d).asks.push(r);
    else if (r.kind === 'use') byDay.get(d).uses.push(r);
  }
  const days = [...byDay.keys()].sort().reverse().slice(0, 60);
  const theDay = days.includes(day) ? day : days[0] || null;
  const perDay = days.map(d => {
    const c = byDay.get(d).uses.reduce(into, cell());
    return { day: d, cost: c.cost, fast: c.fast, asks: byDay.get(d).asks.length };
  });
  const { asks, uses: mine } = byDay.get(theDay) || { asks: [], uses: [] };

  const phases = Object.fromEntries(
    PHASES.map(p => {
      const of = mine.filter(r => r.phase === p);
      const waits = asks.filter(a => a.phase === p && shown.get(a.id)?.ok).map(a => shown.get(a.id).ms);
      return [
        p,
        {
          ...Object.fromEntries(COLUMNS.map(c => [c, of.filter(r => column(r.who) === c).reduce(into, cell())])),
          total: of.reduce(into, cell()),
          asks: p === 'play' ? new Set(of.map(r => r.ask)).size : asks.filter(a => a.phase === p).length,
          waitMs: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
        },
      ];
    }),
  );

  const perAsk = asks.map(a => {
    const of = mine.filter(r => r.ask === a.id);
    const wait = of.filter(r => r.phase !== 'play');
    const s = shown.get(a.id);
    return {
      t: a.t,
      text: a.text,
      phase: a.phase,
      title: s?.title || '',
      backend: s?.backend || '',
      ok: s ? Boolean(s.ok) : null,
      waitMs: s?.ms ?? null,
      wait: Object.fromEntries([...COLUMNS.map(c => [c, wait.filter(r => column(r.who) === c).reduce(into, cell())]), ['total', wait.reduce(into, cell())]]),
      play: of.filter(r => r.phase === 'play').reduce(into, cell()),
      models: [...new Set(wait.filter(r => r.who !== 'voice' && r.model).map(r => `${column(r.who) === 'builders' ? 'builders' : 'main'} ${r.model}${r.fast ? ' fast' : ''}`))],
    };
  });
  // (What was used with no request of that day to put it under: a pass that ran past midnight, the
  // overwatch after a restart.)
  const known = new Set(asks.map(a => a.id));
  const loose = mine.filter(r => !known.has(r.ask)).reduce(into, cell());

  return { days: perDay, day: theDay, total: mine.reduce(into, cell()), phases, asks: perAsk, loose };
}
