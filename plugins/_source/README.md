# Agent Plugin Source

This directory is the canonical source for generated Overlord agent plugins.

- `agents/claude` renders to `plugins/claude` and `packages/overlord-cli/plugins/claude`
- `agents/cursor` renders to `plugins/cursor` and `packages/overlord-cli/plugins/cursor`
- `agents/overlord` renders to `plugins/overlord` and `packages/overlord-cli/plugins/overlord`
- `shared/` holds the reusable slash-command, hook-config, and README templates that those agent trees include and render with per-agent values baked in

Run `yarn plugins:render` after editing the source templates. Run `yarn plugins:check` to verify both committed output trees match this source; CI runs the same check.
