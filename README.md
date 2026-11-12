# 🤖 Build Buddy

**A full-screen, voice-first "build anything with AI" playground for young kids.**

![License: MIT](https://img.shields.io/badge/license-MIT-blue) ![Node 20+](https://img.shields.io/badge/node-20%2B-green) ![No npm dependencies](https://img.shields.io/badge/npm%20dependencies-none-brightgreen)

The screen starts empty except for a friendly robot named Sparky. Your kid holds the **space bar**,
says what they want ("a red car I can drive around!"), and a few seconds later it's on the screen,
playable. Then they keep going: *"make it blue"*, *"add a honking horn"*, *"now make it 3D"*. That loop
of describing an idea, seeing it, and making it better is the skill Build Buddy teaches: how to build
things with AI. Whatever they ask for comes out as a little world that works: a simulation they can
poke and watch, with a spark of joy, and a game only when they ask for one.

It runs on your own computer and uses the AI you already have: **your Claude or ChatGPT
subscription, or your Google account through Antigravity (Gemini)**. Your kid's voice is understood
and spoken on the computer itself, so their voice never leaves it.

| Hold space and talk | Sparky builds it |
|---|---|
| ![Welcome screen with Sparky the robot](docs/welcome.png) | ![A red car to drive on a road with trees and flowers](docs/car.png) |
| **Keep improving it** (the old version stays playable while the new one builds) | **Real 3D games, at full frame rate** |
| ![The building card at the top of a race car game](docs/building.png) | ![A 3D kart racing game with a jungle track](docs/game-3d.png) |

---

## Contents

- [What it makes: little worlds that work](#what-it-makes-little-worlds-that-work)
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

## What it makes: little worlds that work

The aim of every creation is an interactive simulation with a spark of joy, not necessarily a game.
Whatever a kid asks for becomes a little world that works:

- **It works like the real thing,** simplified, playful and quick. A garden's seeds need water and
  sun, a volcano's pressure builds before it blows, and gears side by side turn opposite ways. Each
  creation is built on the 2 or 3 real rules that make it what it is.
- **It's already going when it appears,** with everything they asked for in plain view, and the
  first thing they try does what they asked for. The rules make it richer; they never stand in
  the way.
- **Poke it and watch what happens.** The kid acts on the things themselves (drag the watering can,
  tap the cloud, steer the car), not on a row of buttons, and each poke sets off the next thing:
  water the seed, it sprouts, then it flowers. A tap or a drag can do anything the arrow keys do,
  and amounts show as pictures (a water line, a growing pile), never as words or numbers to read.
- **It keeps going on its own.** Things grow, flow, get hungry and sleepy, windmills turn,
  characters blink and breathe, and the place sways, drifts and twinkles. Left alone, it's still
  worth watching.
- **There's something to discover** by trying "what happens if...?" (more, faster, two things mixed,
  a long wait), and a peek inside where the real thing has a hidden inside. Sparky never points them
  out: they're for finding.
- **A spark of joy.** Everyone in it notices what happens and reacts, whatever the kid taps answers
  in its own way, and what they set going ends in one big happy moment. Results are silly but true
  (too much soap and the bath foams over), and only kind truths are told: nobody gets hurt, and needs
  never turn into suffering (a hungry fish nibbles the plants by itself). Extremes settle back (an
  overflowing bath drains, a too-hot pot cools), but what the kid grew or built stays, and adds up
  to something new by the world's own rules (well-fed hens lay an egg that hatches), never to a
  score.
- **Not necessarily a game.** There's no score, goal or timer unless the kid asks for a game, and
  then the game is built on a world that works: the race car slows on the grass and drifts in
  tight turns.

What the kid says always wins over realism (their flying car flies; it just runs low on fuel), and
the ideas stay theirs: the world's rules come from what they asked for, never from big new things
Sparky adds. All three ways of building are told this. In team and solo mode, the passes after a
creation appears also look for it: does poking its main things set something off, does it keep going
on its own (team mode's checker, tester and polisher, and solo mode's test pass), and is there
something to find (team mode's tester and solo mode's test pass). They know what counts as asking
for a game, so a car to drive doesn't quietly turn into a race; after a change, they're told what
the kid asked for earlier, so a game stays a game and a river the kid made run uphill stays theirs.
None of them gives away what's there to find. Solo mode's test pass also plays it a few minutes
ahead in its head, looking for anything that gets stuck, piles up or never stops.

Asked for "a hamster with a little house and a running wheel", for example, it builds a hamster that
runs in its wheel until it's tired, then naps in its house; seeds the kid drops get stuffed into its
cheeks and carried home, and the stash grows sunflowers. Asked for "a beehive where the bees make
honey", the bees drink flowers dry (they slowly fill back up), carry the nectar home and fill the
cells, and a full hive brings a jar of honey and a new baby bee.

### How it measured

Creations made this way were compared, blind, with ones made from the same requests by the earlier
prompts, which planned a game: one clear thing to do, a reward every time and a goal that grows.
Claude, judging as a demanding parent who loves toys that show kids how the world works, looked at
each pair side by side (two screenshots, the code and its errors), each pair twice with the two
shown in both orders, and scored both out of 10 on how much it is a little world that works, what
there is to discover, its spark of joy, whether it's what was asked, whether it's easy for a
5-year-old, and how solid it is.

- **Requests no example in the prompts mentions** (a beehive, a marble run, a hamster with a wheel,
  a pirate ship, a caterpillar that turns into a butterfly, a treehouse with a slide, a basketball
  game and a bubble machine): solo mode's little worlds won 15 of 16 judgments, 10 of them clearly.
  A world that works went from 5.3 to 7.6, something to discover from 5.5 to 7.3, the spark of joy
  from 7.0 to 7.6, what they asked for from 7.8 to 8.4 and easy for a 5-year-old from 7.4 to 7.9;
  solid stayed level (7.4 and 7.3).
- **The twelve test requests** the earlier prompts were tuned on: solo mode won 19 of 24, and a world
  that works went from 5.4 to 6.8, though joy went from 7.5 to 7.0 and solid from 7.5 to 6.8.
  Racing is where the earlier prompts still win: their 3D kart race, with three animal rivals, gems
  and a rainbow, won both its judgments.
- **On the general scale** used in the rest of this README (each creation scored alone, 10 = nothing
  noticeably wrong), solo mode's creations averaged 7.4 on the new requests, against 7.1 with the
  earlier prompts, and 7.3 on the twelve test requests, against 7.75.
- **Team mode, on the same eight new requests:** its little worlds won 14 of 16 judgments, 11 of
  them clearly. A world that works went from 5.1 to 7.4, something to discover from 4.8 to 6.9, joy
  from 7.0 to 7.2, what they asked for from 7.7 to 8.1 and solid from 7.6 to 7.8; easy for a
  5-year-old went from 8.1 to 7.6. On that general scale they averaged 7.6, against 7.5 with the
  earlier prompts.
- **Just as quick:** the heart of a solo creation was on screen after 22.5 s on average, and after
  28 s at most.

Together, these parts earn their place. A first version of these rules had the working world but not
the parts that make it a delight (already going, everyone reacting, a big happy moment, things
adding up, a finger doing what the arrow keys do) or the test pass's look a few minutes ahead. On
the new requests, in solo mode, its creations scored lower on every count, most of all on what was
asked for (7.0 against 8.5) and on being a world that works (5.9 against 7.3), and today's version
won all 16 judgments against it, 9 of them clearly.

## What a session looks like

1. **They hold space and talk.** *"I want a rocket ship that flies to the moon!"*
2. **Sparky answers out loud** within a couple of seconds, showing what it understood:
   *"A rocket ship zooming to the moon? Blast off!"* A small card at the top shows it's building.
3. **It appears** with a ta-da sound, and Sparky explains how to play: *"Click anywhere to blast off!"*
4. **The next idea is theirs.** Sparky never suggests what to add. At most it asks *"What's next?"*,
   so they learn to come up with ideas and put them into words, instead of just saying yes or no.
5. **They keep building, without starting over.** Changes take a few seconds and slot into what
   they're playing: where they were and what they made come back. If they don't like something,
   the back button undoes it.
6. **A careful helper keeps watch.** Once they've played for a bit, a careful AI looks at what they
   made and quietly fixes it if it's broken or stuck.

## Install

You need:

- **Node.js 20 or newer** ([nodejs.org](https://nodejs.org))
- **Google Chrome, Chromium, Edge or Brave**
- **At least one AI "brain"**, signed in once (Build Buddy uses the first one installed, in this order):
  - **Claude** (the default): install [Claude Code](https://claude.com/claude-code), then run `claude` once and sign in with your Claude account. It builds with its own ways of building ([the agent way](#team-mode-the-agent-way) by default).
  - **Gemini:** install Google's Antigravity CLI (`agy`, from [antigravity.google](https://antigravity.google)), then run `agy` once and sign in with your Google account. It takes over if Claude fails (offline, out of usage), and leads if `claude` isn't installed - then one Argon writes each creation (the classic way).
  - **ChatGPT:** install Codex (`npm install -g @openai/codex`), then run `codex login` with your ChatGPT account.
- To build the speech recognizer: `git`, `cmake` and a C++ compiler (on a Mac, `brew install whisper-cpp` instead).
  Optional: `WHISPER_GPU=1 ./setup.sh` also builds the GPU version (on Linux it needs Vulkan drivers
  and `glslc`) and fetches the larger speech model; see `whisper.gpu` below.

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
| Parakeet TDT 0.6B v2 | A second speech recognizer, listening alongside whisper | ~660 MB |
| Kokoro (via sherpa-onnx) | Natural-sounding voice (Sparky's voice) | ~460 MB |
| Piper | Faster, more robotic backup voice | ~110 MB |
| Phaser | 2D game engine creations can use | ~1.4 MB |
| Three.js | 3D engine creations can use | ~17 MB |

## Run it

```bash
./start.sh                  # full screen; close the window to quit
./start.sh --window         # in a normal window, for grown-ups trying it out
./start.sh --no-browser     # just the server; open http://127.0.0.1:4321 yourself
./start.sh --window --debug # also lets Chrome DevTools tools attach on port 9222
./start.sh --classic        # one AI writes each creation by itself, instead of a team (see Team mode)
./start.sh --solo           # Claude first: one Claude that remembers the creation and keeps improving it (see Solo mode)
./start.sh --agents         # Claude first: a team led by one Claude that remembers it (see Team mode, the agent way)
./start.sh --direct         # Claude first: the same team with direct helpers - quicker, and new (see Team mode, the agent way)
./start.sh --team           # Claude first: team mode's usual way
```

**Grown-up controls:** press **Ctrl+Shift+P** for settings (time limit, AI brain, how Claude builds, voice, names), the
current creation's frame rate, and the **Quit** button. Press **Enter** to type a request instead of
talking.

**Time limit:** pick one at the top of the Ctrl+Shift+P panel (2 to 60 minutes) and press Save; the
countdown starts then. For the last minute a clock counts down in the corner and Sparky gets
sleepy: *"One more minute! I'm getting sleepy..."*, then heavy eyelids, a yawn or two, and nodding
off in the last seconds. When it runs out, Sparky perks up: *"Time's up! You can ask me for one last
thing!"* For 30 seconds (a green clock in the corner) they can ask for one last thing - once they've
started saying it, it counts - and it's built, after whatever was still building. Then, either way,
one more minute just to play with it (no more asking), with Sparky getting sleepy all over again.
Then the creation is put away and Sparky says good night on the *"Time's up!"* screen, yawns, falls asleep under a night sky with Zs floating up, and says *"I'm
sleeping now."* Poke it (a tap or the space bar) and it wriggles and mumbles *"Shhh... I'm
sleeping."* The screen stays until a grown-up opens the panel again and adds time or picks *No
limit*, and Sparky wakes up (*"Oh! I'm awake! More time!"*). Their progress in the creation is kept
for when it comes back. If time runs out while they're still asking for something (still
talking, or Sparky is still building), nothing gets cut off: Sparky finishes it, and they get one
more minute to play with it, but can't ask for anything new.
Time spent fixing a wobbly bit (a creation that crashed) isn't counted. The limit is off unless a grown-up turns it on here; kids can't set
it by asking Sparky. Closing and reopening the app doesn't get around it, but if the app is started
half an hour or more after the time ran out, it starts with no limit.

**Add it to your app launcher (Linux):** run `./install-launcher.sh`, then find *Build Buddy* in your
launcher. On Omarchy, press Super+Space and type `build`. If it's already open, the launcher jumps to
the open window instead of starting a second copy. If a copy is still running without its window,
starting Build Buddy again closes that copy and opens a fresh one. `./install-launcher.sh --remove`
takes it out again.

**Start it when the computer logs in:** on Omarchy/Hyprland, add
`o.launch_on_start("/path/to/build-buddy/start.sh")` to `~/.config/hypr/autostart.lua`. On other
Linux desktops, add a `start.sh` entry to your startup applications. On macOS, add it under Login Items.

## Using it

| On screen | What it does |
|---|---|
| 🎤 big red button, or the **space bar** | Hold and talk, walkie-talkie style. Or tap once: it stops listening when they pause. Listening starts half a second *before* the key goes down and carries on for a moment after it's let go, so first and last words aren't clipped. |
| ↩️ yellow | Go back one step. Every version is kept, so nothing is ever lost. |
| ⭐ purple | *My creations*: everything they've made, by emoji and name. Hidden until a grown-up turns it on in the Ctrl+Shift+P panel. |
| ➕ teal | A fresh new page. The old one stays in *My creations*. |
| 🤖 Sparky | Says what it understood straight away, then how to play. It never suggests ideas; those come from the kid. |

Things to try: *a piano with rainbow keys*, *a fish tank where I can feed the fish*, *a dinosaur
that dances when I click it*, *a 3D racing game*, *make it faster*, *add a second player*, *make the
sky night time*. Sparky follows what the kid asks for as closely as it can and censors it as little
as it can: potty humor is fine (*a poop that farts*, *a dinosaur with diarrhea*) - built gladly,
said back in their own words, never added when they didn't ask for it. It stays friendly: monsters
come out goofy and zaps turn into confetti, and there are no swear words, nothing sexual and nothing
mean about a real person.

## Settings

Put your settings in `config.json` (start from [`config.example.json`](config.example.json)). Anything
you leave out uses the defaults in [`server/config.mjs`](server/config.mjs). The AI brain, models,
voice and names can also be changed from the Ctrl+Shift+P panel.

| Setting | Default | What it does |
|---|---|---|
| `kidName` | `""` | Sparky greets them by name. |
| `kidAge` | `5` | Sparky pitches words and games to this age. |
| `buddyName` | `"Sparky"` | The robot's name. |
| `backends` | `["claude", "agy", "codex"]` | Which AI to use, in order (`claude`, `agy`, `codex`, `command`). The first one installed leads: Claude by default, or Gemini (`agy`) if `claude` isn't installed. If it fails (offline, usage limit), the next takes over. Also in the panel as *AI brain*. |
| `claude.model` / `claude.effort` | `"opus"` / `"low"` | Model and effort for Claude Code: `"opus"`, `"fable"`, `"sonnet"` or any model name Claude Code takes. Opus makes richer, more varied creations; `"sonnet"` is a little faster for big new ones. `"fable"` (Claude Fable, the most capable) leads fuller creations but the kid waits longer and it uses more of your plan: in one test of the agent way, the same garden took 103 s with Fable leading against 61 s with Opus. Also in the panel as *Claude model*. |
| `claude.fast` | `false` | Claude's [fast mode](https://code.claude.com/docs/en/fast-mode) for building: the same model, answering much sooner. On a Claude subscription it's paid from extra usage credits; with none left it quietly runs at normal speed, and the Ctrl+Shift+P panel says why. Also in the panel as *Claude speed*. |
| `team.enabled` | `true` | [Team mode](#team-mode): a lead and a team of Claude helpers build each creation together. `false` is the classic way: one AI writes it all. Also in the panel as *How Claude builds*, and for one run with `./start.sh --classic` or `--team` (which puts Claude first for that run). Used when Claude leads (the first installed brain in `backends`). |
| `team.helpers` | `6` | The most helpers working on one creation at a time (1 to 8). |
| `team.leads` | `3` | How many leads start on each request at once (1 to 3). How long a lead takes before it starts writing varies a lot, so the first one to start a plan is used and the others stop: it saves the slow starts, for a little more of your plan. |
| `team.lead` / `team.helper` / `team.fixer` / `team.checker` / `team.polisher` / `team.tester` / `team.voice` / `team.sketch` | see [Team mode](#team-mode) | How each member of the team runs Claude Code: `model`, `effort`, `fast`, `advisor` and `args`. |
| `team.firstLook` | `false` | For something new, a quick sketch of it is on screen within seconds, and the kid can play with it until the team's version replaces it. Off by default: the sketch takes the place of what was on screen, which can feel like a reset. |
| `team.check` | `true` | Right after a creation appears, the checker takes a careful look and its fixes slide in at a calm moment. |
| `team.polish` | `2` | After the check, how many times the polisher gives it finishing touches (`false` for none). Each pass costs no waiting: the creation is already on screen, and the touches slide in like the check's fixes. |
| `team.warm` | `true` | Start the team's programs while the kid is still talking, so none of them has to start up once the request arrives. |
| `team.agents` | `true` | [The agent way](#team-mode-the-agent-way): team mode led by one Claude that keeps the creation in mind, hands its parts to helpers and makes them fit, then grows and polishes it while the kid plays. `false` is team mode's usual way. Also in the panel as *How Claude builds*, and for one run with `./start.sh --agents` (or `--direct`, or `--team`). |
| `team.agentHelpers` | `"subagents"` | Who writes the agent way's parts. `"subagents"`: Claude Code's subagents, which the lead calls one after another. `"direct"`: [direct helpers](#with-direct-helpers-new) - programs of Build Buddy's own, each started on its part the moment the lead has written that part's job; in test runs something new appeared in about two thirds of the time. In the panel as *The same team with direct helpers*, and for one run with `./start.sh --direct`. |
| `team.peek` | `true` | With direct helpers: before something new or a big change is shown, the app runs it out of sight for a moment and the lead is handed a screenshot of it (and any error it threw) together with its helpers' parts - so a school drawn black, a car hidden under a cloud or people cut off at the edge are fixed before the kid sees them. It takes a second or two with a graphics card. Without one, photographing a page can take many seconds and hold the app up meanwhile, so after one peek that takes longer than about two and a half seconds or brings no picture back, it isn't asked for again until Build Buddy restarts. `data/log.txt` says how long each one took. |
| `team.agentLead` | `claude.model` / `claude.effort`, thinking `{ "build": 1500, "fit": 700, "look": 10000 }` | How the agent way's lead runs Claude Code (`model`, `effort`, `fast`, `args`), and how long it may think while the kid waits (`build`), when it's handed the parts to make them fit (`fit`, with direct helpers) and when it looks its creation over (`look`). Opus 5.5 and Sonnet 5.5 decide for themselves how long to think whatever these say, so the lead's instructions ask it to start writing at once. `firstModel` can lead the turn that makes something new with another model (the main one takes over after); Sonnet there was no quicker, so it's off. |
| `team.agentHelper.model` | `"sonnet"` | The model the agent way's helpers write their parts with, as an alias: `sonnet`, `opus`, `haiku` or `fable`. Haiku writes half again as fast (532 characters a second against 336), but its parts were plainly weaker - a ramp the wrong shape, a word on a sign, things in the wrong band of the screen - so Sonnet stays. |
| `solo.enabled` | `false` | [Solo mode](#solo-mode): one Claude builds each creation and remembers it, with no team. It comes before team mode when both are on. Also in the panel as *How Claude builds*, and for one run with `./start.sh --solo` (which puts Claude first for that run). Used when Claude leads. |
| `solo.polish` | `3` | How many passes it makes over a creation while the kid plays, 1 to 4 (`false` for none): after something new, it grows it, then makes it beautiful, then looks again (with 4, looks again twice); after a change, every pass looks again. |
| `solo.model` / `solo.effort` / `solo.fast` / `solo.args` | your `claude.model` / `claude.effort` / `claude.fast` | How solo mode runs Claude Code. |
| `solo.firstModel` | `"sonnet"` | The quicker model that writes a new creation on a fresh page while the kid waits; the same session then switches to the main model (`solo.model`, or `claude.model`) for its passes, the kid's changes and repairs. `""` uses the main model for everything. |
| `solo.thinking` | `{ "build": 2000, "look": 12000 }` | How long it may think (in tokens) while the kid waits, and when it goes back to a creation while they play. |
| `whisper.model` / `whisper.gpu` | `"small.en"` / `false` | Speech model, and whether it may use the GPU. `{ "model": "large-v3-turbo-q5_0", "gpu": true }` makes about a quarter fewer mistakes with little kids (after `WHISPER_GPU=1 ./setup.sh`), but games stutter for a moment after each request while it uses the GPU. |
| `codex.model` / `codex.reasoning` | Codex default / `"low"` | Model and reasoning effort for Codex. |
| `agy.model` | `"gemini-4-argon-low"` | Model for Antigravity (`agy`): any id `agy models` lists (Gemini 4 Argon at low, medium or high effort, Gemini Flash, ...). When Gemini leads, one Argon writes each creation (the classic way: see [Gemini through Antigravity](#gemini-through-antigravity)); also in the panel as *AI brain* and *Gemini model*. While the kid talks, agy and its voice are started and wait (starting one takes about 3 s), and a quick model says Sparky's first line while it builds (see `agy.voiceModel`). Medium effort scored the same and wasn't quicker; a `-medium` or `-high` model thinks before it writes (Flash medium wrote nothing for 38 s). agy runs in an empty folder of its own, outside Build Buddy's, with its strictest permissions and a sandboxed terminal, and is only asked for text: it can't run commands or read or write files outside that folder (it could still search the web). |
| `agy.voiceModel` | `"gemini-3.8-flash-low"` | The quick model that says Sparky's first line out loud while agy builds, with team mode's voice instructions: about 2 to 3 s, against 5 to 12 s for the builder's own first line. `""` lets the builder's own first line be said. |
| `agy.keepHistory` | `false` | agy keeps every run as a conversation (in its list and on your phone, about half a megabyte each). Build Buddy's runs use an agy home of their own (`data/agy-home`, sharing only your sign-in), so they're never listed with yours, and runs over an hour old are cleared out of it. `true` runs them in your own agy home. |
| `command.cmd` / `command.args` | | Any program that reads a prompt on stdin and prints a reply, e.g. `"ollama"`, `["run", "qwen3"]`. Use it with `"backends": ["command"]`. |
| `stt` | `"both"` | Speech-to-text: `both` (whisper and Parakeet together, the AI gets both versions), `whisper`, `parakeet`, or `browser` (Chrome's online speech service; macOS/Windows Chrome only). |
| `tts` | `"kokoro"` | Voice: `kokoro` (natural), `piper` (faster), `browser` (the system's voices), or `off`. |
| `kokoro.voice` / `kokoro.speed` | `"af_heart"` / `1.0` | One of 28 English voices; preview them in the Ctrl+Shift+P panel. |
| `watch.enabled` | `true` | The overwatch: a careful AI that checks on the game while they play and fixes it if it's broken or stuck (Claude or Codex if one is listed, looking at a screenshot; with agy alone, Argon, judging from the page). |
| `watch.model` / `watch.effort` | `"opus"` / `"medium"` | Model and effort for the overwatch (with Claude; with Codex it uses high reasoning). |
| `watch.agyModel` | `"gemini-4-argon-low"` | The overwatch's model when agy is the only brain it can use (with Claude or Codex listed too, they watch: they can look at the screenshot). agy can't be shown the screenshot, so it judges from the page and how it's running (frame rate, errors, kept values, a blank screen). Argon high took 1 to 5 minutes a look, and hit the 5-minute limit once in 4. |
| `watch.firstAfterSec` / `watch.everySec` | `25` / `180` | First check after this much play, then this often while they keep playing the same version. |
| `creationsButton` | `false` | Show the ⭐ *My creations* button, so the kid can go back to anything they've made. Also in the Ctrl+Shift+P panel. |
| `unmuteMic` | `true` | Linux: switch the microphone on at startup if it's muted in the system settings. |
| `keepOpen` | `false` | Kid-proof mode: reopen the window if it's closed. Quit with Ctrl+Shift+P instead. |
| `port` | `4321` | Local port for the app. |
| `browser` | auto | Path to the browser, if it isn't found automatically. |

### Gemini through Antigravity

With Gemini first (`"backends": ["agy", "claude", "codex"]`, *Gemini (Antigravity), then Claude, then
ChatGPT* in the Ctrl+Shift+P panel), or without `claude` installed, Gemini 4 Argon builds every
creation through Google's Antigravity CLI: one Argon writes the whole page (the classic way - team
mode, solo mode and the agent way are Claude's), and the next brain takes over if it fails. Sparky
still answers out loud after about 2.5 s: agy is started while the kid talks, and a quick model
(Gemini Flash) says the first line. Argon's whole pages scored well with both Opus and Gemini
judges, but something new takes about 100 s (80 to 135 s) and a change 15 to 65 s, so Claude leads
by default.

### Team mode

Team mode is how Build Buddy builds when Claude leads (by default the agent way, below). In the classic way, one AI writes the whole page
from top to bottom, and the kid waits for every line of it. In team mode, Claude Code works as a
team, and each member is its own `claude` run:

| Role | Default | What it does |
|---|---|---|
| `voice` | `haiku`, low effort | Answers out loud straight away (in about 2 s), while the others build. |
| `sketch` | `sonnet`, low effort | Off by default. For something new, makes a quick first look at it (`team.firstLook`): the thing they asked for, big and moving, in a simple scene, answering the keys and taps. It's on screen as soon as a lead starts its plan, and the team's version replaces it. It's never saved, and never shown for a change to what's already there. |
| `lead` | your `claude.model` / `claude.effort` | Three race (`team.leads`); the first to start a plan is used. Plans the page: the code every piece shares, one job per helper (each starting with exactly what it defines, like `makeWorld(scene) → { update(dt) }`), and the code that puts the pieces together. Small changes it makes itself, as edits. |
| `helper` | `sonnet`, low effort | Each writes one piece, all at the same time (Sonnet writes about 40% faster than Opus, and with the lead's detailed plan its pieces judged as well). A helper starts the moment its job is written, while the lead is still writing the rest. One that hasn't written a word after 7 s is thinking hard, so a second helper takes the same job and whichever finishes first is used. |
| `fixer` | your `claude.model` / `claude.effort` | Before anything is shown, every script on the page is checked (two pieces that declared the same name are untangled automatically); if one doesn't parse, or if edits don't fit, the fixer gets one try to repair it. Edits written apart by helpers are applied by the lines they really change when their context has moved; one or two that still don't fit (out of many) are left out, and the checker makes sure the change is there - if more don't fit, the classic way builds that request instead (so nothing the kid made goes missing); if a script still doesn't parse, the usual wobbly-bit fixing takes over. Every page the team makes is also run out of sight for a moment first (with the kid's progress, for a change); if it crashes, the fixer's repair is tried out of sight too and only then shown - if the repair doesn't work (or takes over 30 s), the page is shown and the usual crash fixing takes over. |
| `checker` | your `claude.model`, medium effort | Right after the creation appears, takes a careful look at the whole page and at a screenshot of it running (with its frame rate and any errors): is everything the kid asked for really there, do the pieces fit, do the controls work with both the keys and the pointer, does what each key, tap and drag does to the main things really set off what comes next, does it keep working on its own (nothing freezes, runs away or piles up), is everything in view and nothing cut off or in the way, in a game can the goal really be reached and do new levels come soon, is it smooth (below about 30 frames per second it finds what makes each frame heavy and lightens it). Where an arrow key or a tap does nothing it adds a small answer (a wiggle, or sparkles where they tapped), and in a game, where reaching the goal has no celebration, it adds one. Its fixes (usually about half a minute later) are first tried out of sight for a moment (a fix that throws errors is taken back, so a creation that works is never broken by its polish), then slide in at a calm moment, keeping the kid's progress, so the kid never waits for it. |
| `polisher` | your `claude.model`, high effort | After the check, looks at it again as a demanding parent who designs kids' simulations and games and makes the two or three changes that matter most: the look they were given really showing, the star recognizable, in proportion and with a visible face, a world that works (poking its main things sets something off, and it keeps going when left alone; in a game, a goal that needs the kid), every action answered, nothing cut off or harsh. Twice by default (`team.polish`); tried out of sight and slid in like the check's fixes. |
| `tester` | your `claude.model`, medium effort | Starts each polish pass: looks at the creation (and a screenshot of it running) the way a demanding parent would, and lists what it would mark down, most important first (including a page that's a picture rather than a working world); the polisher then fixes as many of those as it can do well. `team.tester: false` leaves it out. |

A creation then takes about as long as its biggest piece, instead of the whole page, and each
helper puts its full attention on one thing. If the team gets stuck, that request is built the
classic way instead.

Every role takes the same options, so you can tune how Claude Code runs:

```json
"team": {
  "enabled": true,
  "helpers": 6,
  "lead":   { "model": "opus", "effort": "low", "fast": true },
  "helper": { "model": "sonnet", "effort": "low", "advisor": "opus" },
  "voice":  { "model": "haiku" },
  "fixer":  { "model": "opus", "args": ["--fallback-model", "sonnet"] }
}
```

- `model` / `effort`: any Claude Code model alias or name, and `low` to `max`.
- `fast`: [fast mode](https://code.claude.com/docs/en/fast-mode) for that role (paid from extra
  usage credits on a subscription). Fast mode for just the lead is the cheapest big speed-up: it
  writes the plan, which every helper waits for.
- `advisor`: a stronger model the role can ask for advice before it writes (Claude Code's advisor
  tool; it must be at least as capable as the role's own model, e.g. `opus` advising `sonnet`).
  Each consultation adds a few seconds.
- `args`: any other `claude` command-line options for that role.

A team build uses more of your plan than a classic one (several AIs read the request, and the pages
come out bigger and more detailed), and runs up to `helpers` + 2 `claude` programs at once.

### Solo mode

Solo mode is a third way of building, for Claude: one Claude builds the whole creation and keeps it
in mind, with no team and no helpers. Pick it in the Ctrl+Shift+P panel (*How Claude builds*), set
`"solo": { "enabled": true }` in `config.json`, or try it for one run with `./start.sh --solo`. The
classic way and team mode stay exactly as they are.

- **One Claude per creation, remembering it.** A single `claude` program is started while the kid is
  still talking and keeps running between requests, so it knows every line it wrote and what it
  meant each piece to do.
- **The heart of it first, quickly.** Its first reply is the heart of the creation: the star, its
  place, its real rules and what each poke sets off (in a game, the goal and its reward), and the
  controls, all working and in the look. For a
  new creation on a fresh page, a quicker model (Sonnet) writes it while the kid waits; then the
  same session switches to the main model (Opus) for everything else, still remembering every line.
- **Then it keeps working on it while the kid plays.** In the same session, it looks at a screenshot
  of it running (with its frame rate and any errors) three times (`solo.polish`):
  1. it grows it into its full version: about twice as much, with everything a kid pictures for
     that kind of thing, more of its place, characters who react to the kid, one more thing a poke
     sets off, things to discover (in a game, a reward every time and a goal that grows), and one
     big idea of its own from exactly what the kid said (a sleepy cloud named Puff who wishes for a
     rainbow, painted stripe by stripe as the kid plays the piano);
  2. it makes it beautiful: the star readable at a glance, with a face whose expression changes,
     every word of the look really on screen, and no bare corners;
  3. it tests it like a demanding parent: it follows every arrow key, tap and drag to what moves,
     traces every cause and effect (each poke, collision and timer) to check it really fires and
     shows, checks it keeps going when left alone, plays it a few minutes ahead in its head for
     anything that gets stuck, piles up or never stops, checks a 3D scene's
     space (the star's face toward the camera, everything facing the way it moves), scores it the
     way that parent would (what was asked for, a world that works, delight, easy for a
     5-year-old, solid, its own), and fixes what keeps each score down. When it runs slowly, it lightens each frame
     without taking away anything the look asked for.

  After each pass it re-reads the code it just changed, as a tester, and fixes what it broke. Each
  pass is tried out of sight first and slides in at a calm moment, keeping the kid's progress,
  like team mode's polish. One that would crash is taken back, and Claude is told why (a lost grow
  or beautifying pass happens again).
- **Changes from memory.** It already knows the page, so a change is a few edits written straight
  away (7 to 19 s in tests), and the kid's progress carries over.
- **The kid comes first.** If they ask for something while a pass is still working, that pass stops,
  their request is answered next, and the pass happens later.
- **Thinks a little while the kid waits, a lot while they play:** `solo.thinking` gives the budgets.

If the session runs into trouble, that request is built the classic way. After 24 turns, or 20
minutes without one, the session is replaced by a fresh one, handed the page as it is and what the
kid asked for lately; what it still had to do (growing it, making it beautiful) carries over.

On the same eight test creations as team mode, judged blind side by side, each pair twice with the
two shown in both orders, solo mode won all 16 judgments against the classic way, every one by a
clear margin (its creations scored 8 to 9 out of 10 there, the classic way's 4 to 6), and 9 of the
16 against team mode's creations, including all 4 won by a clear margin. Scored one at a time
against fixed anchors (10 = nothing noticeably wrong), its creations averaged 7.8 out of 10 over
seven rounds (7.6 to 7.9), level with team mode's in the same rounds (7.5 to 8.0; earlier tests put
Opus at high effort with no time limit at 7.9) and ahead in four of the seven; in three of them,
seven of its eight creations scored 8 ("very good"). Having Fable instead of Opus do the passes
scored no higher (7.6). They were also judged the most original of the three ways of building (6.9
to 7.4, against team mode's 6.0 to 6.8). What got it there, each measured the same way: a quicker
model writing the heart (as good, and 10 s sooner), making it beautiful after growing it, a test
pass that checks 3D space (its 3D creations went from 6.7 to 7.7), one big idea per creation
(originality from 6.6 to 7.4), and each pass re-reading what it changed before it goes in (no pass
crashed in the final round). The heart of each creation was on screen after 23 s on average (at most
28 s), sooner than team mode's creations (27 s), and Sparky's first words came after about 1.1 s;
the grown, beautiful and tested versions followed while the kid played, each pass taking about 45 s.
In sessions in the real app, changes took 7 to 19 s and the kid's progress carried over each one.
Solo mode runs one `claude` program at a time, where team mode runs up to eight. (These scores were
measured with the earlier prompts, which planned a game; how today's little worlds score is in
[How it measured](#how-it-measured).)

### Team mode, the agent way

The agent way is how Build Buddy builds when Claude leads: team mode led by one Claude that keeps the
creation in mind, the way solo mode does, and hands the work to helpers. For team mode's usual way
instead, pick *A team of AIs at once* in the Ctrl+Shift+P panel, set `"team": { "agents": false }` in
`config.json`, or try it for one run with `./start.sh --team`.

- **One lead that remembers it.** A single `claude` program is started while the kid is still
  talking and keeps running between requests, like solo mode's. Sparky's first words still come
  from team mode's quick voice while it works.
- **Helpers that write at the same time.** The lead plans the page and hands every part to a helper:
  Claude Code subagents (Sonnet by default) that all write at once. The kid waits for the slowest
  one, so parts are small (25 to 40 lines - extras come when it's grown) and the biggest goes out
  first; a helper that goes silent for 90 s is stopped, and the lead does its job itself. Then it
  reads what they wrote and makes it one creation that works - a name that doesn't match, a call
  that's missing, a part that doesn't fit the plan - before the kid sees it.
- **The creation lives in files**, in its own folder: `page.html`, with a `// @part <name>` line
  where each part goes, and `parts/<name>.js` for each part. Build Buddy puts them together after
  each turn. `rules.md` holds the rules every helper follows (Build Buddy writes it); the lead's
  notes for its helpers (the shared names, how the parts talk to each other) are comments in
  `page.html`'s shared code, so every helper reads them with the page.
- **Then it keeps working on it while the kid plays,** three times in the same session (one more
  than `team.polish`): it grows it into its full version, handing the additions out to helpers (who
  write fuller parts here than while the kid waited) and making them fit, then looks it over twice
  as a demanding parent would, fixing small things itself and handing out bigger ones (none with
  `team.check: false`). The kid's changes go to it too.
- **It stays the kid's creation.** If the page changes outside its files (undone, fixed by the
  overwatch), it's handed the page as it is; a pass that crashes when tried is taken back and its
  files are put back; and a change that keeps the creation's progress fields carries the kid's
  progress over, whatever the lead calls it.

Measured blind on eight requests no prompt example mentions (a beehive, a marble run, a hamster with
a wheel, a pirate ship, a caterpillar that turns into a butterfly, a treehouse with a slide, a
basketball game and a bubble machine), each pair judged twice with the two shown in both orders:

- **Against team mode's usual way**, its creations won 14 of 16 judgments, 10 of them clearly. A
  world that works went from 6.4 to 7.9, something to discover from 5.5 to 8.1 and the spark of joy
  from 6.6 to 8.1. Against solo mode they won 15 of 16.
- **On the general scale** (each creation scored alone), they averaged 7.9, the same as team mode's
  usual way and above solo mode (7.6), and they were the most original of the three (7.8 against
  7.0 and 7.4).
- **Richer, not more of one piece.** Judges found them a little less coherent than team mode's usual
  way (7.4 against 7.9 - its grow pass adds side pieces that sit beside the main idea, like a ladybug
  next to a beehive) but more than solo mode's (7.4 against 6.8). A prompt asking it to wire every
  addition into the main idea made its creations worse (7.4 against 7.9 scored alone, with more
  wiring bugs), so it was taken back.
- **The price is waiting.** Something new takes about 60 s to appear (49 to 85 s), against about
  37 s for team mode's usual way in the same kind of test runs (two at once on one computer); its
  three passes then take about 2 minutes, then about 1 each, while the kid plays.
- **Quicker at the same quality.** The comparisons above were measured when its helpers wrote bigger
  parts and something new took about 85 s. Small parts while the kid waits (fuller ones in the
  passes), the biggest handed out first, each part written in one go and less thinking time brought
  that to 60 s. Judged blind against that slower version, each creation scored alone averaged the
  same (7.75 for both, and for team mode's usual way); side by side it won 7 of 16 judgments, with a
  little less to discover (6.7 against 7.4). Keeping parts that small in the passes too was about
  as quick but lost 14 of 16, so the passes get fuller parts.

(The comparisons with team mode and solo mode were measured just before a last round of review
fixes, which changed how its files are kept in step with the page and a few lines of its prompts,
not how it builds.)

#### With direct helpers (new)

A second way to run the same team, to try: pick *The same team with direct helpers* in the
Ctrl+Shift+P panel, set `"team": { "agentHelpers": "direct" }` in `config.json`, or start it for
one run with `./start.sh --direct`. It keeps the lead, its plan, its check, its memory and its
passes while the kid plays, and takes the waiting out of handing the work out. In test runs
something new appeared in about two thirds of the time and was judged at least as good (below);
it isn't the default yet because test runs are all it has behind it.

- **Helpers that start the moment their job is written.** The lead's reply is the page itself: the
  shared code first (the names, sizes and numbers every part goes by, and how the parts tell each
  other what happens), then one line for each part -
  `// @part truck [🚚 the monster truck]: makeTruck(scene) → { update(dt, t) } - ...` - then the code
  that runs them. Build Buddy reads the reply as it's written, and each of those lines starts a
  helper at once, with the page as far as it's written and its job: a `claude` program of Build
  Buddy's own (Sonnet by default), started while the kid was still talking, that answers with its
  part's code and nothing else. The kid waits for the slowest one, so parts are small (25 to 40
  lines - extras come when it's grown), the biggest goes out first, and a helper is told to start
  writing at once (left to itself, Sonnet thinks for 10 to 20 s before the harder parts). One that
  hasn't written a word after 8 s gets a second helper on the same job, and whichever finishes
  first is used.
- **The lead makes the parts one creation.** When its helpers are done it's handed every part in
  one message, with anything Build Buddy can see is loose between them just by reading the files (a
  function the page calls that no part defines, something a part listens for that nothing tells, a
  progress field with no starting value, a color given as text to a library that draws with
  numbers, which comes out black with no error). It goes through what the kid asked for, thing by
  thing: is it there, on the first screen, and does it really happen when this code runs - from
  the key or the tap, through the parts, to the screen? Its fixes are part of its reply (`FIX parts/cars.js`, the lines to find, the
  lines that replace them), and Build Buddy takes them into the files. The lead has no tools at
  all: whatever it needs to see is put in front of it, so a check or a small change is one answer,
  never a trip to read a file first.
- **It sees the creation before the kid does.** With the parts comes a screenshot: the app runs the
  page as the helpers wrote it, out of sight and silent, and sends back its picture and anything
  it threw. Whether everything asked for is there, whole and big enough to know, is something to
  look at, not to work out from the code - and what the picture shows is fixed in the same answer.
  In the test builds that's how a second crowd drawn over the first, clouds covering the car,
  people cut off at the bottom of the screen and a star that crashed every frame were gone before
  anyone saw them (`team.peek`).
- **The kid sees and hears what's being made.** Each job carries a picture and a few words
  (`[🚚 the monster truck]`): the pictures appear on the building card as the helpers start, each
  one pops when its part is ready, and Sparky says "I'm making the monster truck, the row of cars
  and the crowd!" about fifteen seconds in, then "Now I'm putting it all together!".
- **The creation lives in the same files** (`page.html` and `parts/<name>.js`; no `rules.md` - a
  helper is handed its rules with its job).
- **Changes go the same way.** A small change is the lead's own, as FIX blocks, in about 7 s. For
  several things at once or something big, its reply starts with `PART <name> [...]: <job>` lines -
  for a new part, or for one that's written again - so their helpers write while the lead makes its
  own changes to the page.

**Why a lead with helpers works, and where its minute went.**

With Opus leading, the agent way and its subagents are the way of building that gives kids what
they asked for. Timing it turn by turn on six requests of the kind kids make (a monster truck show,
dinosaurs by a volcano, a town to drive around, a car wash, a toilet that fires poop at a dinosaur,
a rocket visiting planets - each with five or six things asked for at once) shows why it works:

- **One mind holds the whole creation.** The lead writes the page's skeleton and, in its comments,
  what every part goes by: the coordinates, the shared numbers, what each part's code is called
  with. Helpers who all read the same plan write parts that fit.
- **It reads every part before the kid sees it.** In three of those six builds its check fixed
  something no error message would ever report: a truck that jumped the cars and never crushed
  them, a dinosaur drawn in the wrong place whose taps the volcano swallowed, aliens that stayed
  behind when their planets moved.
- **It remembers the code.** The same session wrote the page, so a small change is two exact edits
  and takes 6 to 12 s - nothing is read again or written again.
- **Opus leads well.** It starts writing without a long think first - after about 3 s when it's
  asked for a piece of writing on its own, 8 s as the lead planning the build timed below - and its
  edits are exact. (It writes 236 characters a second; Sonnet writes 336 and Haiku 532, which is
  why the helpers aren't Opus. Fable writes 212 after thinking for about 13 s first, every time:
  fuller creations and a longer wait.)

And where the time went - for the monster truck show, which took 70 s to appear: the lead thought
for 8 s and wrote the page in 13; then it wrote a message to each of its five helpers, one after
another, for 15 s (each helper started only when its own message was finished, then read two files
before writing); the helpers needed 19 s more; and the lead's check took 14 s, in three round trips
to read the files. The helpers were writing for about 20 of those 70 s. A big change had the same
shape: the lead waited for its helper before making its own changes.

Direct helpers keep the lead, its plan, its check and its memory, and take the waiting out: nobody
waits to be asked, nothing is read from a file, and the check is one answer. On the same six
requests, one at a time:

| | Subagents (the default) | Direct helpers |
|---|---|---|
| Something new appears after | 68 s (54 to 85) | 43 s (36 to 47) |
| A small change ("make the truck green and add fire") | 9 s (6 to 12) | 7 s (4 to 10) |
| A big change (two or three things at once) | 49 s (36 to 59) | 31 s (23 to 40) |
| The pass that grows it, while the kid plays | 99 and 118 s (two creations) | 73 s (42 to 126, five creations) |

In the app itself, a monster truck show appeared after 47 s: Sparky answered after 3 s, the first
parts' pictures were on the building card at 15 s, "I'm making the purple monster truck, the row of
cars and the show arena!" came at 17 s and "Now I'm putting it all together!" at 31 s.

The creations were judged blind, side by side: a judge is given what the kid said, the list of what
was asked for, each version's code and two screenshots of each, and isn't told how either was built.
On the six first versions and the six big changes, direct helpers' creations were preferred 8 times
out of 12 (3 of them clearly; none of the 4 the other way was), had 57 of the 58 things asked for
fully there and working, against 47 of 58, and scored 8.3 out of 10 on average, against 7.3. The
small changes, judged in an earlier round, came out even (3 to 3). One judge looked at each pair,
so this is a direction, not a measurement to the decimal - but it pointed the same way each time:
the round before, first versions were preferred 4 times out of 6 too, and in a round of six more
first versions made with the screenshot, 5 times out of 6 (8.0 against 7.2).

(Those rounds and times were measured before the lead was handed a screenshot, except that last
one. The screenshot itself takes one to two seconds where it could be timed; the test machine has
no graphics card and takes far longer than a real computer to photograph a plain-canvas page, so
its share of the wait is an estimate: with it, first versions came to about 41 s on average.)

Three things got first versions there, each found by reading what the judges marked down:

- **Parts tell each other what happens through one line of shared code** (`on('crush', ...)`,
  `tell('crush', car)`), never through a list of events that's emptied every frame. With such a
  list, a part that ran earlier in the frame missed everything: twice the crowd never cheered a
  crush.
- **Everything asked for is on the first screen, big enough to know at a glance** - a world just
  big enough to hold it, not a map shown tiny - and a helper's first line names the features that
  make its piece unmistakable (a T-rex: huge head, big teeth, tiny arms, thick tail), then draws
  them.
- **The check runs the numbers as they are** (is the jump high and long enough to clear the row?)
  and follows what one part tells to the parts that should react.

It uses about as much of a Claude plan as the subagents do: a town, its small change and its big
change came to about 15% more, going by the cost Claude Code itself reports for each program.

Three things tried along the way were left out. Haiku as the helpers was quicker and its parts
were plainly weaker. Showing the creation before the lead's check would save about ten seconds
and show the kid the truck that never crushes the cars. And Claude's fast mode would cut the
lead's writing - the largest share of the wait that's left - but it's paid from extra usage
credits, so it stays a choice (*Claude speed* in the panel).

**API keys instead of subscriptions:** the `claude` and `codex` CLIs accept API keys too
(`ANTHROPIC_API_KEY`, or `printenv OPENAI_API_KEY | codex login --with-api-key`). Nothing in Build
Buddy changes.

## How it works

```
 kid talks ──► whisper.cpp ──► Claude Code, Antigravity ──► web page on the stage ──► Kokoro voice
 (space bar)   (on device)      or Codex CLI (your account)   (sandboxed iframe)       (on device)
```

- **Each creation is one web page** (HTML, CSS and JavaScript). That's the format AI models write
  most fluently, and it covers what kids ask for: drawings, animations, games, music, toys and
  stories. Two game engines ship with the app: [Phaser](https://phaser.io) for 2D games (physics,
  particles, tweens, so things bounce and sparkle instead of sitting still) and
  [Three.js](https://threejs.org) for 3D. Both run on the GPU. Without a 3D engine, the AI hand-draws
  "3D" on a 2D canvas: a test kart game ran at 7 fps that way, and at 120 fps with Three.js.
- **Changes don't restart the game.** Each creation keeps the kid's progress (score, level, where
  the player is and which way it faces, things collected, placed or unlocked) in a small
  `KB.keep({...})` object, and puts it back when it starts. When a new version arrives, those
  values are handed over, but only where they still fit (same kind of value), so a changed game
  can't be pushed into a state it doesn't understand. In team mode a new version is tried out of
  sight first: if it crashes only with the kid's progress, it's repaired to carry on from there;
  if that doesn't work out, it quietly starts fresh instead.
- **Your subscription is the brain.** Build Buddy runs the official `claude`, `codex` or `agy` command-line
  tools in non-interactive mode on your computer, so each request counts against your plan's normal
  usage, just as if you'd typed it yourself. It doesn't extract or reuse login tokens.
- **Fast feedback.** With Claude, the AI's first sentence is spoken while the rest is still being written.
  Small changes come back as find-and-replace edits instead of a whole new page, and Sparky speaks
  sentence by sentence, preparing the next one while the current one plays.
- **Built for little voices.** Two speech recognizers listen at once, both on the computer:
  whisper (`small.en`) and NVIDIA's Parakeet. They get *different* words wrong, so Sparky is given
  both versions and works out what was meant. In one test whisper heard "a Cunado", Parakeet heard "a
  panado", and Sparky built the tornado that was asked for. On toddler-style test speech, picking the
  better of the two each time cut mistakes by about a fifth. Both together take about 2 s. They run on
  the CPU on purpose: on the GPU, speech recognition makes games stutter while it works. Whisper is
  also told what the kid is building and what they said lately; silence is never sent to either, so
  they can't invent sentences; and rude words that a mumble gets misheard as are masked. Listening
  starts half a second before the talk key goes down and keeps going a moment after it's let go.
- **Built by a team.** In [team mode](#team-mode) (Claude's way), a quick model answers out loud
  within about 2 seconds, while three leads race to plan the creation and up to six helpers write
  its pieces at the same time, each starting the moment its job is written (a robot on the building
  screen for each). Before anything is shown, every script is checked, the page is run out of sight
  for a moment, and a fixer repairs what doesn't run; right after it appears, a checker and then a
  polisher (twice, each time working through a tester's list of what a demanding parent would mark
  down) look over the whole page and at a screenshot of it running, and give it fixes and finishing
  touches (in tests: a piano key that crashed, food the fish could never reach, a frog that caught
  flies on its own, a car too big for its road, a dragon without real wings). Their changes are
  tried out of sight first, so they can never break a creation that works, and slide in while the
  kid plays. On a test set of eight new creations and four changes (timed like at home), the full
  creation arrived after about 27 s on average instead of 45 s (at most 34 s in quiet test rounds,
  against 72 s); Sparky's first words came after about 2 s instead of 9 s, and changes took 20 s
  instead of 26 s. In blind side-by-side judging against the classic way, the team's creations won
  11 of 12; scored one at a time against fixed anchors (10 = nothing noticeably wrong), they
  averaged 7.8 out of 10 against the classic way's 6.5 - as high as Opus at high effort with no time
  limit (7.9, taking 1.5 to 3 minutes per creation, with the same check and polish). In over a
  hundred judgments no creation from any builder scored above 8 ("very good"): 19 of 24 of the
  team's got that top score, against none of the classic way's; more polish passes didn't raise it,
  but a tester's list did: on eight fresh creations, polish passes guided by the tester brought
  every one to 8 (8.0 on average against 7.75 without it, with every part of the score up). It
  writes about twice as much, so it uses more of your plan. (These scores were measured with the
  earlier prompts, which planned a game; how today's little worlds score is in
  [How it measured](#how-it-measured).)
- **It fixes its own mistakes.** If a creation crashes, Sparky says *"Oops! Let me fix a wobbly bit"*
  and asks the AI to fix it, at most twice in a row.
- **An overwatch looks after it, quietly.** After the kid has played a version for 25 seconds, and
  every 3 minutes after that while they keep playing it, Opus takes a careful look: a screenshot of
  the game, its frame rate, recent errors and kept values (with agy as the only brain, Argon does,
  from the page and those numbers: agy can't be shown the screenshot). It fixes problems that don't show up as
  errors, like a player who's invisible or stuck, a frozen screen, or a request that didn't take.
  If everything works, it may give that version one tiny polish (something cut off at the edge, too
  small to see, a missing bounce), but it never adds new things or changes what the kid chose, so
  it's still entirely their creation. Usually it leaves things alone. Its changes slide in at a calm
  moment without losing progress (fixes with a soft sparkle, polish silently). If the quick fixes
  fail, it's called in straight away. The Ctrl+Shift+P panel shows its last verdict, and
  `data/log.txt` has a `WATCH` line for every check.
- **No two creations look the same.** Each new creation is nudged toward a different look (cartoon
  outlines, paper cut-out, glowing night, pixel art, picture book, and so on), with a full scene
  behind it, characters with personality, and a thing or two to discover by trying. What to
  build is always the kid's idea; Sparky never suggests one.
- **Smooth by default.** The AI follows a short performance checklist, and creations render at no
  more than 1.5× pixel density, so sharp screens don't quadruple the work.

## Safety and privacy

- **Hard to break.** In full-screen mode there's no address bar, tabs or menus. With
  `"keepOpen": true` the window also reopens if it's closed, so only Ctrl+Shift+P → Quit stops it. Space and Enter always belong to the app, even while a game has focus.
  Every version is saved, so a restart picks up where they left off.
- **Creations are sandboxed.** They can't reach the internet, open windows, navigate away, store
  anything, or touch the rest of the app. The only things they can load are the bundled Phaser and
  Three.js.
- **What leaves your computer:** the text of each request and the current creation's code, sent to
  Gemini (Google, through Antigravity), Claude or ChatGPT - whichever brain is building. Gemini's agy
  is only asked for text and can't run commands or touch your files, but it could search the web. The
  overwatch uses Claude or ChatGPT whenever one is installed, even while Gemini builds (it needs to see
  the screenshot): it gets the creation's code, the kid's last few requests and what they've made
  progress in. The overwatch (and in team mode the checker, in solo mode each pass) also
  sends a small screenshot of the creation itself, drawn from inside it (never the camera or the rest of the screen). Listening and speaking happen on the computer itself.
- **What's kept:** creations, conversations and a log live in `data/` on your computer.
  `data/log.txt` shows every request: what was heard, which AI answered, and how long it took.
- **Kid-friendly by instruction.** Sparky is told to keep everything friendly and age-appropriate
  (silly potty humor is allowed when the kid asks for it), but it's still an AI. Sit with them the
  first few times.

## Troubleshooting

| Problem | What to check |
|---|---|
| **Sparky can't hear** | Usually the microphone is muted in the system settings, so the app receives silence. On Linux the app switches it on at startup; if it gets muted mid-session, Sparky says *"My ears are turned off!"* Each recording is logged in `data/log.txt` as a `HEAR` line with its length, loudness and what was understood. |
| **No voice** | Check the system volume, and the *Talking* line in the Ctrl+Shift+P panel. If Kokoro isn't installed, Sparky falls back to Piper. |
| **Gemini isn't used, or says it isn't signed in** | Run `agy` once in a terminal and sign in; `data/log.txt` shows `FAIL agy` with the reason, and the next brain builds meanwhile. Build Buddy runs agy in an agy home of its own (`data/agy-home`, see `agy.keepHistory`); its own log is in `data/agy-home/.gemini/antigravity-cli/log`. |
| **"My brain got a little tangled"** | The AI request failed. Check `data/log.txt`. Common causes are being offline, a usage limit, or needing to sign in to `agy` / `claude` / `codex` again (run it once in a terminal). |
| **A game feels slow** | Ctrl+Shift+P shows its frame rate. Asking Sparky to *"make it simpler"* or *"make it faster"* helps. For 2D games Sparky should be using Phaser, and for 3D, Three.js. |
| **"Port 4321 is busy"** | Build Buddy is already running, or set a different `port` in `config.json`. |

**Platforms:** developed on Linux (Arch Linux ARM on Apple Silicon, Hyprland, Chromium). macOS
should work the same way with Chrome. On Windows the app itself runs (Node finds Chrome or Edge),
but `setup.sh` needs WSL, or use `"stt": "browser", "tts": "browser"` with Chrome.

## Project layout

```
server/main.mjs      web server, API, full-screen browser launcher
server/ai.mjs        Sparky's instructions, AI backends (claude / codex / agy / command), reply parsing
server/team.mjs      team mode: a lead and helpers that build a creation together, at the same time
server/agents.mjs    team mode, the agent way: one lead that remembers the creation, helpers for its parts
server/crew.mjs      the agent way's direct helpers: each starts as the lead writes its job; the lead's fixes go into the files
server/solo.mjs      solo mode: one Claude session per creation that remembers it and keeps improving it
server/speech.mjs    whisper.cpp (listening), Kokoro and Piper (talking)
server/watch.mjs     the overwatch: a stronger model that checks on games and fixes them
server/store.mjs     creations and their versions, saved in data/projects/
server/config.mjs    settings and their defaults
public/              the kid-facing screen
public/stage-shim.js runs inside every creation: crash reports, talk keys, KB.keep, overwatch reports
setup.sh             downloads and builds everything in vendor/
start.sh             starts the app
install-launcher.sh  adds Build Buddy to your Linux app launcher
```

No dependencies to `npm install`. The server uses only Node's standard library. `npm test` runs the
tests of the code that reads the lead's replies as they're written (`server/crew.test.mjs`).

## Credits

Build Buddy stands on these projects (downloaded by `setup.sh`, not included in this repository):

- [whisper.cpp](https://github.com/ggml-org/whisper.cpp), speech-to-text (MIT)
- [Parakeet TDT 0.6B v2](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2) by NVIDIA, second speech recognizer (CC BY 4.0), run with sherpa-onnx
- [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), natural voice (Apache 2.0), run with [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache 2.0)
- [Piper](https://github.com/rhasspy/piper), backup voice (MIT); each voice model has its own license
- [Phaser](https://phaser.io), 2D game engine (MIT)
- [Three.js](https://threejs.org), 3D engine (MIT)
- [Fredoka](https://fonts.google.com/specimen/Fredoka), the rounded font (SIL Open Font License, included in `public/fonts`)

## License

[MIT](LICENSE): free to use, copy, change and share, for any purpose. The projects listed under
[Credits](#credits) keep their own licenses.
