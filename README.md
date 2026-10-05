# 🤖 Build Buddy

**A full-screen, voice-first "build anything with AI" playground for young kids.**

![License: MIT](https://img.shields.io/badge/license-MIT-blue) ![Node 20+](https://img.shields.io/badge/node-20%2B-green) ![No npm dependencies](https://img.shields.io/badge/npm%20dependencies-none-brightgreen)

The screen starts empty except for a friendly robot named Sparky. Your kid holds the **space bar**,
says what they want ("a red car I can drive around!"), and a few seconds later it's on the screen,
playable. Then they keep going: *"make it blue"*, *"add a honking horn"*, *"now make it 3D"*. That loop
of describing an idea, seeing it, and making it better is the skill Build Buddy teaches: how to build
things with AI.

It runs on your own computer and uses the **Claude or ChatGPT subscription you already have**. Your
kid's voice is understood and spoken on the computer itself, so their voice never leaves it.

| Hold space and talk | Sparky builds it |
|---|---|
| ![Welcome screen with Sparky the robot](docs/welcome.png) | ![A race car game on a road with trees and flowers](docs/car.png) |
| **Keep improving it** (the old version stays playable while the new one builds) | **Real 3D games, at full frame rate** |
| ![The building card at the top of a race car game](docs/building.png) | ![A 3D kart racing game with a jungle track](docs/game-3d.png) |

---

## Contents

- [What a session looks like](#what-a-session-looks-like)
- [Install](#install)
- [Run it](#run-it)
- [Using it](#using-it)
- [Settings](#settings)
- [How it works](#how-it-works)
- [Safety and privacy](#safety-and-privacy)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)
- [Credits](#credits)
- [License](#license)

## What a session looks like

1. **They hold space and talk.** *"I want a rocket ship that flies to the moon!"*
2. **Sparky answers out loud** within a couple of seconds, showing what it understood:
   *"A rocket ship zooming to the moon? Blast off!"* A small card at the top shows it's building.
3. **It appears** with a ta-da sound, and Sparky explains how to play: *"Click anywhere to blast off!"*
4. **Sparky suggests one small next step:** *"Should we add a little alien waving on the moon?"*
5. **They keep building.** Changes take a few seconds. If they don't like something, the back
   button undoes it.

## Install

You need:

- **Node.js 20 or newer** ([nodejs.org](https://nodejs.org))
- **Google Chrome, Chromium, Edge or Brave**
- **At least one AI "brain"**, signed in once:
  - **Claude:** install [Claude Code](https://claude.com/claude-code), then run `claude` once and sign in with your Claude account.
  - **ChatGPT:** install Codex (`npm install -g @openai/codex`), then run `codex login` with your ChatGPT account.
- To build the speech recognizer: `git`, `cmake` and a C++ compiler (on a Mac, `brew install whisper-cpp` instead).

Then:

```bash
git clone https://github.com/F286/build-buddy.git
cd build-buddy
./setup.sh
```

`setup.sh` puts everything in `./vendor`, about 1.2 GB, and installs nothing system-wide. Running it again is safe. It sets up:

| | What it is | Size |
|---|---|---|
| whisper.cpp + `small.en` | Speech-to-text (Sparky's ears) | ~500 MB |
| Kokoro (via sherpa-onnx) | Natural-sounding voice (Sparky's voice) | ~460 MB |
| Piper | Faster, more robotic backup voice | ~110 MB |
| Three.js | 3D engine creations can use | ~17 MB |

## Run it

```bash
./start.sh                  # full screen; close the window to quit
./start.sh --window         # in a normal window, for grown-ups trying it out
./start.sh --no-browser     # just the server; open http://127.0.0.1:4321 yourself
./start.sh --window --debug # also lets Chrome DevTools tools attach on port 9222
```

**Grown-up controls:** press **Ctrl+Shift+P** for settings (AI brain, voice, names), the current
creation's frame rate, and the **Quit** button. Press **Enter** to type a request instead of talking.

**Add it to your app launcher (Linux):** run `./install-launcher.sh`, then find *Build Buddy* in your
launcher. On Omarchy, press Super+Space and type `build`. If it's already open, the launcher jumps to
the open window instead of starting a second copy. `./install-launcher.sh --remove` takes it out again.

**Start it when the computer logs in:** on Omarchy/Hyprland, add
`o.launch_on_start("/path/to/build-buddy/start.sh")` to `~/.config/hypr/autostart.lua`. On other
Linux desktops, add a `start.sh` entry to your startup applications. On macOS, add it under Login Items.

## Using it

| On screen | What it does |
|---|---|
| 🎤 big red button, or the **space bar** | Hold and talk, walkie-talkie style. Or tap once: it stops listening when they pause. |
| ↩️ yellow | Go back one step. Every version is kept, so nothing is ever lost. |
| ⭐ purple | *My creations*: everything they've made, by emoji and name. |
| ➕ teal | A fresh new page. The old one stays in *My creations*. |
| 🤖 Sparky | Says what it understood straight away, then how to play, then one small idea for what to add next. |

Things to try: *a piano with rainbow keys*, *a fish tank where I can feed the fish*, *a dinosaur
that dances when I click it*, *a 3D racing game*, *make it faster*, *add a second player*, *make the
sky night time*. Sparky is told to keep everything friendly. Monsters come out goofy and zaps turn
into confetti.

## Settings

Put your settings in `config.json` (start from [`config.example.json`](config.example.json)). Anything
you leave out uses the defaults in [`server/config.mjs`](server/config.mjs). The AI brain, models,
voice and names can also be changed from the Ctrl+Shift+P panel.

| Setting | Default | What it does |
|---|---|---|
| `kidName` | `""` | Sparky greets them by name. |
| `kidAge` | `5` | Sparky pitches words and games to this age. |
| `buddyName` | `"Sparky"` | The robot's name. |
| `backends` | `["claude", "codex"]` | Which AI to use, in order. If the first fails (offline, usage limit), the next takes over. |
| `claude.model` / `claude.effort` | `"sonnet"` / `"low"` | Model and effort for Claude Code. |
| `codex.model` / `codex.reasoning` | Codex default / `"low"` | Model and reasoning effort for Codex. |
| `command.cmd` / `command.args` | | Any program that reads a prompt on stdin and prints a reply, e.g. `"ollama"`, `["run", "qwen3"]`. Use it with `"backends": ["command"]`. |
| `stt` | `"whisper"` | Speech-to-text: `whisper` (on this computer), or `browser` (Chrome's online speech service; macOS/Windows Chrome only). |
| `tts` | `"kokoro"` | Voice: `kokoro` (natural), `piper` (faster), `browser` (the system's voices), or `off`. |
| `kokoro.voice` / `kokoro.speed` | `"af_heart"` / `1.0` | One of 28 English voices; preview them in the Ctrl+Shift+P panel. |
| `unmuteMic` | `true` | Linux: switch the microphone on at startup if it's muted in the system settings. |
| `keepOpen` | `false` | Kid-proof mode: reopen the window if it's closed. Quit with Ctrl+Shift+P instead. |
| `port` | `4321` | Local port for the app. |
| `browser` | auto | Path to the browser, if it isn't found automatically. |

**API keys instead of subscriptions:** the `claude` and `codex` CLIs accept API keys too
(`ANTHROPIC_API_KEY`, or `printenv OPENAI_API_KEY | codex login --with-api-key`). Nothing in Build
Buddy changes.

## How it works

```
 kid talks ──► whisper.cpp ──► Claude Code or Codex CLI ──► web page on the stage ──► Kokoro voice
 (space bar)   (on device)      (your subscription)           (sandboxed iframe)       (on device)
```

- **Each creation is one web page** (HTML, CSS and JavaScript). That's the format AI models write
  most fluently, and it covers what kids ask for: drawings, animations, games, music, toys and
  stories. For 3D, the app ships [Three.js](https://threejs.org), so 3D games run on the GPU. Without
  it, the AI hand-draws "3D" on a 2D canvas: a test kart game ran at 7 fps that way, and at 120 fps
  with Three.js.
- **Your subscription is the brain.** Build Buddy runs the official `claude` or `codex` command-line
  tools in non-interactive mode on your computer, so each request counts against your plan's normal
  usage, just as if you'd typed it yourself. It doesn't extract or reuse login tokens.
- **Fast feedback.** With Claude, the AI's first sentence is spoken while the rest is still being written.
  Small changes come back as find-and-replace edits instead of a whole new page, and Sparky speaks
  sentence by sentence, preparing the next one while the current one plays.
- **It fixes its own mistakes.** If a creation crashes, Sparky says *"Oops! Let me fix a wobbly bit"*
  and asks the AI to fix it, at most twice in a row.
- **Smooth by default.** The AI follows a short performance checklist, and creations render at no
  more than 1.5× pixel density, so sharp screens don't quadruple the work.

## Safety and privacy

- **Hard to break.** In full-screen mode there's no address bar, tabs or menus. With
  `"keepOpen": true` the window also reopens if it's closed, so only Ctrl+Shift+P → Quit stops it. Space and Enter always belong to the app, even while a game has focus.
  Every version is saved, so a restart picks up where they left off.
- **Creations are sandboxed.** They can't reach the internet, open windows, navigate away, store
  anything, or touch the rest of the app. The only thing they can load is the bundled Three.js.
- **What leaves your computer:** only the text of each request, plus the current creation's code,
  sent to Claude or ChatGPT. Listening and speaking happen on the computer itself.
- **What's kept:** creations, conversations and a log live in `data/` on your computer.
  `data/log.txt` shows every request: what was heard, which AI answered, and how long it took.
- **Kid-friendly by instruction.** Sparky is told to keep everything friendly and age-appropriate,
  but it's still an AI. Sit with them the first few times.

## Troubleshooting

| Problem | What to check |
|---|---|
| **Sparky can't hear** | Usually the microphone is muted in the system settings, so the app receives silence. On Linux the app switches it on at startup; if it gets muted mid-session, Sparky says *"My ears are turned off!"* Each recording is logged in `data/log.txt` as a `HEAR` line with its length, loudness and what was understood. |
| **No voice** | Check the system volume, and the *Talking* line in the Ctrl+Shift+P panel. If Kokoro isn't installed, Sparky falls back to Piper. |
| **"My brain got a little tangled"** | The AI request failed. Check `data/log.txt`. Common causes are being offline, a usage limit, or needing to sign in to `claude` / `codex` again. |
| **A game feels slow** | Ctrl+Shift+P shows its frame rate. Asking Sparky to *"make it simpler"* or *"make it faster"* helps. For 3D, Sparky should be using Three.js. |
| **"Port 4321 is busy"** | Build Buddy is already running, or set a different `port` in `config.json`. |

**Platforms:** developed on Linux (Arch Linux ARM on Apple Silicon, Hyprland, Chromium). macOS
should work the same way with Chrome. On Windows the app itself runs (Node finds Chrome or Edge),
but `setup.sh` needs WSL, or use `"stt": "browser", "tts": "browser"` with Chrome.

## Project layout

```
server/main.mjs      web server, API, full-screen browser launcher
server/ai.mjs        Sparky's instructions, AI backends (claude / codex / command), reply parsing
server/speech.mjs    whisper.cpp (listening), Kokoro and Piper (talking)
server/store.mjs     creations and their versions, saved in data/projects/
server/config.mjs    settings and their defaults
public/              the kid-facing screen
public/stage-shim.js runs inside every creation: crash reports, talk keys, sound muting
setup.sh             downloads and builds everything in vendor/
start.sh             starts the app
install-launcher.sh  adds Build Buddy to your Linux app launcher
```

No dependencies to `npm install`. The server uses only Node's standard library.

## Credits

Build Buddy stands on these projects (downloaded by `setup.sh`, not included in this repository):

- [whisper.cpp](https://github.com/ggml-org/whisper.cpp), speech-to-text (MIT)
- [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), natural voice (Apache 2.0), run with [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache 2.0)
- [Piper](https://github.com/rhasspy/piper), backup voice (MIT); each voice model has its own license
- [Three.js](https://threejs.org), 3D engine (MIT)
- [Fredoka](https://fonts.google.com/specimen/Fredoka), the rounded font (SIL Open Font License, included in `public/fonts`)

## License

[MIT](LICENSE): free to use, copy, change and share, for any purpose. The projects listed under
[Credits](#credits) keep their own licenses.
