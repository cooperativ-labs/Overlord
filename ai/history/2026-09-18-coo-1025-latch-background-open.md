# coo:1025.bkhy — "Open in the background" with Latch

## Who opens the terminal

- **Direct session:** Overlord's CLI runner builds the AppleScript / `open`
  command itself (`cli/src/terminal-launcher.ts`) and already honored
  `TerminalProfile.background` (no `activate`, `open -g`).
- **Persistent (Latch) session:** the runner runs `latch create` (headless PTY),
  then `latch open <id> --with iterm --as window|tab` (`cli/src/latch-launch.ts`).
  Overlord decides *whether* and *in what shape* to open; **Latch's `open`
  command owns the AppleScript**, and it always sent `activate`. Overlord's
  background flag was never forwarded, and Latch Desktop's "Open in background"
  is a Desktop-only UserDefaults toggle for Desktop's own launcher — it never
  reached `latch open` either. Hence both settings looked ignored.

## Fix (contract v144)

- Latch: `latch open --background|--foreground`, `open.background` config,
  focus restored to the previously frontmost app (Latch `0.2609181007.0`).
- Overlord: the launch snapshot viewer carries `background` (projected from the
  profile, `false` for chord); the runner sends the flag, version-gated like
  `--as`. Mission-panel re-open stays foreground on purpose.

## No window at all

Already supported: Settings → Terminal → **Show it in → Don't open a window
automatically** (`viewer.openOnLaunch = false`). The runner then skips
`latch open` entirely. Settings copy and `terminal-and-ide.mdx` now point at it.
