#!/usr/bin/env bash
# Add "Build Buddy" to your desktop's app launcher (Linux). On Omarchy, press Super+Space and type
# "build". Launching it while it's already open jumps to the open window instead of starting a
# second copy. Run with --remove to take it out again.
set -euo pipefail
cd "$(dirname "$0")"
DIR=$(pwd)
ENTRY="${XDG_DATA_HOME:-$HOME/.local/share}/applications/build-buddy.desktop"

if [ "${1:-}" = "--remove" ]; then
  rm -f "$ENTRY"
  echo "Removed $ENTRY"
  exit 0
fi

if [ "$(uname -s)" != Linux ]; then
  echo "This adds a Linux launcher entry. On macOS, add start.sh to Login Items or make an Automator app."
  exit 1
fi

# Omarchy: start it the Omarchy way, or focus it if it's already running.
if command -v omarchy-launch-or-focus >/dev/null 2>&1; then
  LAUNCH="uwsm-app -- $DIR/start.sh"
  command -v uwsm-app >/dev/null 2>&1 || LAUNCH="$DIR/start.sh"
  EXEC="omarchy-launch-or-focus \"Build Buddy\" \"$LAUNCH\""
else
  EXEC="\"$DIR/start.sh\""
fi

mkdir -p "$(dirname "$ENTRY")"
cat > "$ENTRY" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Build Buddy
GenericName=AI building playground for kids
Comment=Talk to Sparky and build games, toys and pictures with AI
Exec=$EXEC
Icon=$DIR/public/icon.svg
Terminal=false
Categories=Education;
Keywords=kids;sparky;robot;build;ai;games;
StartupNotify=false
EOF
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$(dirname "$ENTRY")" || true
echo "Added Build Buddy to your app launcher ($ENTRY)"
