# ADR 0109: Bind project resource sources to verified Latch hosts

- Date: 2026-11-27
- Status: accepted
- Contract version: 182.6.0
- Supersedes: none

## Context

A source path and execution target ID cannot identify a Latch host. Two
machines can contain distinct worktrees at the same path. Latch's pairing
pins a static public key. Its local status command exposes the same public
identity. Overlord runner registration identifies an owner and an operating
target, and its device fingerprint is an operational identifier.

## Decision

A project editor who owns the source's registered local target supplies the
expected public key obtained on the intended Latch host. Confirm its digest
using the existing runner queue and a bounded read of
`latch remote-access status --json`. Only the requesting owner’s native
runner on the acting target can claim and complete this operation. Verification
requires exactly one live native runner. The host key is stored on the source
with the owning workspace member and new source revision. Relinking replaces
the association and unlinking clears it. Both use revision compare-and-set.
An accepted mutation and its 24-hour retry receipt commit together.

## Consequences

The resource list exposes the link only to its owning workspace member with
active target access. Multiple live native runners or multiple sources of one
resource bound to the same host suppress the usable link. Changed or removed
sources require fresh verification. Signed-out and switched accounts have
independent access to the link. A Mobile consumer must match the key against
its authenticated Latch pairing, require the current Control grant and use
the exact-root open before reading files or Git data. Reconnect and access
changes invalidate client-held references. Historical runner registrations
permit a verified link to remain usable over Latch while the Overlord runner
is offline. Older clients can ignore the optional response field.

## Alternatives considered

Path, label and repository URL matching cannot identify a host. Letting a
project editor enter an unchecked public key could associate an unrelated
paired host. Trusting the local Overlord fingerprint alone would miss machines
with identical fingerprints. Comparing an independently obtained key to a
native runner observation adds an explicit confirmation while reusing the
existing registration and pairing authorities. Pairing and physical host
authentication remain with Latch.
