import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { forgetLatchProviderSession } from '../packages/core/service/latch-provider-session.ts';
import { createProject } from '../packages/core/service/projects.ts';
import { protocolCreate } from '../packages/core/service/protocol.ts';
import { recordTerminalObservation } from '../packages/core/service/terminal-session-lifecycle.ts';
import { createSeededServiceContext } from '../packages/core/service/test-helpers.ts';

import {
  listMissionTerminalSessions,
  readMissionTerminalHistory
} from './execution/latch-sessions.ts';
import { TerminalSessionObserver } from './terminal-session-observer.ts';
import {
  bindWebappDatabaseClient,
  conformanceAdapters,
  createConformanceDatabase
} from './test-helpers.ts';

for (const adapter of conformanceAdapters()) {
  test(`terminal lifecycle and history SQL on ${adapter}`, async () => {
    const database = await createConformanceDatabase(adapter, 'terminal_history');
    const db = database.db;
    try {
      await bindWebappDatabaseClient({ client: db });
      const { ctx } = await createSeededServiceContext({ db });
      const project = await createProject({
        ctx,
        name: 'Terminal history',
        slug: 'terminal-history'
      });
      const mission = await protocolCreate({
        ctx,
        projectId: project.id,
        objectives: [{ objective: 'Retain sessions' }]
      });
      const missionId = mission.mission.id;
      const ids: string[] = [];
      for (let index = 0; index < 8; index++) {
        const id = randomUUID();
        ids.push(id);
        const at = new Date(Date.parse('2026-11-16T12:00:00Z') + index * 1000).toISOString();
        await db.run(
          `INSERT INTO execution_requests
          (id, workspace_id, project_id, mission_id, objective_id, requested_source, status,
           launch_mode, launch_flags_json, metadata_json, created_at, updated_at, revision)
          VALUES (?, ?, ?, ?, ?, 'manual_run', 'launched', 'run', '{}', ?, ?, ?, 1)`,
          [
            id,
            ctx.workspace.id,
            project.id,
            missionId,
            mission.objectives[0]!.id,
            JSON.stringify({
              providerSession: {
                provider: 'latch',
                providerSessionId: id,
                createdAt: at,
                lastObservedState: 'running'
              }
            }),
            at,
            at
          ]
        );
        if (index < 7)
          await recordTerminalObservation({
            ctx,
            executionRequestId: id,
            providerSessionId: id,
            state: 'exited',
            endedAt: at,
            endReason: 'unknown'
          });
      }
      assert.equal((await listMissionTerminalSessions(missionId)).length, 6);
      const page = await readMissionTerminalHistory(missionId, { limit: '3' });
      assert.deepEqual(
        page.sessions.map(s => s.executionRequestId),
        ids.slice(4, 7).reverse()
      );
      const next = await readMissionTerminalHistory(missionId, {
        limit: '3',
        cursor: page.nextCursor
      });
      assert.equal(next.sessions.length, 3);
      assert.ok(next.nextCursor);
      const last = await readMissionTerminalHistory(missionId, { cursor: next.nextCursor });
      assert.equal(last.sessions.length, 1);
      assert.equal(last.nextCursor, null);
      await forgetLatchProviderSession({
        ctx,
        missionId,
        executionRequestId: ids[6]!,
        providerSessionId: ids[6]!
      });
      assert.equal((await readMissionTerminalHistory(missionId, {})).sessions.length, 7);
      assert.equal((await listMissionTerminalSessions(missionId)).length, 6);
      await new TerminalSessionObserver().runOnce();
      const live = (await listMissionTerminalSessions(missionId)).find(
        s => s.executionRequestId === ids[7]
      );
      assert.equal(live?.lastObservedState, 'lost');
      assert.equal(live?.endedAt, null);
      // Stale observations cannot undo an ended session or change its reason.
      await recordTerminalObservation({
        ctx,
        executionRequestId: ids[5]!,
        providerSessionId: ids[5]!,
        state: 'lost'
      });
      const ended = (await readMissionTerminalHistory(missionId, {})).sessions.find(
        s => s.executionRequestId === ids[5]
      );
      assert.equal(ended?.endReason, 'unknown');
      assert.ok(ended?.endedAt);
    } finally {
      await database.cleanup();
    }
  });
}
