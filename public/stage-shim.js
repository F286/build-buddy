// Injected at the top of every AI-made page (inside the sandboxed frame). It reports crashes
// so the app can fix them, keeps the "talk" keys working while the page has focus, carries the
// kid's progress across updates (KB.keep), reports how the page is running to the overwatch,
// and smooths over things the locked-down frame doesn't allow.
(() => {
  const post = m => parent.postMessage({ kidbuild: true, ...m }, '*');
  const errors = [];
  const report = message => {
    errors.push(message);
    if (errors.length > 10) errors.shift();
    post({ type: 'error', message });
  };

  addEventListener('error', e => {
    if (e.message) report(`${e.message} (line ${e.lineno})`);
  });
  addEventListener('unhandledrejection', e => {
    report(`Unhandled promise rejection: ${e.reason?.message || e.reason}`);
  });

  let lastInput = performance.now();
  for (const type of ['keydown', 'pointerdown', 'touchstart']) {
    addEventListener(type, () => (lastInput = performance.now()), { capture: true, passive: true });
  }

  // ---- Keeping progress across updates. The page calls KB.keep({ score: 0, ... }) and gets an
  // object to play with; the app saves it and hands it back to the next version of the page.
  // Saved values only come back where they still fit the new defaults (same kind of value),
  // so a changed page can't be pushed into a state it doesn't understand.
  const saved = window.__kbRestore?.keep;
  delete window.__kbRestore;
  const plain = v => v && typeof v === 'object' && !Array.isArray(v);
  const fits = (def, val) =>
    typeof def === typeof val && (typeof val !== 'number' || Number.isFinite(val)) && (typeof val !== 'string' || val.length < 2000);
  function fit(def, val) {
    if (plain(def)) {
      const out = {};
      for (const k of Object.keys(def)) out[k] = fit(def[k], plain(val) ? val[k] : undefined);
      return out;
    }
    if (Array.isArray(def)) {
      if (!Array.isArray(val) || val.length > 500) return def;
      const sample = def[0];
      const ok = val.every(v => (sample === undefined ? ['number', 'string', 'boolean'].includes(typeof v) && fits(v, v) : fits(sample, v)));
      return ok ? val.slice() : def;
    }
    return val !== undefined && fits(def, val) ? val : def;
  }
  let kept = null;
  const copy = v => {
    try {
      return JSON.parse(JSON.stringify(v));
    } catch {
      return null;
    }
  };
  window.KB = {
    keep(defaults = {}) {
      kept = fit(plain(defaults) ? defaults : {}, saved);
      return kept;
    },
    get restored() {
      return saved !== undefined;
    },
    get current() {
      return kept;
    },
  };
  setInterval(() => kept && post({ type: 'keep', keep: copy(kept) }), 2000);

  // An element's own background color, or the first color of its background gradient.
  function backgroundOf(el) {
    if (!el) return '';
    const st = getComputedStyle(el);
    if (!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(st.backgroundColor)) return st.backgroundColor;
    return /rgba?\([^)]*\)|#[0-9a-f]{3,8}/i.exec(st.backgroundImage || '')?.[0] || '';
  }

  // ---- A look at how the page is running, for the overwatch: frame rate, errors, kept values,
  // and a small screenshot of the biggest canvas, taken right after a frame is drawn (that's
  // when WebGL canvases still hold their picture).
  function inspect() {
    let frames = 0;
    const t0 = performance.now();
    return new Promise(done => {
      const tick = now => {
        frames++;
        if (now - t0 < 1000) return requestAnimationFrame(tick);
        const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
        const out = {
          fps: Math.round((frames * 1000) / (now - t0)),
          idleSec: Math.round((now - lastInput) / 1000),
          errors: errors.slice(),
          keep: copy(kept),
          elements: document.getElementsByTagName('*').length,
          text: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
          canvas: canvas ? `${canvas.width}x${canvas.height}` : '',
        };
        if (!canvas || !canvas.width || !canvas.height) return done(out);
        // Snapshot the canvas now, while it holds the frame just drawn; shrinking, checking and
        // compressing happen off the game's thread, so the game doesn't stutter.
        const w = Math.round(Math.min(640, canvas.width));
        const h = Math.round((canvas.height * w) / canvas.width);
        const behind = backgroundOf(canvas) || backgroundOf(document.body) || backgroundOf(document.documentElement) || '#ffffff';
        createImageBitmap(canvas, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' })
          .then(async bitmap => {
            const shot = new OffscreenCanvas(w, h);
            const g = shot.getContext('2d');
            // See-through parts of a canvas show the page behind it: paint that first, or they
            // come out black and the overwatch thinks the screen is dark.
            g.fillStyle = behind;
            g.fillRect(0, 0, w, h);
            g.drawImage(bitmap, 0, 0);
            bitmap.close();
            const tiny = new OffscreenCanvas(24, 16);
            tiny.getContext('2d').drawImage(shot, 0, 0, 24, 16);
            const px = tiny.getContext('2d').getImageData(0, 0, 24, 16).data;
            out.blank = px.every((v, i) => v === px[i % 4]);
            const blob = await shot.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
            out.screenshot = await new Promise(r => {
              const reader = new FileReader();
              reader.onload = () => r(reader.result);
              reader.readAsDataURL(blob);
            });
          })
          .catch(() => {})
          .then(() => done(out));
      };
      requestAnimationFrame(tick);
    });
  }

  // Space and Enter belong to the app (talk / type), so the page never sees them.
  const appKey = e =>
    e.code === 'Space' || e.key === ' ' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Escape' ||
    ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyP');
  const forward = e => {
    // Browser shortcuts aren't for kids (F1 opens Chrome's help page over the whole app, Ctrl+P
    // prints, Alt+Left goes back...). The page still sees the keys; the browser doesn't act on them.
    if (/^F\d+$/.test(e.key) || e.ctrlKey || e.metaKey || e.altKey) e.preventDefault();
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
    if (d.type === 'keep?') post({ type: 'keep', keep: copy(kept), id: d.id });
    if (d.type === 'inspect?') inspect().then(r => post({ type: 'inspect', report: r, id: d.id }));
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

  // Warm up the screenshot machinery with a tiny practice shot soon after the page starts: the
  // first real one would otherwise make the game stutter for a moment when the overwatch looks.
  addEventListener('load', () =>
    setTimeout(() => requestAnimationFrame(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas?.width) return;
      createImageBitmap(canvas, { resizeWidth: 4, resizeHeight: 4 })
        .then(bitmap => {
          const practice = new OffscreenCanvas(4, 4);
          practice.getContext('2d').drawImage(bitmap, 0, 0);
          bitmap.close();
          practice.getContext('2d').getImageData(0, 0, 1, 1);
          return practice.convertToBlob({ type: 'image/jpeg' });
        })
        .catch(() => {});
    }), 1500),
  );
})();
