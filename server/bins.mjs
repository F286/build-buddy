// Find helper programs even when the app is started from a desktop shortcut or autostart,
// where PATH is often missing ~/.local/bin, mise, Homebrew, etc.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolvePath } from './config.mjs';

function isExecutable(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return false;
    if (process.platform === 'win32') return true;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findBin(name, configured, extraDirs = []) {
  if (configured) {
    const p = resolvePath(configured);
    return isExecutable(p) ? p : null;
  }
  const home = os.homedir();
  const names = process.platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  const dirs = [
    ...extraDirs,
    ...(process.env.PATH || '').split(path.delimiter),
    path.join(home, '.local/bin'),
    path.join(home, `.local/share/mise/installs/${name}/latest`),
    path.join(home, `.local/share/mise/installs/${name}/latest/bin`),
    path.join(home, '.local/share/mise/shims'),
    path.join(home, '.npm-global/bin'),
    path.join(home, '.bun/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ];
  for (const d of dirs) {
    for (const n of names) {
      const f = path.join(d, n);
      if (d && isExecutable(f)) return f;
    }
  }
  return null;
}

// Run a program, feed `input` on stdin, stream stdout chunks to onStdout, and resolve with
// everything it printed. Rejects on a non-zero exit, a timeout, or an abort.
export function run(bin, args, { input = '', cwd, env, timeoutSec = 120, onStdout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32' && /\.cmd$/i.test(bin),
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${path.basename(bin)} took longer than ${timeoutSec}s`));
    }, timeoutSec * 1000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', d => {
      out += d;
      onStdout?.(d);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', d => (err += d));
    child.on('error', e => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${path.basename(bin)} exited with ${code}: ${(err || out).trim().slice(-600)}`));
    });
    child.stdin.on('error', () => {}); // the program may exit before reading all input
    child.stdin.end(input);
  });
}
