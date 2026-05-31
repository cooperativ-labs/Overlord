/**
 * PENDING specs for the Agent Launch Pipeline remediation (ticket 1:1288).
 *
 * These describe the behavior defined in
 *   code-reviews/AGENT_LAUNCH_PIPELINE_REMEDIATION_PLAN_2026-05-31.md
 * which is NOT yet implemented. Every block is `describe.skip` so CI stays green
 * until the corresponding phase lands. Activation guide and the full coverage
 * matrix live in
 *   code-reviews/AGENT_LAUNCH_PIPELINE_TEST_COVERAGE_2026-05-31.md
 *
 * When you implement a phase: remove its `.skip`, fill in any TODO, and (per the
 * coverage doc) update the existing "current behavior" assertions that the phase
 * intentionally changes.
 *
 * These specs use the same loose-mock patterns as the neighboring suites so they
 * can be lifted into the real test files with minimal edits.
 *
 * ---------------------------------------------------------------------------
 * IMPLEMENTATION STATUS (ticket 1:1288 execution, 2026-05-31)
 * ---------------------------------------------------------------------------
 * The following phases are now IMPLEMENTED and have LIVE tests in their proper
 * homes (the skipped specs below are kept only as a per-phase map):
 *   - Phase 1 (TS selection-order unification: prefer launching -> submitted ->
 *     draft across REST attach/connect/spawn via markSubmittedObjectiveExecuting,
 *     and the hosted MCP attach handler): tests/lib/objectives.test.ts.
 *     REMAINING: the atomic claim_next_objective_for_execution RPC (the loop
 *     keeps the existing per-state-query architecture); MCP parity needs an
 *     edge-function/integration test.
 *   - Phase 2 (createExecutionRequest writes launching; readers include it):
 *     tests/lib/overlord/execution-requests.test.ts (assertions flipped).
 *   - Phase 3 (active-objective dedup + relaunch wake-up event):
 *     tests/lib/overlord/execution-requests.test.ts ("reuses the active
 *     request..."/"resets a stale launching request..."). The partial-index
 *     race and new-request-after-terminal specs remain INTEGRATION-ONLY (below).
 *   - Phase 4 (complete-execution-launch -> launching; attach -> launched;
 *     stale launching reclaim): tests/app/api/protocol/complete-execution-launch
 *     and tests/app/api/protocol/claim-execution.
 *   - Phase 9 (claim fails closed on target-config error):
 *     tests/app/api/protocol/claim-execution + tests/lib/overlord/target-agent-flags.
 *
 * REMAINING (not implemented in this pass): Phase 5/6 (UI Run builder + selected
 * target hook + Quick Task Bar parity), Phase 7 (remove targetDeviceId /
 * --target-device-id / target_device_id and the device->execution-target
 * fingerprint rename across CLI/MCP/docs), Phase 8 (centralized launch-args
 * module), plus DB application + `yarn generate` for the new migrations.
 */
import { markSubmittedObjectiveExecuting } from '@/lib/objectives';
import { createExecutionRequest } from '@/lib/overlord/execution-requests';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = 1;
const TICKET_UUID = 'cccccccc-0000-4000-8000-000000000099';
const OBJECTIVE_ID = 'dddddddd-0000-4000-8000-000000000099';
const PROJECT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

// ---------------------------------------------------------------------------
// Shared loose-mock helpers (mirror tests/lib/overlord/execution-requests.test.ts)
// ---------------------------------------------------------------------------

type TableHandlers = Record<string, () => unknown>;

function buildSupabase(handlers: TableHandlers) {
  return {
    from: jest.fn((table: string) => {
      const handler = handlers[table];
      if (!handler) throw new Error(`unexpected table: ${table}`);
      return handler();
    })
  };
}

function ticketQuery() {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => ({
      data: {
        id: TICKET_UUID,
        ticket_id: '1:999',
        organization_id: ORG_ID,
        project_id: PROJECT_ID,
        for_human: false
      },
      error: null
    }))
  };
  return chain;
}

function objectiveQuery(objective: Record<string, unknown> = {}) {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    in: jest.fn(() => chain),
    order: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => ({
      data: {
        id: OBJECTIVE_ID,
        ticket_id: TICKET_UUID,
        state: 'draft',
        objective: 'Ship the feature',
        assigned_agent: { agent: 'codex', model: null, thinking: null },
        ...objective
      },
      error: null
    })),
    update: jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) }))
  };
  return chain;
}

function ticketEventsInsert() {
  return { insert: jest.fn(async () => ({ error: null })) };
}

// ===========================================================================
// Phase 1 — Unify attach objective selection across REST/connect/spawn/MCP
// ===========================================================================
describe.skip('[1:1288 Phase 1] unified attach objective selection', () => {
  it('prefers the oldest launching objective by position then created_at', async () => {
    // TODO(phase1): once selection prefers `launching` first, assert the shared
    // transition (RPC `claim_next_objective_for_execution` or its TS wrapper)
    // selects launching ahead of legacy `submitted`, then `draft`, ordered by
    // position then created_at.
    expect(true).toBe(true);
  });

  it('carries the executing objective assigned_agent onto the newly seeded draft', async () => {
    // Today this is implemented at lib/objectives.ts:629 but untested. After
    // unification it must hold for every caller. Assert the inserted draft row
    // carries assigned_agent from the launched objective.
    expect(true).toBe(true);
  });

  it('is idempotent when re-attaching to an already-executing objective', async () => {
    // Mirrors the re-attach fallback: with no launching/submitted/draft
    // objective but an executing one present, the transition returns
    // didExecute:false and does not mutate state. Selection now queries
    // launching -> submitted -> draft (3 queries) before the executing fallback.
    const launchingQuery = {
      select: jest.fn(() => launchingQuery),
      eq: jest.fn(() => launchingQuery),
      order: jest.fn(() => launchingQuery),
      limit: jest.fn(() => launchingQuery),
      maybeSingle: jest.fn(async () => ({ data: null, error: null }))
    };
    const submittedQuery = {
      select: jest.fn(() => submittedQuery),
      eq: jest.fn(() => submittedQuery),
      order: jest.fn(() => submittedQuery),
      limit: jest.fn(() => submittedQuery),
      maybeSingle: jest.fn(async () => ({ data: null, error: null }))
    };
    const draftQuery = {
      select: jest.fn(() => draftQuery),
      eq: jest.fn(() => draftQuery),
      order: jest.fn(() => draftQuery),
      limit: jest.fn(() => draftQuery),
      maybeSingle: jest.fn(async () => ({ data: null, error: null }))
    };
    const executingQuery = {
      select: jest.fn(() => executingQuery),
      eq: jest.fn(() => executingQuery),
      in: jest.fn(() => executingQuery),
      order: jest.fn(() => executingQuery),
      limit: jest.fn(() => executingQuery),
      maybeSingle: jest.fn(async () => ({
        data: {
          id: OBJECTIVE_ID,
          objective: 'Already running',
          state: 'executing',
          assigned_agent: null
        },
        error: null
      }))
    };
    const supabase = {
      from: jest
        .fn()
        .mockReturnValueOnce(launchingQuery)
        .mockReturnValueOnce(submittedQuery)
        .mockReturnValueOnce(draftQuery)
        .mockReturnValueOnce(executingQuery)
    };

    const result = await markSubmittedObjectiveExecuting(
      supabase as never,
      TICKET_UUID,
      { agentIdentifier: 'claude-code' },
      USER_ID
    );

    expect((result as { didExecute: boolean }).didExecute).toBe(false);
    expect((result as { executedObjectiveId?: string }).executedObjectiveId).toBe(OBJECTIVE_ID);
  });

  it('MCP attach selects the same objective (same order) as REST attach', async () => {
    // The hosted MCP handler (supabase/functions/mcp/handlers/attach.ts) is a
    // separate reimplementation that orders `created_at DESC` (newest), opposite
    // to REST's `position ASC, created_at ASC`. After Phase 1 both must route
    // through the shared RPC. This spec belongs in a Deno/edge-function test or
    // an integration test that exercises the handler against the real RPC.
    expect(true).toBe(true);
  });
});

// ===========================================================================
// Phase 2 — New launch requests write `launching`, not `submitted`
// ===========================================================================
describe.skip('[1:1288 Phase 2] createExecutionRequest writes launching', () => {
  it('promotes a draft objective to launching (not submitted)', async () => {
    const objectiveChain = objectiveQuery();
    let objectiveUpdate: Record<string, unknown> | undefined;
    objectiveChain.update = jest.fn((update: Record<string, unknown>) => {
      objectiveUpdate = update;
      return { eq: jest.fn(async () => ({ error: null })) };
    }) as never;

    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () => objectiveChain,
      execution_requests: () => ({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(async () => ({
              data: { id: 'req-1', status: 'queued' },
              error: null
            }))
          }))
        }))
      }),
      ticket_events: () => ticketEventsInsert()
    });

    const result = await createExecutionRequest(supabase as never, {
      ticketId: TICKET_UUID,
      objectiveId: OBJECTIVE_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
      requestedFrom: 'manual_run'
    });

    // TODO(phase2): flip the expectation in execution-requests.test.ts too.
    expect(objectiveUpdate).toEqual(expect.objectContaining({ state: 'launching' }));
    expect((result.objective as { state: string }).state).toBe('launching');
  });

  it('treats an objective already in launching as launchable on re-resolve', async () => {
    // resolveObjectiveForExecution currently filters ['draft','submitted']
    // (execution-requests.ts:92,104). After Phase 2 it must include 'launching'
    // so re-resolving an already-queued objective does not throw
    // "Objective is not launchable from state \"launching\"".
    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () => objectiveQuery({ state: 'launching' }),
      execution_requests: () => ({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(async () => ({ data: { id: 'req-1', status: 'queued' }, error: null }))
          }))
        }))
      }),
      ticket_events: () => ticketEventsInsert()
    });

    await expect(
      createExecutionRequest(supabase as never, {
        ticketId: TICKET_UUID,
        objectiveId: OBJECTIVE_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        requestedFrom: 'manual_run'
      })
    ).resolves.toBeDefined();
  });
});

// ===========================================================================
// Phase 3 — Dedup active manual runs by objective_id + support relaunch
// ===========================================================================
describe.skip('[1:1288 Phase 3] manual-run dedup + relaunch', () => {
  it('returns the existing active request and emits a wake-up event on a duplicate click', async () => {
    // TODO(phase3): assert the pre-check finds the active request for objective_id,
    // returns it with `reused: true`, and inserts an `execution_requested` event
    // carrying `{ reused_execution_request: true }`.
    expect(true).toBe(true);
  });

  it('resolves the insert race on the partial objective_id index, not the idempotency key', () => {
    // INTEGRATION ONLY: the partial unique index
    //   execution_requests(objective_id) WHERE status IN ('queued','claimed','launching')
    // cannot be exercised by the in-memory from() mocks. Add the real test in
    // tests/supabase/execution-requests-idempotency.test.ts: two concurrent
    // createExecutionRequest calls must yield ONE active row, with the conflict
    // resolved on the objective_id index (assert via pg constraint name), and the
    // second call returning the first row with reused:true.
    expect(true).toBe(true);
  });

  it('inserts a NEW request when clicking Run after a failed/launched request', () => {
    // INTEGRATION ONLY (needs a real terminal-state row): confirms the
    // idempotency key stays non-deterministic so terminal rows never block a
    // legitimate relaunch. Add alongside the race test in the supabase suite.
    expect(true).toBe(true);
  });
});

// ===========================================================================
// Phase 4 — Runner success is attach-aware (launching -> launched at attach)
// ===========================================================================
describe.skip('[1:1288 Phase 4] attach marks request launched', () => {
  it('marks the matching request launched only after the agent_session is created', async () => {
    // TODO(phase4): in protocol-attach (and the MCP attach handler), after the
    // agent_sessions row is created, the matching execution request becomes
    // status:'launched' with launched_session_id + launched_at set and
    // lease_expires_at null. Assert ordering: session insert precedes the
    // request update.
    expect(true).toBe(true);
  });

  it('matches by executionRequestId metadata, falling back to active launching/claimed by objective_id', async () => {
    // TODO(phase4): prefer attach metadata `executionRequestId`; when absent,
    // match the active launching|claimed request for the same objective_id.
    expect(true).toBe(true);
  });

  it('is a no-op for a non-runner manual launch with no execution request', async () => {
    // TODO(phase4): a manual `ovld launch` with no request must still create the
    // session and succeed; request completion is skipped, not an error.
    expect(true).toBe(true);
  });

  it('reclaims a stale launching request after the lease times out', async () => {
    // Extends tests/app/api/protocol/claim-execution/route.test.ts (which today
    // only reclaims expired `claimed`) to also reclaim expired `launching`.
    expect(true).toBe(true);
  });

  // NOTE (.mjs, ungated today): tests/cli-runner.test.mjs currently asserts the
  // post-spawn protocol call marks the request launched. After Phase 4 the
  // runner's first call must set `launching`; update that suite accordingly.
});

// ===========================================================================
// Phase 9 — Fail safely on target-config load errors
// ===========================================================================
describe.skip('[1:1288 Phase 9] claim fails closed on target-config error', () => {
  it('treats a target-config DB error as a claim failure with no fallback flags', async () => {
    // TODO(phase9): once resolveTargetAgentLaunch returns a discriminated result
    // ({kind:'configured'|'not_configured'|'error'}), the claim-execution route
    // must skip/fail the candidate on `error` instead of falling back to the
    // request-captured launch_params flags. Extends
    // tests/app/api/protocol/claim-execution/route.test.ts. The existing
    // not_configured fallback test must keep passing.
    expect(true).toBe(true);
  });
});

// ===========================================================================
// Phases 5, 6, 7, 8, 10 — see the coverage doc for recommended homes:
//   5/6: component tests (AgentSplitButton/QuickTaskBar/useWorkspacePreference)
//   7:   tests/cli-protocol.test.mjs (--target-execution-target-id,
//        --execution-target-fingerprint) + local MCP shim catalog checks
//   8:   tests/cli-runner.test.mjs / launch-commands golden (shared launch-args module)
//   10:  migration/constraint tests (status set + expired/cancelled -> failed)
// These live with their surfaces rather than here; tracked in
// code-reviews/AGENT_LAUNCH_PIPELINE_TEST_COVERAGE_2026-05-31.md.
// ===========================================================================
