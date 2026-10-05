// Injected at the top of every AI-made page (inside the sandboxed frame). It reports crashes
// so the app can fix them, keeps the "talk" keys working while the page has focus, and
// smooths over things the locked-down frame doesn't allow.
(() => {
  const post = m => parent.postMessage({ kidbuild: true, ...m }, '*');

  addEventListener('error', e => {
    if (e.message) post({ type: 'error', message: `${e.message} (line ${e.lineno})` });
  });
  addEventListener('unhandledrejection', e => {
    post({ type: 'error', message: `Unhandled promise rejection: ${e.reason?.message || e.reason}` });
  });

  // Space and Enter belong to the app (talk / type), so the page never sees them.
  const appKey = e =>
    e.code === 'Space' || e.key === ' ' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Escape' ||
    ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyP');
  const forward = e => {
    if (!appKey(e)) return;
    if (e.code !== 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    post({ type: 'key', event: e.type, code: e.key === ' ' ? 'Space' : e.code, repeat: e.repeat, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey });
  };
  addEventListener('keydown', forward, true);
  addEventListener('keyup', forward, true);

  // Sharp screens (2x) make canvas and 3D pages draw four times the pixels. Pages that size
  // themselves by devicePixelRatio get at most 1.5x: a little softer, a lot smoother.
  const realRatio = window.devicePixelRatio || 1;
  try {
    Object.defineProperty(window, 'devicePixelRatio', { get: () => Math.min(realRatio, 1.5), configurable: true });
  } catch {}

  // Track the page's sound so the app can hush it while the kid is talking.
  const contexts = [];
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    class TrackedAudioContext extends AC {
      constructor(...args) {
        super(...args);
        contexts.push(this);
      }
    }
    window.AudioContext = window.webkitAudioContext = TrackedAudioContext;
  }

  addEventListener('message', e => {
    const d = e.data;
    if (e.source !== parent || !d?.kidbuild) return;
    if (d.type === 'mute') contexts.forEach(c => c.state === 'running' && c.suspend());
    if (d.type === 'unmute') contexts.forEach(c => c.state === 'suspended' && c.resume());
    if (d.type === 'fps?') {
      // Count animation frames for a second (shown in the grown-up panel).
      let frames = 0;
      const t0 = performance.now();
      const tick = now => {
        frames++;
        if (now - t0 < 1000) requestAnimationFrame(tick);
        else post({ type: 'fps', fps: Math.round((frames * 1000) / (now - t0)) });
      };
      requestAnimationFrame(tick);
    }
    if (d.type === 'key') {
      const ev = new KeyboardEvent(d.event, { key: d.key, code: d.code, bubbles: true, cancelable: true });
      (document.activeElement || document.body || document).dispatchEvent(ev);
    }
  });

  // Storage throws in a sandboxed frame; hand the page a forgetful stand-in instead.
  const memoryStorage = () => {
    const m = new Map();
    return {
      getItem: k => (m.has(String(k)) ? m.get(String(k)) : null),
      setItem: (k, v) => m.set(String(k), String(v)),
      removeItem: k => m.delete(String(k)),
      clear: () => m.clear(),
      key: i => [...m.keys()][i] ?? null,
      get length() {
        return m.size;
      },
    };
  };
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      window[name].length;
    } catch {
      try {
        Object.defineProperty(window, name, { value: memoryStorage(), configurable: true });
      } catch {}
    }
  }

  addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('wheel', e => e.ctrlKey && e.preventDefault(), { passive: false });
  addEventListener('load', () => post({ type: 'loaded' }));
})();
