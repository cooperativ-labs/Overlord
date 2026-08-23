# Area Playbook — `cli`

## Roots

```
cli/bin/ovld.mjs      # real entry point — run this, not dist/, to exercise a dev build
cli/src/              # commands, protocol client, launch, objective ledger, config, setup
cli/test/             # unit tests + cli/test/e2e
cli/docs/             # command reference and protocol docs (drift target)
```

Excluded from review: `cli/dist/`, `cli/node_modules/`.

## Read first

- `CONTRACT.md` → **CLI Layer** (§3) and the *CLI → REST (Backend Client Surface)* interaction
  surface.
- `cli/AGENTS.md`, `cli/README.md`, `cli/docs/01-command-reference.md`.

The CLI is a **product surface**, not a script: agents and humans both depend on exact flag
names, output shapes, and exit codes. Renaming a flag or changing stdout structure is a
breaking change, never a refactor. Internal restructuring behind a stable flag surface is
exactly what this routine looks for.

## Known hot spots (baseline, contract v35)

| File | Lines | Why it is a standing candidate |
|---|---:|---|
| `cli/src/commands.ts` | ~2460 | Long `if (subcommand === …)` dispatch mixed with per-command logic |
| `cli/src/connectors.ts` | ~870 | Connector staging, rendering, install paths |
| `cli/src/runner-service.ts` | ~710 | Runner daemon lifecycle and queue polling |
| `cli/src/change-ledger.ts` | ~500 | Objective-scoped evidence lifecycle, batching, and acknowledgements |

## Area-specific checks

### Dispatch vs. handler separation
`commands.ts` interleaves subcommand routing with the bodies of individual commands, and the
same `subcommand === 'deliver'` test recurs at many points in one function. That repetition is
the finding to develop: it means delivery-specific behavior is scattered through a generic path.
Measure it before proposing anything:

```bash
grep -c "subcommand === 'deliver'" cli/src/commands.ts
grep -n "subcommand === '" cli/src/commands.ts | wc -l
```

The valuable proposal is a per-command handler with a declared shape (flags it reads, inputs it
validates, output it prints), leaving `commands.ts` as routing only. Sequence it one command at
a time — a single change that moves every command at once is unreviewable.

### Flag registry as the single source of truth
`cli/src/flag-registry.ts` holds the per-command allowlist. Flag any command that reads a flag
absent from the registry, or a registry entry no command reads:

```bash
grep -ohE "'--[a-z-]+'" cli/src/*.ts | sort -u > /tmp/used-flags.txt
grep -ohE "'--[a-z-]+'" cli/src/flag-registry.ts | sort -u > /tmp/registered-flags.txt
comm -23 /tmp/used-flags.txt /tmp/registered-flags.txt
```

Also check that flag parsing, validation, and help text derive from the registry rather than
being restated in `help.ts` / `protocol-help.ts`. Triplicated flag lists that have drifted are a
high-value finding; route pure documentation mismatches to `drift-review`.

### stdin/file input handling
Protocol commands accept `--*-json`, `--*-file`, and `-` (stdin) for payloads, rationales,
artifacts, and summaries, with an inline size limit. That resolution logic must exist once. Flag
per-flag re-implementations of "inline or file or stdin" and any input path that skips the size
check.

### Backend client boundary
All HTTP goes through `backend-client.ts`: base URL resolution, auth header, retry, error
mapping. Flag direct `fetch` calls elsewhere in `cli/src/`:

```bash
grep -rn "fetch(" cli/src --include='*.ts' | grep -v backend-client
```

Auth/session errors must map to the guidance the connector skills promise (`ovld auth repair`),
so error-mapping consolidation is a real finding when that mapping is scattered.

### Output shape
`output.ts` owns human vs. `--json` rendering. Flag `console.log` of structured data outside it
(`no-console` allows only `warn`/`error`, so most hits are already lint violations) and any
command that builds JSON by string concatenation. Agents parse this output; inconsistent
envelopes are a high-value finding.

### Attribution and secrets safety
`capture-change.ts`, `active-objective-sessions.ts`, `change-ledger.ts`, and
`local-file-storage.ts` implement objective-bound path evidence; `redact-secrets.ts` protects
logs. Refactors across this boundary are `L` at minimum because scope or locking mistakes can
misattribute changes or lose retryable evidence. Verify that path validation remains shared with
the core Protocol schema, storage stays owner-only and atomically locked across processes, and
callbacks without an exact objective binding or codec-normalized edit path cannot create a file
claim. Flag any new logging path that does not pass through redaction.

### Session and config resolution
`session-key.ts`, `active-mission.ts`, `config.ts`, and `env.ts` all resolve state from a
precedence chain (flag → env → session file → config → default). Compare the chains: they
should be one shared resolver. Divergent precedence between commands is a high-value finding
because it produces "works in one command, not the other" behavior.

### Tests
`cli/test/` is a flat unit suite plus `cli/test/e2e`. Flag fixture and temp-home setup duplicated
across files instead of using `cli/test/support`. Note that some tests are environment-sensitive
in a pod (they resolve the real backend URL or a native binary), so a refactor's verification
step should say which suites are expected to be reliable where it runs.

## Verification for refactors in this area

```bash
yarn lint
yarn typecheck:cli
yarn test:cli
yarn test:cli:e2e        # when dispatch, flags, or output shape moved
node cli/bin/ovld.mjs protocol help   # smoke the real entry point, not dist/
```

If flag surfaces or command help moved, also run the `drift-review` skill afterwards — CLI
restructuring is the most common source of surface drift.
