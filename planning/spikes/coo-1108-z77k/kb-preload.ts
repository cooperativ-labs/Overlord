/* eslint-disable no-console -- acceptance harness */
// coo:1108.z77k acceptance harness — NOT production code and NOT a contracted interface.
//
// Loaded into a scratch backend process with `node --import`. The real Knowledgebase
// sign-in is still blocked (no public client metadata document, and consent needs the
// account holder), so this stands an in-memory Knowledgebase behind the *production*
// connections module inside the real backend process: global `fetch` is redirected for the
// one fake origin only, so the production OAuth client, egress policy, MCP client, source
// checker and HTTP routes all run unchanged. A loopback control port lets the harness play
// the account holder (consent) and the upstream administrator (revocation).
//
// Enabled only when ACCEPTANCE_KB_CONTROL_PORT is set.

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

import { FakeKnowledgebase, KB_ORIGIN } from '../../../backend/connections/fake-knowledgebase.ts';

const port = Number(process.env.ACCEPTANCE_KB_CONTROL_PORT);
if (Number.isSafeInteger(port) && port > 0) {
  const kb = new FakeKnowledgebase();
  kb.now = Date.now();
  const clock = setInterval(() => (kb.now = Date.now()), 250);
  clock.unref();

  interface Note {
    id: string;
    path: string;
    title: string;
    body: string;
    version: string;
  }
  const notes = new Map<string, Note>();

  // A real Knowledgebase keeps its grants while Overlord restarts. Persist the fake's state
  // (fake tokens for a fake server, in the scratch directory) so a backend restart or kill
  // does not look like an upstream revocation.
  const stateFile =
    process.env.ACCEPTANCE_KB_STATE_FILE ?? path.join(process.cwd(), 'kb-state.json');
  type Grant = { user: string; clientId: string; alive: boolean };
  const internals = kb as unknown as {
    access: Map<string, { grant: Grant; expiresAt: number }>;
    refresh: Map<string, { grant: Grant; rotatedAt: number | null; revoked: boolean }>;
  };
  const persist = () => {
    const grants: Grant[] = [];
    const index = (grant: Grant) => {
      let i = grants.indexOf(grant);
      if (i < 0) i = grants.push(grant) - 1;
      return i;
    };
    const access = [...internals.access].map(([token, v]) => ({
      token,
      grant: index(v.grant),
      expiresAt: v.expiresAt
    }));
    const refresh = [...internals.refresh].map(([token, v]) => ({
      token,
      grant: index(v.grant),
      rotatedAt: v.rotatedAt,
      revoked: v.revoked
    }));
    writeFileSync(
      stateFile,
      JSON.stringify({
        notes: [...notes.values()],
        grants,
        access,
        refresh,
        revokedNodes: [...kb.revokedNodes]
      })
    );
  };
  if (existsSync(stateFile)) {
    const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
    for (const note of saved.notes ?? []) notes.set(note.id, note);
    const grants: Grant[] = saved.grants ?? [];
    for (const a of saved.access ?? [])
      internals.access.set(a.token, { grant: grants[a.grant]!, expiresAt: a.expiresAt });
    for (const r of saved.refresh ?? [])
      internals.refresh.set(r.token, {
        grant: grants[r.grant]!,
        rotatedAt: r.rotatedAt,
        revoked: r.revoked
      });
    for (const node of saved.revokedNodes ?? []) kb.revokedNodes.add(node);
  }
  const fakeFetch = async (input: string, init: RequestInit = {}) => {
    const response = await kb.fetch(input, init);
    persist();
    return response;
  };
  const realFetch = globalThis.fetch;

  const reply = (id: number | undefined, payload: unknown) =>
    new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(payload) }] }
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' }
      }
    );

  /** Serves seeded notes for `search` / `read_file`; everything else is the stock fake. */
  const kbFetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    let body: {
      method?: string;
      id?: number;
      params?: { name?: string; arguments?: Record<string, unknown> };
    } | null = null;
    try {
      body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    } catch {
      body = null; // Form-encoded OAuth requests go to the fake unchanged.
    }
    const tool = body?.method === 'tools/call' ? body.params?.name : undefined;
    if (tool === 'search' || tool === 'read_file') {
      // Authenticate through the stock fake first so revoked or expired tokens still get 401.
      const probe = await fakeFetch(input, {
        ...init,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: body!.id,
          method: 'tools/call',
          params: { name: 'list_workspaces', arguments: {} }
        })
      });
      if (probe.status !== 200) return probe;
      const args = body!.params?.arguments ?? {};
      if (tool === 'search') {
        const q = String(args.query ?? args.q ?? '').toLowerCase();
        const words = q.split(/\W+/).filter(w => w.length > 2);
        const hits = [...notes.values()].filter(
          n =>
            !words.length ||
            words.some(w => `${n.title} ${n.body} ${n.path}`.toLowerCase().includes(w))
        );
        return reply(body!.id, {
          results: hits.map(n => ({
            id: n.id,
            path: n.path,
            title: n.title,
            current_version_id: n.version,
            updated_at: '2026-09-28T10:00:00.000Z'
          }))
        });
      }
      const wanted = String(args.path ?? args.node_id ?? args.id ?? '');
      const note = [...notes.values()].find(n => n.path === wanted || n.id === wanted);
      if (!note) return reply(body!.id, { error: 'not_found', path: wanted });
      return reply(body!.id, {
        node_id: note.id,
        path: note.path,
        current_version_id: note.version,
        body: note.body
      });
    }
    return fakeFetch(input, init);
  };

  // Provider request bodies are held in memory only, to answer "did this text reach the
  // provider after time T" and "which tools were declared". They are never logged or returned.
  const providerLog: { at: number; body: string }[] = [];
  let providerFault: { status: number; remaining: number } | null = null;
  let failSourceChecks = false;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(`${KB_ORIGIN}/`)) {
      if (failSourceChecks && typeof init?.body === 'string' && init.body.includes('"get_related"'))
        return new Response('upstream unavailable', { status: 503 });
      return kbFetch(url, init ?? {});
    }
    if (url.includes('generativelanguage.googleapis.com')) {
      const body =
        typeof init?.body === 'string'
          ? init.body
          : input instanceof Request
            ? await input.clone().text()
            : '';
      providerLog.push({ at: Date.now(), body });
      if (providerLog.length > 600) providerLog.shift();
      if (providerFault && providerFault.remaining > 0) {
        providerFault.remaining--;
        return new Response(
          JSON.stringify({
            error: { code: providerFault.status, message: 'injected fault', status: 'INJECTED' }
          }),
          { status: providerFault.status, headers: { 'content-type': 'application/json' } }
        );
      }
    }
    return realFetch(input as never, init);
  }) as typeof fetch;

  const json = (res: import('node:http').ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        setImmediate(persist);
        switch (req.url) {
          case '/seed': {
            const note: Note = {
              id: input.id ?? randomUUID(),
              path: String(input.path),
              title: String(input.title),
              body: String(input.body),
              version: String(input.version ?? 'ver-1')
            };
            notes.set(note.id, note);
            return json(res, 200, { id: note.id });
          }
          case '/consent': {
            // The account holder approves the authorize request. The stock fake insists on an
            // HTTPS client id; a loopback scratch backend has an http one, so the code is
            // registered here with the same fields the fake records.
            const url = new URL(String(input.authorizeUrl));
            const p = url.searchParams;
            if (
              p.get('response_type') !== 'code' ||
              p.get('code_challenge_method') !== 'S256' ||
              !p.get('resource') ||
              !p.get('scope')?.includes('offline_access')
            )
              return json(res, 400, { error: 'authorize request rejected' });
            const code = randomUUID();
            (
              kb as unknown as {
                codes: Map<string, Record<string, string>>;
              }
            ).codes.set(code, {
              user: String(input.user ?? 'kb-owner'),
              clientId: p.get('client_id')!,
              challenge: p.get('code_challenge')!,
              redirectUri: p.get('redirect_uri')!,
              resource: p.get('resource')!
            });
            return json(res, 200, {
              code,
              state: p.get('state'),
              redirectUri: p.get('redirect_uri'),
              params: [...p.keys()]
            });
          }
          case '/revoke-node':
            kb.revokedNodes.add(`${String(input.user ?? 'kb-owner')}:${String(input.nodeId)}`);
            return json(res, 200, { ok: true });
          case '/restore-node':
            kb.revokedNodes.delete(`${String(input.user ?? 'kb-owner')}:${String(input.nodeId)}`);
            return json(res, 200, { ok: true });
          case '/revoke-consent':
            kb.revokeConsent(String(input.user ?? 'kb-owner'));
            return json(res, 200, { ok: true });
          case '/stats':
            return json(res, 200, {
              calls: kb.calls,
              tokenRequests: kb.tokenRequests,
              revocations: kb.revocations
            });
          case '/fail-source-checks':
            failSourceChecks = Boolean(input.on);
            return json(res, 200, { failSourceChecks });
          case '/provider-fault':
            providerFault = { status: Number(input.status), remaining: Number(input.count ?? 1) };
            return json(res, 200, { ok: true });
          case '/provider-contains': {
            const since = Number(input.since ?? 0);
            const scoped = providerLog.filter(entry => entry.at >= since);
            const needles: string[] = Array.isArray(input.needles) ? input.needles : [];
            return json(res, 200, {
              requests: scoped.length,
              containing: Object.fromEntries(
                needles.map(needle => [
                  needle,
                  scoped.filter(entry => entry.body.includes(needle)).length
                ])
              )
            });
          }
          case '/provider-tools': {
            const since = Number(input.since ?? 0);
            const sets = new Map<string, number>();
            for (const entry of providerLog.filter(e => e.at >= since)) {
              let names: string[] = [];
              try {
                const parsed = JSON.parse(entry.body);
                names = (parsed.tools ?? []).flatMap((t: any) =>
                  (t.functionDeclarations ?? []).map((d: any) => String(d.name))
                );
              } catch {
                names = ['<unparsed>'];
              }
              const key = names.join(',');
              sets.set(key, (sets.get(key) ?? 0) + 1);
            }
            return json(res, 200, {
              distinctToolLists: [...sets.entries()].map(([names, requests]) => ({
                names: names ? names.split(',') : [],
                requests
              }))
            });
          }
          case '/leaks':
            return json(res, 200, { leaks: kb.leaks(String(input.haystack ?? '')) });
          default:
            return json(res, 404, { error: 'not_found' });
        }
      } catch (error) {
        return json(res, 500, { error: (error as Error).message });
      }
    });
  })
    .listen(port, '127.0.0.1')
    .unref();
  console.error(`[acceptance] fake Knowledgebase control on 127.0.0.1:${port}`);
}
