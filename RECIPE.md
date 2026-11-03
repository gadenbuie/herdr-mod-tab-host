# Tab host

A shared tab section for the Herdr desktop app. The tab bar keeps its own
Files and Changes buttons, and beside them — at the right end of the bar —
every contributing mod gets a button of its own: an icon, a title, a chip
with a count when the mod publishes one. Clicking it opens the side panel
on that mod's tab, exactly as the Files and Changes buttons do; the mod can
be a scratchpad, a list of reviews, anything — its tab joins the one side
panel, one layout, with no layout edit per mod. Herdr (0.1.12) has no
mechanism for it, so this mod is the mechanism, and one day Herdr itself
may be (herdrdev/herdr-app#246).

![Tab host](preview.png)

The preview above is drawn; this is the bar as the app really renders it
(`assets/tab-bar.png`, the example contributor installed):

![The real tab bar: Files and Changes with three contributor buttons](assets/tab-bar.png)

## What you see

- The tab bar, one 42 px row: the shipped `tabs` block on the left (Files,
  Changes, and the window buttons where the platform draws them), then the
  `tabhost-buttons` block at the right end. That block draws one button per
  contributor, styled after the shipped Files and Changes buttons (those
  keep their own buttons — the contributors' are drawn beside them, right of
  everything the shipped tab bar draws; on Linux and Windows that means
  right of the window buttons, as for herdr-issues). Each button is an icon
  when the manifest names one (`*.svg` draws tinted with the text color,
  anything else full color), a title after it, and a chip after that while
  the mod's `badge` key holds a positive number.
- The side panel: the shipped stack (Files, Changes) with one block per
  contributor among them, in bar order — `tabhost-<mod name>`, shown one at
  a time, added when a contributor's folder appears and removed when it
  goes.
- A name a person added by hand (no manifest) gets the mod name capitalized
  and no icon. Files and Changes keep their authored ids and have no `tab`
  in any `mod.json`, so the buttons copy doesn't draw them — the shipped
  tab bar already does.
- The buttons block is as wide as the buttons it draws: a layout file seeds
  a width, the copy corrects it, and both agree from then on. A button that
  isn't drawn takes no room.
- `data/tab-host/reconcile.log` (under the app's home) holds the last 20
  events: the copy starting with its props, each reconcile with the tab
  list it saw, every `layout.set` and resize, each `tab.show` answer, and
  each command a key sent.

## How it behaves

**A contributor joins by declaring a tab in its own `mod.json`** — no
code, no registration, no layout edit:

```json
{ "place": "none", "tab": { "title": "Notes", "icon": "mods/<name>/icon.svg" } }
```

`place: "none"` keeps Herdr from docking a copy anywhere on its own. `icon`
is optional. No code is needed to *join* — only to *be* something when its
tab opens. The same field under the name `button` works too (see #246 under
Watch out), and `shared("tabhost.panels")` — a list of mod names — adds
tabs without a manifest at all.

The optional fields cover the things a contributor's own files cannot do.
`badge` names a `shared()` key the contributor keeps up to date
(`setShared` re-renders every mod); the button draws that number as a chip
after its label, and the label is what truncates when the bar runs out of
room, so the count survives a collapsed panel. `order` is a number that
places the button among the contributors, smaller further left; missing
sorts as 100, ties fall back to the title, so a manifest that says nothing
sits in the alphabet the bar has always used and one that asks moves only
itself. Files and Changes are the shipped `tabs` mod's drawing, so `order`
sorts contributors among themselves. `show` is a shell string run as
`sh -c` in the shown space's folder on that space's machine: exit 0 draws
the button, anything else and an exec that can't start keeps it away,
absent draws always — the field for a mod whose program is on some machines
and not others.

**Buttons and clicks.** The active state is the panel shown *and* its stack
child active, read from `layout()` (which reflects clicks), so a copy that
starts late still highlights the button that is showing. A click does what
the shipped buttons do: shown on it → `layout.hide {panel}`; otherwise
`layout.select {stack, child}` + `layout.show {panel}`. The block's width
is an estimate from the titles and icons, applied with `layout.resize {id,
px}` when it differs. A contributor whose manifest names a `badge` key gets
that chip's width reserved whether or not a number is there, so a count
arriving doesn't resize the bar under the person's cursor.

**Which buttons, in which space.** One layout serves every space, so the
bar is not per space either: `tab.show` answers for the space being shown,
and that is the one fact about a button the person's context changes. The
answers are memoized under everything they depend on — the space's id, its
machine, its folder and the text itself — and they outlive the visit: they
are kept in `localStorage`, so a space the person has been in draws its
buttons the moment it arrives instead of narrowing the block to nothing
and widening it again, and a restart starts just as full. A visit still
asks every question again, once per contributor (`this.asked`, so a render
cannot ask a hundred times), and an answer that comes back different takes
its button away — until then the memo is what is on the screen, not the
truth. A space nobody has visited has no answer to draw from, so it draws
the button and loses only the ones its own answers refuse: unanswered is a
yes until the check says otherwise, because the other way round is a bar
that empties itself on every space change and fills again as the answers
land, the block narrowing to nothing and back — a round trip of it on a
remote space. A tab opened from a button drawn in that window is closed
again by `settle()` the moment the answer lands, which is the price, and a
space that has already said no never draws the button again. `fit()`
filters the same way `render()` does, so a button that is not drawn takes
no room, and `toggleTab()` refuses one, so the key can't open a tab the bar
isn't showing. If the child the panel is showing goes hidden, the copy
selects the first that is still drawn, or hides the panel when none is —
once per change. Every answer is one line in the log (`show roborev → no
(code 1)`), which is the only way to see why a button is missing. The
checks are asked one at a time by a worker the copy starts in `init`:
three fanned out at once to one remote machine came back as one, and two
buttons that never answer are two buttons that never come back.

**Which tab, in which space.** The panel is one column for every space —
one layout serves them all, and `layouts/.state` records one active child
and one hidden flag for all of them — so a space arriving cannot ask the
layout what it had open: the answer is the tab of the space just left. The
shipped tab bar remembers Files and Changes per space, in a
`localStorage` map of its own (`workspace.panels` names the children it
may restore), and hides a child it does not know there — which is why a
tab contributed here used to be closed every time its space came back. So
this copy keeps its own map (`tab-host.open`, space key → child id): a tab
of ours on screen when the person leaves a space is what they left open,
and it is selected and shown again on the way back — in the frame the
space changes, after the tab bar has had its say for that frame, and only
once the space's answers are in, since a button `tab.show` keeps away is
not a tab to put back. A space whose panel was showing Files or Changes
chose those over any tab of ours, and the tab remembered for it goes; a
panel left hidden says nothing either way, because the tab bar hides what
a space did not choose. Closing a tab with its button or its key forgets
it, so a space never hands back a tab the person shut. What a space left
open is read from the last frame that was that space's own (`this.last`),
not from `layout()` as the space changes: a command takes a frame to land,
and another mod decides the panel on that same frame.

**The key** (`tab-host.toggle:<mod>`) is the same copy's `nextCommand()`
loop, and the same `toggleTab(name)` a click runs — one function, so a key
and a button can't drift apart. It reports what it did (`shown`,
`hidden`), so the log line for a press says which way the toggle went.
Only the copy with `buttons: true` acts, so a second copy of the block in
some layout never answers the same press; an unknown name, a missing
stack, a missing panel column, or a button `tab.show` keeps out of this
space is a no-op (logged as such, since a key that does nothing is
otherwise silent), and each press writes one line to the log beside the
clicks.

**The reconciler** (the same copy — and being in the always-visible tab
bar, it never sleeps, so contributors register even while the panel is
hidden): keeps the stack's children in step with the contributors.

- Contributors are read from disk, not from running mods: a mod with
  `place: "none"` never starts until it is shown, so runtime
  self-registration would be a deadlock. `mods/*/mod.json` is the registry,
  and a folder appearing or disappearing is the register/deregister event.
- The tree given to `layout.set` is read from the layout *file*, not from
  `layout()`: the file holds only what was authored, so clicks (sizes,
  hidden, the active child) stay in `layouts/.state/` where they belong and
  are never baked into the file.
- Children are matched by id: `tabhost-<mod name>` is managed (added when
  the manifest appears, removed when it goes), every other id is kept
  untouched. A child whose `content.mod` is already in the stack is not
  added twice.
- The managed children are written in bar order (`tab.order`, missing as
  100, ties by title), so the stack reads the way the buttons do; an
  existing child keeps its own node and only its place moves. The buttons
  copy sorts again at render, which covers the gap between a manifest
  changing and the next `layout.set`.
- `layout.set` runs only on a real diff, and a memory of the last written
  id list keeps one state change to one write even if the copy restarts. A
  set carries the width the layout *file* authored, so the copy forgets
  the width it last asked for and fits the block again afterwards.
- `watchFolder(appHome()/mods)` drives it, so installing a mod shows its
  button at once; a rejected watch falls back to a 5 s poll.
- On a shipped layout (no `cloned_from`), `layout.set` refuses structural
  changes; the buttons still draw and still select what is there, they
  just can't add contributors. Clone the layout to give the power back.

## Built from

**The layout change (once, by `wire.py` — or by hand).** The tab bar
becomes a row with one extra block, and the side panel keeps its stack:

```json
{
  "id": "tab-bar",
  "type": "row",
  "size": { "px": 42 },
  "resizable": false,
  "children": [
    { "id": "tabs", "type": "block", "content": { "mod": "tabs" }, "window_drag": true },
    {
      "id": "tabhost-buttons",
      "type": "block",
      "size": { "px": 90 },
      "window_drag": true,
      "content": {
        "mod": "tab-host",
        "props": { "stack": "panel-body", "panel": "panel", "buttons": true }
      }
    }
  ]
}
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

**The delivery model.** Two kinds of repo meet here, and keeping them
apart is the design:

- **This repo** owns the mechanism: the tab-host mod, the example
  contributor, `install.sh` (deploy + wire + check) and `wire.py` (layout
  wiring). It is the person's, and nothing third parties build runs through
  it.
- **A contributor repo** owns one mod. Its install is a copy into
  `~/.config/herdr-app/mods/<name>/` plus the manifest line; its dependency
  on tab-host is entirely at run time, and absent tab-host it still works
  as a pane. It never runs this repo's scripts and never lands in its
  `mods/`.

The registry that joins them is Herdr's own mods folder — `mods/*/mod.json`
is read from disk by the running tab-host, so installation order doesn't
matter and neither side needs the other's build.

**The files:**

- `mods/tab-host/main.js` — one `View`, one role (the tab bar copy is both
  the buttons and the reconciler). `find` walks a layout tree;
  `manifests()` is the registry reader; `reconcile()` is the whole write
  path; `fit()` keeps the block as wide as its buttons; `tell()` is the
  log.
- `mods/tab-host/mod.json` — `{ "place": "none" }`.
- `wire.py` — the layout wiring: every personal layout's tab bar gets the
  `tabhost-buttons` block (wrap or insert, whichever the shape needs);
  shipped layouts, unreadable files and already-wired layouts are skipped;
  every change is backed up. `install.sh` runs it after copying the mods.
- `AGENTS.md` — the contributor contract for agents; `PROMPT.md` — the
  one-liner a person pastes to send an agent at it.
- `examples/tab-notes/main.js` — `EditorState`/`Editor` from `gpui-base`
  (not `gpui-kit`), one file under `data/tab-notes/`, a `sleep(800)` debounce
  with a `wrote` guard so a burst of typing is one write.
- `examples/tab-notes/mod.json` — the contract, verbatim.
- `layouts/work.json` and `layouts/focus.json` (this Herdr) — wired by
  `wire.py`; `*.bak-wire-*` copies sit beside them.

**The `herdr` functions it calls:** reads `layout()`, `props()`,
`spaces()`, `shared()`; writes `layout.set`, `layout.select`,
`layout.show`, `layout.hide`, `layout.resize`; runs `nextCommand()` for the
toggle key, `exec` for each `tab.show` check, `watchFolder` on the mods
folder; keeps its two maps in `localStorage` (`tab-host.answers`,
`tab-host.open`); the log is rewritten whole from a ring in memory — read
with `readTextFile`, written with `writeTextFile` against what was read,
so a concurrent write loses nothing but a line. It styles with `theme()`
and draws with `div`/`svg`/`image` from `gpui-kit` and `h_flex` from
`gpui-base`. No art of its own: every icon belongs to the contributor that
named it.

## Watch out

- **Don't rebuild the pattern this replaces.** A third party joining
  Herdr's side panel the old way — the way jankeesvw's herdr-issues must —
  renders a button of itself (`props {button: true}`) and ships a whole
  layout clone (`main-issues.json`) that appends its block to `panel-body`
  and bolts its button block beside the `tabs` block. Two such mods mean
  two layout clones to hand-merge, and each clone falls behind Herdr's
  updates to `main` and `tabs`. That combinatorial tax is what tab-host
  removes: one layout change, N contributors, each contributing by
  existing.
- **v1 was the side panel stack's `header`.** The first version drew a
  strip as the stack's `header` — a mod that draws tabs on top of the
  stack, which Herdr's layout format supports and which this Herdr renders.
  It worked, and it avoided touching the tab bar. It was also the wrong
  shape: the strip listed Files and Changes (they are stack children), and
  the tab bar kept its own Files and Changes buttons, so the person saw two
  rows of buttons doing one job. The person's expectation — "a button in
  the top row next to Files and Changes; the row of tabs inside the
  sidebar would not be needed" — is what v2 does. The stack `header`
  remains a working Herdr feature worth knowing about; it just isn't the
  right one here.
- **Ship a mod, not a layout.** A "tab-host" layout in Settings would be a
  frozen clone of a base layout, drifting on every Herdr release, and
  layouts are either/or — picking it means leaving your own. The mod +
  wiring shape keeps the person's layouts theirs: one idempotent block per
  personal layout from `wire.py`, shipped layouts untouched (they can't
  take structural changes; #246's core fix would give them the buttons).
  This was decided after v2; the strip of v1 was the same conclusion
  arrived at sideways.
- **Install as a copy, not a symlink.** The mods first went in as symlinks
  to this repo (the way herdr-issues' README recommends installing). The
  layout applied, `status` showed no errors, the layout named the mod —
  and the mod never ran: no copy, no error, nothing. Every working mod in
  this Herdr is a real directory; the two symlinks were the difference,
  and copying the folders fixed it at once. `install.sh` copies the repo's
  mods into Herdr's home and runs `herdr-app check` on each, so a `git
  pull` reaches the app with one command. Worth an upstream issue;
  `svg()` not following symlinks is already half of one (jankeesvw hit it
  too).
- **A contributor never comes through this repo.** It never runs
  `install.sh` and never lands in `mods/`; its install is its own copy
  into `~/.config/herdr-app/mods/<name>/`, and it should still be worth
  having with tab-host absent (as a pane via `pane.split --mod <name>`).
- **Written against herdr-app 0.1.12.** The build leans on what that
  version does: mods behind symlinked folders don't start, `nextCommand()`
  hands a bound command's argument to the always-visible copy, and the
  per-space answers rest in `localStorage`. If the app behaves
  differently, check these first.
- **The core may take this over** (herdrdev/herdr-app#246, open; draft PR
  #247 waiting on the maintainer): a `button` key in `mod.json`, blocks
  injected by the app into every `panel-body` stack (id
  `mod-panel-<name>`), a `modButtons()` API, and the shipped tab bar
  drawing the buttons. Where they meet: this mod reads `tab` **or**
  `button`, so a contributor written today is already written the way the
  PR proposes; if the PR merges, the reconciler's kept-children rule
  leaves the app's injected blocks alone and adds nothing, and the
  buttons keep drawing (titles then come from `modButtons()`-shaped
  manifests — same fields). What the PR has that this mod does not: it
  works on shipped layouts, and the tab bar remembers per space which
  panel shows. What this mod has that the PR does not: it exists today,
  and it drives any personal stack, not only ones the app names
  `panel-body`.
- **Limits.** One tab-host section per layout is the tested case; the
  `props {stack}` form supports more, but two sections reconciling one
  registry is untested. The buttons sit right of everything the shipped
  tab bar draws; on Linux and Windows that means right of the window
  buttons (as for herdr-issues). The width is an estimate, not a measure;
  a much longer title truncates rather than widening mid-flight (the next
  reconcile fits it).

## Done when

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
second button beside it. `toggleTab` was driven from a timer patch in the
installed copy — synthetic key events need an Accessibility grant this
machine does not have — with the side panel **hidden**: the panel came back
on that contributor's tab, and the next call put it away again.

Spaces were confirmed on the installed copy with the person's own four
contributors and one scratch one whose `show` passes everywhere except one
space (`test "$(pwd)" != …`), reading `reconcile.log` for what changed:

- Second visit to a space: `refit for <space>` and the answers, no resize
  between them — the block never narrows, so no button left the bar.
  Before this, every switch logged the width growing back one answer at a
  time (71 → 151 → 254).
- First visit with the scratch contributor: the bar drew all five buttons
  and one resize took it from 332 to 254 when `show spacecheck → no` came
  back.
- `tab-host.toggle:plannotator` in one space, away, and back: `back to
  tabhost-plannotator in recall`, the panel on that tab, the button
  highlighted. Closing it with the same key first meant no `back to` line —
  a shut tab stays shut.
- Choosing Files in the shipped tab bar and then leaving: the space's entry
  in `data/tab-host/store-*.json` (`tab-host.open`) is gone, and coming
  back restores Files rather than a tab of ours.
- Touching the installed `main.js` to restart the copy: the switch after
  the restart still logged no resize, so the answers and the remembered
  tab came back out of `localStorage`, not out of memory.
