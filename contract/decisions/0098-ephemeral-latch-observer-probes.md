# ADR 0098: Ephemeral Latch observer probes

- Date: 2026-11-21
- Status: accepted
- Amends: 0064

The observer continues to sweep every 30 seconds with a ten-second inspection
deadline. A process guards against overlapping passes, but replicas can race
on the former per-mapping 30-second key or fall on opposite sides of a bucket
boundary. The production baseline was about 38,600 observer jobs per day,
usually with four execution-request feed rows per job.

Serialize queue admission on the durable mapping row. Reuse an outstanding
job only within its original ten-second window, and a successful result only
if its job was created within five seconds. Check current target eligibility
before dispatch or reuse and before applying a result. Scope identity to
workspace, project, mission, mapping, provider session, execution target, actor,
eligibility membership, token, resource and executable. Jobs carry an explicit
resource hint so mission-less dispatch resolves the same checkout as before.
This optimization never applies to interactive or end-session requests.

Use the existing runner and notification transport. Duplicate completion
preserves the first stored result. Queued probes past the ten-second window
are ineligible for claim. Bounded, retry-safe sweeps delete completed or
unclaimed jobs after 15 minutes and reclaim abandoned claimed or launching
jobs after one hour. The current runner expiry path can terminate those jobs
sooner. Reuse and completion survive a backend restart because the job and
result are committed in the database.

Transport lifecycle writes for new probes are internal. They emit no
execution-request change-feed records or mission events. A confirmed exit
remains monotonic and retains its timestamp and reason. A failed or timed-out
probe cannot confirm exit. Confirmed absence removes only the observed
mapping, and an older probe cannot overwrite a newer observation or end
intent. Durable mapping updates and lifecycle events still use normal replay.
Legacy PostgreSQL probes can be removed after the 21-day feed pruning is
enabled, after their own age exceeds 21 days and all their feed records are
gone. Existing mission timeline events remain retained.
During a mixed-version rollout, older backends may still publish a new marked
job's lifecycle updates. Cleanup honors those surviving feed references too.

Contract impact: major. Consumers no longer receive routine probe transport
events. The runner claim and result shapes continue to serve existing clients.
The observer, queue service, database adapters and replay policy apply the
same distinction between ephemeral jobs and durable session history.

Keeping the fixed bucket would leave cross-boundary races. A process-local
cache could not coordinate replicas or retain results across restart. Slower
polling would increase status-detection latency and was outside this decision.
