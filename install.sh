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
for mod in "$here"/mods/*/; do
  name=$(basename "$mod")
  rm -rf "$HOME/.config/herdr-app/mods/$name"
  cp -RL "$mod" "$HOME/.config/herdr-app/mods/$name"
done
python3 "$here/wire.py"
herdr-app check "$HOME/.config/herdr-app/mods/tab-host" >/dev/null
herdr-app check "$HOME/.config/herdr-app/mods/tab-notes" >/dev/null
echo "installed and checked: $(ls "$here"/mods | tr '\n' ' ')"
