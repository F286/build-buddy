// Every creation is a "project" folder holding numbered versions (v1.html, v2.html, ...) plus a
// project.json with its title, which version is showing, and the conversation so far.
// Version 0 means the blank screen. Nothing is ever deleted, so "go back" is always safe.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA } from './config.mjs';

const PROJECTS = path.join(DATA, 'projects');
const STATE = path.join(DATA, 'state.json');
fs.mkdirSync(PROJECTS, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Write-then-rename so a crash or power cut can never leave a half-written file.
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

const dir = id => path.join(PROJECTS, id);
const projectFile = id => path.join(dir(id), 'project.json');

function save(p) {
  p.updated = Date.now();
  writeAtomic(projectFile(p.id), JSON.stringify(p, null, 2));
  return p;
}

function load(id) {
  if (!/^[\w-]+$/.test(id || '')) return null;
  return readJson(projectFile(id), null);
}

function create() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const id = `${stamp}-${crypto.randomBytes(2).toString('hex')}`;
  fs.mkdirSync(dir(id), { recursive: true });
  const p = { id, title: '', emoji: '', created: Date.now(), current: 0, versions: [], history: [] };
  setCurrentId(id);
  return save(p);
}

function setCurrentId(id) {
  writeAtomic(STATE, JSON.stringify({ projectId: id }));
}

export function currentProject() {
  return load(readJson(STATE, {}).projectId) || create();
}

export function html(p, n = p.current) {
  if (!n) return '';
  try {
    return fs.readFileSync(path.join(dir(p.id), `v${n}.html`), 'utf8');
  } catch {
    return '';
  }
}

export function addVersion(p, pageHtml, meta) {
  const n = p.versions.reduce((m, v) => Math.max(m, v.n), 0) + 1;
  writeAtomic(path.join(dir(p.id), `v${n}.html`), pageHtml);
  p.versions.push({ n, at: Date.now(), ...meta, from: p.current }); // from: what was showing before
  p.current = n;
  return save(p);
}

export function addHistory(p, role, text) {
  if (text) p.history.push({ role, text, at: Date.now() });
  return save(p);
}

export function setTitle(p, title, emoji) {
  if (title) p.title = title;
  if (emoji) p.emoji = emoji;
  return save(p);
}

// Step back to the version that was showing before the current one.
export function undo() {
  const p = currentProject();
  const ns = p.versions.map(v => v.n).filter(n => n < p.current);
  if (!p.current) return null;
  p.current = ns.length ? Math.max(...ns) : 0;
  return save(p);
}

// Take back a version that turned out broken (a fix that crashed when the app tried it): it's
// forgotten, and the one it was made from is current again (after an undo, that isn't
// necessarily the newest one left).
export function dropVersion(p, n) {
  if (p.current !== n) return p;
  const from = p.versions.find(v => v.n === n)?.from;
  p.versions = p.versions.filter(v => v.n !== n);
  p.current = from === 0 || p.versions.some(v => v.n === from) ? from : p.versions.reduce((m, v) => (v.n < n ? Math.max(m, v.n) : m), 0);
  fs.rmSync(path.join(dir(p.id), `v${n}.html`), { force: true });
  return save(p);
}

export function newProject() {
  const p = currentProject();
  return p.versions.length ? create() : p; // reuse an untouched blank project
}

export function open(id) {
  const p = load(id);
  if (!p) return null;
  setCurrentId(p.id);
  if (!p.current && p.versions.length) p.current = p.versions.at(-1).n;
  return save(p);
}

export function list() {
  return fs
    .readdirSync(PROJECTS)
    .map(load)
    .filter(p => p && p.versions.length)
    .sort((a, b) => b.updated - a.updated)
    .map(p => ({ id: p.id, title: p.title || 'My creation', emoji: p.emoji || '⭐', updated: p.updated }));
}
