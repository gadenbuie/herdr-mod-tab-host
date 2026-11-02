#!/usr/bin/env python3
"""Wire tab-host into Herdr's layouts.

Gives every personal layout's tab bar the tabhost-buttons block, so the mod's
buttons show and contributors have a side-panel stack to join. Shipped
layouts are left alone (layout.set refuses structural changes there, and
Herdr replaces them at start). Idempotent; backs up every file it changes.

Called by install.sh; also safe to run alone against another folder:

    python3 wire.py [layouts-dir]     # default: ~/.config/herdr-app/layouts
"""
import json
import os
import shutil
import sys
import time

MOD = "tab-host"
STACK_MARKS = ("files", "changes")  # how the shared side-panel stack is recognized


def walk(node, parent=None):
    yield node, parent
    for child in node.get("children", []):
        yield from walk(child, node)


def wired(tree):
    return any(
        n.get("content", {}).get("mod") == MOD and n.get("content", {}).get("props", {}).get("buttons")
        for n, _ in walk(tree)
    )


def find_block(tree, mod):
    for n, parent in walk(tree):
        if n.get("content", {}).get("mod") == mod:
            return n, parent
    return None, None


def find_shared_stack(tree):
    """The stack contributors join: the one holding the shipped panels, with
    the column around it (the one show/hide toggles)."""
    for n, parent in walk(tree):
        if n.get("type") != "stack":
            continue
        mods = [c.get("content", {}).get("mod") for c in n.get("children", [])]
        if any(m in STACK_MARKS for m in mods):
            return n, parent
    return None, None


def buttons_block(stack_id, panel_id):
    return {
        "id": "tabhost-buttons",
        "type": "block",
        "content": {
            "mod": MOD,
            "props": {"stack": stack_id, "panel": panel_id, "buttons": True},
        },
        "size": {"px": 90},
        "window_drag": True,
    }


def wire(path):
    name = os.path.basename(path)
    try:
        with open(path) as f:
            tree = json.load(f)
    except (OSError, ValueError) as e:
        return f"{name}: unreadable ({e})"

    if "cloned_from" not in tree:
        return f"{name}: shipped, left alone"
    if wired(tree):
        return f"{name}: already wired"

    tabs, tabs_parent = find_block(tree, "tabs")
    if not tabs or tabs_parent is None:
        return f"{name}: no tab bar to sit beside, skipped"
    stack, stack_parent = find_shared_stack(tree)
    if not stack or stack_parent is None:
        return f"{name}: no side-panel stack to join, skipped"

    block = buttons_block(stack["id"], stack_parent["id"])
    index = tabs_parent["children"].index(tabs)

    if tabs_parent.get("type") == "row":
        # The tab bar is already a row: the buttons block slides in beside it.
        tabs_parent["children"].insert(index + 1, block)
    else:
        # The tab bar is a lone block in a column: wrap the two in a row that
        # takes the block's height, and take the height off the block (inside
        # a row, a px size is a width).
        height = tabs.get("size", {}).get("px", 42)
        tabs.pop("size", None)
        row = {
            "id": "tabhost-tab-bar",
            "type": "row",
            "size": {"px": height},
            "resizable": False,
            "children": [tabs, block],
        }
        tabs_parent["children"][index] = row

    stamp = time.strftime("%H%M")
    shutil.copy2(path, path + ".bak-wire-" + stamp)
    with open(path, "w") as f:
        json.dump(tree, f, indent=2)
        f.write("\n")
    return f"{name}: wired (tabhost-buttons beside tabs; stack {stack['id']}, panel {stack_parent['id']})"


def main():
    layouts = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.config/herdr-app/layouts")
    if not os.path.isdir(layouts):
        sys.exit(f"no layouts folder at {layouts}")
    for entry in sorted(os.listdir(layouts)):
        path = os.path.join(layouts, entry)
        if entry.endswith(".json") and os.path.isfile(path):
            print(wire(path))


if __name__ == "__main__":
    main()
