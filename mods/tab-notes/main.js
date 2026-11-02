// tab-notes: the example tab-host contributor.
//
// The whole contract is the tab in its mod.json:
//
//   { "place": "none", "tab": { "title": "Notes", "icon": "mods/tab-notes/note.svg" } }
//
// No registration code: tab-host reads the manifest, adds the block to its
// stack, and this mod starts the first time its tab is picked. A scratchpad
// that saves as you type, to ~/.config/herdr-app/data/tab-notes/notes.md.

import { View, div } from "gpui-kit";
import { Editor, EditorState, h_flex, v_flex } from "gpui-base";
import { appHome, theme } from "herdr";
import * as fs from "fs/promises";

const DIR = () => appHome() + "/data/tab-notes";
const FILE = () => DIR() + "/notes.md";

export default class Notes extends View {
  init(_props, cx) {
    this.ready = false;
    this.text = "";
    this.wrote = null; // what last reached the file, so a debounce pile-up writes once
    this.saving = false;
    cx.spawn(async (cx) => {
      let text = "";
      try { text = await fs.readFile(FILE(), "utf8"); } catch { /* first run */ }
      this.text = text;
      this.state = EditorState.new({ value: text, soft_wrap: true, line_numbers: false, font_size: 12.5 });
      this.state.on("change", (_e, cx) => {
        this.text = this.state.value();
        // Every burst of typing gets one write: sleep out the pause, then flush.
        cx.spawn(async (cx) => { await cx.sleep(800); await this.flush(cx); });
      });
      this.ready = true;
      cx.notify();
    });
  }

  async flush(cx) {
    if (this.saving) return; // a write in flight will pick this.text up on its next pass
    this.saving = true;
    try {
      while (this.text !== this.wrote) {
        await fs.mkdir(DIR(), { recursive: true });
        await fs.writeFile(FILE(), this.text, "utf8");
        this.wrote = this.text;
        this.saved = Date.now();
        this.error = null;
        cx.notify();
      }
    } catch (e) {
      this.error = String(e?.message ?? e);
      cx.notify();
    } finally {
      this.saving = false;
    }
  }

  render(cx) {
    const t = theme();
    if (!this.ready)
      return v_flex().size_full().items_center().justify_center().bg(t.surface)
        .child(div().text_size(12).text_color(t.dim).child("Reading…"));
    const when = this.saved
      ? new Date(this.saved).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : null;
    return v_flex().size_full().bg(t.surface).children([
      h_flex().h(28).px(10).gap(8).items_center().justify_between().flex_none().border_b(1).border_color(t.border)
        .child(div().text_size(11).text_color(t.dim).truncate().child("notes.md"))
        .child(div().text_size(11).text_color(this.error ? t.ansi1 : t.dim)
          .child(this.error ?? (when ? `saved ${when}` : ""))),
      div().flex_1().min_h(0).child(Editor.new(this.state))]);
  }
}
