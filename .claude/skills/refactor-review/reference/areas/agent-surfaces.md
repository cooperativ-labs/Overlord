# Area Playbook — `agent-surfaces`

## Roots

```
mcp/                              # hosted MCP server: server.ts, tool-catalog.ts, widgets.ts
connectors/core/overlord-mission/ # the shared skill core every adapter overlays
connectors/adapters/{claude,codex,cursor,antigravity,pi}/
connectors/VERSION
scripts/sync-connector-versions.mjs
cli/src/connector-core-render.ts  # renders core + adapter overlays into shipped output
```

## Read first

- `CONTRACT.md` → **MCP Server** (§12), **Connector Layer** (§4), and the *Agent → Protocol*,
  *Connector → Protocol (Hook Surface)*, *MCP Server → Auth*, and *MCP Server → Service Layer*
  interaction surfaces.
- `mcp/AGENTS.md`, `connectors/AGENTS.md`, `connectors/README.md`,
  `connectors/docs/05-connectors-and-agent-plugins.md`,
  `connectors/docs/agent-harness-configuration-architecture.md`.
- `.claude/skills/connector-versions/SKILL.md` — connector edits require a version sync.

This area's product is *instructions consumed by other agents*. Its failure mode is duplication
that drifts, and the drift is invisible until an agent on one harness behaves differently from an
agent on another.

## Relationship to `drift-review`

`drift-review` asks whether API / CLI / MCP / connector docs describe the same operations.
This routine asks whether the **structure** minimizes the chance of them diverging again: is
shared content actually shared, or copied into five adapters? If you find a content mismatch,
record it as an adjacent finding and point at `drift-review`; keep your own findings structural.

## Area-specific checks

### Core vs. adapter overlay discipline
`connectors/core/overlord-mission/` is the single source; each adapter should contribute only
harness-specific overlay (command names, hook wiring, tool naming). Measure how much each adapter
duplicates rather than overlays:

```bash
wc -l connectors/core/overlord-mission/SKILL.md \
      connectors/adapters/*/skills/overlord-mission/SKILL.md 2>/dev/null
for f in connectors/adapters/*/skills/overlord-mission/SKILL.md; do
  echo "== $f"; diff <(sed -n '/Required Protocol Workflow/,$p' connectors/core/overlord-mission/SKILL.md) \
                     <(sed -n '/Required Protocol Workflow/,$p' "$f") | head -5
done
```

A lifecycle rule restated in an adapter instead of inherited from core is a `High`-value finding:
core changes then reach some harnesses and not others. Confirm the render path in
`cli/src/connector-core-render.ts` before proposing the fix, so the proposal names the actual
mechanism rather than inventing one.

### Adapter shape symmetry
Adapters have deliberately different capabilities, but the *layout* should be predictable. Build
the matrix — commands, skills, hooks, MCP shim, prompt wrapper, conformance manifest — and check
each gap:

```bash
for a in connectors/adapters/*/; do echo "== $a"; ls "$a"; done
```

For every asymmetry, decide and state: intentional (harness lacks the capability) or accidental
(never ported). Accidental asymmetries are findings; intentional ones belong in the adapter's
README, and their absence there is a documentation finding.

### MCP shim duplication
Each local shim (`connectors/adapters/*/scripts/overlord-mcp.mjs`) maps snake_case tool arguments
onto `ovld protocol` kebab-case flags. These shims are near-copies:

```bash
wc -l connectors/adapters/*/scripts/overlord-mcp.mjs
md5sum connectors/adapters/*/scripts/overlord-mcp.mjs
```

Identical or near-identical shims argue for a shared generated module; genuinely divergent ones
argue for documenting why. Either way the finding must respect the constraint that shims ship as
standalone runnable files into user homes — a proposal requiring a bundler at install time is
usually the wrong trade, so state that constraint in the finding.

### Hosted tool catalog vs. service layer
`mcp/tool-catalog.ts` declares hosted tool definitions; `mcp/server.ts` dispatches them into the
service layer. Flag:
- a tool whose input schema restates a shape already in `@overlord/contract` rather than deriving
  from it
- validation or business rules implemented in the dispatcher instead of the service layer (the
  same rule then has to be re-implemented for REST and CLI)
- tool definitions and dispatch cases that have to be edited in two places to add one tool —
  propose a single registry keyed by tool name

```bash
grep -c "name:" mcp/tool-catalog.ts
grep -n "case '" mcp/server.ts | wc -l
```

### Version sync integrity
`connectors/VERSION` is the source of truth, propagated by
`scripts/sync-connector-versions.mjs` to plugin manifests and shim server info. Flag any version
literal in a connector file that is not a sync target, and any new adapter absent from the target
lists in that script — a version that drifts silently is worse than one that is missing.

```bash
node scripts/sync-connector-versions.mjs --check
grep -rn "version" connectors/adapters/*/plugin.json connectors/adapters/*/.*-plugin/plugin.json 2>/dev/null | head
```

### Conformance manifests
Each adapter and `mcp/` carries a `conformance-manifest.yaml` declaring the contract version it
was validated against. Flag manifests behind the current `CONTRACT.md` version and any adapter
missing one.

## Verification for refactors in this area

```bash
yarn lint
node scripts/sync-connector-versions.mjs --check
yarn test:cli                # connector-core-render.test.ts covers the render path
node cli/bin/ovld.mjs protocol help
```

After any change to core or overlay content, re-render and diff the shipped adapter output rather
than trusting the source diff — the render step is where duplication silently reappears. Follow
with the `connector-versions` skill to bump the patch version if the change is user-visible.
