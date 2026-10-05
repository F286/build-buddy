#!/usr/bin/env bash
# Start Build Buddy full-screen. Grown-ups: Ctrl+Shift+P inside the app → Quit.
#   ./start.sh             kiosk (full screen, reopens itself if closed)
#   ./start.sh --window    normal window, for trying things out
#   ./start.sh --no-browser   just the server; open http://127.0.0.1:4321 yourself
cd "$(dirname "$0")"
exec node server/main.mjs "$@"
