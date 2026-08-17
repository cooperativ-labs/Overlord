# Fix published `ovld` crash: missing `@overlord/database`

## Symptom

After the last CLI publish, any `ovld` invocation failed immediately:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@overlord/database'
imported from .../node_modules/overlord-cli/dist/index.js
```

## Root cause

The production CLI bundle (`cli/scripts/build.mjs`) marked `@overlord/database`,
`@overlord/auth`, and `kysely` as esbuild externals. Those packages are private
workspace packages and are not published to npm, and `overlord-cli`'s published
`dependencies` only listed `yaml`.

The client graph still pulled `@overlord/core/service/context`, which has a
runtime import of `formatObjectiveDisplayId` / `parseObjectiveRef` from
`@overlord/database`. esbuild hoisted that import to a top-level ESM `import`
in `dist/index.js`. Node evaluates that import on every `ovld` start, including
`help` / `version`.

This is the same class of bug as the earlier `yaml` externalization: the
published tarball and desktop staging dir ship `dist/index.js` without
workspace `node_modules`.

## Fix

- Bundle all JS the CLI graph actually imports, including private workspace
  packages. Only the native addon `better-sqlite3` stays external (and is never
  statically imported).
- Fail the CLI production build if `dist/index.js` still has a non-`node:`
  package import.
- Add `cli/test/packaged-bundle.test.ts` to assert the bundle has no leftover
  package imports and that `ovld version` works from a copy with no
  `node_modules`.

The published CLI still does not ship SQLite, migrations, or `better-sqlite3`.
Display-id helpers are inlined as ordinary JS.

## Verify

```
yarn cli:build:prod
node cli/bin/ovld.mjs version
```

To replace a broken global install from this checkout:

```
yarn cli:pack:prod
npm install -g --no-fund ./cli/overlord-cli-*.tgz
```
