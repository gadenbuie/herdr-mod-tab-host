#!/bin/sh
# Installs the mods into Herdr's home and wires the layouts.
#
# 1. Copies each mod in mods/ into ~/.config/herdr-app/mods/ as a real
#    folder — Herdr (0.1.12) doesn't start mods that live behind a symlinked
#    mod folder, so a git pull reaches the app through one run of this.
# 2. Wires every personal layout (layouts/*.json with a cloned_from) so the
#    tab bar carries the tabhost-buttons block; shipped layouts are left
#    alone, files already wired are skipped, and every change is backed up
#    beside the file. See wire.py.
# 3. Runs herdr-app check on each mod, which fails loudly on a broken copy.
set -e
here=$(cd "$(dirname "$0")" && pwd)

# Deploy mods/, and take back mods this repo deployed before but no longer
# ships (an example moved to examples/, say). The list of deployed names is
# kept in data/tab-host/installed.txt; mods anyone else installed are never
# touched.
state="$HOME/.config/herdr-app/data/tab-host/installed.txt"
mkdir -p "$(dirname "$state")"
touch "$state"
for name in $(cat "$state"); do
  [ -d "$here/mods/$name" ] || rm -rf "$HOME/.config/herdr-app/mods/$name"
done
: > "$state"
for mod in "$here"/mods/*/; do
  name=$(basename "$mod")
  echo "$name" >> "$state"
  rm -rf "$HOME/.config/herdr-app/mods/$name"
  cp -RL "$mod" "$HOME/.config/herdr-app/mods/$name"
done
python3 "$here/wire.py"
for mod in "$here"/mods/*/; do
  herdr-app check "$HOME/.config/herdr-app/mods/$(basename "$mod")" >/dev/null
done
echo "installed and checked: $(ls "$here"/mods | tr '\n' ' ')"
