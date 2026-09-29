# Week 38, 2026 (14–20 Sep)

Consolidated from per-objective reports created this week.

## coo:1025.bkhy — "Open in the background" with Latch (2026-09-18)

Overlord's CLI runner builds the terminal-open command itself for direct
sessions and already honored `TerminalProfile.background`. For persistent
(Latch) sessions the runner runs `latch create`, then `latch open`, and
Latch's `open` owns the AppleScript — it always sent `activate`, and neither
Overlord's background flag nor Latch Desktop's UserDefaults toggle reached it,
so both settings looked ignored.

Fix (contract v144): Latch gained `latch open --background|--foreground` and an
`open.background` config, restoring focus to the previously frontmost app
(Latch `0.2609181007.0`). The launch snapshot viewer now carries `background`
(projected from the profile, `false` for chord) and the runner sends the flag,
version-gated like `--as`. Mission-panel re-open stays foreground on purpose.

No window at all was already supported via Settings → Terminal → Show it in →
Don't open a window automatically (`viewer.openOnLaunch = false`); the runner
then skips `latch open`. Settings copy and `terminal-and-ide.mdx` now point
at it.
