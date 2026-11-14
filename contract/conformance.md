# Overlord conformance

Part of the Overlord contract. [CONTRACT.md](CONTRACT.md) defines its scope, precedence and change protocol.

## Conformance Requirements

Any component, connector, or extension that ships against Overlord must:

1. **Provide a conformance manifest** (`conformance-manifest.yaml`) at its root declaring:
   - `contractVersion`: the version this component was validated against
   - `componentType`: one of `connector`, `extension`, `database-adapter`, `auth-provider`, `rest-module`, `rest-consumer`, `desktop-shell`, `mcp-server`
   - `componentKey`: stable lowercase identifier
   - All capabilities and extension points it uses

2. **Pass validation** via `ovld contract check <manifest-file>`

3. **Respect ownership boundaries**: only interact with other components through declared surfaces

4. **Use namespaced identifiers** for all extension values — table names, JSON keys, event types, vocabulary extensions

5. **Declare all vocabulary extensions** from open vocabularies in its conformance manifest

### Agent connector conformance

In addition to the requirements above, a connector must:

1. **Ship a harness capability descriptor** at `connectors/adapters/<agent>/harness-capabilities.yaml`
   that validates against [`contract/harness-capabilities.schema.yaml`](harness-capabilities.schema.yaml),
   and record its path, schema version, and SHA-256 digest in the conformance manifest.
2. **Prove every `supported` capability with an executable fixture that CI runs.** Checking that
   a named file exists would let an empty fixture claim a capability into existence. Claimed-but-
   unproven is worse than absent, because the UI renders controls that do nothing.
   For callback/extension decision capabilities, a recorded payload shape is necessary but not
   sufficient: a `decision-codec` fixture must execute the shipped request decoder and response
   encoder and pin the bounded request card plus exact allow/deny/defer bytes.
3. **Justify every other status.** `unsupported` requires a reason and a stable `evidenceRef`;
   `not-implemented` and `unverified` require a tracker id. Promoting a status out of
   `unsupported` must replace `evidenceRef` with executable fixtures in the same change, so
   turning a hard limit into work leaves a trace.
4. **Ship the mandatory unbound-session negative fixture**, demonstrating that an unbound session
   in an unrelated directory is untouched and unblocked by every registered integration. A side
   effect the fixture records must be declared as a hazard with a tracker.
5. **Never hand-edit generated descriptor metadata.** `integrationShape`, `capabilityTier`, and
   `harnessCapabilities` are produced from the descriptor. The tier is derived from passing
   fixtures; a connector that declares more than its fixtures prove fails conformance.
6. **Make no network call from adapter code.** Adapters translate and hand off to the CLI, which
   owns transport, auth, retry, and redaction.

### Virtual Target Gateway conformance

A **Virtual Target Gateway** is a `rest-consumer` (e.g. Racecar) that realizes virtual execution requests. In addition to the requirements above, it must:

1. **Never access the Overlord database directly.** It interacts only through the documented `/api/virtual-targets/v1/*` REST surface; no direct DB access is possible or required.
2. **Be idempotent by `executionRequestId`.** Claim, retry, duplicate delivery, and gateway restart for the same request must yield exactly one realized environment and one run; a post-launch gateway crash must not destroy or duplicate the environment.
3. **Preserve the normal protocol lifecycle.** A gateway records observations and drives the `launching → launched|failed` transition, but it never completes an objective — only an agent protocol delivery does. It must not introduce a parallel request state machine.
4. **Vendor the published virtual-target DTOs**, validate against this contract version, and declare its called endpoints and its namespaced adapter key (e.g. `racecar`) in its `conformance-manifest.yaml` (`componentType: rest-consumer`). The adapter key is an open-vocabulary value, not a new `execution_targets.type`.

See [`contract/conformance-manifest.schema.yaml`](conformance-manifest.schema.yaml) for the required manifest shape, and [`contract/examples/rest-consumer-racecar-conformance-manifest.yaml`](examples/rest-consumer-racecar-conformance-manifest.yaml) for a Virtual Target Gateway template.

---

## Controlled Vocabularies

### Closed (contract-version-bump required to add values)

- `objectives.state`: `draft`, `submitted`, `launching`, `executing`, `pending_delivery`, `complete` (`future` retired by ADR 0056)
- `missions.created_by_kind`, `objectives.created_by_kind`: `human`, `agent`, `automation`
- `project_statuses.type`: `draft`, `next`, `execute`, `review`, `complete`, `blocked`, `cancelled`
- `execution_requests.status`: `queued`, `claimed`, `launching`, `launched`, `failed`, `cleared`, `cancelled`, `expired`
- `run_queue_entries.state`: `waiting`, `blocked`, `dispatched`, `running`
- `agent_sessions.delivery_state`: `not_delivered`, `delivered`, `pending_redelivery`
- `mission_events.type`: `update`, `user_follow_up`, `alert`, `discussion_summary`, `decision`, `ask`, `answer`, `permission_request`, `delivery`, `execution_requested`, `awaiting_approval`, `status_change`
- `permission_requests.status`: `requested`, `approved`, `denied`, `expired`, `not_required`
- `idempotency_keys.status`: `in_progress`, `completed`, `failed`
- `audit_log.result`: `allowed`, `denied`, `failed`
- `workspace_invitations.status`: `pending`, `accepted`, `revoked`, `expired`
- `chat_runs.state`: `queued`, `running`, `waiting_user`, `completed`, `failed`, `cancelled`; `chat_runs.outcome`: `answered`, `allowance_exhausted`; `chat_runs.failure_code` / `chat_run_attempts.failure_code`: `provider_unavailable`, `rate_limited`, `context_limit`, `unsupported_capability`, `interrupted`, `provider_error`, `source_access_lost`
- `chat_run_attempts.state`: `leased`, `released`, `succeeded`, `failed`, `fenced`, `cancelled`; `chat_run_attempts.recovery_mode`: `initial`, `checkpoint`, `fresh_generation`
- `chat_messages.role`: `user`, `assistant`; `chat_messages.state`: `streaming`, `complete`, `interrupted`; `chat_questions.state`: `open`, `answered`, `superseded`, `cancelled`; `chat_work_proposals.state`: `open`, `created`, `cancelled`; `chat_tool_calls.state`: `requested`, `executing`, `completed`, `failed`, `cancelled`
- `chat_events.kind`: `thread.updated`, `message.created`, `message.delta`, `message.completed`, `run.updated`, `tool.updated`, `question.opened`, `question.closed`, `proposal.revised`, `proposal.created`, `content.invalidated`
- `chat_source_refs.source_kind`: `knowledgebase`, `overlord`, `repository`; `chat_source_refs.access_state`: `authorized`, `revoked`, `unknown`
- `chat_notifications.type`: `chat_needs_answer`, `chat_finished` (also admitted by `notification_preferences.type`); `chat_notifications.state`: `pending`, `suppressed`, `dispatching`, `dispatched`, `cancelled`, `failed`
- `account_connections.provider`: `knowledgebase`, `everhour`, `github`; `account_connections.state`: `pending`, `connected`, `reauthorization_required`, `disconnected`; `account_connections.credential_kind`: `oauth`, `api_key`; `account_connections.credential_format`: `connection-v1`, `everhour-user-key-v1`, `github-user-oauth-v1`; `account_connections.assistant_write_scope`: `per_request`, `all_workspaces`
- RBAC role names (`role_assignments.role_key` core, non-extension values; enumerated in `auth/src/rbac/types.ts`'s `Role` enum and `overlord.rbac.toml`): `ADMIN`, `MANAGER`, `MEMBER`, `PUBLIC`

### Open (extensions may add namespaced values)

- `workspaces.kind`, `profiles.kind`
- `execution_targets.type` (documents `local` and `virtual` as core values; a virtual target is realized by an external gateway over the Virtual Target Queue Surface), `project_resource_sources.source_kind`
- Gateway **adapter keys** (e.g. `racecar`) and virtual source/observation/failure/grant/action kinds — namespaced open-vocabulary values declared in a gateway's `rest-consumer` conformance manifest, never new closed-vocabulary values or `execution_targets.type` values
- `artifacts.type`
- `mission_events.source`, `entity_changes.entity_type`, `entity_changes.source`
- `outbox_messages.topic`, `worker_jobs.type`
- RBAC permission names
- Connector/agent identifiers

Full value lists live in the database schema contract "Controlled Vocabularies" section.

Post-delivery follow-up execution reuses existing vocabulary values: discussion-only
follow-ups append `mission_events.type = user_follow_up` while the objective remains
`complete`; explicit resume transitions the objective to `pending_delivery` and
creates a new session with `agent_sessions.delivery_state = pending_redelivery`.
