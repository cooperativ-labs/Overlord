# 0097: Suppress timestamp-only runner change events

Status: Accepted

Runner claim polling frequently updates registration heartbeats. Persisting a
feed event for every poll creates a large durable history while consumers need
events for changes to the runner's state and for reconnection.

Continue writing the heartbeat and revision at the existing cadence. Emit a
registration event on insert, reconnection, and a meaningful change to target,
relation, label, version, capabilities, supported agents, health, or error code;
do not emit an event for an otherwise unchanged, fresh heartbeat. Keep the
existing reconnect dispatch behavior. Consumers must read current registration
state rather than treating the event stream as a heartbeat clock. This changes
the observable feed contract and requires a major version.

Legacy Everhour workspace-key adoption needs the complete set of attributed
actors. Both adapters preserve those pairs in the extension-owned
`ext_everhour_connection_attribution` table. The service consults their union
with the surviving feed and fails closed if a membership cannot be resolved.
Any later pruning operation must atomically preserve additional matching actors
before deleting their source rows. No pruning is enabled by this migration.
Account erasure replaces the deleted membership's preserved and unpruned actor
identifiers with a non-identifying marker that makes adoption fail closed. The
erasure transaction takes the same feed lock as pruning before domain locks so
the old identifier cannot be recopied after redaction.

PostgreSQL feed readers take a transaction-scoped SHARE table lock before
reading the feed and its high-water mark. This waits for prior inserts to commit
or roll back and blocks later inserts for the duration of the short read. A
bare maximum identity value is unsafe because sequence allocation precedes
transaction commit. This lock trades concurrent feed-write latency for a
commit-safe cursor; operational rollout must monitor contention and latency.
Both the feed read lock and pruning lock have a two-second lock timeout; an
unsuccessful pass fails and retries through the normal caller or poll loop.

A singleton `entity_change_retention` boundary records the greatest pruned
sequence. A bounded transaction deletes only a contiguous prefix older than
21 days, preserves Everhour actors, and advances the boundary atomically.
PostgreSQL pruning excludes readers and inserts with a SHARE ROW EXCLUSIVE lock.
REST returns 409 `snapshot_required` with a safe resume cursor for older
cursors; SSE emits the same signal and closes. Clients refresh authorized state
and replay from that cursor. Pruning remains disabled until recovery has been
verified on every supported client and rollout prerequisites are met.
