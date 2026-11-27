# ADR 0110: Link explicit Latch shared roots to project sources

- Date: 2026-11-27
- Status: accepted
- Supersedes: none

## Context

Project access and an authenticated Latch host identify a source. Files
also needs an explicit share from that host's owner for the paired device.

## Decision

Extend ADR 0109's account-scoped source association and revisioned mutation.
Project editors who own a registered target can submit the ID returned by
Latch when the owner shares the source directory. The target owner's native
runner verifies the public host key, exact canonical source directory and
saved directory identity. It checks the share's device, current Control
grant and grant revision using the host-local Latch CLI. Only the public-key
digest and confirmation of the requested root ID return to Overlord.

Root-only unlink preserves the host link and works while the runner is
offline. Host replacement or removal clears its root. Reverification of the
same host with the root field omitted preserves the root. Source edits,
revision conflicts, ambiguous host matches and loss of project or target
access use the existing association rules.

## Consequences

A saved root ID is an opaque selector. The client must match its
authenticated host and find the ID among the roots for its current pairing.
Latch checks grant revocation and directory identity on use. Overlord
stores no Latch credentials, file data, pairing records or root paths.
Older clients can omit the root field. Older runners can continue to verify
hosts and fail closed on root linking because they supply no root proof.

## Alternatives considered

Reusing the source path as Files authority would bypass explicit owner
selection. Storing credentials or proxying previews through Overlord would
extend access beyond the paired transport. Storing the bounded selector in
the existing association keeps Files subject to both permission systems.
