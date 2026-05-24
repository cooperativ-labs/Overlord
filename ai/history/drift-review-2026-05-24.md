# Overlord Surface Drift Report — 2026-05-24

**Audited by:** Claude Code drift-review skill  
**Date:** 2026-05-24

## Summary

- **Surfaces audited:** API routes, CLI (`protocol.mjs`), Hosted MCP (`supabase/functions/mcp/tools.ts`), Antigravity local shim (`plugins/antigravity/scripts/overlord-mcp.mjs`), Agent plugin skills (Claude, Cursor, Codex, Antigravity), `docs/public/ovld-protocol-help.txt`, `packages/overlord-cli/README.md`
- **Total operations found:** 37 (35 protocol + 2 UI-only hosted MCP)
- **Fully aligned operations:** 29
- **Operations with drift:** 6

---

## Alignment Matrix

| Operation | API Route | CLI | Hosted MCP | Antigravity Shim | Plugin Docs | Public Docs |
|-----------|-----------|-----|------------|------------------|-------------|-------------|
| attach | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| connect | ✅ | ✅ | ❌ intentional¹ | ✅ | ✅ | ✅ |
| load-context | ✅ | ✅ | ❌ intentional¹ | ✅ `load_ticket_context` | ✅ | ✅ |
| update | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| deliver | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ask | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| hook-event | ✅ | ✅ | ✅ `record_hook_event` | ✅ `record_hook_event` | ✅ | ✅ |
| record-change-rationales | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| discover-project | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| search-tickets | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| create | ✅ | ✅ | ✅ `create_ticket` | ✅ `create_ticket` | ✅ | ✅ |
| prompt | ✅ | ✅ | ❌ intentional¹ | ✅ | ✅ | ✅ |
| revert | ✅ | ✅ | ❌ intentional¹ | ✅ | ✅ | ✅ |
| discuss-objective | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| add-objectives | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| record-work | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| read-context | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| write-context | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| get-device | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ missing `--device-port` |
| update-device | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| list-project-resources | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| add-project-resource | ✅ | ✅ | ⚠️ missing `devicePort` | ⚠️ missing `device_port` | ✅ | ⚠️ missing `--device-port` |
| update-project-resource | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| request-approval-gate | ✅ | ✅ | ✅ | ❌ **MISSING** | ✅ | ✅ |
| permission-request | ✅ | ✅ | ❌ intentional | ❌ intentional | ✅ | ✅ |
| request-execution | ✅ | ✅ | ❌ intentional | ✅ | ✅ | ✅ |
| claim-execution | ✅ | ✅ | ❌ intentional | ✅ | ✅ | ✅ |
| complete-execution-launch | ✅ | ✅ | ❌ intentional | ✅ | ✅ | ✅ |
| fail-execution-launch | ✅ | ✅ | ❌ intentional | ✅ | ✅ | ✅ |
| attachment-list | ✅ | ✅ | ✅ `list_attachments` | ✅ `list_attachments` | ✅ | ⚠️ wrong required params |
| attachment-prepare-upload | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ wrong required params |
| attachment-finalize-upload | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ wrong required params |
| attachment-download-url | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ wrong required params |
| attachment-upload-file | CLI-local | ✅ | ❌ not in hosted² | ✅ `upload_attachment_file` | ✅ (Antigrav only) | ✅ |
| auth-status | ❌ CLI-only | ✅ | ❌ intentional | ❌ intentional | ✅ | ✅ |
| create_ticket_draft | — | — | ✅ UI-only | — | N/A | N/A |
| save_ticket_draft | — | — | ✅ UI-only | — | N/A | N/A |

> ¹ Intentional local-only asymmetry, documented in Antigravity SKILL.md.  
> ² `upload_attachment_file` wraps a binary PUT to Supabase Storage that hosted MCP runtimes cannot perform. Intentional.

---

## Drift Findings

### 🔴 Missing Operation: `request_approval_gate` not in Antigravity shim

**File:** `packages/overlord-cli/plugins/antigravity/scripts/overlord-mcp.mjs`

The `request_approval_gate` tool exists in the CLI (`ovld protocol request-approval-gate`), the hosted MCP, and is documented in all agent plugin skills — but is **absent from the Antigravity local MCP shim**.

An Antigravity agent that encounters a risk requiring human approval before the next objective runs cannot call this via MCP. It must fall back to the CLI directly, but the tool isn't discoverable from the shim's tool list.

**Fix:** Add `request_approval_gate` tool to the Antigravity shim, mapping `session_key` (required), `ticket_id` (required), `reason` (required), `objective_id` (optional) → CLI flags `--session-key`, `--ticket-id`, `--reason`, `--objective-id`. Subcommand: `request-approval-gate`.

---

### 🟠 Parameter Drift: `devicePort` / `device_port` missing across surfaces

The CLI has `--device-port <port>` (SSH port for placeholder reconciliation) on both `get-device` and `add-project-resource`. This propagated inconsistently:

| Surface | `get-device` | `add-project-resource` |
|---------|-------------|------------------------|
| CLI (`--device-port`) | ✅ | ✅ |
| Hosted MCP (`devicePort: integer`) | ✅ | ❌ **MISSING** |
| Antigravity shim (`device_port`) | ❌ **MISSING** | ❌ **MISSING** |
| Public docs (`--device-port`) | ❌ **MISSING** | ❌ **MISSING** |

**Fix 1:** `supabase/functions/mcp/tools.ts` — add `devicePort: { type: 'integer', description: 'SSH port for placeholder reconciliation when multiple targets share the same host.' }` to `add_project_resource` properties (after `devicePlatform`).

**Fix 2:** `packages/overlord-cli/plugins/antigravity/scripts/overlord-mcp.mjs` — add `device_port: { type: 'integer' }` to both `get_device` and `add_project_resource` schemas, and wire `'device-port': args.device_port` in each `toCliFlags`.

**Fix 3:** `docs/public/ovld-protocol-help.txt` — add `--device-port <port>` line to the `get-device` and `add-project-resource` optional flags sections.

---

### 🟠 Documentation Drift: stale attachment `--ticket-id` requirements in `docs/public/ovld-protocol-help.txt`

The public help file predates a CLI update that made `--ticket-id` optional (derivable from `--objective-id` or `--attachment-id`) for all attachment operations. Five commands are affected:

| Command | Public docs says | CLI actually requires |
|---------|-----------------|----------------------|
| `attachment-list` | `--ticket-id` required | ONE OF `--objective-id \| --ticket-id` |
| `attachment-prepare-upload` | `--ticket-id` required | optional — derived from `--objective-id` |
| `attachment-finalize-upload` | `--ticket-id` required | optional — derived from `--objective-id` |
| `attachment-download-url` | `--ticket-id` required | optional — derived from `--attachment-id` |
| `attachment-upload-file` | `--ticket-id` required | optional — derived from `--objective-id` |

Agents reading only the public docs will unnecessarily always send `--ticket-id`. This is incorrect guidance but not breaking (passing both still works).

**Fix:** `docs/public/ovld-protocol-help.txt` — update the five attachment sections to match current CLI help text. Simplest approach: regenerate this file from `ovld protocol help` output.

---

### 🟡 Documentation Drift: session auto-persistence omitted in public help

The `docs/public/ovld-protocol-help.txt` environment fallback section reads:

```
--session-key  <- SESSION_KEY
--ticket-id    <- TICKET_ID
```

The actual CLI help text reads:

```
--session-key  <- SESSION_KEY or auto-persisted session from last attach/connect/prompt in this working directory
--ticket-id    <- TICKET_ID  or auto-persisted session (human-readable ticket_id, e.g. 1:899)
```

Agents reading only the public docs won't know the CLI persists session state to a temp file per working directory, and may pass `--session-key`/`--ticket-id` redundantly on every call.

**Fix:** `docs/public/ovld-protocol-help.txt` — sync the Environment fallback block with the current CLI help.

---

## Recommendations (ordered by impact)

1. **[High]** Add `request_approval_gate` to Antigravity MCP shim — `packages/overlord-cli/plugins/antigravity/scripts/overlord-mcp.mjs`
2. **[Medium]** Add `devicePort` to hosted MCP `add_project_resource` — `supabase/functions/mcp/tools.ts`
3. **[Medium]** Add `device_port` to Antigravity shim `get_device` and `add_project_resource` — `packages/overlord-cli/plugins/antigravity/scripts/overlord-mcp.mjs`
4. **[Medium]** Fix stale `--ticket-id` required blocks for all 5 attachment commands — `docs/public/ovld-protocol-help.txt`
5. **[Low]** Sync session auto-persistence note in environment fallback — `docs/public/ovld-protocol-help.txt`

---

## No Drift Found In

- Claude, Cursor, and Codex plugin skills (all at version 0.5.8, fully aligned)
- Hosted MCP `get_device` — `devicePort` is present
- CLI README — all subcommands, flags, and examples accurate
- All core lifecycle operations: attach, update, deliver, ask, record-work, read/write-context, discuss-objective, add-objectives, search-tickets, create, record-change-rationales
