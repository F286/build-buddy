// The checks of a built page that need no browser (team.mjs): what certainly spoils it, read from its code.
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProblems } from './team.mjs';

const page = script => `<!doctype html><html><body><canvas id="c"></canvas>\n<script type="module">\n${script}\n</script></body></html>`;
const MATTER = "import Matter from 'matter-js';\nconst { Engine, Bodies, Composite } = Matter;\nconst engine = Engine.create();\nComposite.add(engine.world, Bodies.circle(100, 0, 20));\n";

test('Matter.js physics that nothing steps is a problem to fix before it is shown', () => {
  const [problem, ...more] = blankProblems(page(`${MATTER}requestAnimationFrame(function frame() { draw(); requestAnimationFrame(frame); });`));
  assert.match(problem, /nothing steps its engine/);
  assert.match(problem, /Engine\.update\(engine, 1000 \/ 60\)/);
  assert.deepEqual(more, []);
});

test('Matter.js physics that is stepped, in any of the ways it can be, is not', () => {
  for (const step of [
    'let acc = 0; function frame(dt) { acc = Math.min(acc + dt * 1000, 50); while (acc >= 1000 / 60) { Engine.update(engine, 1000 / 60); acc -= 1000 / 60; } }',
    'Matter.Engine.update(engine, 1000 / 60);',
    'Matter.Runner.run(Matter.Runner.create(), engine);',
    'Matter.Runner.run(engine);',
    'Engine.run(engine);',
    'const E = Matter.Engine;\nE.update(engine, 16.6);',
    'const S = { engine }; Matter.Engine["update"]; phys.update(S.engine, 1000 / 60);',
  ]) assert.deepEqual(blankProblems(page(`${MATTER}${step}`)), [], step);
  // Its Engine under a name of the page's own: no telling from the code, so nothing is said.
  for (const renamed of [
    "import { Engine as Phys, Bodies } from 'matter-js';\nconst world = Phys.create();\nfunction tick() { Phys.update(world, 1000 / 60); }",
    "import Matter from 'matter-js';\nconst { Engine: Phys } = Matter;\nconst world = Phys.create();\nfunction tick() { Phys.update(world, 1000 / 60); }",
    "import Matter from 'matter-js';\nconst Phys = Matter.Engine;\nconst world = Phys.create();\nfunction tick() { Phys.update(world, 1000 / 60); }",
  ]) assert.deepEqual(blankProblems(page(renamed)), [], renamed);
  // Named imports work like the default one.
  assert.match(blankProblems(page("import { Engine, Bodies } from 'matter-js';\nconst engine = Engine.create();"))[0], /nothing steps its engine/);
});

test('a page without Matter.js is not asked to step anything, and a 3D page must draw', () => {
  assert.deepEqual(blankProblems(page("const ctx = document.getElementById('c').getContext('2d');\nfunction frame() { ctx.fillRect(0, 0, 9, 9); requestAnimationFrame(frame); }\nframe();")), []);
  assert.match(blankProblems(page("import * as THREE from 'three';\nconst scene = new THREE.Scene();"))[0], /never draws/);
});
