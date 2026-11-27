# ADR 0111 Project Git and Files through registered runners

- Date: 2026-11-27
- Status: accepted

## Context

The project board needs read-only Git and Files for its configured resources.
A resource can have different local checkouts on different targets, and a
configured Git URL can exist before any runner has a local checkout.

## Decision

Add a project resource-read catalog and a bounded read operation under
`/api/projects/:id/resource-reads`. The browser chooses one local source using
its ID, revision, resource key and execution target. It asks the user to choose
between multiple eligible sources. The catalog exposes runner availability
and labels without filesystem paths.

The backend requires current project read permission and active access to the
selected target. Only the owner's registered native runner on that target can
claim and complete the job. The runner advertises `projectResourceReads` on its
claim heartbeat. Claim resolution checks the exact source again and supplies
its registered directory to the runner. Before returning data, the backend
rechecks project permission, target access and source revision.

The runner reuses the hardened Git status and diff implementations, requires a
worktree root for Git, and reads regular files and directories beneath the
registered source for Files. Files can also read a non-Git source. Results
travel through the existing private capability queue. The waiter clears
checkout data when it finishes, and private queue retention covers orphaned
rows. Browser content is short-lived and scoped to the account, project and
source. The existing agent repository-read operations retain their behavior.

## Alternatives considered

Reusing the agent route's resource-key lookup would allow a source to change
between selection and claim. A separate web request carries the exact source
revision and lets older runners skip the new capability. A paired-host relay
would need a new browser identity and authorization model and remains outside
this interaction.
