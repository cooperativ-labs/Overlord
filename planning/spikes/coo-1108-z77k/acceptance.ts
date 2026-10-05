/* eslint-disable no-console -- acceptance harness */
// coo:1108.z77k live acceptance run — NOT production code and NOT a contracted interface.
//
// Drives the section 14 matrix of planning/feature-plans/chat-agent-request-routing.md
// against a scratch cloud-mode backend (Postgres) as a remote client would: HTTP with bearer
// credentials, the real `ovld runner` on two registered targets, and real Gemini
// (`gemini-3.8-flash`). The Knowledgebase is the in-memory server behind the production
// connections module (see kb-preload.ts); real sign-in remains blocked.
//
// Results carry ids, counts, outcomes and assistant answers. They never carry tokens,
// checkpoint payloads, thought signatures or secret fixture values.
//
// Usage: ACCEPTANCE_WORK_DIR=<scratch> node --import tsx planning/spikes/coo-1108-z77k/acceptance.ts <scenario...>

import { randomUUID } from 'node:crypto';

import {
  api,
  BASE,
  closeDb,
  kbControl,
  lastAssistant,
  loadState,
  Recorder,
  rows,
  saveState,
  sleep,
  type State,
  streamUntil,
  textOf,
  waitSettled
} from './lib.ts';

const state: State = loadState();
const A = state.users.a!.token;
const B = state.users.b!.token;
const C = state.users.c!.token;
const P = state.projects!;
const T = state.targets!;
const rec = new Recorder(
  process.env.ACCEPTANCE_RUN_NAME ?? `acceptance-${process.argv.slice(2).join('+') || 'all'}`
);
const extra: Record<string, unknown> = { model: 'gemini-3.8-flash', base: BASE };

const OFFLINE_NOTE = `# Offline support — design notes (2026-09)
Goal: the phone keeps working without the backend for capture and reading.
- Capture: queue new missions/objectives locally and replay them in order on reconnect; today OfflineObjectiveStore only queues a failed mission create.
- Reading: cache the mission list and mission detail; show staleness.
- Sync: the backend needs idempotent creates keyed by client request ids so replays cannot duplicate.
- Open question: whether the desktop app should cache for Local mode too.`;
const NOTE_MARKER = 'OfflineObjectiveStore only queues';

async function counts() {
  const [row] = await rows<{ missions: string; objectives: string; launches: string }>(
    `SELECT (SELECT COUNT(*) FROM missions) AS missions, (SELECT COUNT(*) FROM objectives) AS objectives,
            (SELECT COUNT(*) FROM execution_requests WHERE mission_id IS NOT NULL) AS launches`
  );
  return {
    missions: Number(row!.missions),
    objectives: Number(row!.objectives),
    launches: Number(row!.launches)
  };
}
const newThread = async (token: string, text: string) => {
  const created = await api(token, 'POST', '/api/chat/threads', {
    message: { clientRequestId: randomUUID(), text }
  });
  if (created.status !== 200)
    throw new Error(`thread ${created.status} ${JSON.stringify(created.body)}`);
  return created.body as { thread: { id: string }; run: { id: string }; message: { id: string } };
};
const say = async (token: string, threadId: string, text: string, optionId?: string) =>
  api(token, 'POST', `/api/chat/threads/${threadId}/messages`, {
    clientRequestId: randomUUID(),
    text,
    ...(optionId ? { optionId } : {})
  });
const toolCalls = (runId: string) =>
  rows<{
    tool_id: string;
    state: string;
    executions: number;
    turn_index: number;
    call_order: number;
    outcome: string | null;
    arguments_json: any;
  }>(
    `SELECT tool_id, state, executions, turn_index, call_order, result_json::jsonb->>'outcome' AS outcome, arguments_json FROM chat_tool_calls WHERE run_id = $1 ORDER BY turn_index, call_order`,
    [runId]
  );
const evidenceOf = (message: any): any[] =>
  (message?.blocks ?? []).filter((b: any) => b.kind === 'evidence').flatMap((b: any) => b.evidence);

// ---------------------------------------------------------------------------------------------

const scenarios: Record<string, () => Promise<void>> = {
  /** Knowledgebase sign-in through the production HTTP routes (fake upstream). */
  async kb() {
    // Seed with stable ids so source references survive a reseed.
    state.knowledgebase ??= {
      connectionId: '',
      notes: { offline: randomUUID(), limiter: randomUUID() }
    };
    await kbControl('/seed', {
      id: state.knowledgebase.notes.offline,
      path: 'projects/offline-support.md',
      title: 'Offline support — design notes',
      body: OFFLINE_NOTE,
      version: 'ver-7'
    });
    await kbControl('/seed', {
      id: state.knowledgebase.notes.limiter,
      path: 'decisions/sandbox-rate-limiting.md',
      title: 'Sandbox Service rate limiting decision',
      body: '# Decision 2026-09-12\nSandbox Service will rate limit /orders at 60 requests per minute per API key, using a token bucket in memory. Owner: platform team.',
      version: 'ver-2'
    });
    saveState(state);
    const before = await api(A, 'GET', '/api/connections');
    let connection = before.body.items?.find((c: any) => c.state === 'connected');
    if (!connection) {
      const started = await api(A, 'POST', '/api/connections', {
        provider: 'knowledgebase',
        returnTo: 'mobile'
      });
      rec.record(
        'kb.start',
        'Sign-in start returns an authorize URL and expiry',
        started.status === 200,
        {
          status: started.status,
          keys: Object.keys(started.body ?? {})
        }
      );
      const url = new URL(started.body.authorizeUrl);
      rec.record(
        'kb.authorize-url',
        'Authorize URL carries PKCE S256, resource, offline_access and the metadata-document client id',
        url.searchParams.get('code_challenge_method') === 'S256' &&
          url.searchParams.get('resource') === 'https://kb.test/mcp' &&
          String(url.searchParams.get('scope')).includes('offline_access') &&
          String(url.searchParams.get('client_id')).endsWith('/oauth/clients/knowledgebase.json'),
        { params: [...url.searchParams.keys()] }
      );
      // A different signed-in person cannot complete someone else's sign-in by guessing state.
      const forged = await api(
        null,
        'GET',
        `/api/connections/knowledgebase/callback?code=x&state=${randomUUID()}`
      );
      rec.record(
        'kb.forged-callback',
        'Unknown state is rejected with a status-only page',
        forged.status === 400,
        {
          status: forged.status
        }
      );
      const consent = await kbControl('/consent', { authorizeUrl: started.body.authorizeUrl });
      const callback = await api(
        null,
        'GET',
        `/api/connections/knowledgebase/callback?code=${consent.code}&state=${encodeURIComponent(consent.state)}`
      );
      const location = callback.headers.get('location') ?? '';
      rec.record(
        'kb.callback',
        'Callback redirects to the mobile return URL carrying only provider and status',
        callback.status === 302 &&
          location === 'overlord://connections/callback?provider=knowledgebase&status=connected',
        { status: callback.status, location }
      );
      const replay = await api(
        null,
        'GET',
        `/api/connections/knowledgebase/callback?code=${consent.code}&state=${encodeURIComponent(consent.state)}`
      );
      rec.record(
        'kb.replayed-callback',
        'A replayed callback cannot be reused',
        replay.status !== 302 ||
          !String(replay.headers.get('location')).includes('status=connected'),
        {
          status: replay.status,
          location: replay.headers.get('location')
        }
      );
      const after = await api(A, 'GET', '/api/connections');
      connection = after.body.items?.find((c: any) => c.state === 'connected');
      const serialized = JSON.stringify(after.body);
      const leak = await kbControl('/leaks', {
        haystack: serialized + JSON.stringify(started.body)
      });
      rec.record(
        'kb.connected',
        'Connection is listed as connected with its workspaces and no credential',
        Boolean(connection) && !leak.leaks,
        {
          connection: connection && {
            state: connection.state,
            provider: connection.provider,
            workspaces: connection.workspaces ?? connection.authorizedWorkspaces
          },
          credentialInDto: leak.leaks
        }
      );
    }
    state.knowledgebase!.connectionId = connection?.id ?? '';
    saveState(state);
    const others = await Promise.all([B, C].map(t => api(t, 'GET', '/api/connections')));
    rec.record(
      'kb.owner-scoped',
      "Another person's connection list does not include it, and they cannot disconnect it",
      others.every(
        r => r.status === 200 && !r.body.items.some((c: any) => c.id === connection?.id)
      ) &&
        (await api(B, 'DELETE', `/api/connections/${connection?.id}`)).status === 404 &&
        (await api(C, 'DELETE', `/api/connections/${connection?.id}`)).status === 404,
      {}
    );
    const providers = await api(A, 'GET', '/api/chat/providers');
    rec.record(
      'kb.providers',
      'Provider readiness reports Gemini ready and the live connection',
      providers.body.providers?.[0]?.state === 'ready' && providers.body.connections?.length === 1,
      {
        providers: providers.body.providers,
        connections: providers.body.connections?.map((c: any) => c.state)
      }
    );
  },

  /** Rows 1 and 2: research-only conversation; Knowledgebase plus Git. */
  async research() {
    const before = await counts();
    const startedAt = Date.now();
    const t = await newThread(
      A,
      'What would adding offline support require across Overlord and OverlordMobile? Check our notes and what is currently being changed.'
    );
    let firstTextAt = 0;
    const frames = await streamUntil(
      A,
      t.thread.id,
      0,
      frame => {
        if (!firstTextAt && frame.event?.kind === 'message.delta') firstTextAt = Date.now();
        return (
          frame.event?.kind === 'run.updated' &&
          ['completed', 'failed', 'cancelled', 'waiting_user'].includes(frame.event.run.state)
        );
      },
      300_000
    );
    const snap = await waitSettled(A, t.thread.id);
    const latencyMs = Date.now() - startedAt;
    const answer = lastAssistant(snap);
    const evidence = evidenceOf(answer);
    const kinds = [...new Set(evidence.map(e => e.source.kind))];
    const calls = await toolCalls(t.run.id);
    const after = await counts();
    const capability = await rows<{ n: string }>(
      `SELECT COUNT(*) AS n FROM execution_requests WHERE mission_id IS NULL AND created_at >= $1`,
      [new Date(startedAt).toISOString()]
    );
    const seqs = frames.filter(f => f.type === 'event').map(f => f.event.seq);
    extra.research = {
      threadId: t.thread.id,
      runId: t.run.id,
      run: snap.latestRun,
      latencyMs,
      firstTextMs: firstTextAt ? firstTextAt - startedAt : null,
      toolCalls: calls.map(c => ({
        tool: c.tool_id,
        turn: c.turn_index,
        outcome: c.outcome,
        executions: c.executions
      })),
      evidence: evidence.map(e => ({
        kind: e.source.kind,
        label: e.label,
        revision: e.sourceRevision,
        observedAt: e.observedAt,
        source: e.source
      })),
      answer: textOf(answer)
    };
    rec.record(
      'r1.completed',
      'Research run completes with a cited answer',
      snap.latestRun?.state === 'completed' &&
        snap.latestRun?.outcome === 'answered' &&
        /\[E\d+/.test(textOf(answer)),
      {
        run: snap.latestRun,
        citations: (textOf(answer).match(/\[E\d+[^\]]*\]/g) ?? []).length
      }
    );
    rec.record(
      'r1.no-work-created',
      'Research creates no missions, objectives or launches',
      JSON.stringify(before) === JSON.stringify(after),
      { before, after, missionLessCapabilityCalls: Number(capability[0]!.n) }
    );
    rec.record(
      'r2.kb-and-git',
      'Answer cites Knowledgebase and repository evidence together',
      kinds.includes('knowledgebase') && kinds.includes('repository'),
      { kinds }
    );
    const repo = evidence.filter(e => e.source.kind === 'repository');
    rec.record(
      'r2.repository-provenance',
      'Repository evidence names target, resource, HEAD and observation time',
      repo.length > 0 &&
        repo.every(
          e => e.source.executionTargetId && e.source.resourceKey && e.source.head && e.observedAt
        ),
      {
        resources: [
          ...new Set(repo.map(e => `${e.source.resourceKey}@${String(e.source.head).slice(0, 8)}`))
        ]
      }
    );
    rec.record(
      'r2.both-checkouts',
      'Both the control-plane and mobile checkouts were inspected',
      ['primary', 'mobile'].every(k => repo.some(e => e.source.resourceKey === k)),
      {}
    );
    rec.record(
      'r2.stream-ordered',
      'Live stream delivered events in strictly increasing order with no gap',
      seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1),
      { first: seqs[0], last: seqs.at(-1), count: seqs.length }
    );
    const leaked = JSON.stringify(snap) + JSON.stringify(frames);
    rec.record(
      'r1.no-private-state',
      'Snapshot and events carry no thought signatures, checkpoints or function-call parts',
      !/thoughtSignature|functionCall|functionResponse|payload_json/.test(leaked),
      {}
    );
    state.knowledgebase && saveState({ ...state, ...{ researchThreadId: t.thread.id } } as State);
  },

  /** Row 20: path traversal, symlink, secret, binary, huge output — through the HTTP route. */
  async bounds() {
    const read = (body: Record<string, unknown>, token = A) =>
      api(token, 'POST', `/api/projects/${P.sandbox}/repository-reads`, {
        operationId: `bounds-${randomUUID()}`,
        projectId: P.sandbox,
        executionTargetId: T.t1,
        resourceKey: 'primary',
        ...body
      });
    const cases: [string, Record<string, unknown>, (r: any) => boolean][] = [
      [
        'absolute path',
        { operation: 'read_file', relativePath: '/etc/hosts' },
        r => r.status === 400
      ],
      [
        'parent traversal',
        { operation: 'read_file', relativePath: '../repo-b/README.md' },
        r => r.status === 400
      ],
      [
        'nested traversal',
        { operation: 'read_file', relativePath: 'src/../../repo-b/README.md' },
        r => r.status === 400
      ],
      [
        '.git segment',
        { operation: 'read_file', relativePath: '.git/config' },
        r => r.status === 400
      ],
      [
        'symlink leaving the resource',
        { operation: 'read_file', relativePath: 'link-out' },
        r => r.body.outcome === 'denied'
      ],
      [
        '.env secret',
        { operation: 'read_file', relativePath: '.env' },
        r => r.body.outcome === 'denied'
      ],
      [
        'secrets.json',
        { operation: 'read_file', relativePath: 'secrets.json' },
        r => r.body.outcome === 'denied'
      ],
      [
        'binary file',
        { operation: 'read_file', relativePath: 'logo.png' },
        r => r.body.outcome === 'binary' && !r.body.data?.content
      ],
      // `bytes` is the size of the JSON data envelope; the bound applies to the content itself.
      [
        'large file read is cut at 64 KiB',
        { operation: 'read_file', relativePath: 'big.log' },
        r =>
          r.body.outcome === 'ok' &&
          r.body.truncated === true &&
          Buffer.byteLength(r.body.data.content) <= 64 * 1024 &&
          r.body.data.totalBytes > 2_000_000
      ],
      [
        'large diff is cut at 128 KiB',
        { operation: 'diff', scope: 'all' },
        r =>
          r.body.outcome === 'ok' &&
          r.body.truncated === true &&
          Buffer.byteLength(r.body.data.diff) <= 128 * 1024
      ],
      [
        'search is capped at 100 hits',
        { operation: 'search_text', query: 'status=retried' },
        r =>
          r.body.outcome === 'ok' &&
          r.body.truncated === true &&
          (r.body.data?.hits?.length ?? r.body.data?.matches?.length ?? 0) <= 100
      ],
      [
        'search never returns secret file hits',
        { operation: 'search_text', query: 'DATABASE_PASSWORD' },
        r => r.body.outcome === 'ok' && r.body.data.hits.length === 0
      ],
      [
        'unknown target',
        { operation: 'git_status', executionTargetId: randomUUID() },
        r => r.status === 404
      ]
    ];
    for (const [label, body, ok] of cases) {
      const result = await read(body);
      const flat = JSON.stringify(result.body);
      rec.record(
        `b.${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
        `Repository read: ${label}`,
        ok(result) && !/sup3r-s3cret|tok_live_acceptance|sk-acceptance-secret/.test(flat),
        {
          status: result.status,
          outcome: result.body?.outcome ?? result.body?.code,
          truncated: result.body?.truncated,
          bytes: result.body?.bytes
        }
      );
    }
    const diff = await read({
      operation: 'diff',
      scope: 'unstaged',
      relativePaths: ['src/server.ts']
    });
    rec.record(
      'b.scoped-diff',
      'A path-scoped diff returns the real change',
      diff.body.outcome === 'ok' && JSON.stringify(diff.body.data).includes('/limits'),
      { bytes: diff.body.bytes }
    );
    const idempotent = `bounds-idem-${randomUUID()}`;
    const idempotentSince = new Date().toISOString();
    const first = await read({ operation: 'git_status', operationId: idempotent });
    const again = await read({ operation: 'git_status', operationId: idempotent });
    const conflict = await read({ operation: 'branches', operationId: idempotent });
    // The queue key is a digest of the acting member and the operation id, so count by time window.
    const jobs = await rows<{ n: string }>(
      `SELECT COUNT(*) AS n FROM execution_requests WHERE idempotency_key LIKE 'repository-read:%' AND created_at >= $1`,
      [idempotentSince]
    );
    rec.record(
      'b.operation-id',
      'A repeated operation id reuses one queued job; a different read under it conflicts',
      first.body.outcome === 'ok' &&
        again.body.observedAt === first.body.observedAt &&
        conflict.status === 409 &&
        Number(jobs[0]!.n) === 1,
      {
        conflict: conflict.body?.code,
        jobs: Number(jobs[0]!.n)
      }
    );
    const t2 = await api(A, 'POST', `/api/projects/${P.sandbox}/repository-reads`, {
      operation: 'git_status',
      operationId: `bounds-${randomUUID()}`,
      projectId: P.sandbox,
      executionTargetId: T.t2,
      resourceKey: 'primary'
    });
    rec.record(
      'b.second-target',
      'The same resource on the second target reports its own branch and HEAD',
      t2.body.outcome === 'ok' && t2.body.branch === 'release' && t2.body.head !== first.body.head,
      {
        t1: { branch: first.body.branch, head: String(first.body.head).slice(0, 8) },
        t2: { branch: t2.body.branch, head: String(t2.body.head).slice(0, 8) }
      }
    );
  },

  /** Row 18: cross-owner, organization and project requests are denied without revealing existence. */
  async isolation() {
    const t = await newThread(A, 'Reply with the single word: ready. Do not use any tools.');
    const snap = await waitSettled(A, t.thread.id);
    const ghost = randomUUID();
    const probes: [string, string, (id: string) => string, unknown?][] = [
      ['GET', 'thread snapshot', id => `/api/chat/threads/${id}`],
      [
        'PATCH',
        'thread rename',
        id => `/api/chat/threads/${id}`,
        { expectedRevision: 1, title: 'x' }
      ],
      [
        'POST',
        'message',
        id => `/api/chat/threads/${id}/messages`,
        { clientRequestId: randomUUID(), text: 'hi' }
      ],
      ['GET', 'events poll', id => `/api/chat/threads/${id}/events?after=0&poll=1`],
      ['GET', 'events stream', id => `/api/chat/threads/${id}/events?after=0`],
      [
        'PUT',
        'presence',
        id => `/api/chat/threads/${id}/presence`,
        { clientId: randomUUID(), platform: 'web', state: 'foreground' }
      ],
      ['POST', 'ack', id => `/api/chat/threads/${id}/ack`, { clientId: randomUUID(), seq: 1 }]
    ];
    const results: Record<string, unknown> = {};
    let ok = true;
    for (const [who, token] of [
      ['other organization', B],
      ['same organization, other person', C]
    ] as const)
      for (const [method, label, route, body] of probes) {
        const real = await api(token, method, route(t.thread.id), body);
        const fake = await api(token, method, route(ghost), body);
        const same =
          real.status === 404 &&
          fake.status === 404 &&
          JSON.stringify(real.body) === JSON.stringify(fake.body);
        if (!same) ok = false;
        results[`${who}: ${label}`] = {
          real: real.status,
          ghost: fake.status,
          identicalBody: JSON.stringify(real.body) === JSON.stringify(fake.body)
        };
      }
    const runId = snap.latestRun.id;
    for (const [who, token] of [
      ['other organization', B],
      ['same organization, other person', C]
    ] as const)
      for (const [label, route, body] of [
        ['run cancel', `/api/chat/runs/${runId}/cancel`, { clientRequestId: randomUUID() }],
        ['run continue', `/api/chat/runs/${runId}/continue`, { clientRequestId: randomUUID() }]
      ] as const) {
        const real = await api(token, 'POST', route, body);
        const fake = await api(token, 'POST', route.replace(runId, ghost), body);
        if (
          real.status !== 404 ||
          fake.status !== 404 ||
          JSON.stringify(real.body) !== JSON.stringify(fake.body)
        )
          ok = false;
        results[`${who}: ${label}`] = { real: real.status, ghost: fake.status };
      }
    rec.record(
      'i.thread-routes',
      'Every thread and run route answers another person exactly as it answers a nonexistent id',
      ok,
      results
    );
    const lists = await Promise.all([B, C].map(token => api(token, 'GET', '/api/chat/threads')));
    rec.record(
      'i.lists',
      "Another person's thread list never includes the owner's threads",
      lists.every(l => l.status === 200 && !l.body.items.some((x: any) => x.id === t.thread.id)),
      {}
    );
    const notes = await Promise.all(
      [B, C].map(token => api(token, 'GET', '/api/chat/notifications'))
    );
    rec.record(
      'i.notifications',
      'Conversation notification history is per owner',
      notes.every(n => n.status === 200 && !JSON.stringify(n.body).includes(t.thread.id)),
      {}
    );
    // Project isolation inside one organization: C belongs to Labs only.
    const reads = await Promise.all(
      [B, C].map(token =>
        api(token, 'POST', `/api/projects/${P.overlord}/repository-reads`, {
          operation: 'git_status',
          operationId: `iso-${randomUUID()}`,
          projectId: P.overlord,
          executionTargetId: T.t1,
          resourceKey: 'primary'
        })
      )
    );
    rec.record(
      'i.repository-route',
      'A person without project access cannot read its repository',
      reads.every(r => r.status === 404),
      { statuses: reads.map(r => r.status) }
    );
    const before = Date.now();
    const cThread = await newThread(
      C,
      `List every Overlord project you can see with its id. Then read the git status of the project with id ${P.overlord} on execution target ${T.t1} (resource primary) and summarize its mission history.`
    );
    const cSnap = await waitSettled(C, cThread.thread.id);
    const cCalls = await toolCalls(cThread.run.id);
    const cText = JSON.stringify(cSnap);
    const sent = await kbControl('/provider-contains', {
      since: before,
      needles: ['Control plane for coding agents', 'Sandbox Service', '34e44ebe']
    });
    rec.record(
      'i.assistant-scope',
      'The assistant acting for a Labs-only member sees only Labs projects and is refused the Engineering repository',
      cSnap.latestRun?.state === 'completed' &&
        !cText.includes('Control plane for coding agents') &&
        !cText.includes('34e44ebe') &&
        cCalls.filter(c => c.tool_id === 'repository_read').every(c => c.outcome === 'not_found'),
      {
        toolCalls: cCalls.map(c => ({ tool: c.tool_id, outcome: c.outcome })),
        providerSaw: sent.containing,
        answer: textOf(lastAssistant(cSnap)).slice(0, 600)
      }
    );
    // A project_automation credential reaches no chat route.
    const automation = await api(A, 'POST', '/api/user-tokens', {
      label: 'acceptance-automation',
      scope: 'project_automation',
      projectIds: [P.overlord]
    });
    const secret = Object.values(automation.body ?? {}).find(
      (v): v is string => typeof v === 'string' && v.startsWith('out_')
    );
    const routes = secret
      ? await Promise.all(
          [
            '/api/chat/threads',
            `/api/chat/threads/${t.thread.id}`,
            '/api/chat/providers',
            '/api/connections'
          ].map(r => api(secret, 'GET', r))
        )
      : [];
    rec.record(
      'i.automation-token',
      'A project-automation token reaches no chat or connection route',
      Boolean(secret) && routes.every(r => r.status === 404),
      { statuses: routes.map(r => r.status), minted: automation.status }
    );
    const anonymous = await api(null, 'GET', `/api/chat/threads/${t.thread.id}`);
    rec.record('i.anonymous', 'An unauthenticated request is rejected', anonymous.status === 401, {
      status: anonymous.status
    });
  }
};

// Further scenarios live in sibling modules and register themselves here.
export {
  A,
  api,
  B,
  C,
  counts,
  evidenceOf,
  extra,
  newThread,
  NOTE_MARKER,
  P,
  rec,
  say,
  scenarios,
  state,
  T,
  toolCalls
};

async function main() {
  const more = await import('./acceptance-flows.ts').catch(error => {
    if (String(error?.code) !== 'ERR_MODULE_NOT_FOUND') throw error;
    return null;
  });
  more?.register(scenarios);
  (await import('./acceptance-safety.ts')).register(scenarios);
  const wanted = process.argv.slice(2);
  for (const name of wanted.length ? wanted : Object.keys(scenarios)) {
    const run = scenarios[name];
    if (!run) throw new Error(`unknown scenario ${name}`);
    console.log(`\n=== ${name}`);
    try {
      await run();
    } catch (error) {
      rec.record(`${name}.error`, `Scenario ${name} did not finish`, false, {
        error: String((error as Error)?.stack ?? error).slice(0, 1500)
      });
    }
  }
  rec.save(extra);
  await closeDb();
  await sleep(50);
  process.exit(rec.results.some(r => r.status === 'fail') ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
