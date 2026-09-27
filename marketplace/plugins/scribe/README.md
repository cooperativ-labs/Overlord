# Scribe for ChatGPT and Claude

Ask “Pull my most recent Scribe transcript and turn it into decisions and action
items.” The shared MCP service reads Scribe's saved canonical transcripts,
including reviewed titles and speaker labels. It provides recent meetings,
literal text search, revision-aware paged retrieval, research `search`/`fetch`,
a meeting-notes prompt, and a transcript viewer for MCP Apps hosts.

This is a **single-user bridge to a local Scribe library**. Claude Code can start
it directly over stdio. ChatGPT and Claude web connect over Streamable HTTP and
OAuth. It does not call a model API or require OpenAI/Anthropic API keys. The
assistant performs the requested analysis on retrieved text.

## From the Scribe app

Settings → **Assistants** does the setup below from buttons, with the
remaining steps listed beside each one:

- **Add to Claude Code** stages the bundled plugin marketplace in
  `~/Library/Application Support/Scribe/Integrations/claude` and runs
  `claude plugin marketplace add` and `claude plugin install scribe@scribe-local`
  in a login shell. **Copy Commands** copies the same two commands instead.
- **Public address** takes your HTTPS tunnel/proxy origin and shows the
  connector URL (`…/mcp`). **Copy Server Command** copies a command that
  creates the owner key on first run and starts the HTTP bridge from the staged
  copy, allowing Claude's callback (`https://claude.ai/api/mcp/auth_callback`)
  and the ChatGPT callback, if one was entered. **Copy Owner Key** copies the
  key for Scribe's consent page.
- **Add to ChatGPT…** and **Add to Claude…** copy the connector URL and open
  `chatgpt.com/plugins` or `claude.ai/customize/connectors` for pasting.

`Scripts/build-app.sh` and `Scripts/package-app.sh` embed the package through
`Scripts/embed-assistant-connector.sh` (a release requires npm; a development
build skips it without npm, and the tab then says so).

## Build and test

Node.js 22 or newer is required. From this directory:

```sh
npm ci
npm test
npm run build
npm run package
```

Tests use synthetic transcripts and the official MCP client across both
transports. They include OAuth consent, PKCE, resource binding, token refresh
and revocation, filesystem boundaries, edits, search and pagination. No private
meeting text is needed. `npm run build` bundles dependencies into `dist/cli.mjs`;
`npm run package` creates a self-contained Claude marketplace at
`dist/packages/claude`, including dependency notices. Keep its `ui/` directory
beside `dist/`. Do not run `npm install` inside a plugin cache.

## Claude Code

For a temporary local session after building:

```sh
claude --plugin-dir /absolute/path/to/Scribe/Integrations/scribe
```

For a persistent install of the packaged plugin:

```sh
claude plugin marketplace add /absolute/path/to/Scribe/Integrations/scribe/dist/packages/claude
claude plugin install scribe@scribe-local
```

Restart Claude Code, run `/mcp`, and verify `scribe` is connected. Ask for your
most recent transcript or use `/scribe:scribe-transcripts`. The plugin includes
the MCP server and the transcript workflow skill. Its only runtime dependency
is Node; the packaged artifact can also be distributed through a compatible
marketplace. This local bundle does not provide Scribe's hosted ChatGPT service.

The default library is `~/Meeting Transcripts`, matching Scribe. Set
`SCRIBE_TRANSCRIPTS_DIR` in the launching environment to use another Scribe
store. For a remote Claude Code instance, use the HTTP endpoint instead:

```sh
claude mcp add --transport http scribe https://YOUR-DOMAIN/mcp
```

Use `/mcp` to authenticate. Add the exact callback shown by that client to the
server's redirect allowlist before authorizing it.

## ChatGPT and Claude web

The Mac must stay awake and the bridge must remain running. Remote clients
cannot read a localhost URL. Provide an HTTPS reverse proxy/tunnel to
`127.0.0.1:8766`, preserving the public `Host` header. For a development tunnel,
for example, `ngrok http 8766` produces an HTTPS origin. Public distribution
requires a stable deployment and the host's publisher review; a development
tunnel is only for private testing.

Create the private owner key once:

```sh
node dist/cli.mjs init
```

It creates `~/Library/Application Support/Scribe/MCP/owner-key` with mode 0600,
refusing to overwrite an existing key. Read that file locally when the consent
page asks for the key. **Do not paste it in a chat or into plugin manifests.**

Set the public origin and exact allowed OAuth callback URLs. Copy each callback
from that client's connection setup; do not use wildcard hosts or guessed URLs.
For ChatGPT, callback URLs can be specific to a connection. This server uses
dynamic registration, not CIMD, and does not advertise RFC 9207 issuer support.

```sh
export SCRIBE_PUBLIC_URL='https://YOUR-DOMAIN'
export SCRIBE_OAUTH_REDIRECT_URIS='["EXACT-HTTPS-CALLBACK-FROM-CHATGPT","EXACT-HTTPS-CALLBACK-FROM-CLAUDE"]'
node dist/cli.mjs http
```

Use actual callback URLs in that JSON array and omit clients you are not
connecting. HTTP startup refuses missing/unsafe configuration. It binds only
to loopback, rejects unexpected Host/Origin headers, and authenticates every MCP
request. The local stdio transport uses the OS user's existing file permissions.

In **ChatGPT**, enable developer mode under Settings → Security and login, then
add the HTTPS `/mcp` endpoint from the Plugins page with OAuth authentication.
Complete Scribe's consent page and select the plugin in a new conversation.
In **Claude web/Desktop**, add the same URL as a custom connector in Settings →
Connectors and complete OAuth. Account/organization policy may control access
to custom connectors. No public app-directory submission is performed by the
build or packaging commands.

For a portable ChatGPT plugin package, run:

```sh
npm run package -- --url https://YOUR-DOMAIN/mcp
```

This writes `dist/packages/chatgpt/scribe` with the portable plugin manifest,
remote MCP configuration, and workflow skill. If ChatGPT has assigned a
registered `plugin_asdk_app...` ID, add `--app-id <actual-id>` to generate the
OpenAI registered-app mapping. Packaging alone does not register the service or
install it in an account. Refresh the client connection after tool changes.

## Tools and data behavior

| Tool | Behavior |
| --- | --- |
| `scribe_recent_transcripts` | Latest saved transcript per meeting; newest processing run first; optional creation-date filters and paging |
| `scribe_search_transcripts` | Literal case-insensitive search over title, speaker names and segment text, with short excerpts |
| `scribe_get_transcript` | Timestamped text, metadata, warnings, revision and explicit continuation offset |
| `search` / `fetch` | Research retrieval aliases; large fetches continue with `scribe_get_transcript` |

Results use stable run UUIDs and `scribe://transcripts/<id>` source identifiers.
These identify sources for citations; they are not public URLs or app-opening
deep links. Source-relative timestamps are formatted as hours, minutes and
seconds. Speaker labels follow the canonical speaker table, matching exports;
presentation-only inferred identities are not promoted to confirmed speakers.

Text pages contain at most 24,000 UTF-16 code units. Follow `next_offset` until
null and pass `revision` on subsequent reads. Recent/search lists are live; a new
run between list pages can shift offset positions. An unfinished reprocess does
not hide its predecessor. Missing/corrupt/unsupported runs are counted in
`skipped_runs`; an unavailable root is an error. Limits are 32 MiB per canonical
file and 10,000 runs. The bridge scans saved files on each request, favoring fresh
edits over an index; very large libraries may respond slowly.

Only transcript text and selected metadata leave the service when requested.
The server exposes no audio, absolute paths, capture controls, deletes, or edits.
All tools carry read-only annotations and output schemas. Transcript text is
untrusted source material; the skill directs the model to ignore instructions
embedded in it. The viewer uses text nodes and no external assets or network
requests. Summaries and drafts stay in the requesting chat unless the user
requests another destination through another tool.

## Authentication and operation

OAuth supports discovery, dynamic client registration restricted to exact
callback URLs, authorization code + S256 PKCE, explicit password-protected owner
consent, `transcripts.read` scope, `/mcp` audience binding, one-hour access
tokens, rotating 30-day refresh tokens, and family revocation at `/revoke`.
Codes and consent requests expire after five minutes. Tokens survive a restart;
pending consent and codes do not. The service is for one library owner, with no
multi-user account routing. Use a separate instance, origin and state directory
for each owner. Run one process per state directory.

State is stored in mode-0600 `oauth-state.json` beside the owner key. Access and
refresh tokens are hashed; registered confidential-client credentials, when
used, are private state. Back up/protect that directory as credentials. To
disconnect every client, stop the bridge, remove `oauth-state.json`, then restart
and reconnect clients. Rotate the owner key separately if it was exposed.
Client-side disconnect may not call revocation; deleting server state is the
definitive all-client revocation procedure. Do not log proxy request bodies,
Authorization headers, or transcript responses.

Configuration:

| Variable | Default / purpose |
| --- | --- |
| `SCRIBE_TRANSCRIPTS_DIR` | `~/Meeting Transcripts` |
| `SCRIBE_MCP_STATE_DIR` | `~/Library/Application Support/Scribe/MCP` |
| `SCRIBE_MCP_PORT` | `8766` (loopback only) |
| `SCRIBE_PUBLIC_URL` | Required canonical HTTPS origin for HTTP |
| `SCRIBE_OAUTH_REDIRECT_URIS` | Required JSON array of exact approved OAuth callback URLs |

`GET /health` reports process liveness without revealing library information.
Unauthenticated `/mcp` must return 401 with protected-resource discovery. Proxy
forwarded headers are deliberately not trusted; per-IP rate limits are shared
behind a tunnel, appropriate for this single-user bridge.

## Acceptance checks and publication

After installing in each real client:

1. Ask for recent meetings and verify the title/date against Scribe.
2. Ask for decisions from one meeting and verify several timestamped passages.
3. Read a long meeting to the final page; edit its title/speaker in Scribe and
   confirm fresh retrieval sees the revision.
4. Confirm the viewer displays a list, a transcript page, empty results and
   errors. Confirm the model can work without widget support in Claude Code.
5. Deny OAuth once, reconnect successfully, then disconnect/revoke and confirm
   the old token cannot read transcripts.

Public submission additionally needs an actual HTTPS deployment, publisher
identity, published privacy policy/terms, sample reviewer library, brand assets,
and screenshots. Never give directory reviewers access to a private meeting
library. Those account/deployment steps cannot be supplied by a local bundle.

The implementation follows Overlord's shared MCP + client-adapter pattern, tool
annotations, OAuth discovery and presentation resources; it uses the official
MCP SDK instead of copying Overlord's hosted workspace/auth code.

Official references checked during implementation:

- [OpenAI MCP server and UI](https://developers.openai.com/plugins/build/app-quickstart)
- [OpenAI OAuth authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [Claude plugin manifests](https://code.claude.com/docs/en/plugins-reference)
- [MCP Apps initialization](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiInitializeRequest.html)
