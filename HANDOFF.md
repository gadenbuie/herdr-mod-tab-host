# HANDOFF — a key for a contributor's tab, and a badge on its button

Two things a contributor cannot do for itself, written up for whoever works in
this repo next. Both come from `~/play/gadenbuie/herdr-mod-plannotator`
(installed at `~/.config/herdr-app/mods/plannotator/`), but **neither may end up
plannotator-shaped**: any contributor with a tab should get both features.

## The prompt to give an agent

```text
Read ~/play/gadenbuie/herdr-mod-tab-host/HANDOFF.md and do the two changes it
describes: a `tabhost.open:<mod>` key command, and a badge on a contributor's
button fed by shared state. Keep both generic — no contributor's name may
appear in mods/tab-host/main.js — and follow AGENTS.md's rules for this repo
(the tab is a manifest, contributors never edit a layout). When
`herdr-app check` passes, install with rsync the way AGENTS.md says, and prove
each change the way the "Check before calling it done" section of HANDOFF.md
lists. Tell me what you changed and what you saw.
```

## Why a key needs tab-host

A contributor cannot put its own tab on the screen from a key. Three facts,
each checked against Herdr 0.1.12 and its bundle:

1. **A key fills one argument.** `keys.json` actions are `name` or
   `name:value`, and "the value fills the command's first argument". Showing a
   tab takes two commands — `layout.select {stack, child}` then
   `layout.show {id}` — and `layout.select` needs two arguments. A button can
   run both in a row; a key cannot run either.
2. **A hidden block receives no commands.** With the side panel hidden,
   `herdr-app do plannotator.palette` opened nothing (no overlay, no error), so
   a command of the contributor's own never arrives while its tab is shut. A
   contributor can only answer a key while it is on screen — which is exactly
   when the key is not needed.
3. **The always-visible block is this mod's.** `tabhost-buttons` sits in the
   tab bar, never sleeps (that is why contributors register while the panel is
   hidden), and already runs the two commands a click needs. It just has no
   `nextCommand()` loop.

So the command belongs here, and it is worth writing generically: it gives
every contributor a key, not one.

## Proposal 1 — `tabhost.open:<mod>`

`keys.json` gets `"cmd-alt-shift-i": "tabhost.open:plannotator"`; the buttons
copy receives `open:plannotator` from `nextCommand()` and does what its button
does, including hiding the panel when that tab is already showing.

```js
// mods/tab-host/main.js — add nextCommand to the herdr import
import { layout, run, theme, props, appHome, shared, watchFolder,
         readTextFile, writeTextFile, nextCommand } from "herdr";

// in init(), next to the reconciler spawn
    // A key fills only a command's first argument, so `layout.select` can't be
    // bound; this copy is the always-visible half of the pair, so it takes the
    // command a key can express. Same two commands as the button, and the same
    // toggle: pressing it on the tab that is already showing puts the panel away.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = String((await nextCommand()) ?? "");
        if (!command.startsWith("open:") || props()?.buttons !== true) continue;
        const name = command.slice(5);
        const root = layout();
        const stack = myStack(root);
        const panel = props()?.panel ? find(root, props().panel) : null;
        const entry = (stack?.children ?? []).find((c) => c.content?.mod === name);
        if (!entry || !panel) continue;
        if (panel.hidden || stack.active !== entry.id) {
          run("layout.select", { stack: stack.id, child: entry.id });
          run("layout.show", { id: panel.id });
        } else {
          run("layout.hide", { id: panel.id });
        }
        this.tell("open " + name);
        cx.notify();
      }
    });
```

Notes:

- `props()?.buttons !== true` keeps the reconciler copy (a layout that carries
  the same block without `buttons`) from acting on the same command. If a
  second buttons copy ever exists, this guard is not enough — a
  `shared()`/`localStorage` claim per press would be, the way `ANNOUNCE` in
  plannotator marks a log so two copies toast once.
- Unknown names, a missing stack, a missing panel column: silent no-ops, the
  way a broken `mod.json` is not a contributor. Never throw from this loop.
- `this.tell(...)` writes the same `data/tab-host/reconcile.log` line the
  reconciler writes, so a key press is visible in the log beside the clicks.

## Proposal 2 — a badge on the contributor's button

The person asked for the "unread" count on the tab label, so that it can be
seen **while the side panel is collapsed** — which is the state the panel is in
most of the time. A badge on the button is the only place that survives that:
the button lives in the always-visible tab bar.

The mechanism already exists: `shared(key)` / `setShared(key, value)` is
app-wide, every mod sees it, and **setting re-renders all** mods. So the
contributor publishes a number and this mod draws it — no polling, no
contributor-specific code.

### The manifest names the key

```json
{ "place": "none",
  "tab": { "title": "Plannotator", "icon": "mods/plannotator/icon.svg",
           "badge": "plannotator.waiting" } }
```

- `tab.badge` (optional string): a `shared()` key the contributor keeps up to
  date. Absent: no badge, exactly as today.
- Read it in `manifests()` beside `title` and `icon`, and carry it on the entry.
- One key per contributor rather than one map for all of them: two mods writing
  one `shared()` object would race each other's read-modify-write.

### Drawing it

In `render()`, the entry gets its number and the button draws a chip after the
label:

```js
const badge = entry.badge ? Number(shared(entry.badge) ?? 0) : 0;
...
      .child(div().max_w(120).truncate().child(e.title))
      .when(badge > 0, (el) => el.child(div().flex_none().px(5).rounded(99)
        .bg(t.accent).text_color(t.accent_foreground).text_size(9.5)
        .child(badge > 9 ? "9+" : String(badge))))
```

- `flex_none` **after** the truncating label is what makes the badge the last
  thing to go when the tab bar is narrow: the title truncates, the number does
  not. That is the whole point of the ask.
- Style it with the shipped references so it reads as part of the bar: the
  space tabs draw a 6 px `div().size(6).rounded(3).bg(t[c.status])` for
  attention, and the panel's own button is `h(26).px(8).gap(5).rounded(6)`
  (`tabs/main.js`). A count chip matches plannotator's own header chip
  (`px(6).rounded(99).bg(t.accent).text_color(t.accent_foreground)`), so the
  button and the panel agree at a glance.
- No second source of truth here: this mod renders the number it is given and
  never computes one. If the key is missing or not a number, draw nothing.

### The contributor side (already possible today)

plannotator's side-panel copy is alive while hidden — proven: with the panel
hidden, a decision written into a session log became a Herdr toast a second
later, because that copy's `watchFolder` loop ran. The same copy already holds
the thread list and the count that wants the person, so it can publish:

```js
const want = this.threads.filter((t) => t.state === "answer").length;
if (shared("plannotator.waiting") !== want) setShared("plannotator.waiting", want);
```

guarded exactly like that: `setShared` re-renders every mod, so it must not run
on every tick with an unchanged value. That is the contributor's commit to make
once `tab.badge` exists; nothing else about it belongs in this repo.

### One thing to decide with the person

Which number is the badge? plannotator has two interesting ones: threads
**waiting on the person** (its header chip, the yellow dots) and threads **new
since they last looked** (blue). The badge above is the waiting count, because
that is the one that wants action. If both are wanted, the quieter one is a
6 px dot (`bg(t.ansi4)`) before the chip, and the manifest grows
`tab.badgeDot` — do not invent it without asking.

## Check before calling it done

- `herdr-app check ~/.config/herdr-app/mods/tab-host` passes, and
  `data/tab-host/reconcile.log` still ends with the reconcile line it wrote
  before the change (nothing about registering contributors may move).
- With the side panel **hidden**, `herdr-app do tabhost.open:plannotator`
  (or the key) shows the panel on that contributor's tab, and the same command
  again hides it. `herdr-app status` reports no errors.
- With the panel hidden, a nonzero `shared()` value for a `tab.badge` key
  draws the chip on the button — check it with a synthetic value
  (`setShared("plannotator.waiting", 3)` from a scratch mod or the console)
  before trusting the contributor's own number.
- Narrow the window until the button label truncates: the chip stays, the title
  goes. That is the case the person asked for.
- `grep -n -i plannotator mods/tab-host/main.js` returns nothing, in the code
  as well as this file's prompt: both features must work for a contributor that
  does not exist yet.

## Don't

- Don't special-case a contributor, and don't let a contributor's needs change
  the manifest contract twice: `tab.title`/`tab.icon` stay as they are, and
  both additions are optional fields.
- Don't poll in this copy for a badge value; `shared()` already re-renders on
  every set.
- Don't make the key press one of the layout commands with a second argument
  bolted on — `keys.json` cannot express it, which is the whole reason this
  file exists.
