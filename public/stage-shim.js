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
  // A trial run (the app trying a fix out of sight before showing it): silent.
  const trial = Boolean(window.__kbRestore?.trial);
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
      // With an empty list to start from: simple values, or flat objects of them (like the things
      // the kid placed, { x, y, kind }).
      const simple = v => ['number', 'string', 'boolean'].includes(typeof v) && fits(v, v);
      const flat = v => simple(v) || (plain(v) && Object.values(v).every(simple));
      const ok = val.every(v => (sample === undefined ? flat(v) : fits(sample, v)));
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
      return saved != null;
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

  // The page as the kid sees it, as a small JPEG (at most 640 wide), plus whether it's all one
  // color. Called right after a frame is drawn: that's when WebGL canvases still hold their
  // picture, so every canvas's picture and a copy of the page's elements are taken straight away.
  // The elements are drawn from that copy as an SVG picture, which the browser paints without
  // running anything in it. A canvas that covers what's behind it (a game's whole picture) goes
  // under the elements; a see-through one (sparkles over a page) goes on top.
  async function snapshot() {
    const vw = innerWidth;
    const vh = innerHeight;
    if (!vw || !vh) return null;
    const w = Math.round(Math.min(640, vw));
    const h = Math.round((vh * w) / vw);
    const k = w / vw;
    const layers = [...document.querySelectorAll('canvas')]
      .map(c => ({ c, r: c.getBoundingClientRect() }))
      .filter(l => l.c.width && l.c.height && l.r.width > 0 && l.r.height > 0)
      .map(l => ({ r: l.r, bitmap: createImageBitmap(l.c).catch(() => null) }));
    const page = document.documentElement.cloneNode(true);
    const biggest = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const behind = backgroundOf(biggest) || backgroundOf(document.body) || backgroundOf(document.documentElement) || '#ffffff';

    const shot = new OffscreenCanvas(w, h);
    const g = shot.getContext('2d');
    g.imageSmoothingQuality = 'medium';
    // See-through parts show the page's background: paint that first, or they come out black
    // and the overwatch thinks the screen is dark.
    g.fillStyle = behind;
    g.fillRect(0, 0, w, h);
    const pictures = [];
    for (const l of layers) {
      const bitmap = await l.bitmap;
      if (!bitmap) continue;
      const tiny = new OffscreenCanvas(8, 8).getContext('2d');
      tiny.drawImage(bitmap, 0, 0, 8, 8);
      const px = tiny.getImageData(0, 0, 8, 8).data;
      let alpha = 0;
      for (let i = 3; i < px.length; i += 4) alpha += px[i];
      pictures.push({ r: l.r, bitmap, under: alpha > 64 * 230 });
    }
    const put = p => {
      g.drawImage(p.bitmap, p.r.left * k, p.r.top * k, p.r.width * k, p.r.height * k);
      p.bitmap.close();
    };
    pictures.filter(p => p.under).forEach(put);
    try {
      page.querySelectorAll('script').forEach(el => el.remove());
      page.querySelectorAll('canvas').forEach(el => (el.style.visibility = 'hidden'));
      if (pictures.some(p => p.under)) for (const el of [page, page.querySelector('body')]) if (el) el.style.background = 'transparent';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(page)}</foreignObject></svg>`;
      const img = new Image();
      // A data: URL: in the sandbox, a blob: picture would make the snapshot unreadable.
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await img.decode();
      g.drawImage(img, 0, 0, w, h);
    } catch {
      // The canvases alone, then.
    }
    pictures.filter(p => !p.under).forEach(put);
    const tiny = new OffscreenCanvas(24, 16);
    tiny.getContext('2d').drawImage(shot, 0, 0, 24, 16);
    const px = tiny.getContext('2d').getImageData(0, 0, 24, 16).data;
    const blob = await shot.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
    const url = await new Promise(r => {
      const reader = new FileReader();
      reader.onload = () => r(reader.result);
      reader.readAsDataURL(blob);
    });
    return { url, blank: px.every((v, i) => v === px[i % 4]) };
  }

  // ---- A look at how the page is running, for the checker and the overwatch: frame rate,
  // errors, kept values, and a small screenshot. If the screenshot takes more than 2 s (a page
  // that's very slow to paint), the report goes without it rather than not at all.
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
        Promise.race([snapshot(), new Promise(r => setTimeout(r, 2000))])
          .then(shot => {
            if (!shot) return;
            out.screenshot = shot.url;
            out.blank = shot.blank;
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
        if (trial) {
          this.suspend();
          this.resume = () => Promise.resolve();
        }
      }
    }
    window.AudioContext = window.webkitAudioContext = TrackedAudioContext;
  }

  if (trial && window.HTMLMediaElement) HTMLMediaElement.prototype.play = () => Promise.resolve();

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
