# RECIPE: tab-host, a shared tab section any mod can join

The want: several extensions, each contributing its own tab beside Files and
Changes in the tab bar, without one big mod holding them all and without a
layout edit per mod. Herdr (0.1.12) has no mechanism for it, so this mod is
the mechanism, and one day Herdr itself may be (herdrdev/herdr-app#246).

## The pattern this replaces

Herdr's own side panel (Files, Changes) is a `stack` whose children are mod
blocks, shown one at a time, with buttons the shipped `tabs` mod draws
itself. jankeesvw's herdr-issues joins it the way a third party must today:
the mod renders a button of itself (`props {button: true}`) and ships a whole
layout clone (`main-issues.json`) that appends its block to `panel-body` and
bolts its button block beside the `tabs` block. Two such mods mean two layout
clones to hand-merge, and each clone falls behind Herdr's updates to `main`
and `tabs`. That combinatorial tax is what tab-host removes: one layout
change, N contributors, each contributing by existing.

## The pieces

**The layout change (once, by `wire.py` — or by hand).** The tab bar
becomes a row with one extra block, and the side panel keeps its stack:

```json
{ "id": "tab-bar", "type": "row", "size": { "px": 42 }, "resizable": false, "children": [
  { "id": "tabs", "type": "block", "content": { "mod": "tabs" }, "window_drag": true },
  { "id": "tabhost-buttons", "type": "block", "size": { "px": 72 },
    "content": { "mod": "tab-host",
                 "props": { "stack": "panel-body", "panel": "panel", "buttons": true } } } ] }
```

`props {stack}` names the stack the contributors' blocks join; `props
{panel}` names the column the buttons show and hide — the same two ids the
shipped buttons hardcode, passed instead of assumed. `buttons: true` marks
the copy. `wire.py` finds all three on its own: the tab bar is the block
whose mod is `tabs` (wrapped in a row if it is a lone column child, slipped
in beside it if a row already), the stack is the one holding the shipped
panels, and the panel is that stack's column. It wires every personal
layout (a `cloned_from` in the file), skips shipped ones and already-wired
ones, and backs up each file it touches.

**The contract (all a contributor writes).** In the contributor's own
`mod.json`:

```json
{ "place": "none", "tab": { "title": "Notes", "icon": "examples/tab-notes/note.svg" } }
```

`place: "none"` keeps Herdr from docking a copy anywhere on its own. `icon`
is optional; `*.svg` draws tinted with the text color, anything else draws
full color. No code is needed to *join* — only to *be* something when its tab
opens. The same field under the name `button` works too (see #246 below),
and `shared("tabhost.panels")` — a list of mod names — adds tabs without a
manifest at all.

Two optional fields go to the two things a contributor's own files cannot
do. `badge` names a `shared()` key the contributor keeps up to date
(`setShared` re-renders every mod); the button draws that number as a chip
after its label, and the label is what truncates when the bar runs out of
room, so the count survives a collapsed panel. `tabhost.open:<mod>` is the
command a key binds: it does what that mod's button does, because `keys.json`
fills only a command's first argument and a hidden tab's own copy is asleep.

**The buttons** (`mods/tab-host/main.js`, the copy in the tab bar): draws one
button per contributor — the stack's `tabhost-*` children — styled after the
shipped Files and Changes buttons, which keep their own buttons. The active
state is the panel shown *and* its stack child active, read from `layout()`
(which reflects clicks), so the mod never remembers state of its own. A
click does what those buttons do: shown on it → `layout.hide {panel}`;
otherwise `layout.select {stack, child}` + `layout.show {panel}`. The block's
width is fitted to the buttons it draws: an estimate from the titles and
icons, applied with `layout.resize {id, px}` when it differs — the layout
file seeds a width, the copy corrects it, and both agree from then on. A
contributor whose manifest names a `badge` key gets that chip's width
reserved whether or not a number is there, so a count arriving doesn't resize
the bar under the person's cursor.

**The key** (`tabhost.open:<mod>`) is the same copy's `nextCommand()` loop,
and the same `openTab(name)` a click runs — one function, so a key and a
button can't drift apart. Only the copy with `buttons: true` acts, so a
second copy of the block in some layout never answers the same press; an
unknown name, a missing stack or a missing panel column is a silent no-op,
and each press writes one line to the log beside the clicks.

**The reconciler** (the same copy — and being in the always-visible tab bar,
it never sleeps, so contributors register even while the panel is hidden):
keeps the stack's children in step with the contributors.

- Contributors are read from disk, not from running mods: a mod with
  `place: "none"` never starts until it is shown, so runtime
  self-registration would be a deadlock. `mods/*/mod.json` is the registry,
  and a folder appearing or disappearing is the register/deregister event.
- The tree given to `layout.set` is read from the layout *file*, not from
  `layout()`: the file holds only what was authored, so clicks (sizes,
  hidden, the active child) stay in `layouts/.state/` where they belong and
  are never baked into the file.
- Children are matched by id: `tabhost-<mod name>` is managed (added when the
  manifest appears, removed when it goes), every other id is kept untouched.
  A child whose `content.mod` is already in the stack is not added twice.
- `layout.set` runs only on a real diff, and a memory of the last written id
  list keeps one state change to one write even if the copy restarts.
- `watchFolder(appHome()/mods)` drives it, so installing a mod shows its
  button at once; a rejected watch falls back to a 5 s poll.
- On a shipped layout (no `cloned_from`), `layout.set` refuses structural
  changes; the buttons still draw and still select what is there, they just
  can't add contributors. Clone the layout to give the power back.

## v1, and why it was replaced

The first version drew a strip as the side panel stack's `header` — a mod
that draws tabs on top of the stack, which Herdr's layout format supports and
which this Herdr renders. It worked, and it avoided touching the tab bar. It
was also the wrong shape: the strip listed Files and Changes (they are stack
children), and the tab bar kept its own Files and Changes buttons, so the
person saw two rows of buttons doing one job. The person's expectation —
"a button in the top row next to Files and Changes; the row of tabs inside
the sidebar would not be needed" — is what v2 does. The stack `header`
remains a working Herdr feature worth knowing about; it just isn't the right
one here.

## The delivery model

Two kinds of repo meet here, and keeping them apart is the design:

- **This repo** owns the mechanism: the tab-host mod, the example
  contributor, `install.sh` (deploy + wire + check) and `wire.py` (layout
  wiring). It is the person's, and nothing third parties build runs through
  it.
- **A contributor repo** owns one mod. Its install is a copy into
  `~/.config/herdr-app/mods/<name>/` plus the manifest line; its dependency
  on tab-host is entirely at run time, and absent tab-host it still works as
  a pane. It never runs this repo's scripts and never lands in its `mods/`.

The registry that joins them is Herdr's own mods folder — `mods/*/mod.json`
is read from disk by the running tab-host, so installation order doesn't
matter and neither side needs the other's build.

## Mod or layout?

A mod. A "tab-host" layout in Settings would be a frozen clone of a base
layout, drifting on every Herdr release, and layouts are either/or — picking
it means leaving your own. The mod + wiring shape keeps the person's layouts
theirs: one idempotent block per personal layout from `wire.py`, shipped
layouts untouched (they can't take structural changes; #246's core fix would
give them the buttons). This was decided after v2; the strip of v1 was the
same conclusion arrived at sideways.

## Why the install is a copy, not a symlink

The mods first went in as symlinks to this repo (the way herdr-issues'
README recommends installing). The layout applied, `status` showed no errors,
the layout named the mod — and the mod never ran: no copy, no error, nothing.
Every working mod in this Herdr is a real directory; the two symlinks were
the difference, and copying the folders fixed it at once. `install.sh` copies
the repo's mods into Herdr's home and runs `herdr-app check` on each, so a
`git pull` reaches the app with one command. Worth an upstream issue;
`svg()` not following symlinks is already half of one (jankeesvw hit it too).

## What the buttons show for mods without a manifest

Files and Changes keep their authored ids and have no `tab` in any
`mod.json`, so the buttons copy doesn't draw them (the shipped tab bar
already does). If a contributor's manifest is missing, the button falls back
to the mod name capitalized and draws no icon.

## The diagnostics

`data/tab-host/reconcile.log` holds the last 20 events: the copy starting
(with its props), each reconcile with the tab list it saw, every
`layout.set` and resize, and any warning. It is rewritten whole from a ring
in memory — read with `readTextFile`, written with `writeTextFile` against
what was read, so a concurrent write loses nothing but a line.

## Alignment with the core (#246)

herdrdev/herdr-app#246 (open, draft PR #247 waiting on the maintainer)
proposes the app-level version: a `button` key in `mod.json`, blocks injected
by the app into every `panel-body` stack (id `mod-panel-<name>`), a
`modButtons()` API, and the shipped tab bar drawing the buttons. Where they
meet:

- The manifest key: this mod reads `tab` **or** `button`, so a contributor
  written today is already written the way the PR proposes.
- If the PR merges, the app injects the blocks itself; the reconciler's
  kept-children rule leaves them alone and adds nothing, and the buttons keep
  drawing (titles then come from `modButtons()`-shaped manifests — same
  fields).
- What the PR has that this mod does not: it works on shipped layouts, and
  the tab bar remembers per space which panel shows. What this mod has that
  the PR does not: it exists today, and it drives any personal stack, not
  only ones the app names `panel-body`.

## Verification

```sh
herdr-app check ~/.config/herdr-app/mods/tab-host
```

It passes. `install.sh` deploys tab-host alone — the example in `examples/`
is not installed; copy it into `~/.config/herdr-app/mods/` to watch the
whole flow live. Live, this was confirmed end to end: the buttons copy
starts with its props (`{"stack":"panel-body","panel":"panel","buttons":true}`),
the scan sees the contributor, `layout.set` keeps `tabhost-tab-notes` in
`layouts/work.json` (and it persists across restarts), `fit` settles the
block's width (90 seed → 72 for one button, → 0 when the last contributor
leaves), `layout.select` and `layout.show`/`hide` drive the panel, clicks
survive a `layout.set`, and `status` shows no errors.

Badges and keys were confirmed with a scratch contributor (a copy of the
example with `"badge": "badgecheck.n"`) rather than with the contributor
that asked for them, which is the point: a mod that had never been seen
drew its chip from a real `setShared("badgecheck.n", 12)` (the chip reads
`9+`, the title truncates, the chip does not), and the same worked on the
second button beside it. `openTab` was driven from a timer patch in the
installed copy — synthetic key events need an Accessibility grant this
machine does not have — with the side panel **hidden**: the panel came back
on that contributor's tab, and the next call put it away again.

## Built from

- `mods/tab-host/main.js` — one `View`, one role (the tab bar copy is both
  the buttons and the reconciler). `find` walks a layout tree;
  `manifests()` is the registry reader; `reconcile()` is the whole write
  path; `fit()` keeps the block as wide as its buttons; `tell()` is the log.
- `mods/tab-host/mod.json` — `{ "place": "none" }`.
- `wire.py` — the layout wiring: every personal layout's tab bar gets the
  `tabhost-buttons` block (wrap or insert, whichever the shape needs);
  shipped layouts, unreadable files and already-wired layouts are skipped;
  every change is backed up. `install.sh` runs it after copying the mods.
- `AGENTS.md` — the contributor contract for agents; `PROMPT.md` — the
  one-liner a person pastes to send an agent at it.
- `examples/tab-notes/main.js` — `EditorState`/`Editor` from `gpui-base` (not
  `gpui-kit`), one file under `data/tab-notes/`, a `sleep(800)` debounce with
  a `wrote` guard so a burst of typing is one write.
- `examples/tab-notes/mod.json` — the contract, verbatim.
- `layouts/work.json` and `layouts/focus.json` (this Herdr) — wired by
  `wire.py`; `*.bak-wire-*` copies sit beside them.

## Limits

- One tab-host section per layout is the tested case; the `props {stack}`
  form supports more, but two sections reconciling one registry is untested.
- The buttons sit right of everything the shipped tab bar draws; on Linux and
  Windows that means right of the window buttons (as for herdr-issues).
- The width is an estimate, not a measure; a much longer title truncates
  rather than widening mid-flight (the next reconcile fits it).
