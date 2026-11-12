# ADR 0035: One account-connections module owns every external account credential

- Date: 2026-10-05
- Status: accepted
- Contract version: 153
- Supersedes: none
- Origin: contract v153 (coo:1110), backfilled 2026-11

## Context

Everhour and GitHub personal credentials lived in extension-owned stores with their own encryption, beside the new Knowledgebase connections.

## Decision

`account_connections` holds every external account connection, organization-scoped (`knowledgebase`) or profile-scoped (`everhour`, `github`). The connections module is the only reader and writer of credentials, owns the key ring and re-sealing, and runs the GitHub repository OAuth flow; extensions obtain credentials only through `ProfileConnections` and never hold an encryption key. Legacy envelopes are adopted verbatim by migration and lazily, re-sealed under the current key, and tombstoned on disconnect so they cannot be resurrected. A missing configured key keeps the envelope (`unavailable`); a rotated key erases it (`reauthorization_required`). There is never a plaintext fallback.

## Consequences

- The legacy personal-connection routes are compatibility aliases with recorded retirement criteria.
- The GitHub OAuth security properties of v31/v33 are unchanged.

## Alternatives considered

Not recorded.
