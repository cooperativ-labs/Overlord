/* global URL, URLSearchParams, AbortSignal */
/* eslint-disable no-console -- proof script */
// coo:1108 Phase A: Overlord-side outbound OAuth + MCP client proof for the configured
// Knowledgebase (https://knowledge.chaselubitz.com/mcp). NOT production code.
//
//   node knowledgebase-client-proof.mjs discover
//       Live, unauthenticated: RFC 9728/8414 discovery, grant/PKCE/CIMD support, and the
//       authorize endpoint's response to a client ID it cannot resolve.
//   node knowledgebase-client-proof.mjs authorize --client-id <https CIMD URL> [--port 8765]
//       Authorization code + PKCE (S256) + RFC 8707 resource, loopback redirect. Needs a
//       publicly hosted client metadata document and an interactive sign-in.
//   node knowledgebase-client-proof.mjs reads [--node <uuid> --workspace <slug>]
//       initialize, tools/list (allowlist), list_workspaces, search, and the per-node
//       access check. Uses the stored OAuth token or KB_PAT (a kb_pat_ token).
//   node knowledgebase-client-proof.mjs refresh | revoke
//
// Tokens are written to an AES-256-GCM envelope bound to an owner ID (key from
// CHAT_PROOF_CREDENTIAL_KEY, 32 bytes base64). Token values are never printed.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const RESOURCE = process.env.KB_MCP_URL ?? 'https://knowledge.chaselubitz.com/mcp';
const OWNER = process.env.CHAT_PROOF_OWNER ?? 'proof-owner';
const STORE = process.env.CHAT_PROOF_CREDENTIAL_FILE ?? '.kb-proof-credential.json';
const TIMEOUT_MS = 15_000;
const OUTPUT_LIMIT = 64 * 1024;

// Reviewed read allowlist. `query` is read-only in behaviour but not annotated so (it is a
// POST); it stays out until reviewed. Annotations never widen this list.
const READ_ALLOWLIST = new Set([
  'get_current_actor', 'list_workspaces', 'list_shared_with_me', 'search', 'list_children',
  'read_resource', 'read_file', 'get_related', 'get_links', 'list_entities', 'traverse',
  'get_neighborhood', 'list_versions', 'read_version'
]);

const [command, ...rest] = process.argv.slice(2);
const opts = Object.fromEntries(rest.reduce((acc, v, i, a) => (i % 2 ? acc : [...acc, [a[i].replace(/^--/, ''), a[i + 1]]]), []));

const out = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));

async function fetchJson(url, init = {}) {
  const res = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, headers: res.headers, body, text };
}

async function discover() {
  const probe = await fetchJson(RESOURCE, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
  const challenge = probe.headers.get('www-authenticate') ?? '';
  const prmUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
  const prm = (await fetchJson(prmUrl)).body;
  const issuer = prm.authorization_servers[0];
  const asUrl = `${new URL(issuer).origin}/.well-known/oauth-authorization-server${new URL(issuer).pathname}`;
  const as = (await fetchJson(asUrl)).body;
  return { challengeStatus: probe.status, prm, as };
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

// ---- owner-bound credential envelope -------------------------------------------
function key() {
  const raw = process.env.CHAT_PROOF_CREDENTIAL_KEY;
  if (!raw) throw new Error('CHAT_PROOF_CREDENTIAL_KEY (32 bytes, base64) is required');
  return Buffer.from(raw, 'base64');
}
function seal(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(`kb:${OWNER}`));
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  writeFileSync(STORE, JSON.stringify({ v: 1, owner: OWNER, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600 });
}
function unseal() {
  if (!existsSync(STORE)) return null;
  const env = JSON.parse(readFileSync(STORE, 'utf8'));
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(env.iv, 'base64'));
  decipher.setAAD(Buffer.from(`kb:${OWNER}`)); // a different owner fails authentication
  decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]).toString());
}

// ---- MCP over stateless Streamable HTTP ----------------------------------------
let rpcId = 0;
async function rpc(token, method, params) {
  const res = await fetchJson(RESOURCE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params })
  });
  let body = res.body;
  if (!body && (res.text.startsWith('event:') || res.text.includes('\ndata:'))) {
    const data = res.text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop();
    body = data ? JSON.parse(data) : null;
  }
  return { status: res.status, body, bytes: res.text.length, challenge: res.headers.get('www-authenticate') };
}

async function callTool(token, name, args) {
  if (!READ_ALLOWLIST.has(name)) return { denied: 'not_in_read_allowlist' };
  const r = await rpc(token, 'tools/call', { name, arguments: args });
  const text = r.body?.result?.content?.map((c) => c.text ?? '').join('') ?? '';
  return {
    httpStatus: r.status,
    isError: r.body?.result?.isError ?? Boolean(r.body?.error),
    bytes: text.length,
    truncated: text.length > OUTPUT_LIMIT,
    // The proof prints only shape, never document content.
    httpStatusInText: /\(HTTP (\d{3})\)/.exec(text)?.[1] ?? null,
    parsed: (() => { try { return JSON.parse(text.slice(0, OUTPUT_LIMIT)); } catch { return null; } })()
  };
}

async function accessToken() {
  if (process.env.KB_PAT) return { token: process.env.KB_PAT, kind: 'pat' };
  const cred = unseal();
  if (!cred) throw new Error('no stored credential; run authorize or set KB_PAT');
  return { token: cred.access_token, kind: 'oauth' };
}

if (command === 'discover') {
  const { challengeStatus, prm, as } = await discover();
  const unknownClient = await fetchJson(`${as.authorization_endpoint}?${new URLSearchParams({
    response_type: 'code', client_id: 'https://backend.ovld.ai/oauth/does-not-exist.json',
    redirect_uri: 'http://127.0.0.1:8765/callback', code_challenge: pkce().challenge,
    code_challenge_method: 'S256', scope: 'openid offline_access', resource: RESOURCE, state: 'probe'
  })}`);
  out('discovery', {
    unauthenticatedStatus: challengeStatus,
    resource: prm.resource,
    authorizationServers: prm.authorization_servers,
    pkce: as.code_challenge_methods_supported,
    grants: as.grant_types_supported,
    deviceGrant: as.grant_types_supported.includes('urn:ietf:params:oauth:grant-type:device_code') || Boolean(as.device_authorization_endpoint),
    dynamicRegistration: Boolean(as.registration_endpoint),
    cimd: as.client_id_metadata_document_supported ?? false,
    publicClientAuth: as.token_endpoint_auth_methods_supported.includes('none'),
    scopes: as.scopes_supported,
    revocation: Boolean(as.revocation_endpoint),
    introspectionAuth: as.introspection_endpoint_auth_methods_supported
  });
  out('authorize.unresolvable_client', {
    status: unknownClient.status,
    location: unknownClient.headers.get('location')?.replace(/[?#].*$/, '') ?? null,
    error: unknownClient.body?.error ?? unknownClient.body?.message ?? (unknownClient.headers.get('location') ? new URL(unknownClient.headers.get('location'), as.issuer).searchParams.get('error') : null) ?? unknownClient.text.slice(0, 160)
  });
} else if (command === 'authorize') {
  const { as } = await discover();
  const port = Number(opts.port ?? 8765);
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const { verifier, challenge } = pkce();
  const state = randomBytes(16).toString('base64url');
  const url = `${as.authorization_endpoint}?${new URLSearchParams({
    response_type: 'code', client_id: opts['client-id'], redirect_uri: redirectUri,
    code_challenge: challenge, code_challenge_method: 'S256', scope: 'openid offline_access',
    resource: RESOURCE, state
  })}`;
  out('authorize.open_in_browser', { url });
  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const params = new URL(req.url, redirectUri).searchParams;
      res.end('You can close this window.');
      server.close();
      if (params.get('state') !== state) reject(new Error('state mismatch'));
      else if (params.get('error')) reject(new Error(params.get('error')));
      else resolve(params.get('code'));
    }).listen(port, '127.0.0.1');
  });
  const token = await fetchJson(as.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: opts['client-id'], code_verifier: verifier, resource: RESOURCE })
  });
  if (token.status !== 200) throw new Error(`token exchange ${token.status}`);
  seal({ ...token.body, client_id: opts['client-id'], obtained_at: Date.now() });
  out('authorize.stored', { hasRefresh: Boolean(token.body.refresh_token), expiresIn: token.body.expires_in, scope: token.body.scope });
} else if (command === 'reads') {
  const { token, kind } = await accessToken();
  const init = await rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'overlord-chat-proof', version: '0' } });
  out('mcp.initialize', { credential: kind, status: init.status, server: init.body?.result?.serverInfo?.name ?? null });
  const list = await rpc(token, 'tools/list', {});
  const tools = list.body?.result?.tools ?? [];
  out('mcp.tools', {
    total: tools.length,
    exposed: tools.filter((t) => READ_ALLOWLIST.has(t.name)).map((t) => t.name),
    readOnlyAnnotatedButNotAllowlisted: tools.filter((t) => t.annotations?.readOnlyHint && !READ_ALLOWLIST.has(t.name)).map((t) => t.name),
    allowlistedWithoutReadOnlyHint: tools.filter((t) => READ_ALLOWLIST.has(t.name) && !t.annotations?.readOnlyHint).map((t) => t.name)
  });
  out('write.attempt', { tool: 'delete_file', result: await callTool(token, 'delete_file', { path: 'x' }) });
  const ws = await callTool(token, 'list_workspaces', {});
  out('read.list_workspaces', { httpStatus: ws.httpStatus, isError: ws.isError, workspaces: ws.parsed?.workspaces?.map((w) => w.slug) ?? null });
  const workspace = opts.workspace ?? ws.parsed?.workspaces?.[0]?.slug;
  const hits = await callTool(token, 'search', { q: opts.q ?? 'Overlord', workspace, limit: 5 });
  out('read.search', { workspace, isError: hits.isError, bytes: hits.bytes });
  if (opts.node) {
    // Current per-source access check: GET /v1/ws/{ws}/nodes/{id}. 403 after revocation.
    const check = await callTool(token, 'get_related', { node_id: opts.node, workspace });
    out('access.check', { node: opts.node, isError: check.isError, httpStatus: check.httpStatusInText, accessible: !check.isError });
  }
} else if (command === 'refresh' || command === 'revoke') {
  const { as } = await discover();
  const cred = unseal();
  const endpoint = command === 'refresh' ? as.token_endpoint : as.revocation_endpoint;
  const body = command === 'refresh'
    ? { grant_type: 'refresh_token', refresh_token: cred.refresh_token, client_id: cred.client_id, resource: RESOURCE }
    : { token: cred.refresh_token, token_type_hint: 'refresh_token', client_id: cred.client_id };
  const r = await fetchJson(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  if (command === 'refresh' && r.status === 200) seal({ ...cred, ...r.body, obtained_at: Date.now() });
  out(command, { status: r.status, rotated: command === 'refresh' && r.body?.refresh_token !== cred.refresh_token });
} else {
  console.error('usage: discover | authorize --client-id <url> | reads [--node id --workspace slug] | refresh | revoke');
  process.exit(1);
}
