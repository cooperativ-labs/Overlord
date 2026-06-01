# Agent Launch Pipeline Review - 2026-06-01

Scope: reviewed the uncommitted launch-pipeline changes against
`ai/feature-plans/target-scoped-resources-and-multi-org-runner.md`, focusing on
execution request creation, runner claim/complete/fail, target-scoped resources,
and attach linkage.

## Summary

The target-scoped resource direction is mostly implemented, but the multi-org
runner changes introduced a few correctness gaps in the launch lifecycle. The
highest-risk issue is that `claim-execution` can now return work from a different
organization than the runner/UI uses for follow-up lifecycle calls, so
`complete-execution-launch` and `fail-execution-launch` can 404 after launching.

Severity summary: 3 High, 2 Medium.

## Findings

### High - Cross-org claims are not completed or failed in the claimed org

Locations:
- `apps/web/app/api/protocol/claim-execution/route.ts:112`
- `apps/web/app/api/protocol/claim-execution/route.ts:135`
- `packages/overlord-cli/bin/_cli/runner.mjs:229`
- `packages/overlord-cli/bin/_cli/runner.mjs:237`
- `apps/web/app/api/protocol/complete-execution-launch/route.ts:40`
- `apps/web/app/api/protocol/fail-execution-launch/route.ts:37`
- `lib/hooks/use-execution-request-launcher.ts:146`

`claim-execution` now queries every allowed organization for the runner target,
but the runner's `completeLaunch` and `failLaunch` helpers do not pass the
claimed request's `organization_id` back to the protocol command. The protocol
CLI therefore resolves auth with the stored/default org, and the API routes then
filter by that org. Desktop has the same issue: it calls complete/fail using the
currently viewed `organizationId`, not `claim.request.organization_id`.

Impact: a runner can successfully spawn an agent for org B while its stored/UI
org is org A, then fail to mark the request `launching` or `failed`. The row
stays `claimed` until lease expiry and can be relaunched, producing stale queue
state and possible duplicate agents.

Recommendation: have every post-claim lifecycle call use the claimed request org:
`complete-execution-launch`, `fail-execution-launch`, and any runner clear/list
action that acts on a claimed row. Add regression tests where the auth default org
differs from `claim.request.organization_id`.

### High - `--organization-id` no longer pins claim scope

Locations:
- `packages/overlord-cli/bin/_cli/runner.mjs:107`
- `packages/overlord-cli/bin/_cli/runner.mjs:218`
- `apps/web/app/api/protocol/claim-execution/route.ts:112`
- `apps/web/app/api/protocol/claim-execution/route.ts:126`

The runner still documents and implements a pinned organization scope, but the
server explicitly treats `tokenContext.organizationId` as only a default hint and
then claims from all target-sharing member orgs. Because the claim request body
does not carry a distinct "pinned org" value, the server cannot tell the
difference between a stored auth default and an explicit `--organization-id`.

Impact: operators cannot restrict a runner to a single org even though the CLI
claims they can. This is also surprising when testing a shared target across
multiple orgs.

Recommendation: either add an explicit optional claim body field such as
`organizationIdScope` that the runner sets only for `--organization-id`, then
intersect `allowedOrgIds` with it, or remove the option/help text if all claims
are intentionally always org-agnostic.

RESPONSE: Claims are intentionally org-agnostic. The runner is designed to be able to claim work from any org that shares the target.

### High - `targetResourceId` is trusted without validating project or target

Locations:
- `apps/web/app/api/protocol/request-execution/route.ts:44`
- `lib/overlord/execution-requests.ts:313`
- `apps/web/app/api/protocol/claim-execution/route.ts:48`

`createExecutionRequest` skips the request-time primary check whenever
`targetResourceId` is present, but it never verifies that the resource directory
belongs to the ticket's project, belongs to the requested target, or is visible
to the requesting user. Later, `resolveWorkingDirectory` only checks that the
resource's `execution_target_id` matches the claiming target and does not select
or compare `project_id`.

Impact: an API caller can queue a project objective with a resource id from
another project on the same target, causing the runner to launch the wrong
checkout path and bypassing the "no primary directory" guard.

Recommendation: validate explicit resources during request creation with the
service-role client: select `project_id`, `execution_target_id`, and path for
`targetResourceId`; require `project_id === ticket.project_id`; if
`targetExecutionTargetId` is set, require the same target; and fail before
queueing when the resource does not match. Keep the claim-time target check as a
defense-in-depth guard.

### Medium - Execution request id threading is still only partial

Locations:
- `packages/overlord-cli/bin/_cli/runner.mjs:294`
- `packages/overlord-cli/bin/_cli/runner.mjs:400`
- `packages/overlord-cli/bin/_cli/protocol.mjs:72`
- `lib/overlord/protocol-attach.ts:45`

The runner sets `OVERLORD_EXECUTION_REQUEST_ID` in the child process environment,
but `ovld protocol attach` never reads that env var into metadata. Terminal
profile launches also execute a generated shell command that exports only
`OVERLORD_DEVICE_FINGERPRINT`, so the request id is dropped before the agent
starts in a new terminal.

Impact: attach falls back to objective matching even though the comments say the
exact request id is threaded. The fallback is usually sufficient with the active
request uniqueness constraint, but it is weaker for debugging and any future path
that permits multiple launch attempts for the same objective.

Recommendation: add `executionRequestId` to `resolveProtocolMetadata` from
`OVERLORD_EXECUTION_REQUEST_ID`, export it in `buildRunnerLaunchShellCommand`,
and add CLI runner/protocol tests for direct spawn and terminal-profile launch.

### Medium - Missing-primary backstop can spam ticket events every poll

Location:
- `apps/web/app/api/protocol/claim-execution/route.ts:188`

When a project request reaches claim without a primary on the claiming target,
the route leaves the request queued and inserts a `ticket_events` row. A runner
polling every few seconds will insert the same event on every poll until someone
fixes the primary or clears the request.

Impact: one bad request can flood the activity feed and make the real launch
problem harder to see.

Recommendation: store the missing-primary message on `execution_requests.last_error`
and only emit a ticket event when transitioning into that error condition (or
rate-limit the event by request id). Clear `last_error` when the request is
successfully claimed.

## Verification

Review only. I did not run the test suite or change implementation code.
