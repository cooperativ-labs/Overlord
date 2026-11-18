# Delivery process plan review

Reviewed for coo:1297.ed20 on 2026-11-18.

Contract impact: none. This review changes no interface, implementation, storage or runtime behavior. The proposed implementation still requires a major contract release, as the plan declares.

## Assessment

The direction is sound: keep delivery atomic, separate narrative publication from acceptance, persist replay receipts, remove automatic mission prose, and preserve immutable accepted evidence. The research correctly distinguishes missing measurements from zero rates. Keep the settled exclusions: no partial delivery, no publication timer and no automatic narrative fallback.

The plan needs four corrections before the affected phases are ready to implement. Findings below concern the proposed design, not claims of newly reproduced production bugs. Leave the implementation plan unchanged until the review choices are settled.

## Findings and recommendations

### R1 — High: inline publication can falsely claim coverage of unseen deliveries

**Plan:** [section 5.2](delivery-process-research.md:122), contrasted with [evidence identity](delivery-process-research.md:103) and [publication CAS](delivery-process-research.md:152).

Inline delivery checks only `baseContentRevision`, then publishes against the newly advanced evidence revision. Consider agents A and B attaching at content 8/evidence 14. A delivers without prose, advancing evidence to 15 while content remains 8. B delivers its original prose with base content 8. The specified check passes and labels B's prose current at evidence 16, although B never read A's accepted work. A follow-up or source deletion without a narrative write produces the same hole. The separate publication command checks both revisions; inline publication must do so too.

Current source confirms that the existing check is content-only (`packages/core/service/mission-summary-agent.ts:387`); the proposed new evidence revision will not repair it automatically.

**Recommendation:** add `baseEvidenceRevision` to inline narrative input. Compare both bases against the pre-delivery state under the mission lock, then advance evidence and publish only on a match. On either mismatch, accept delivery and valid closes, withhold prose and return fresh publication context. Legacy callers missing the evidence base may still deliver; conservatively withhold their prose rather than claim coverage that cannot be established. Record-work can retain its explicit new-mission exception.

**Placement/size:** phase 2, small to medium across parser, service, contract and clients. Include parallel prose-free delivery, follow-up, deletion, and legacy missing-base fixtures. Do not defer this to integration testing.

### R2 — High: a single maximum seen timestamp cannot acknowledge independent evidence streams safely

**Plan:** [section 5.4](delivery-process-research.md:169), especially the instruction to acknowledge the maximum of rendered watermarks.

The stored baseline is one `mission_summary_seen.seen_at` (`contract/data/README.md:1653`); the backend writes a scalar maximum (`backend/mission-summary.ts:365`). If unseen risks have watermark 10 and a visible narrative has watermark 20, acknowledging only the visible narrative at 20 also makes the older unseen risks appear read on the next visit. Adding independent response watermarks without independent stored acknowledgements cannot satisfy the plan's promise that hidden evidence stays unread.

The current web hook deliberately requires all evidence groups to be covered before acknowledging (`webapp/web/lib/hooks/use-mission-summary-seen.ts:104`). The plan must explicitly preserve or replace that protection.

**Recommendation:** for the smallest release, retain the scalar marker and require coverage of every relevant group in the same response before acknowledging the combined maximum, including narrative and coo:1278 item evidence. Keep signatures so a changed group invalidates its coverage. If independently clearing sections is required, persist per-stream seen positions and define migration and old-client acknowledgement semantics; response fields alone are insufficient.

**Placement/size:** phase 3, medium with the conservative coverage gate; larger if per-stream storage is chosen. Add the older-hidden/newer-visible example in both directions, then remount/cold-read to prove unread state survives. Coordinate the fixture with coo:1278 rather than independently implementing incompatible seen semantics.

### R3 — Medium: draft replay has neither a batch identity nor durable replay storage

**Plan:** [draft storage](delivery-process-research.md:65) and [replay-before-CAS requirement](delivery-process-research.md:198).

The plan defines stable entry ids and a header revision but no update batch operation id, request digest, or durable accepted batch result. Entry ids identify observations, not attempts: the same entry can legitimately be edited many times. After batch A commits, its response is lost, and batch B changes the draft, the current entries cannot identify or replay A safely. A CAS check rejects the promised replay; rerunning A can overwrite B or duplicate its progress event.

**Recommendation:** specify `reportDraft.operationId` and a per-draft accepted-batch receipt containing the canonical operation digest and result revision/event id, atomically written with mutations and the attributable update event. Replay the same id/digest before CAS, reject changed input under the same id, and document what happens when replay occurs after sealing/session end. Keep those replay semantics narrow and do not reopen update authority. An equivalent existing durable receipt facility is acceptable if its retention and scope meet these requirements.

Bound total batches/withdrawn audit entries or define retention separately: the 12-active-entries limit does not bound retained history. State the replay guarantee if old batch receipts are ever pruned.

**Placement/size:** phase 4, medium. Update the four-table estimate if a new receipt table is needed. Test A, lost response, B, replay A; assert unchanged B state and no duplicate event.

### R4 — Medium: automatic retry identity is promised without specifying how clients recover it

**Plan:** [operation id generation](delivery-process-research.md:70), [receipt recovery](delivery-process-research.md:87), and [CLI/MCP work](delivery-process-research.md:229).

The server receipt design is useful, but “clients generate and retain” is not yet a transport design. A restarted CLI or a repeated hosted MCP tool invocation must recover the same operation id before sending anything. If an MCP handler creates a fresh id for each call, a lost response followed by a tool retry duplicates sessionless record-work. Conversely, retaining one id indefinitely for identical text incorrectly merges intentional separate retrospective work. This is precisely the distinction the server cannot infer.

**Recommendation:** define the logical attempt boundary and storage owner in phase 1. For CLI, persist the id and request digest before transmission, define an explicit retry/resume selector and an explicit new-operation path, and specify behavior when persistence is unavailable. For MCP, expose a caller-retained operation id in the typed payload and instruct the caller to reuse it; do not claim automatic retry safety from an id minted only inside the tool handler. Do not bind identity solely to request text. Document publication retry identity using the same rule.

**Placement/size:** phase 1, medium across CLI, hosted/local MCP, generated schemas and instructions. Test process restart, timeout before receipt visibility, intentional identical record-work twice, and repeated MCP invocation. Missing-id legacy requests keep the documented weaker guarantee.

## Remaining PM decisions

These are independently answerable. Engineering should adopt R1 and R3 as correctness requirements; they do not need a product vote about whether stale or duplicated data is acceptable.

| Decision | Recommended choice | Alternative and consequence |
| --- | --- | --- |
| When should draft reporting ship? | Phase 4, opt-in after reliable finalization and narrative publication. | Include it in the initial release, adding 5–8 planned days and more migration/client scope to that release. |
| Should people see provisional evidence? | Keep the proposed collapsed read-only objective section on web/desktop/iOS; no mission badges. | Agent-only pilot reduces initial UI work but hides discoveries from operators until delivery. |
| What should reading one summary section acknowledge? | Preserve whole-snapshot coverage before clearing the mission marker (R2). | Independent section read state needs per-stream storage, API rules and client migration. |
| May an author supply prose after omitting it at delivery? | Yes, one successful publication under the same current-author/evidence checks, without a timer. | Require new authorized work, increasing effort for otherwise completed delivery. No automatic fallback either way. |
| What happens when the original author can no longer publish? | Accept indefinitely missing/outdated prose; recovery requires new explicitly authorized work. | Add a separately authorized takeover/editor flow, which expands scope and needs its own audit/security design. Do not silently allow another agent to borrow the old opportunity. |
| Keep delivery-report formatting and historical generated prose? | Yes to both: retain report formatting and label old prose legacy until replaced. | Removing formatting or deleting historical text changes additional product behavior and should be separately scoped. |

The settled prohibition on automatic mission prose does not prohibit delivery-report formatting; keep that distinction visible in acceptance criteria. Also describe “current” as coverage of the latest defined delivery/execution basis, since item decisions and questions deliberately do not advance it (plan section 5.1).

## Sequencing and validation

Keep phases 1, 2+3 as one user-facing narrative release, then 4, with focused checks throughout and phase 5 for integrated verification. Resolve R4 before phase 1, R1 before phase 2, R2 before phase 3 and R3 before phase 4. Keep the plan's 18–30 day estimate provisional until client persistence, seen-state choice and cutover mechanism have concrete owners. The corrections should be incorporated into those phase estimates, not treated as free integration cleanup.

The no-old-writer gate is well identified, but implementation must choose and rehearse the stop/drain sequence or database fence before release. Verify Cloud replicas and Local upgrade behavior separately. Do not replace this with an unchecked rolling-deploy assumption. Preserve the planned separation between accepted delivery facts and current publication state on receipt reads.

Validation for this review: inspected the full plan, current contract and relevant ADRs 0060/0073/0074, delivery transaction and post-commit queue path, summary revision validation, scalar seen storage/backend write, and web coverage gate. No source implementation, migrations, deployment, fresh production measurement or test execution was performed. The earlier 47 baseline tests and 79-delivery cohort remain historical research evidence only; this review does not expand their claims.
