#!/usr/bin/env bash
# One-time setup: local speech-to-text (whisper.cpp) and text-to-speech (Piper).
# Everything goes into ./vendor - nothing is installed system-wide. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p vendor/models vendor/piper

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

OS=$(uname -s)
ARCH=$(uname -m)
WHISPER_MODEL=${WHISPER_MODEL:-small.en}  # extra model to fetch, if you want another one

have node || { echo "Node.js 20+ is required (https://nodejs.org)"; exit 1; }
have curl || { echo "curl is required"; exit 1; }

# ---------------------------------------------------------------------------- whisper.cpp
say "Speech-to-text: whisper.cpp"
CMAKE=cmake
if ! have cmake && have mise; then CMAKE="mise exec cmake@latest -- cmake"; fi
if have whisper-cli; then
  echo "using $(command -v whisper-cli)"
elif [ -x vendor/whisper.cpp/build/bin/whisper-cli ]; then
  echo "already built"
else
  have git || { echo "git is required to build whisper.cpp"; exit 1; }
  if ! $CMAKE --version >/dev/null 2>&1; then
    if [ "$OS" = Darwin ] && have brew; then echo "tip: 'brew install whisper-cpp' is the quickest route on a Mac"; exit 1; fi
    echo "cmake is required (or install whisper.cpp from your package manager)"; exit 1
  fi
  [ -d vendor/whisper.cpp ] || git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git vendor/whisper.cpp
  # On a Mac this build already uses the GPU (Metal).
  $CMAKE -S vendor/whisper.cpp -B vendor/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DBUILD_SHARED_LIBS=OFF >/dev/null
  $CMAKE --build vendor/whisper.cpp/build -j --config Release --target whisper-cli
fi

# Optional (WHISPER_GPU=1 ./setup.sh): a GPU build plus the larger model, which hears little kids
# better but makes games stutter briefly while it works (see whisper in server/config.mjs).
GPU=no
[ "${WHISPER_GPU:-0}" = 1 ] && [ "$OS" = Darwin ] && GPU=yes # the Mac build above already uses Metal
if [ "${WHISPER_GPU:-0}" = 1 ] && [ "$OS" = Linux ] && [ -d vendor/whisper.cpp ] && have glslc && pkg-config --exists vulkan 2>/dev/null; then
  if [ -x vendor/whisper.cpp/build-vk/bin/whisper-cli ]; then
    echo "GPU build: already built"
    GPU=yes
  else
    echo "building the GPU (Vulkan) version..."
    if [ ! -d vendor/spirv/include/spirv ]; then # header-only, kept in vendor/
      rm -rf vendor/spirv-src && git clone -q --depth 1 https://github.com/KhronosGroup/SPIRV-Headers.git vendor/spirv-src
      $CMAKE -S vendor/spirv-src -B vendor/spirv-src/build -DCMAKE_INSTALL_PREFIX="$PWD/vendor/spirv" -DSPIRV_HEADERS_ENABLE_TESTS=OFF >/dev/null
      $CMAKE --install vendor/spirv-src/build >/dev/null && rm -rf vendor/spirv-src
    fi
    if $CMAKE -S vendor/whisper.cpp -B vendor/whisper.cpp/build-vk -DCMAKE_BUILD_TYPE=Release -DGGML_VULKAN=ON -DGGML_CCACHE=OFF \
         -DWHISPER_BUILD_TESTS=OFF -DBUILD_SHARED_LIBS=OFF -DCMAKE_PREFIX_PATH="$PWD/vendor/spirv" \
         -DCMAKE_CXX_FLAGS="-I$PWD/vendor/spirv/include" -DCMAKE_C_FLAGS="-I$PWD/vendor/spirv/include" >/dev/null &&
       $CMAKE --build vendor/whisper.cpp/build-vk -j --config Release --target whisper-cli; then
      GPU=yes
    else
      echo "the GPU build didn't work - the CPU build and the smaller speech model will be used"
    fi
  fi
fi

# small.en is the default; large-v3-turbo only comes with WHISPER_GPU=1.
for MODEL in small.en $([ $GPU = yes ] && echo large-v3-turbo-q5_0) $WHISPER_MODEL; do
  if [ ! -s "vendor/models/ggml-$MODEL.bin" ]; then
    echo "downloading the $MODEL speech model..."
    curl -fL --progress-bar -o "vendor/models/ggml-$MODEL.bin" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin"
  fi
done

# ---------------------------------------------------------------------------- Kokoro
say "Natural voice: Kokoro (via sherpa-onnx)"
SHERPA_VERSION=1.13.8
case "$OS-$ARCH" in
  Linux-x86_64) SHERPA=linux-x64-shared ;;
  Linux-aarch64 | Linux-arm64) SHERPA=linux-aarch64-shared-cpu ;;
  Darwin-arm64) SHERPA=osx-arm64-shared ;;
  Darwin-x86_64) SHERPA=osx-x64-shared ;;
  *) SHERPA= ;;
esac
mkdir -p vendor/kokoro
if [ -x vendor/kokoro/sherpa-onnx/bin/sherpa-onnx-offline-tts ]; then
  echo "already installed"
elif [ -n "$SHERPA" ]; then
  curl -fL --progress-bar "https://github.com/k2-fsa/sherpa-onnx/releases/download/v$SHERPA_VERSION/sherpa-onnx-v$SHERPA_VERSION-$SHERPA.tar.bz2" | tar xj -C vendor/kokoro
  mv "vendor/kokoro/sherpa-onnx-v$SHERPA_VERSION-$SHERPA" vendor/kokoro/sherpa-onnx
else
  echo "no sherpa-onnx build for $OS-$ARCH - the Piper voice will be used"
fi
if [ ! -s vendor/kokoro/model/model.onnx ]; then
  echo "downloading the Kokoro voice model (about 330 MB)..."
  curl -fL --progress-bar https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2 | tar xj -C vendor/kokoro
  rm -rf vendor/kokoro/model && mv vendor/kokoro/kokoro-multi-lang-v1_0 vendor/kokoro/model
fi

# ---------------------------------------------------------------------------- Parakeet
say "Speech-to-text for little kids: Parakeet (via sherpa-onnx)"
PARAKEET=vendor/parakeet/tdt-0.6b-v2
if [ -s "$PARAKEET/encoder.int8.onnx" ]; then
  echo "already installed"
elif [ -x vendor/kokoro/sherpa-onnx/bin/sherpa-onnx-offline ]; then
  echo "downloading the Parakeet speech model (about 660 MB)..."
  mkdir -p "$PARAKEET"
  for f in encoder.int8.onnx decoder.int8.onnx joiner.int8.onnx tokens.txt; do
    curl -fL --progress-bar -o "$PARAKEET/$f" "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/main/$f"
  done
else
  echo "needs sherpa-onnx (above) - whisper will be used instead"
fi

# ---------------------------------------------------------------------------- Piper
say "Fast voice: Piper"
case "$OS-$ARCH" in
  Linux-x86_64) PIPER=piper_linux_x86_64.tar.gz ;;
  Linux-aarch64 | Linux-arm64) PIPER=piper_linux_aarch64.tar.gz ;;
  Darwin-arm64) PIPER=piper_macos_aarch64.tar.gz ;;
  Darwin-x86_64) PIPER=piper_macos_x64.tar.gz ;;
  *) PIPER= ;;
esac
if [ -x vendor/piper/piper/piper ]; then
  echo "already installed"
elif [ -n "$PIPER" ]; then
  curl -fL --progress-bar "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/$PIPER" | tar xz -C vendor/piper
else
  echo "no Piper build for $OS-$ARCH - set \"tts\": \"browser\" in config.json"
fi
VOICE=${PIPER_VOICE:-en/en_US/amy/medium/en_US-amy-medium}
if [ ! -s vendor/piper/voice.onnx ]; then
  echo "downloading the voice..."
  curl -fL --progress-bar -o vendor/piper/voice.onnx "https://huggingface.co/rhasspy/piper-voices/resolve/main/$VOICE.onnx"
  curl -fsL -o vendor/piper/voice.onnx.json "https://huggingface.co/rhasspy/piper-voices/resolve/main/$VOICE.onnx.json"
fi

# ---------------------------------------------------------------------------- Three.js
say "3D engine: Three.js"
THREE_VERSION=0.186.1
if [ -s vendor/three/build/three.module.js ]; then
  echo "already installed"
else
  tmp=$(mktemp -d)
  curl -fsSL "https://registry.npmjs.org/three/-/three-$THREE_VERSION.tgz" | tar xz -C "$tmp"
  mkdir -p vendor/three
  cp -r "$tmp/package/build" vendor/three/build
  cp -r "$tmp/package/examples/jsm" vendor/three/addons
  cp "$tmp/package/LICENSE" vendor/three/
  echo "$THREE_VERSION" > vendor/three/VERSION
  rm -rf "$tmp"
fi

# ---------------------------------------------------------------------------- Matter.js
say "2D physics: Matter.js"
MATTER_VERSION=0.20.0
MATTER_WRAPPER=5 # (one more whenever the module written around it below changes, so every install gets the new one)
if [ -s vendor/matter/matter.esm.js ] && [ "$(cat vendor/matter/VERSION 2>/dev/null)" = "$MATTER_VERSION" ] && [ "$(cat vendor/matter/WRAPPER 2>/dev/null)" = "$MATTER_WRAPPER" ]; then
  echo "already installed"
else
  tmp=$(mktemp -d)
  curl -fsSL "https://registry.npmjs.org/matter-js/-/matter-js-$MATTER_VERSION.tgz" | tar xz -C "$tmp"
  mkdir -p vendor/matter
  # Its browser build is one file for a <script> tag, and creations import modules: so it gets a
  # module to export from around it. Both ways of importing it then work -
  # import Matter from 'matter-js' and import { Engine, Bodies } from 'matter-js'.
  {
    echo "// Matter.js $MATTER_VERSION (build/matter.min.js), as an ES module."
    echo "const module = { exports: {} };"
    echo "(function (module, exports, define) {"
    cat "$tmp/package/build/matter.min.js"
    echo
    cat <<'MODULE'
}).call(globalThis, module, module.exports);
const Matter = module.exports;
export default Matter;
export const { Axes, Bodies, Body, Bounds, Collision, Common, Composite, Composites, Constraint, Contact, Detector, Engine, Events, Grid, Mouse, MouseConstraint, Pair, Pairs, Plugin, Query, Render, Resolver, Runner, SAT, Sleeping, Svg, Vector, Vertices, World } = Matter;
// Most examples written before this version start the engine with Runner.run(engine) or
// Engine.run(engine). This version wants Runner.run(runner, engine) and, handed only an engine,
// runs nothing and says nothing - so here both spellings work.
const run = Runner.run;
Runner.run = Engine.run = (runner, engine) => (engine ? run(runner, engine) : run(Runner.create(), runner));
// A body added to the engine instead of its world - Composite.add(engine, body) - throws from deep
// inside, in the middle of a frame, and the page's loop stops for good. Here it goes into the world.
for (const name of ['add', 'remove', 'clear', 'allBodies', 'allConstraints', 'allComposites']) {
  const was = Composite[name];
  Composite[name] = World[name] = (composite, ...rest) => was(composite && composite.world && !composite.bodies ? composite.world : composite, ...rest);
}

// What has come to rest stays exactly where it is until something really moves it.
// Left to itself, Matter keeps nudging resting things by a fraction of a pixel a step, and a wall of
// bricks laid like a real one creeps apart and falls down by itself, whatever the solver passes:
// measured, a castle of 40 px bricks loses its first brick after 26 s and one of 30 px bricks after
// 4 s. Matter's own sleeping stops that, but a sleeping body is deaf to a push or a throw until it
// is woken, hangs in the air when what it rested on goes away, and has its contacts reported as
// ending and starting again. So here a body that has rested on something for a second is held:
// after every step it is put back where it was, with no speed. It stays in the solver like any
// other body, so nothing about touching it changes, and it is let go - with everything it touches
// or is tied to, and everything those do - as soon as the page moves or pushes it
// (Body.setPosition and the like, or a force), something on the move touches it or is stopped
// by it and sets it going, it no longer touches what it rested on or hangs on what held it (a
// body taken away from under it, a rope cut), what it is tied to pulls it, or gravity changes.
// What touches nothing is never held.
// (What it costs: what gets less than 5 px in a second stops there - a marble on a slope of up to
// half a degree, which plain Matter has rolling at 50 px a second ten seconds later (with the air
// friction the building rules give what must roll, 0.002), and a ball with friction on one of up
// to 5 degrees, which plain Matter moves a pixel or two a second - and a push that doesn't set a
// held body going at 12 px a second in one step can be lost, since it starts every step from
// rest: what comes up against it has to come at 24 px a second if it weighs the same, faster the
// lighter it is (or, turning on the spot, at 14 degrees a second, however big it is), and a
// weight that would move it little by little may not move it at all - a block set down softly
// on the end of a plank balanced on another doesn't tip it, a ball set at rest in the dip between
// two others on ice may not part them. Engine.create({ settling: false }) is plain Matter, and so
// is an engine with Matter's own sleeping switched on. test/matter.html has the tests.)
const REST = 60; // sixtieths of a second a body must be at rest before it is held: a second
const SLOW = 0.2, SLOW_TURN = 0.004; // at rest: slower than this many px and radians a step all that time,
const FAR = 5, FAR_TURN = 0.03; // and no further than this from where that began (or it is going somewhere, slowly);
const SPOT = 0.5, SPOT_TURN = 0.01; // or shaking on the spot: no further than this from where it was
const PUSH = 0.5, PUSH_NO_GRAVITY = 0.05, PUSH_TURN = 0.005; // pulled by what it is tied to: faster than this share of one step of free fall (px a step where nothing falls), or radians a step
const HIT = 1, HIT_TURN = 0.02; // just hit: px and radians a step
const SOON = 3; // sixtieths of a second in which something on the move has left its spot (SPOT / SLOW, and one more)
const states = new WeakMap(); // body -> { x, y, angle, slow, fromX, fromY, fromAngle, spot, held, rested, step, at, tied, pace, turn, came }
const handled = new WeakSet(); // bodies the page itself has just moved, pushed or changed
const pulls = new WeakMap(); // engine -> its gravity as last seen
const settled = new WeakMap(); // engine -> the step it was last settled in
const there = new WeakMap(); // a contact (Matter's pair) or a Constraint -> the last step it was there in
const NO_SPEED = { x: 0, y: 0 };
const put = { position: Body.setPosition, angle: Body.setAngle, velocity: Body.setVelocity, spin: Body.setAngularVelocity };
for (const name of ['setPosition', 'setAngle', 'setVelocity', 'setAngularVelocity', 'setSpeed', 'setAngularSpeed', 'translate', 'rotate', 'scale', 'applyForce', 'setStatic', 'setMass', 'setDensity', 'setInertia', 'setVertices', 'setParts', 'setCentre']) {
  const was = Body[name];
  if (!was) continue;
  Body[name] = function (body) {
    if (body && typeof body === 'object') handled.add(body.parent || body);
    return was.apply(this, arguments);
  };
}
const stateOf = body => states.get(body) || states.set(body, { x: body.position.x, y: body.position.y, angle: body.angle, slow: 0, fromX: 0, fromY: 0, fromAngle: 0, spot: 0, held: false, rested: null, step: 0, at: 0, tied: 0, pace: 0, turn: 0, came: false }).get(body);
let now = 0; // (counts the steps settled: `step` is the last one a body was settled in, `at` the last one it touched something in, `tied` the last one a rope held it in)
const ends = (it, body) => (it.bodyA && (it.bodyA.parent || it.bodyA)) === body || (it.bodyB && (it.bodyB.parent || it.bodyB)) === body;
function settle(engine) {
  // (Switched off: what was held is forgotten, or it would jump back when switched on again.)
  if (engine.settling === false || engine.enableSleeping) return void settled.delete(engine);
  const step = engine.timing.lastDelta;
  if (!step) return; // (no time has passed: nothing has rested either)
  const last = settled.get(engine);
  settled.set(engine, ++now);
  const sixtieths = step / (1000 / 60);
  const bodies = Composite.allBodies(engine.world);
  const gravity = engine.gravity;
  // Gravity changed: everything is let go.
  const pull = `${gravity.x},${gravity.y},${gravity.scale}`;
  const all = pulls.has(engine) && pulls.get(engine) !== pull;
  pulls.set(engine, pull);
  // (body.speed is in px a step of 1/60 s, whatever the step.)
  const fall = Math.hypot(gravity.x, gravity.y) * (gravity.scale ?? 0.001) * step * (1000 / 60);
  const push = fall > 0 ? PUSH * fall : PUSH_NO_GRAVITY;
  // What touches what in this step, and what a rope, a pin or an axle holds (a Constraint, Matter's
  // own mouse constraint included).
  const pairs = engine.pairs.list;
  for (const pair of pairs) {
    if (!pair.isActive || pair.isSensor) continue;
    there.set(pair, now);
    const a = pair.bodyA.parent, b = pair.bodyB.parent;
    if (!a.isStatic) stateOf(a).at = now;
    if (!b.isStatic) stateOf(b).at = now;
  }
  const ties = Composite.allConstraints(engine.world);
  for (const rope of ties) {
    there.set(rope, now);
    if (rope.bodyA && !rope.bodyA.isStatic) stateOf(rope.bodyA.parent || rope.bodyA).tied = now;
    if (rope.bodyB && !rope.bodyB.isStatic) stateOf(rope.bodyB.parent || rope.bodyB).tied = now;
  }
  const loose = []; // what is let go this step, to begin with
  for (const body of bodies) {
    const byHand = handled.delete(body);
    if (body.isStatic) {
      states.delete(body);
      if (byHand) loose.push(body);
      continue;
    }
    const s = stateOf(body);
    // (How fast it came into this step: a hit can stop dead the very thing that hit.)
    s.came = s.pace >= SLOW || s.turn >= SLOW_TURN;
    s.pace = body.speed;
    s.turn = body.angularSpeed;
    // (Not here in the step before: it was out of the world meanwhile, or is new.)
    const back = s.step !== last;
    s.step = now;
    if (byHand || all || back) loose.push(body);
    else if (s.at !== now) {
      // What touches nothing is never held (it would hang in the air), and takes a second to count as at rest again.
      if (s.held) loose.push(body);
      s.slow = s.spot = 0;
    } else if (s.held) {
      // Held, a body goes on touching what it rested on, and hanging on what held it, step after
      // step: if one of those is no longer there, it has gone (what has come to touch it since
      // doesn't count: it may come and go). And only what it is tied to can move it without a
      // touch (the solver's own little starts, in a heap that has come to rest, are not that).
      // A rope can also let go of a body without leaving the world: Matter's own mouse
      // constraint does, when the finger lifts.
      if (s.rested.some(it => there.get(it) !== now || !ends(it, body)) || (s.tied === now && (body.speed > push || body.angularSpeed > PUSH_TURN))) loose.push(body);
    } else {
      if (body.speed < SLOW && body.angularSpeed < SLOW_TURN) {
        if (!s.slow) {
          s.fromX = body.position.x;
          s.fromY = body.position.y;
          s.fromAngle = body.angle;
        }
        s.slow += sixtieths;
      } else {
        // (At rest, and set going just as its second in one place was up, too late to leave its
        // spot before a hold would begin: that second begins again, or the hit would be lost.)
        if (s.slow * 2 >= REST && s.spot + SOON + sixtieths >= REST) s.spot = 0;
        s.slow = 0;
      }
      if (Math.abs(body.position.x - s.x) > SPOT || Math.abs(body.position.y - s.y) > SPOT || Math.abs(body.angle - s.angle) > SPOT_TURN) {
        s.spot = 0;
        s.x = body.position.x;
        s.y = body.position.y;
        s.angle = body.angle;
      } else s.spot += sixtieths;
    }
  }
  // Around each body: what it touches and what it is tied to, and the contacts and ropes
  // themselves (worked out only in a step in which something is hit, let go or begins to be held).
  let around = null;
  const aroundOf = body => {
    if (!around) {
      around = new Map();
      const note = (body, other, it) => {
        let mine = around.get(body);
        if (!mine) around.set(body, (mine = { bodies: [], its: [] }));
        mine.bodies.push(other);
        mine.its.push(it);
      };
      for (const pair of pairs) {
        if (!pair.isActive || pair.isSensor) continue;
        note(pair.bodyA.parent, pair.bodyB.parent, pair);
        note(pair.bodyB.parent, pair.bodyA.parent, pair);
      }
      for (const rope of ties) {
        const a = rope.bodyA && (rope.bodyA.parent || rope.bodyA), b = rope.bodyB && (rope.bodyB.parent || rope.bodyB);
        if (a) note(a, b, rope);
        if (b) note(b, a, rope);
      }
    }
    return around.get(body);
  };
  // Something on the move (fast enough to see, and getting somewhere) lets go of what it touches.
  const moving = body => {
    const s = states.get(body);
    return s && !s.held && s.slow === 0 && s.spot < 3;
  };
  // So does something that came into this step on the move and was stopped in it, if that set
  // going (as fast as "on the move") what it touches, or anything held that leans on that: a ball
  // that hits one of its own weight and bounce stops dead, and of a row of them only the far one
  // leaves. (A box set down on a wall sets nothing going, and the wall stays held: left alone,
  // what is held gets no speed at all from a step.)
  const stopped = body => {
    const s = states.get(body);
    return s && !s.held && s.came && s.spot < 3;
  };
  let calm = null; // held bodies around which nothing was set going, as found in this step
  const shaken = body => {
    if (calm && calm.has(body)) return false;
    const reached = new Set([body]);
    for (const one of reached) {
      if (one.speed >= SLOW || one.angularSpeed >= SLOW_TURN) return true;
      for (const other of aroundOf(one)?.bodies || []) if (other && states.get(other)?.held) reached.add(other);
    }
    if (calm) for (const one of reached) calm.add(one);
    else calm = reached;
    return false;
  };
  // (A hit handed on to something held through a body that is not held yet is still lost:
  // letting go for that too made a castle settle crooked, with all that stops and starts in it
  // while it comes to rest.)
  for (const pair of pairs) {
    if (!pair.isActive || pair.isSensor) continue;
    const a = pair.bodyA.parent, b = pair.bodyB.parent;
    if (states.get(b)?.held && (moving(a) || (stopped(a) && shaken(b)))) loose.push(b);
    else if (states.get(a)?.held && (moving(b) || (stopped(b) && shaken(a)))) loose.push(a);
  }
  // What is let go takes along everything it touches or is tied to, and everything those do.
  const free = new Set(loose);
  for (let i = 0; i < loose.length; i++) {
    for (const other of aroundOf(loose[i])?.bodies || []) {
      if (!other || other.isStatic || free.has(other)) continue;
      free.add(other);
      loose.push(other);
    }
  }
  for (const body of bodies) {
    if (body.isStatic) continue;
    const s = states.get(body);
    if (free.has(body)) {
      s.held = false;
      s.rested = null;
      s.slow = s.spot = 0;
      s.x = body.position.x;
      s.y = body.position.y;
      s.angle = body.angle;
      continue;
    }
    if (!s.held) {
      if (s.spot < REST) {
        if (s.slow < REST) continue;
        // Slow all that time, but it has got somewhere: a seesaw tipping, a block creeping down a ramp.
        if (Math.abs(body.position.x - s.fromX) > FAR || Math.abs(body.position.y - s.fromY) > FAR || Math.abs(body.angle - s.fromAngle) > FAR_TURN) {
          s.slow = 0;
          continue;
        }
      }
      // (Hit in this very step: its place hasn't changed yet, but it is not at rest.)
      if (body.speed > HIT || body.angularSpeed > HIT_TURN) {
        s.slow = s.spot = 0;
        continue;
      }
      s.held = true;
      s.rested = aroundOf(body)?.its || [];
      s.x = body.position.x;
      s.y = body.position.y;
      s.angle = body.angle;
    }
    if (body.position.x !== s.x || body.position.y !== s.y) put.position(body, s);
    if (body.angle !== s.angle) put.angle(body, s.angle);
    put.velocity(body, NO_SPEED);
    put.spin(body, 0);
    body.positionImpulse.x = body.positionImpulse.y = 0; // (nor a shove left over in the solver for the next step)
  }
}
// A force the page wrote straight into a body (body.force.y -= 0.01, in its loop or in its own
// 'beforeUpdate') is the page pushing it too. By 'beforeSolve' a body's force is gravity's own
// and nothing else, unless the page added to it.
function pushed(engine) {
  if (engine.settling === false || engine.enableSleeping) return;
  const gravity = engine.gravity, scale = gravity.scale ?? 0.001;
  const pulls = (gravity.x !== 0 || gravity.y !== 0) && scale !== 0;
  for (const body of Composite.allBodies(engine.world)) {
    if (body.isStatic || body.isSleeping) continue;
    const x = pulls ? body.mass * gravity.x * scale : 0, y = pulls ? body.mass * gravity.y * scale : 0;
    if (body.force.x !== x || body.force.y !== y || body.torque) handled.add(body);
  }
}
// More solver passes than Matter's own 6 and 4, unless a page asks otherwise: things built of many
// pieces hold together better while they are being knocked about and before they are held (that
// castle loses its first brick after 3 s with 6 and 4).
const create = Engine.create;
Engine.create = options => {
  const engine = create({ positionIterations: 10, velocityIterations: 8, ...options });
  Events.on(engine, 'beforeSolve', () => pushed(engine));
  Events.on(engine, 'afterUpdate', () => settle(engine));
  return engine;
};
MODULE
  } > vendor/matter/matter.esm.js.new
  # (Written beside it and moved into place whole: the app may be showing a creation that imports it.)
  mv vendor/matter/matter.esm.js.new vendor/matter/matter.esm.js
  cp "$tmp/package/LICENSE" vendor/matter/
  echo "$MATTER_VERSION" > vendor/matter/VERSION
  echo "$MATTER_WRAPPER" > vendor/matter/WRAPPER
  rm -rf "$tmp"
fi

# ---------------------------------------------------------------------------- AI brains
say "AI brains"
found=0
if have claude || [ -x "$HOME/.local/bin/claude" ]; then
  echo "Claude Code: found - Build Buddy's default brain. If you haven't yet, run 'claude' once and sign in with your Claude account."
  found=1
fi
if have agy || [ -x "$HOME/.local/bin/agy" ]; then
  echo "Antigravity (Gemini): found. If you haven't yet, run 'agy' once and sign in with your Google account."
  found=1
fi
if have codex; then
  echo "Codex: found. If you haven't yet, run 'codex login' and sign in with your ChatGPT account."
  found=1
fi
if [ $found = 0 ]; then
  echo "Install at least one:"
  echo "  Claude Code:  curl -fsSL https://claude.ai/install.sh | bash   (then run 'claude' to sign in) - the default"
  echo "  Antigravity:  from https://antigravity.google (the agy command)  (then run 'agy' to sign in)"
  echo "  Codex:        npm install -g @openai/codex                     (then run 'codex login')"
fi

say "All set! Start it with ./start.sh"
