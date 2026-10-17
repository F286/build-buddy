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

# ---------------------------------------------------------------------------- Phaser
say "2D game engine: Phaser"
PHASER_VERSION=4.2.1
if [ -s vendor/phaser/phaser.esm.min.js ]; then
  echo "already installed"
else
  tmp=$(mktemp -d)
  curl -fsSL "https://registry.npmjs.org/phaser/-/phaser-$PHASER_VERSION.tgz" | tar xz -C "$tmp"
  mkdir -p vendor/phaser
  cp "$tmp/package/dist/phaser.esm.min.js" "$tmp/package/LICENSE.md" vendor/phaser/
  echo "$PHASER_VERSION" > vendor/phaser/VERSION
  rm -rf "$tmp"
fi

# ---------------------------------------------------------------------------- AI brains
say "AI brains"
found=0
if have claude || [ -x "$HOME/.local/bin/claude" ]; then
  echo "Claude Code: found. If you haven't yet, run 'claude' once and sign in with your Claude account."
  found=1
fi
if have codex; then
  echo "Codex: found. If you haven't yet, run 'codex login' and sign in with your ChatGPT account."
  found=1
fi
if [ $found = 0 ]; then
  echo "Install at least one:"
  echo "  Claude Code:  curl -fsSL https://claude.ai/install.sh | bash   (then run 'claude' to sign in)"
  echo "  Codex:        npm install -g @openai/codex                     (then run 'codex login')"
fi

say "All set! Start it with ./start.sh"
