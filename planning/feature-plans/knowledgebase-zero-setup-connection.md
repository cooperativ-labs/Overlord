# Zero-setup Knowledgebase connection (coo:1121.w16e, contract v156)

## Problem

Settings → Connected accounts showed Knowledgebase as "Not configured on this server"
until an operator set `KNOWLEDGEBASE_MCP_URL` and generated
`ACCOUNT_CONNECTIONS_ENCRYPTION_KEY`. The OAuth flow itself (PKCE S256, RFC 8707
`resource`, CIMD client id, hashed single-use state, sealed verifier) already existed in
`backend/connections`. Only the two configuration gates stood between a user and
Connect.

## Decisions

1. **Standard server by default, operator override only.** An unset
   `KNOWLEDGEBASE_MCP_URL` now means `https://knowledge.chaselubitz.com/mcp`. An HTTPS
   value overrides it, and `off`/`none`/`disabled`/`false` turns the provider off.
   There are no per-user custom servers.
   - Why: one origin per deployment keeps egress a fixed, operator-reviewed allowlist,
     and keeps the one-live-connection-per-server invariant simple.
   - The standard server's authorization server is on the same origin
     (`/v1/auth`), so no extra egress origin is needed.
2. **Platform-managed key.** The key ring derives a credential key from
   `BETTER_AUTH_SECRET` with HKDF-SHA256, under an account-connections-only label.
   - Every Cloud deployment already provisions that secret. On Railway it is a
     preserved platform variable, so no user or operator generates a key.
   - The key id is `platform-<fingerprint>`. A rotated secret therefore surfaces as a
     rotated key: reauthorization, credential erased.
   - A missing secret surfaces as missing configuration: `unavailable`, credential
     kept.
   - Rejected: a random key stored in the database. It would sit beside the
     ciphertext and defeat encryption at rest.
3. **Explicit key still wins, and migration is lazy.** When
   `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY` is set, it remains the current key, so
   existing deployments are unchanged.
   - If an operator adds it later, Knowledgebase rows sealed under the platform key
     are re-sealed in place on next use. The token and credential revision do not
     change, and no one reconnects.
   - Profile-scoped providers keep their v153 fallback keys ahead of the platform key.
4. **UI.** The existing `ConnectedAccounts` row keeps its shape. It gains:
   - an "Opening Knowledgebase…" busy state, which is reset on a Back-button return;
   - a cancelled or unfinished sign-in explanation (`authorization_denied`);
   - the server host and shared workspaces;
   - actionable unavailable hints that never name a variable;
   - a retry on listing failure;
   - a Cancel for the desktop external-browser wait.

## Coverage

- `backend/connections/connections.postgres-conformance.test.ts` → "zero-setup
  Knowledgebase …" (SQLite and Postgres). It covers:
  - a fresh deployment with only `BETTER_AUTH_SECRET` completing OAuth against the
    standard origin;
  - explicit-key rows staying put;
  - platform → explicit re-seal;
  - a removed key staying `unavailable`;
  - a rotated secret leading to reconnect;
  - cancelled and failed sign-ins recovering;
  - owner and organization scoping;
  - the HTTP providers listing and `denied`/`connected` redirects.
- `webapp/web/lib/connections.test.ts` and
  `webapp/web/components/connections/ConnectedAccounts.test.tsx` cover the lifecycle
  states.

## Follow-ups

- The OverlordMobile Connected accounts rows read the same availability, so they need
  no change. Their copy for unavailable reasons can adopt the web hints.
