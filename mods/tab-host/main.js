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
// props: { stack } names the stack whose children the contributors join;
// { panel } names the column the show/hide buttons toggle; { buttons: true }
// marks this copy. The reconciler finds its own block for the width fit.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, run, theme, props, appHome, shared, watchFolder, readTextFile, writeTextFile } from "herdr";
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
        out.push({ name, title: tab.title, icon: typeof tab.icon === "string" ? tab.icon : null });
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

// The width N buttons need: padding, icon, gap, and about six pixels a letter
// at 12 px. A little over is fine; a little under truncates a label.
function widthOf(entries) {
  if (!entries.length) return 0;
  const one = (e) => 16 + (e.icon ? 19 : 0) + Math.round(e.title.length * 6.2);
  return entries.reduce((acc, e) => acc + one(e), 0) + 6 + 3 * (entries.length - 1);
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
    this.mani = {};    // mod name -> { title, icon }, from the last scan
    this.written = null; // the child-id list the layout last got, so one state change is one layout.set
    this.px = null;      // the width the buttons last asked for
    this.busy = false;
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
      this.fit(list, extra);
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
  // per width change beats measuring.
  async fit(list, extra) {
    const block = myBlock(layout());
    if (!block) {
      this.warn = "fit: the buttons block is not in the live layout";
      return;
    }
    const extraNames = Array.isArray(extra) ? extra : [];
    const entries = [
      ...list,
      ...extraNames.filter((n) => typeof n === "string" && !list.some((m) => m.name === n))
        .map((n) => ({ name: n, title: pretty(n), icon: null })),
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

  render() {
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
        return { id: c.id, mod, title: m?.title ?? pretty(mod), icon: m?.icon ?? null };
      });
    const glyph = (icon, color) => {
      if (!icon) return null;
      const el = icon.endsWith(".svg") ? svg(icon) : image(icon);
      return el.size(14).flex_none().text_color(color);
    };
    const button = (e) => {
      const on = shown && active === e.id;
      const color = on ? t.foreground : t.muted;
      return h_flex().id(`th-${e.id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).when(on, (el) => el.bg(t.selected)).text_color(color)
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => {
          if (on) run("layout.hide", { id: p.panel });
          else { run("layout.select", { stack: stack.id, child: e.id }); run("layout.show", { id: p.panel }); }
        })
        .when(Boolean(e.icon), (el) => el.child(glyph(e.icon, color)))
        .child(div().max_w(120).truncate().child(e.title));
    };
    return h_flex().size_full().justify_end().px(6).gap(3).items_center()
      .children(entries.map(button));
  }
}
