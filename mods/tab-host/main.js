// tab-host: mods contribute tabs to a shared section; the tab bar shows them.
//
// The layout gives the tab bar one extra block, and mods do the rest:
//
//   { "id": "tab-bar", "type": "row", "resizable": false, "children": [
//     { "id": "tabs", "type": "block", "content": { "mod": "tabs" }, "window_drag": true },
//     { "id": "tabhost-buttons", "type": "block", "size": { "px": 90 },
//       "content": { "mod": "tab-host",
//                    "props": { "stack": "panel-body", "panel": "panel", "buttons": true } } } ] }
//
// A mod joins by declaring a tab in its own mod.json — no code, no registration:
//
//   { "place": "none", "tab": { "title": "Notes", "icon": "mods/<name>/icon.svg" } }
//
// The buttons copy draws one button per contributor beside Files and Changes
// (they keep their own buttons — the shipped tab bar draws those), shows and
// hides the panel and picks the shown tab exactly as those buttons do, and
// keeps its own width fitted to the buttons it draws (layout.resize).
// The same copy reconciles: when a contributor appears in or disappears from
// mods/, it adds or removes that block in the stack with layout.set (personal
// layouts only). Watched with watchFolder, so a mod installed while Herdr runs
// shows up at once. Being in the always-visible tab bar, this copy never
// sleeps: contributors register even while the panel is hidden.
//
// A person can also add a mod without a manifest: shared("tabhost.panels") is
// a list of extra mod names, set with setShared from any mod or edited into
// shared.json.
//
// Two more things, both optional and both for any contributor, none of them
// the contributor's to build:
//
//   { "tab": { "title": "Notes", "icon": "mods/notes/icon.svg",
//              "badge": "notes.unread" } }
//
// `tab.badge` names a shared() key the contributor keeps up to date (a count
// it sets with setShared, which re-renders every mod); this copy draws it as a
// chip after the button's label, where it stays visible with the panel hidden.
// This copy never counts anything itself.
//
// `tab.order` is a number that says where the button goes among the
// contributors: smaller is further left. Missing — or a manifest that never
// mentions it — sorts as 100, and ties fall back to the title, so the bar reads
// the way it did before anyone ordered anything. Files and Changes keep their
// own buttons (the shipped tabs mod draws those), so this orders the
// contributors among themselves and nothing else.
//
// `tab.show` is a shell string, run as `sh -c` in the shown space's folder and
// on that space's machine — the place a terminal there would start, so it can
// ask the machine the space actually lives on. Exit 0 draws the button; a
// nonzero exit, or an exec that could not start at all (the program isn't
// there, the machine is away), keeps it away. Absent draws always, which is
// what every contributor got before this existed: a mod whose program is
// everywhere omits it, and one whose program is on the laptop and not on the
// build box asks with `command -v`. One answer is one space — the bar is not
// per space, so the check runs again when the shown space changes, and the
// button stays away until the answer for that space arrives.
//
// `tab-host.toggle:<mod>` opens that mod's tab or closes it again, for a key
// bound to it in keys.json (`"cmd-alt-shift-i": "tab-host.toggle:tab-notes"`).
// It has to
// live here: keys.json fills a command's first argument only, so the two
// commands a click runs (layout.select, layout.show) can't be bound, and a
// contributor's own copy is asleep whenever its tab is hidden — which is when
// the key is wanted. This copy is in the always-visible tab bar, so it answers.
//
// props: { stack } names the stack whose children the contributors join;
// { panel } names the column the show/hide buttons toggle; { buttons: true }
// marks this copy. The reconciler finds its own block for the width fit.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, run, theme, props, appHome, shared, watchFolder,
         readTextFile, writeTextFile, nextCommand, exec, spaces } from "herdr";
import * as fs from "fs/promises";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Every installed mod that wants a tab. A missing or broken mod.json, or one
// without a tab, is just not a contributor — never an error. Entries are
// symlinks as often as folders (the usual way a repo mod is installed), so
// every name gets a read and only a readable mod.json with a tab counts.
// The manifest is "tab"; herdrdev/herdr-app#246 proposes "button" for the same
// idea in the core, so either key joins here — one mod, one field, and the
// same field keeps working if the core takes the idea over.
//
// Where a contributor's button goes in the bar when there is more than one:
// `tab.order`, a number, smaller first. Missing or not a number sorts as 100,
// so a mod that never asked sits in the middle and one that wants the left end
// picks something smaller. Ties — the usual case, since most manifests say
// nothing — fall back to the title, which is the order the bar had before this
// field existed. A name a person added by hand (shared("tabhost.panels")) has
// no manifest, so it gets the default order and its prettied name as a title.
const DEFAULT_ORDER = 100;
const orderOf = (n) => (typeof n === "number" && Number.isFinite(n) ? n : DEFAULT_ORDER);
const byOrder = (a, b) =>
  a.order - b.order || a.title.localeCompare(b.title) || a.name.localeCompare(b.name);

async function manifests() {
  const root = appHome() + "/mods";
  let names;
  try { names = await fs.readdir(root); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    try {
      const meta = JSON.parse(await fs.readFile(root + "/" + name + "/mod.json", "utf8"));
      const tab = meta.tab ?? meta.button;
      if (tab && typeof tab === "object" && typeof tab.title === "string")
        out.push({ name, title: tab.title,
                   icon: typeof tab.icon === "string" ? tab.icon : null,
                   badge: typeof tab.badge === "string" ? tab.badge : null,
                   show: typeof tab.show === "string" ? tab.show : null,
                   order: orderOf(tab.order) });
    } catch { /* not a contributor */ }
  }
  out.sort(byOrder);
  return out;
}

// The stack whose children the contributors join, and this copy's own block
// (the one whose content names this mod with buttons: true, for the width fit).
function myStack(root) {
  const want = props()?.stack;
  return want ? find(root, want) : null;
}

function myBlock(root) {
  const walk = (n) => {
    if (n?.content?.mod === "tab-host" && n.content?.props?.buttons) return n;
    for (const c of n?.children ?? []) {
      const found = walk(c);
      if (found) return found;
    }
    for (const f of n?.floating ?? []) {
      const found = walk(f);
      if (found) return found;
    }
    return null;
  };
  return walk(root);
}

const pretty = (name) => name.charAt(0).toUpperCase() + name.slice(1);

// Every contributor the bar draws, in bar order: the manifests the last scan
// found, plus any name a person added by hand with shared("tabhost.panels").
// Both callers want the same list in the same order — the reconciler writes it
// as the stack's children, and fit() measures the widths it needs — so it is
// one function rather than two that could disagree.
function ordered(mani, extra) {
  const list = Object.values(mani ?? {});
  const have = new Set(list.map((m) => m.name));
  for (const n of Array.isArray(extra) ? extra : [])
    if (typeof n === "string" && !have.has(n)) {
      have.add(n);
      list.push({ name: n, title: pretty(n), icon: null, badge: null, order: DEFAULT_ORDER });
    }
  return list.filter((e) => e.name !== "tab-host").sort(byOrder);
}

// The shell string a contributor's button is conditional on, or null for a
// button that is always there. Blank is the same as absent: a manifest that
// says "show": "" means nothing by it.
const showText = (m) => (typeof m?.show === "string" && m.show.trim() ? m.show : null);

// Everything an answer to that check depends on: which space it asks about
// (id), where that space is (machine, folder) and what was asked (the text).
// Any of the four changing makes the old answer stale — including the folder
// moving under the same space id, which is how a worktree space becomes a
// different checkout.
const spaceKey = (s) => [s.id, s.machine ?? "", s.folder ?? ""].join("\u0000");
const checkKey = (space, text) => spaceKey(space) + "\u0000" + text;
const activeSpace = () => spaces().find((s) => s.active) ?? null;

// The number a contributor publishes for its own badge key: read here, never
// computed here. Missing, not a number, or zero means no chip — every caller
// asks this, so the chip and the room it needs can't disagree.
const badgeOf = (key) => {
  if (!key) return 0;
  const n = Math.floor(Number(shared(key) ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// The width the buttons block needs: the row's own padding, then per button its
// padding, icon and gap and label, then the gaps between buttons. Text has no
// measurement API here, so the label is letters × an average advance — 5.9 px
// at 12 px on this bar, measured off a real render rather than guessed — and
// rounded up.
//
// The row's px(6) on each side counts, and used to be left out: the block is
// set to exactly this width, so a row 12 px wider than its block — with the
// buttons pinned to its right edge — has its excess pushed off the *left*,
// where the block clips it. That cut the left of the first button's pill, the
// highlighted tab: a squared-off corner, the icon sitting 2 px from the edge
// instead of the 8 px its padding asks for.
//
// The estimate rounds up for the same reason: the two ways of being wrong are
// not equal. A pixel or two over leaves that much of the row's own background
// between the shipped tab strip and these buttons, which nobody can see; a
// pixel or two under is a clipped pill, which they can.
//
// A button drawing a badge adds that chip's width and its gap — only while it
// is drawing one, or a count that has gone away leaves just such a hole. The
// chip's width is fixed rather than derived from the count, so a number going
// 3 → 4 doesn't resize the bar under the cursor.
const ROW_PX = 12; // the row's own px(6), left and right
function widthOf(entries) {
  if (!entries.length) return 0;
  const one = (e) => 16 + (e.icon ? 19 : 0) + Math.ceil(e.title.length * 5.9) + (badgeOf(e.badge) ? 26 : 0);
  return ROW_PX + entries.reduce((acc, e) => acc + one(e), 0) + 3 * (entries.length - 1);
}

// The one file this mod rewrites: read what is there, write the new whole.
// A missing file reads as nothing, and a read that rejects reads as nothing too.
async function rewrite(path, text) {
  let cur = null;
  try { cur = await readTextFile(path); } catch { /* not there yet */ }
  await writeTextFile(path, text, cur ?? null);
}

export default class TabHost extends View {
  init(_props, cx) {
    this.tell("start " + JSON.stringify(props() ?? null));
    this.mani = {};    // mod name -> { title, icon, badge, show, order }, from the last scan
    this.written = null; // the child-id list the layout last got, so one state change is one layout.set
    this.px = null;      // the width the buttons last asked for
    this.chips = null;   // chips drawn last render; null until one has been seen
    this.busy = false;
    // What each contributor's tab.show answered where the person is now standing:
    // checkKey() -> true (draw) or false (don't). A key that isn't here has no
    // answer yet, which draws nothing — see visibleHere(). Drop in this.space
    // when the shown space changes, so an answer never outlives what it was
    // about.
    this.checks = new Map();
    this.asking = new Set(); // check keys whose exec is out, or waiting its turn
    this.queue = [];         // checks waiting for the worker, oldest first
    this.kick = null;        // the worker's resolver while it has nothing to do
    this.space = "";         // the space every answer here belongs to (spaceKey)
    this.settled = null;     // the state the active-child decision was last made for
    // A key fills one command's first argument, so neither of the two commands
    // a click runs can be bound; this copy is the always-visible half of the
    // pair, so it takes the one a key can express and does what the button
    // does, including the toggle: on the tab already showing, the panel goes
    // away. Unknown names, a missing stack, a missing panel column: silent
    // no-ops, the way a mod without a tab is simply not a contributor.
    // What arrives is the part after `<mod>.` in the binding — `tab-host.toggle:
    // <name>` reaches this loop as `toggle:<name>` — so the prefix it looks for
    // is the command, not the mod. `open:` is the name this had in its first
    // cut; it still answers, so a binding written then keeps working.
    cx.spawn(async (cx) => {
      this.tell("key loop ready");
      for (;;) {
        let command;
        try { command = String((await nextCommand()) ?? ""); }
        catch (e) {
          // The copy going away: said once, rather than a silent stop that would
          // read from the outside exactly like a key that does nothing.
          this.tell("key loop closed: " + (e?.message ?? e));
          break;
        }
        // Every command is logged. A key that does nothing is the one thing the
        // person can't inspect from outside, so one press is one line beside the
        // clicks. Only the buttons copy acts: a layout carrying another copy of
        // this mod without `buttons` must not answer the same press as well.
        const name = /^(?:toggle|open):/.test(command) ? command.slice(command.indexOf(":") + 1) : null;
        if (name === null) { this.tell("command \"" + command + "\" ignored"); continue; }
        if (props()?.buttons !== true) {
          this.tell("command \"" + command + "\" left to the buttons copy");
          continue;
        }
        const did = this.toggleTab(name);
        this.tell("command \"" + command + "\" → " + (did || "no " + name + " button here"));
        if (did) cx.notify();
      }
    });
    // The tab.show worker: one exec at a time, woken by ask() and alive as long
    // as this copy is, so a check is started by init rather than by a render.
    cx.spawn((cx) => this.drain(cx));
    cx.spawn(async (cx) => {
      await this.reconcile(cx);
      try {
        for (;;) {
          await watchFolder(appHome() + "/mods");
          await this.reconcile(cx);
        }
      } catch (e) {
        // No watcher here (a rejected watch, the old build going away): poll gently.
        console.log("tab-host: watching mods/ failed, polling instead —", e?.message ?? e);
        cx.timer.every(5000, (cx) => this.reconcile(cx));
      }
    });
  }

  // What a contributor's button does, and what `tab-host.toggle:<mod>` does:
  // show the panel on that tab, or put the panel away when that tab is already
  // the one showing. A click and a key both land here, so they can't drift
  // apart. Says which it did — "shown", "hidden" — or false for a name that is
  // not in the stack, a props set with no panel, or a button that tab.show keeps
  // out of this space: silent, the way a mod without a tab is simply not a
  // contributor. A hidden tab is the case worth naming: its button is not on
  // screen, so a click can't reach it, and a key bound to it opens a tab the bar
  // is not offering.
  toggleTab(name) {
    const root = layout();
    const stack = myStack(root);
    const panel = props()?.panel ? find(root, props().panel) : null;
    const entry = (stack?.children ?? []).find((c) => c.content?.mod === name);
    if (!entry || !panel) return false;
    if (!this.visibleHere(this.mani[name], activeSpace())) return false;
    if (panel.hidden || stack.active !== entry.id) {
      run("layout.select", { stack: stack.id, child: entry.id });
      run("layout.show", { id: panel.id });
      return "shown";
    }
    run("layout.hide", { id: panel.id });
    return "hidden";
  }

  // Is this contributor's button drawn where the person is standing now? No
  // tab.show draws it, whatever the space; one that has an answer draws it when
  // that answer was yes. No answer yet is not a yes: the check answers in
  // milliseconds here and a round trip away, and a button that arrives a beat
  // after its space does is better than one that appears and then goes, taking
  // a click with it. Everything that decides what is on screen asks this —
  // render, fit, toggleTab, the active-child fix below — so the bar, the room
  // it takes and the tabs a key may open cannot disagree.
  visibleHere(m, space) {
    const text = showText(m);
    if (!text) return true;
    return Boolean(space) && this.checks.get(checkKey(space, text)) === true;
  }

  // Ask every conditional contributor about this space, once each: the answers
  // live in this.checks under everything they depend on, and the ones that are
  // not this space's are dropped, along with any check still waiting its turn,
  // when the shown space changes. Called from render, which is where a space
  // change (live spaces(), re-rendered by Herdr) arrives.
  checkSpace(space, cx) {
    const here = space ? spaceKey(space) : "";
    if (here !== this.space) {
      this.space = here;
      for (const key of [...this.checks.keys()])
        if (!key.startsWith(here + "\u0000")) this.checks.delete(key);
      this.queue = this.queue.filter((job) => {
        if (job.key.startsWith(here + "\u0000")) return true;
        this.asking.delete(job.key);
        return false;
      });
      this.settled = null;
    }
    if (!space) return;
    for (const m of Object.values(this.mani))
      this.ask(m, space, cx);
  }

  // Queue one contributor's tab.show. The exec itself runs in the one worker
  // drain() owns, never here: render runs constantly, and a task started by it
  // is not the place for work whose answer has to arrive.
  ask(m, space, cx) {
    const text = showText(m);
    if (!text) return;
    const key = checkKey(space, text);
    if (this.checks.has(key) || this.asking.has(key)) return;
    this.asking.add(key);
    this.queue.push({ name: m.name, space, key, text });
    this.kick?.();
  }

  // One tab.show at a time, for the life of this copy. Asking a machine several
  // things at once is what loses answers — three checks fanned out to one remote
  // machine came back as one, the other two never answering at all — and a check
  // with no answer is a button that never comes back, which is worse than a
  // button that arrives late. The checks are one `command -v` each, so the queue
  // costs nothing that can be felt.
  async drain(cx) {
    for (;;) {
      if (!this.queue.length) {
        await new Promise((resolve) => { this.kick = resolve; });
        continue;
      }
      await this.check(this.queue.shift(), cx);
    }
  }

  // What the queued ask does: run the string where the space lives, and apply
  // the exit code. 0 draws, anything else does not, and an exec that couldn't
  // start at all (no sh, the folder gone, the machine away) is a no as well — a
  // check that can't run is not permission.
  async check(job, cx) {
    const { name, space, key, text } = job;
    let ok = false;
    let why;
    try {
      const r = await exec("sh", ["-c", text], { cwd: space.folder || undefined, on: space.machine });
      ok = r.code === 0;
      why = "code " + r.code;
    } catch (e) {
      why = "exec failed: " + (e?.message ?? e);
    }
    this.asking.delete(key);
    // The space moved on while this ran: its answer is about a space nobody is
    // in any more, and the next one to be entered asks again.
    if (!key.startsWith(this.space + "\u0000")) return;
    this.checks.set(key, ok);
    const what = "show " + name + " → " + (ok ? "yes" : "no") + " (" + why + ")";
    // The bar loses or gains a button: the block is now the wrong width, and the
    // panel may be showing a tab that just went away. Both after the answer is
    // in, so the log line carries what the answer changed.
    this.wrote = null;
    await this.fit();
    this.tell(what);
    this.settle();
    cx.notify();
  }

  // Whether a check for this space is still out. The active-child fix waits for
  // it: an answer that arrives a moment later can change which buttons are
  // drawn, and moving the panel twice in that moment is a flash for nothing.
  pending(space) {
    if (!space) return false;
    const head = spaceKey(space) + "\u0000";
    for (const key of this.asking) if (key.startsWith(head)) return true;
    return false;
  }

  // The panel shows one child, and one whose button tab.show keeps out of this
  // space has no business being it — the person would see a tab the bar is not
  // offering. Move to the first child that is still drawn, or put the panel away
  // when none is. Once per change: the state this was last decided for is
  // remembered, so a re-render with the same answers runs nothing.
  settle() {
    const root = layout();
    const stack = myStack(root);
    const panel = props()?.panel ? find(root, props().panel) : null;
    if (!stack || !panel) return;
    const space = activeSpace();
    if (this.pending(space)) return;
    const kids = (stack.children ?? []).filter((c) => String(c.id ?? "").startsWith("tabhost-"));
    const drawn = kids.filter((c) => this.visibleHere(this.mani[c.content?.mod], space));
    const mark = [stack.active, panel.hidden ? "hidden" : "shown", drawn.map((c) => c.id).join(",")].join("|");
    if (mark === this.settled) return;
    this.settled = mark;
    const active = kids.find((c) => c.id === stack.active);
    if (!active || drawn.some((c) => c.id === active.id)) return;
    if (drawn.length) {
      run("layout.select", { stack: stack.id, child: drawn[0].id });
      this.tell("active " + active.id + " is not drawn here → select " + drawn[0].id);
    } else {
      run("layout.hide", { id: panel.id });
      this.tell("active " + active.id + " is not drawn here → hide " + panel.id);
    }
  }

  // Keep the stack's children in step with the contributors. The tree that
  // layout.set gets comes from the layout file, not from layout(): the file
  // holds only what was authored, so clicks (sizes, hidden, the active child)
  // keep living in layouts/.state/ where they belong.
  async reconcile(cx) {
    if (this.busy) return;
    const name = shared("layout");
    if (!name) return;
    this.busy = true;
    try {
      const list = await manifests();
      this.mani = Object.fromEntries(list.map((m) => [m.name, m]));
      this.seen = list.map((m) => m.name);
      const tree = JSON.parse(await fs.readFile(appHome() + "/layouts/" + name + ".json", "utf8"));
      if (!tree.cloned_from) throw new Error("the shown layout is shipped; clone it so tab-host can add children");
      const stack = myStack(tree);
      if (!stack || stack.type !== "stack") return;
      this.warn = null;
      const kept = (stack.children ?? []).filter((c) => !String(c.id ?? "").startsWith("tabhost-"));
      const hand = new Set(kept.map((c) => c.content?.mod).filter(Boolean));
      // The contributors in bar order, so the children are written in the order
      // the buttons are read in and nothing has to sort them at draw time. A
      // contributor already in the stack keeps its own node — only its place
      // moves — and one already there under a hand-written id is left alone.
      const ours = new Map((stack.children ?? [])
        .filter((c) => String(c.id ?? "").startsWith("tabhost-"))
        .map((c) => [c.content?.mod, c]));
      const wanted = [...kept];
      for (const e of ordered(this.mani, shared("tabhost.panels")))
        if (!hand.has(e.name))
          wanted.push(ours.get(e.name)
            ?? { id: "tabhost-" + e.name, type: "block", content: { mod: e.name } });
      const before = (stack.children ?? []).map((c) => c.id).join("|");
      const after = wanted.map((c) => c.id).join("|");
      if (before !== after && after !== this.written) {
        this.written = after;
        stack.children = wanted;
        await run("layout.set", { layout: tree });
        this.wrote = "set [" + after + "]";
        // The tree just set carries the width the layout *file* authored, which
        // is the seed wire.py wrote, not the width this copy last asked for — so
        // forget it and let the fit below ask again. Without this, a set (a mod
        // installed, removed, or reordered) narrows the block to the seed and no
        // later fit notices, because this.px still names the wider one.
        this.px = null;
      } else {
        this.wrote = null;
      }
      this.fit();
      this.settle();
    } catch (e) {
      this.warn = String(e?.message ?? e);
      console.log("tab-host: reconcile —", this.warn);
    } finally {
      this.busy = false;
    }
    cx.notify();
    this.tell("reconciled");
  }

  // Keep the buttons block as wide as its buttons — the ones this space draws,
  // which is the same filter render() applies, so a button that is not there
  // takes no room and one that arrives gets its room back. The width asked for
  // is remembered (this.px), not read back: layout() can be stale on a copy's
  // first pass, and layout.resize is cheap and idempotent, so asking once
  // per width change beats measuring. It reads the last scan and the live
  // shared list rather than taking them, so render() can ask for a refit when
  // a badge appears or goes away — the one thing besides tab.show that changes
  // a button's width without the mods folder changing.
  async fit() {
    const block = myBlock(layout());
    if (!block) {
      this.warn = "fit: the buttons block is not in the live layout";
      return;
    }
    const space = activeSpace();
    const entries = ordered(this.mani, shared("tabhost.panels"))
      .filter((e) => this.visibleHere(e, space));
    const want = widthOf(entries);
    if (want !== this.px) {
      this.px = want;
      await run("layout.resize", { id: block.id, px: want });
      this.wrote = (this.wrote ? this.wrote + "; " : "") + "resize " + block.id + " → " + want;
    }
  }

  // What this copy did, for data/tab-host/reconcile.log. A small ring in
  // memory, rewritten whole — no appends, so the file stays readable. Every
  // line names the stack it serves, so copies for two layouts can share the
  // one file without their lines being mistaken for each other's.
  tell(what) {
    const slot = props()?.stack ? " " + props().stack : "";
    const stamp = this.seen ? " tabs=[" + this.seen.join(",") + "]" : "";
    const line = new Date().toISOString().slice(11, 23) + slot + " " + what + stamp
      + (this.wrote ? " " + this.wrote : "") + (this.warn ? " WARN: " + this.warn : "");
    this.log = [...(this.log ?? []), line].slice(-20);
    rewrite(appHome() + "/data/tab-host/reconcile.log", this.log.join("\n") + "\n")
      .catch((e) => console.log("tab-host: log —", e?.message ?? e));
  }

  render(cx) {
    const t = theme();
    const root = layout();
    const stack = myStack(root);
    if (!stack) return div();
    const p = props() ?? {};
    const panel = p.panel ? find(root, p.panel) : null;
    const shown = Boolean(panel && !panel.hidden);
    const active = stack.active ?? null;
    // tab.show is asked here, because this is where a change of space arrives:
    // spaces() is live data, so Herdr re-renders every copy when the shown space
    // changes, and this copy is one of them.
    const space = activeSpace();
    this.checkSpace(space, cx);
    const entries = (stack.children ?? [])
      .filter((c) => String(c.id ?? "").startsWith("tabhost-"))
      .map((c) => {
        const mod = c.content?.mod ?? "";
        const m = this.mani[mod];
        return { id: c.id, name: mod, title: m?.title ?? pretty(mod),
                 order: orderOf(m?.order), icon: m?.icon ?? null, badge: m?.badge ?? null };
      })
      // A contributor this space doesn't draw is not a button: no pill, no chip,
      // no room taken.
      .filter((e) => this.visibleHere(this.mani[e.name], space))
      // The reconciler writes the children in bar order; sorting again here is
      // what the gap between a manifest changing and the next layout.set gets,
      // and it makes the buttons independent of how the stack happens to be
      // stored in some layout file.
      .sort(byOrder);
    // A chip needs room, and a chip is the one thing that appears and goes
    // without the mods folder changing, so the block is re-fitted here when the
    // count of chips changes — once per change, not per number: `setShared`
    // re-renders every copy, which is this notice, and no timer is involved.
    // The first render only records the count: before the first scan there are
    // no titles to measure, and asking for a width then would fit the block to
    // nothing.
    const chips = entries.filter((e) => badgeOf(e.badge) > 0).length;
    if (this.chips !== null && this.chips !== chips) {
      cx?.spawn?.(async () => {
        this.wrote = null;
        await this.fit();
        // A resize nobody can see in the log is the same blindness a dead key
        // had, so say why the bar changed width this time.
        this.tell("refit for " + chips + " badge" + (chips === 1 ? "" : "s"));
        cx.notify();
      });
    }
    this.chips = chips;
    const glyph = (icon, color) => {
      if (!icon) return null;
      const el = icon.endsWith(".svg") ? svg(icon) : image(icon);
      return el.size(14).flex_none().text_color(color);
    };
    const button = (e) => {
      const on = shown && active === e.id;
      const color = on ? t.foreground : t.muted;
      const n = badgeOf(e.badge);
      return h_flex().id(`th-${e.id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).when(on, (el) => el.bg(t.selected)).text_color(color)
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => {
          if (!this.toggleTab(e.name)) return;
          cx.notify();
        })
        .when(Boolean(e.icon), (el) => el.child(glyph(e.icon, color)))
        .child(div().max_w(120).truncate().child(e.title))
        // flex_none after the truncating label: a narrow tab bar shortens the
        // title and keeps the count, which is the whole point of the chip.
        .when(n > 0, (el) => el.child(div().flex_none().px(5).rounded(99)
          .bg(t.accent).text_color(t.accent_foreground).text_size(9.5)
          .child(n > 9 ? "9+" : String(n))));
    };
    return h_flex().size_full().justify_end().px(ROW_PX / 2).gap(3).items_center()
      .children(entries.map(button));
  }
}
