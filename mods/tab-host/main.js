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
// `tab-host.open:<mod>` does what that mod's button does, for a key bound to it
// in keys.json (`"cmd-alt-shift-i": "tab-host.open:tab-notes"`). It has to
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
         readTextFile, writeTextFile, nextCommand } from "herdr";
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
                   badge: typeof tab.badge === "string" ? tab.badge : null });
    } catch { /* not a contributor */ }
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
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

// The number a contributor publishes for its own badge key: read here, never
// computed here. Missing, not a number, or zero means no chip — every caller
// asks this, so the chip and the room it needs can't disagree.
const badgeOf = (key) => {
  if (!key) return 0;
  const n = Math.floor(Number(shared(key) ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// The width N buttons need: their padding, icon and gap, and the label. Text
// has no measurement API here, so the label is letters × an average advance —
// 5.9 px at 12 px on this bar, measured off a real render rather than guessed.
// The row's buttons are pinned to its right edge, so being short by a few
// pixels only slides the button over the tail of the tab strip (no clipping,
// no label lost) while being long leaves a visible hole between the shipped
// buttons and these. Short it is, then.
//
// A button drawing a badge adds that chip's width and its gap — only while it
// is drawing one, or a count that has gone away leaves just such a hole. The
// chip's width is fixed rather than derived from the count, so a number going
// 3 → 4 doesn't resize the bar under the cursor.
function widthOf(entries) {
  if (!entries.length) return 0;
  const one = (e) => 16 + (e.icon ? 19 : 0) + Math.round(e.title.length * 5.9) + (badgeOf(e.badge) ? 26 : 0);
  return entries.reduce((acc, e) => acc + one(e), 0) + 3 * (entries.length - 1);
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
    this.mani = {};    // mod name -> { title, icon, badge }, from the last scan
    this.written = null; // the child-id list the layout last got, so one state change is one layout.set
    this.px = null;      // the width the buttons last asked for
    this.busy = false;
    // A key fills one command's first argument, so neither of the two commands
    // a click runs can be bound; this copy is the always-visible half of the
    // pair, so it takes the one a key can express and does what the button
    // does, including the toggle: on the tab already showing, the panel goes
    // away. Unknown names, a missing stack, a missing panel column: silent
    // no-ops, the way a mod without a tab is simply not a contributor.
    // What arrives is the part after `<mod>.` in the binding — `tab-host.open:
    // <name>` reaches this loop as `open:<name>` — so the prefix it looks for
    // is the command, not the mod.
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
        const name = command.startsWith("open:") ? command.slice("open:".length) : null;
        if (name === null) { this.tell("command \"" + command + "\" ignored"); continue; }
        if (props()?.buttons !== true) {
          this.tell("command \"" + command + "\" left to the buttons copy");
          continue;
        }
        const opened = this.openTab(name);
        this.tell("command \"" + command + "\" → " + (opened ? "opened" : "no tab named " + name));
        if (opened) cx.notify();
      }
    });
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

  // What a contributor's button does, and what `tab-host.open:<mod>` does: show
  // the panel on that tab, or put the panel away when that tab is already the
  // one showing. A click and a key both land here, so they can't drift apart.
  // False for a name that is not in the stack or a props set with no panel:
  // silent, the way a mod without a tab is simply not a contributor.
  openTab(name) {
    const root = layout();
    const stack = myStack(root);
    const panel = props()?.panel ? find(root, props().panel) : null;
    const entry = (stack?.children ?? []).find((c) => c.content?.mod === name);
    if (!entry || !panel) return false;
    if (panel.hidden || stack.active !== entry.id) {
      run("layout.select", { stack: stack.id, child: entry.id });
      run("layout.show", { id: panel.id });
    } else {
      run("layout.hide", { id: panel.id });
    }
    return true;
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
      const have = new Set(kept.map((c) => c.content?.mod).filter(Boolean));
      const extra = shared("tabhost.panels");
      const names = [
        ...list.map((m) => m.name),
        ...(Array.isArray(extra) ? extra.filter((n) => typeof n === "string") : []),
      ];
      const add = [...new Set(names)].filter((n) => n !== "tab-host" && !have.has(n));
      const wanted = [...kept, ...add.map((n) => ({ id: "tabhost-" + n, type: "block", content: { mod: n } }))];
      const before = (stack.children ?? []).map((c) => c.id).join("|");
      const after = wanted.map((c) => c.id).join("|");
      if (before !== after && after !== this.written) {
        this.written = after;
        stack.children = wanted;
        await run("layout.set", { layout: tree });
        this.wrote = "set [" + after + "]";
      } else {
        this.wrote = null;
      }
      this.fit();
    } catch (e) {
      this.warn = String(e?.message ?? e);
      console.log("tab-host: reconcile —", this.warn);
    } finally {
      this.busy = false;
    }
    cx.notify();
    this.tell("reconciled");
  }

  // Keep the buttons block as wide as its buttons. The width asked for is
  // remembered (this.px), not read back: layout() can be stale on a copy's
  // first pass, and layout.resize is cheap and idempotent, so asking once
  // per width change beats measuring. It reads the last scan and the live
  // shared list rather than taking them, so render() can ask for a refit when
  // a badge appears or goes away — the one thing that changes a button's width
  // without the mods folder changing.
  async fit() {
    const block = myBlock(layout());
    if (!block) {
      this.warn = "fit: the buttons block is not in the live layout";
      return;
    }
    const list = Object.values(this.mani ?? {});
    const extra = shared("tabhost.panels");
    const extraNames = Array.isArray(extra) ? extra : [];
    const entries = [
      ...list,
      ...extraNames.filter((n) => typeof n === "string" && !list.some((m) => m.name === n))
        .map((n) => ({ name: n, title: pretty(n), icon: null, badge: null })),
    ].filter((e) => e.name !== "tab-host");
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
    const entries = (stack.children ?? [])
      .filter((c) => String(c.id ?? "").startsWith("tabhost-"))
      .map((c) => {
        const mod = c.content?.mod ?? "";
        const m = this.mani[mod];
        return { id: c.id, mod, title: m?.title ?? pretty(mod),
                 icon: m?.icon ?? null, badge: m?.badge ?? null };
      });
    // A chip needs room, and a chip is the one thing that appears and goes
    // without the mods folder changing, so the block is re-fitted here when the
    // count of chips changes — once per change, not per number: `setShared`
    // re-renders every copy, which is this notice, and no timer is involved.
    const chips = entries.filter((e) => badgeOf(e.badge) > 0).length;
    if (this.chips !== chips) {
      this.chips = chips;
      cx?.spawn?.(async () => {
        this.wrote = null;
        await this.fit();
        // A resize nobody can see in the log is the same blindness a dead key
        // had, so say why the bar changed width this time.
        this.tell("refit for " + chips + " badge" + (chips === 1 ? "" : "s"));
        cx.notify();
      });
    }
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
          if (!this.openTab(e.mod)) return;
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
    return h_flex().size_full().justify_end().px(6).gap(3).items_center()
      .children(entries.map(button));
  }
}
