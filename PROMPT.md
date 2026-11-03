# PROMPT.md — the one-liner to give your agent

Paste this when you want a new mod in the tab bar:

```text
Build a Herdr mod that joins my tab-host tab bar: read
~/play/gadenbuie/herdr-mod-tab-host/AGENTS.md and follow it exactly.
The mod is self-contained in its own folder (~/play/herdr-mod-<name>/);
do not modify tab-host. Describe what the mod should do first if anything
is unclear; otherwise pick the smallest version of the idea. When
`herdr-app check` passes, install it into ~/.config/herdr-app/mods/
(the way AGENTS.md's "Delivering" section says) and tell me what the
new button does.
```

Replace "the smallest version of the idea" with a sentence about what the
mod should do — read your GitHub notifications, show a clock, browse a
folder — and the agent has everything else from AGENTS.md.

If what the mod shows belongs to the workspace — an inbox whose threads
follow the repo you're in, a review queue, whatever the person last opened
— say so in that sentence too: AGENTS.md's `tab.state` field is what it
reaches for, and the mod's state then sticks to the space and comes back
when the person does. Without it the agent won't know you want that.

The result is the third party's own repo: it depends on tab-host being
installed to get its button, works without it as a pane, and needs no
changes to tab-host now or later.
