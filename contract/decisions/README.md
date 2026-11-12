# Architecture Decision Records

ADRs explain why consequential contract decisions were made. They supplement
the current contract documents but do not silently override them
([CONTRACT.md](../CONTRACT.md) section 3).

## Required format

Each ADR is a file `NNNN-short-title.md` with a four-digit identifier that is
never reused. It starts with `# ADR NNNN: Title` and a header list:

- `Date:` the date the decision was made (ISO 8601);
- `Status:` one of `proposed`, `accepted`, `superseded`, or `rejected`;
- `Contract version:` the contract version current when it was accepted;
- `Supersedes:` the ADRs it replaces, or `none`; a superseded ADR gains
  `Superseded by:`; and
- `Origin:` for a backfilled record only, the contract version and ticket it
  records and when it was backfilled, for example
  `Origin: contract v153 (coo:1042), backfilled 2026-11` (ADR 0005).

The body has the sections **Context**, **Decision**, **Consequences**, and
**Alternatives considered**. A backfilled record whose source does not record
alternatives says "not recorded" rather than inventing them.

An accepted ADR is required for changes to architecture, foundational
technology, component or service boundaries, authentication, authorization,
workspace or organization isolation, persistent data meaning, migration
semantics, or other system-wide security properties, and for retiring a
surface. Purely additive changes are recorded in the changelog only (ADR 0004).

Add every new record to the index below; `yarn contract:check` fails when a
record and the index disagree.

## Index

- [0001 — Adopt a versioned contract with ADRs, a changelog and topic documents](0001-adopt-versioned-contract-model.md)
- [0002 — Continue the contract number line as Semantic Versioning](0002-continue-the-number-line.md)
- [0003 — Keep the former change summaries verbatim as non-normative changelog entries](0003-changelog-keeps-summaries-verbatim.md)
- [0004 — Backfill ADRs by decision, not by version](0004-backfill-adrs-by-decision.md)
- [0005 — Mark backfilled ADRs with their origin](0005-mark-backfilled-adrs.md)
- [0006 — A hand-authored OpenAPI description is the source of truth for REST](0006-openapi-source-of-truth.md)
- [0007 — Keep REST paths; no `/api/v1` move](0007-no-api-path-move.md)
- [0008 — OpenAPI covers REST only](0008-openapi-covers-rest-only.md)
- [0009 — Conformance manifests pin the major version](0009-manifests-pin-major-version.md)
- [0010 — Code and contract land together](0010-code-and-contract-land-together.md)
- [0011 — Split controlled vocabularies into closed and open sets](0011-closed-and-open-vocabularies.md)
- [0012 — Shipped components declare a conformance manifest](0012-conformance-manifests.md)
- [0013 — Extensions use only declared, namespaced extension points](0013-namespaced-extension-points.md)
- [0014 — Pin duplicated deterministic algorithms with golden vectors](0014-golden-vectors-for-duplicated-algorithms.md)
- [0015 — Ship two first-class editions, Local and Cloud, under one contract](0015-two-editions.md)
- [0016 — The harness capability descriptor is the single source of connector capability truth](0016-harness-capability-descriptor.md)
- [0017 — Cross-workspace authorization is organization-bounded](0017-organization-bounded-authorization.md)
- [0018 — Project Run Queues are planning state upstream of execution requests](0018-run-queues-upstream-of-execution-requests.md)
- [0019 — Self-minted tokens consent to every workspace of the organization](0019-self-minted-token-consent.md)
- [0020 — Retire the Latch v1 conversation-observation integration](0020-retire-latch-v1-conversation-integration.md)
- [0021 — Track file changes through an objective ledger; evidence never blocks delivery](0021-objective-ledger-change-tracking.md)
- [0022 — The activity feed is a projection of missions](0022-mission-anchored-feed.md)
- [0023 — Run Queue holds are waiting or blocked, and serial missions dispatch one entry](0023-queue-holds-and-serial-missions.md)
- [0024 — Worktree/branch automation is a per-user preference](0024-worktree-automation-is-a-user-preference.md)
- [0025 — Local-target capabilities reach remote targets through the runner queue](0025-runner-queue-transport-and-latch-answers.md)
- [0026 — Destructive agent bulk deletion requires explicit confirmation](0026-confirmed-bulk-deletion.md)
- [0027 — Run Queue launch is user-controlled](0027-run-queues-start-paused.md)
- [0028 — Objectives record an explicit run boundary](0028-objective-run-boundary.md)
- [0029 — Agent-created work requires deliberate project routing](0029-deliberate-project-routing.md)
- [0030 — Run Queue order and mission objective order are one sequence](0030-queue-order-is-mission-order.md)
- [0031 — The Live Activity payload carries one bounded pending-ask line](0031-live-activity-pending-ask.md)
- [0032 — Retire the cross-workspace Human Actions feed](0032-retire-human-actions-feed.md)
- [0033 — Project automation tokens are default-deny and project-scoped](0033-project-automation-tokens.md)
- [0034 — Assistant conversations are private, Cloud-only, and create work only through Create](0034-private-assistant-conversations.md)
- [0035 — One account-connections module owns every external account credential](0035-account-connections-module.md)
- [0036 — Assistant Knowledgebase writes require an explicit user grant](0036-assistant-knowledgebase-write-grant.md)
- [0037 — Features are identified by a canonical reference found by exhaustive lookup](0037-feature-reference-and-exact-lookup.md)
- [0038 — Default Knowledgebase server and a platform key derived from the auth secret](0038-zero-setup-knowledgebase.md)
- [0039 — Cache positive Knowledgebase source checks for 30 seconds](0039-source-check-cache.md)
- [0040 — Opt-in all-workspaces write scope for a Knowledgebase connection](0040-all-workspaces-write-scope.md)
- [0041 — Owner-only unredacted chat diagnostics are an explicit privacy exception](0041-owner-only-chat-diagnostics.md)
- [0042 — Retire the My Missions aggregate board](0042-retire-my-missions.md)
- [0043 — One implementation per workflow; one MCP tool catalog](0043-one-implementation-per-workflow.md)
- [0044 — Objective change tracking is a cumulative file list without per-file rationale](0044-cumulative-objective-file-list.md)
- [0045 — Deferred work is structured, agent-authored future work that nothing rewrites](0045-structured-deferred-work.md)
- [0046 — Mission summaries are an operator-only surface with explicit eligibility](0046-operator-only-mission-summary.md)
- [0047 — Inbox attachments live in the owner's storage workspace](0047-inbox-attachment-storage.md)
- [0048 — The OpenAPI description covers every registered route, with explicit exclusions and operation extensions](0048-openapi-route-inventory.md)
- [0049 — Token bounds apply to every route, including management routes](0049-token-bounds-on-every-route.md)
