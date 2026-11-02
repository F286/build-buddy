// The kit: what every page the agent way makes while the kid waits starts from, so its lead only
// plans the creation - its look, its rules, its parts - and its helpers only write their parts.
// The kit makes the canvas (or the 3D scene), turns the arrow keys, taps and drags into calls on
// the parts, makes simple sounds and runs the one animation loop: run([parts]) does it all.
//
// Each part is an object with any of these (all optional):
//   init()                    once, when it starts (in order)
//   update(dt, t)             every frame (dt and t in seconds; dt at most 0.05)
//   draw(ctx, t)              every frame, after every update, in order (back to front) - 2D only
//   tap(x, y, ray)            a tap or click: the parts are asked from the front one back, until one
//                             returns true (in 3D, ray is a THREE.Raycaster through that point)
//   drag(x, y, dx, dy)        while a finger or the mouse moves, pressed (dx, dy: since last time)
//   release(x, y)             when it's let go
//   key(name, down)           'left' 'right' 'up' 'down' 'space', pressed (down) or let go
// A hook that throws is left out from then on and the rest go on (its error is still reported, so
// it gets fixed).

const PRELUDE_2D = `// ---- kit (Build Buddy's: the canvas, input, sounds and the loop - run([parts]))
const canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block;touch-action:none';
document.body.append(canvas);
const ctx = canvas.getContext('2d');
let W = innerWidth, H = innerHeight;
const fit = () => { W = canvas.width = innerWidth; H = canvas.height = innerHeight; };
fit();
addEventListener('resize', fit);`;

const PRELUDE_3D = `// ---- kit (Build Buddy's: the scene, camera, lights, input, sounds and the loop - run([parts]))
import * as THREE from 'three';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.domElement.style.cssText = 'position:fixed;inset:0;display:block;touch-action:none';
document.body.append(renderer.domElement);
const canvas = renderer.domElement;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
camera.position.set(0, 7, 14);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x556655, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(6, 12, 5);
scene.add(sun);
let W = innerWidth, H = innerHeight;
const fit = () => { W = innerWidth; H = innerHeight; renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix(); };
fit();
addEventListener('resize', fit);
const ray = new THREE.Raycaster();`;

const COMMON = `const input = { left: false, right: false, up: false, down: false, space: false, x: W / 2, y: H / 2, pressed: false };
let kitAudio = null;
function tone(freq = 440, dur = 0.15, type = 'sine', vol = 0.15) {
  try {
    kitAudio ||= new AudioContext();
    const o = kitAudio.createOscillator(), g = kitAudio.createGain(), at = kitAudio.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    o.connect(g).connect(kitAudio.destination); o.start(at); o.stop(at + dur);
  } catch {}
}
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
function run(parts) {
  parts = parts.filter(Boolean);
  const failed = new Set(); // (a part's hook that threw is left out from then on - the rest go on)
  const call = (p, fn, ...args) => {
    if (typeof p[fn] !== 'function' || failed.has(p[fn])) return undefined;
    try { return p[fn](...args); } catch (err) { failed.add(p[fn]); setTimeout(() => { throw err; }); }
  };
  parts.forEach(p => call(p, 'init'));
  const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', ' ': 'space' };
  addEventListener('keydown', e => { const k = KEYS[e.key]; if (!k) return; e.preventDefault(); if (input[k]) return; input[k] = true; parts.forEach(p => call(p, 'key', k, true)); });
  addEventListener('keyup', e => { const k = KEYS[e.key]; if (!k) return; input[k] = false; parts.forEach(p => call(p, 'key', k, false)); });
  const at = e => [e.clientX, e.clientY];
  canvas.addEventListener('pointerdown', e => {
    [input.x, input.y] = at(e); input.pressed = true;
    try { kitAudio ||= new AudioContext(); kitAudio.resume(); } catch {}
    const extra = typeof ray === 'undefined' ? undefined : (ray.setFromCamera(new THREE.Vector2((input.x / W) * 2 - 1, -(input.y / H) * 2 + 1), camera), ray);
    for (const p of [...parts].reverse()) if (call(p, 'tap', input.x, input.y, extra) === true) break;
  });
  addEventListener('pointermove', e => {
    const [x, y] = at(e), dx = x - input.x, dy = y - input.y;
    [input.x, input.y] = [x, y];
    if (input.pressed) parts.forEach(p => call(p, 'drag', x, y, dx, dy));
  });
  addEventListener('pointerup', e => { if (!input.pressed) return; input.pressed = false; parts.forEach(p => call(p, 'release', ...at(e))); });
  let last = performance.now(), t = 0;
  const frame = now => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now; t += dt;
    parts.forEach(p => call(p, 'update', dt, t));
    DRAW
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}`;

const DRAW_2D = 'ctx.clearRect(0, 0, W, H); parts.forEach(p => { ctx.save(); call(p, \'draw\', ctx, t); ctx.restore(); });';
const DRAW_3D = 'renderer.render(scene, camera);';

export function kitCode(kind) {
  const three = kind === '3d';
  return `${three ? PRELUDE_3D : PRELUDE_2D}\n${COMMON.replace('DRAW', three ? DRAW_3D : DRAW_2D)}`;
}

// What the lead and its helpers are told the kit gives them.
export function kitApi(kind) {
  const three = kind === '3d';
  return `${
    three
      ? 'The kit (3D) gives: THREE (imported), scene, camera (at 0, 7, 14 looking at the middle; a part may move it), renderer, sun (a light), W and H (the window size),'
      : 'The kit (2D) gives: canvas (the whole window), ctx (its 2D context), W and H (its size, kept up to date),'
  } input (left, right, up, down, space: arrow keys and space held; x, y: the pointer; pressed: a finger or button down), tone(freq, dur, type, vol) for a quick sound (type: 'sine', 'square', 'triangle' or 'sawtooth'), rand(a, b), and run(parts), which runs it all.
Each part is one object (const <name> = { ... }) with any of: init() once at the start; update(dt, t) every frame (seconds; dt at most 0.05);${three ? '' : ' draw(ctx, t) every frame after every update, back to front in run order (the kit clears the canvas each frame, so something draws the background);'} tap(x, y${three ? ', ray' : ''}) - asked from the front part back until one returns true${three ? ' (ray: a THREE.Raycaster through the tap, for ray.intersectObjects(...))' : ''}; drag(x, y, dx, dy) while pressed and moving; release(x, y); key(name, down) for 'left', 'right', 'up', 'down', 'space'. ${three ? 'The kit draws the scene every frame: parts add their meshes to scene in init().' : ''} Parts use each other by name (sky.top, ball.shoot()), exactly as the plan says.`;
}

// The page: the kit, the plan's shared code, every part, and run([...]) in the plan's order.
export function kitPage(kind, shared, parts, order) {
  const names = parts.map(p => p.name);
  const ordered = [...order.filter(n => names.includes(n)), ...names.filter(n => !order.includes(n))];
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}</style>
</head>
<body>
<script type="module">
${kitCode(kind)}

${shared.trim()}

${parts.map(p => `// ---- ${p.name}\n${p.code}`).join('\n\n')}

// ---- main
run([${ordered.join(', ')}]);
</script>
</body>
</html>
`;
}
