# CLI Installation: NPM vs Web/Electron

**Ticket:** 9ca9a29d
**Date:** 2026-02-25

## Decision

**Rely on web/Electron for now.** NPM publishing is not required for V1.

## Rationale

1. **Electron bundles the CLI** — The desktop app now includes the CLI in its bundle. Users who install the app can click "Install CLI" in Settings to add `ovld` to `~/.local/bin`.

2. **Web users can use npx** — From the project directory, `npx overlord` works without a global install. The package is in the project's `package.json` bin.

3. **Package is private** — `package.json` has `"private": true`, so it's not published to NPM. Publishing would require a separate package or making the package public.

4. **V1 scope** — The packaging doc (packaging-v1-thin-electron-cli.md) states "Bundle the Overlord CLI so 'agents can work' without the user separately installing a CLI." The Electron + web flow satisfies this.

## Future NPM Publishing

If we later want `npm install -g overlord` for users who don't use the desktop app:

- Create a separate `overlord-cli` package (or publish the main package with `private: false`)
- Add a `prepare` or `postinstall` script if needed
- Ensure the CLI works standalone (credentials, etc.)

For now, the desktop app and `npx overlord` cover the intended workflows.
