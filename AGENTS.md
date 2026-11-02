# Building a tab for tab-host

You are building a contributor for tab-host: a Herdr mod that gets its own
button in the person's tab bar, beside Files and Changes, opening its own tab
in the side panel. **The mod is yours** — its own folder, its own repo, its
own life — and joins by declaring one tab in its `mod.json`. tab-host is the
mechanism it lands in, not a project you build into. This file is the whole
contract; for everything else about writing Herdr mods, read
`~/.config/herdr-app/AGENTS.md` first — this file only adds the
specific rules on top of it.

## The contract

A contributor is an ordinary mod in this repo's `mods/<name>/` whose
`mod.json` declares one tab:

```json
{ "place": "none", "tab": { "title": "My thing", "icon": "mods/<name>/icon.svg" } }
```

- `place: "none"` — required. Herdr must never dock a copy of your mod on
  its own; tab-host's stack is the only place it shows.
- `tab.title` — required, the button's label. Keep it one word if you can;
  the button truncates at a width that fits beside the shipped buttons.
- `tab.icon` — optional, a path from Herdr's home (`mods/<name>/icon.svg`).
  `*.svg` draws tinted with the text color; anything else draws full color.
  Give one — a button without an icon is a label alone.
- The same field under the name `button` works too
  (herdrdev/herdr-app#246 proposes that name for the core; either joins).
- `main.js` — any Herdr mod: default-exports a class extending `View`, with
  `init(props, cx)` and `render(cx)`. There is no registration code and
  nothing to import from tab-host.

## What happens around your mod

- tab-host watches `mods/` and adds your block to the side panel's stack
  (`tabhost-<name>`) with `layout.set` the moment your folder appears — and
  removes it when you leave. It draws your button in the tab bar, fitted to
  its width. You never touch a layout.
- Your copy starts the first time your button opens your tab, and stays
  alive (shown or hidden) while your block is in the stack. Do your setup in
  `init`, and clean up in `close(cx)` — it gets one call when your block
  leaves.
- You get no props. If your mod can also show somewhere else (a pane, an
  overlay), use `props()` to tell the roles apart the way tab-host itself
  does.

## Rules that bit other mods here

- Imports: `View`, `div`, `svg`, `image` come from `gpui-kit`; `Editor`,
  `EditorState`, `Input`, `InputState`, `h_flex`, `v_flex` come from
  `gpui-base`. The editor classes are **not** in `gpui-kit` however much the
  docs imply it.
- `.children([...])` takes an array, never varargs.
- Style with `theme()` colors so you follow the person's theme. Animate with
  `.frames`, `.spin`, `.loop` — never a timer redraw.
- Don't poll what Herdr gives you live (`spaces()`, `agents()`, `panes()`,
  `layout()`); render again reads it fresh.
- Keep side effects off the module top level. One mod per idea.

## Delivering

Your mod lives wherever your project lives (`~/play/herdr-mod-<name>/` is
the local habit). Installing it means one thing: a **real directory** at
`~/.config/herdr-app/mods/<name>/` — Herdr (0.1.12) doesn't run mods that
live behind a symlink, so your install step is a copy, not a link:

```sh
rsync -rlpt --delete ~/play/herdr-mod-<name>/mods/<name>/ \
      ~/.config/herdr-app/mods/<name>/
herdr-app check ~/.config/herdr-app/mods/<name>
```

That is the whole dependency on this repo: none at build time. tab-host
watches the mods folder and adds your button and your block the moment the
copy lands — and removes them when the folder goes. You never run this
repo's `install.sh` (it deploys tab-host itself and the example below, and
wires the layouts; it belongs to this repo's owner), and you never edit a
layout.

Herdr hot-reloads saved files, so while developing, a save is live within a
second.

## Without tab-host

Your mod should be worth having when tab-host isn't installed. With
`place: "none"` it shows nowhere on its own, so give it a second door the
way herdr-issues does: it opens as a pane of its own
(`pane.split --mod <name>`) or as an overlay, and the tab is the bonus the
tab bar gains when tab-host is there. Never require tab-host at runtime —
you have no way to import it, and a mod that breaks without a neighbor is a
mod nobody keeps.

## Check before you finish

```sh
herdr-app check ~/.config/herdr-app/mods/<name>
```

Nonzero with the exact error means broken; never call it done without a
passing check. Then look once in the app: the button sits at the right end
of the tab bar, highlights while your tab shows, and toggles the panel.
If something doesn't appear, `~/.config/herdr-app/data/tab-host/reconcile.log`
holds what tab-host last saw and did.

## Don't

- Don't edit `mods/tab-host/` or this repo to add your tab — the manifest is
  the interface, and a changed tab-host is a fork the person has to maintain.
  (The one exception: `examples/tab-notes/` here is the *reference example*;
  copy its shape, not its folder.)
- Don't ship a layout variant of your own; the wiring is tab-host's
  `wire.py`'s job and runs against whatever layouts the person already has.
- Don't edit `~/.config/herdr-app/AGENTS.md` or the `.d.ts` files; the app
  rewrites them.
- Don't `setShared("tabhost.panels", …)` from your mod's top level — it is
  for the person or an agent registering a tab by hand, and last-write-wins
  races eat entries.
