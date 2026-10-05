# coo:1108.z77k live acceptance harness

Not production code and not a contracted interface. These scripts drive the section 14
matrix of `planning/feature-plans/chat-agent-request-routing.md` against a scratch stack
on one machine. The report is `planning/feature-plans/chat-agent-request-routing-acceptance.md`;
raw results are in `results/`.

## What is real and what is not

| Part | Used |
| --- | --- |
| Backend | The real `backend/index.ts` process in cloud mode on a throwaway Postgres database |
| Engine | Real `gemini-3.8-flash` through the production runtime (key from `.env.local`) |
| Repository reads | The real `ovld runner` (run from this checkout's source) on two registered targets, over HTTP |
| Clients | HTTP with bearer credentials, as a remote client; the production Swift model; headless Chromium |
| Knowledgebase | The **production** connections module, OAuth client, egress policy and MCP client, against the in-memory `FakeKnowledgebase`. Real sign-in is blocked (no public client metadata document; consent needs the account holder) |
| APNs | Not configured. Candidates reach `dispatched` with no device to deliver to |

`kb-preload.ts` is loaded into the scratch backend with `node --import`. It redirects
`fetch` for the one fake Knowledgebase origin, keeps that server's state across backend
restarts, and opens a loopback control port so the harness can act as the account holder
(consent) and the upstream administrator (revocation). It also holds outbound Gemini request
bodies in memory to answer "did this text reach the provider after time T", and can inject
provider faults. Nothing is logged or returned except counts and tool names.

## Files

- `bootstrap.ts`: accounts (owner A with workspaces Engineering and Labs, owner B in another
  organization, member C in Labs only), projects, runner credentials.
- `bind.ts`: binds resources to directories by inserting rows, so no checkout's
  `.overlord/project.json` is written.
- `acceptance.ts`, `acceptance-flows.ts`, `acceptance-safety.ts`: the scenarios.
- `lib.ts`: HTTP, stream, database and result helpers.

## Reproduce

Use Node 24 and a scratch directory outside the repository (`$W`). Never start the scratch
processes with this shell's `OVERLORD_*` variables; they point at production.

```sh
ROOT=$PWD; W=/tmp/ovld-accept; mkdir -p $W/logs $W/home-cloud $W/home-t1 $W/home-t2
export PATH="$ROOT/node_modules/.bin:$PATH" TMPDIR=/tmp

# 1. Database (disposable) and migrations
node scripts/test-db.mjs up            # prints the server URL
#   create a database `overlord_accept` in it, then:
DATABASE_URL=postgresql://…/overlord_accept tsx scripts/migrate-postgres.ts

# 2. Backend, cloud mode, with the fake Knowledgebase preload
cd backend && env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp OVLD_HOME=$W/home-cloud \
  DATABASE_URL=postgresql://…/overlord_accept OVERLORD_WEB_HOST=127.0.0.1 OVERLORD_WEB_PORT=4411 \
  BETTER_AUTH_URL=http://127.0.0.1:4411 BETTER_AUTH_SECRET=<random> \
  KNOWLEDGEBASE_MCP_URL=https://kb.test/mcp ACCOUNT_CONNECTIONS_ENCRYPTION_KEY=<32 bytes base64url> \
  ACCEPTANCE_KB_CONTROL_PORT=4412 ACCEPTANCE_KB_STATE_FILE=$W/kb-state.json \
  node --import tsx --import ../planning/spikes/coo-1108-z77k/kb-preload.ts index.ts

# 3. Accounts and projects
ACCEPTANCE_WORK_DIR=$W node --import tsx planning/spikes/coo-1108-z77k/bootstrap.ts

# 4. Two targets and runners (the CLI run from source so it has the read capabilities).
#    For each of t1/t2, with its own OVLD_HOME, runner token from $W/state.json and a custom
#    OVERLORD_DEVICE_FINGERPRINT (the default one collides with the backend host):
#      ovld add-et --name "Jake Mac" --workspace-id eng --json
#      ovld runner start --poll-interval-ms 500
ACCEPTANCE_WORK_DIR=$W node --import tsx planning/spikes/coo-1108-z77k/bind.ts <t1 id> <t2 id>

# 5. Scenarios (order matters: `revocation` ends by disconnecting the Knowledgebase)
ACCEPTANCE_WORK_DIR=$W ACCEPTANCE_RUN_NAME=acceptance-final \
  node --import tsx planning/spikes/coo-1108-z77k/acceptance.ts \
  kb research bounds isolation names targets relaunch notify create cancel restart \
  injection routing limits revocation2 revocation local
```

`restart`, `create` and `limits` stop, kill and restart the backend through
`stack.sh` in this folder (copied to `$W`, with `W` and `ROOT` exported; `backend-start`, `backend-stop`, `backend-kill9`, `runner-start <n>`,
`runner-stop <n>`); `EXTRA_ENV` passes limit settings to a restart. The Sandbox Service
fixture is two clones of a small repository in different states, holding an injected
instruction file, secret files, a binary file, a symlink leaving the checkout and a 2.6 MB
log.

`local` needs a second backend started outside the repository directory (so no
`overlord.toml` selects cloud mode) on SQLite, and `ACCEPTANCE_LOCAL_URL` /
`ACCEPTANCE_LOCAL_TOKEN`.

The mobile client is exercised by `OverlordMobile/scripts/test-chat-live.sh` with
`OVERLORD_LIVE_BASE_URL` and `OVERLORD_LIVE_TOKEN`.
