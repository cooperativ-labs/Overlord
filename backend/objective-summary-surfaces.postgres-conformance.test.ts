import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bindWebappDatabaseClient,
  conformanceAdapters,
  createConformanceDatabase
} from './test-helpers.ts';

/**
 * Objective summary surfaces (coo:1275.m0jd, ADR 0059) on both database
 * adapters: the REST presentation-only edit and Summarize request, the
 * protocol (CLI / hosted MCP) agent rules, and the instruction-only agent
 * context, through the real repository and protocol dispatch.
 */

const LONG =
  `Rebuild the objective summary surfaces. ${'Keep every prohibition and file path exact. '.repeat(9)}`.trim();
const SUMMARY =
  'Add summary fields to the objective API. People read a short summary first. The work is complete when the API returns it.';

type Dto = {
  id: string;
  displayId: string;
  state: string;
  updatedAt: string;
  revision: number;
  summary: string | null;
  summarySource: string | null;
  summaryStatus: string | null;
  summarySuppressed: boolean;
  summaryRevision: number;
  summaryAuthorWorkspaceUserId: string | null;
  warnings?: Array<{ code: string }>;
};

for (const adapter of conformanceAdapters()) {
  describe(`objective summary surfaces [${adapter}]`, () => {
    it('applies the person/agent rules on REST and protocol and keeps contexts instruction-only', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_desc_surf');
      try {
        const workspaceUserId = await bindWebappDatabaseClient({ client: db });
        const repo = await import('./repository.ts');
        const { runProtocolSubcommand } = await import('./protocol.ts');
        const { ApiError } = await import('./errors.ts');
        const { ServiceError } = await import('../packages/core/service/errors.ts');
        const isCode = (status: number, code: string) => (error: unknown) =>
          (error instanceof ApiError || error instanceof ServiceError) &&
          error.status === status &&
          error.code === code;

        const project = await repo.createProject({ name: `Summary surfaces ${adapter}` });
        const created = (await runProtocolSubcommand('create', {
          flags: {
            '--project-id': project.id,
            '--objectives-json': JSON.stringify([
              { instructions: LONG, summary: SUMMARY },
              { instructions: LONG }
            ])
          }
        })) as { mission: { id: string }; objectives: Array<{ id: string; displayId: string }> };
        const [authored, automatic] = created.objectives;
        assert.ok(authored && automatic);
        const detail = async () =>
          (await repo.getMissionDetail(created.mission.id)).objectives as unknown as Dto[];
        const find = async (id: string) => (await detail()).find(row => row.id === id)!;

        assert.equal((await find(authored.id)).summarySource, 'agent');
        assert.equal((await find(automatic.id)).summaryStatus, 'pending');

        // Agent Remove, then an agent cannot restore it by text or request.
        await runProtocolSubcommand('update-objective', {
          flags: { '--objective-id': authored.id, '--summary': '' }
        });
        const refused = (await runProtocolSubcommand('update-objective', {
          flags: { '--objective-id': authored.id, '--summary': SUMMARY }
        })) as Dto;
        assert.equal(refused.summary, null);
        assert.deepEqual(
          refused.warnings?.map(warning => warning.code),
          ['summary_suppressed']
        );
        await assert.rejects(
          runProtocolSubcommand('update-objective', {
            flags: { '--objective-id': authored.id, '--summary-request': 'summarize' }
          }),
          isCode(409, 'summary_suppressed')
        );

        // A person's Summarize clears it, in any state; agents stay draft-only.
        await repo.updateObjective(authored.id, { state: 'complete' });
        const before = await find(authored.id);
        const summarized = (await repo.requestObjectiveSummary(authored.id, {
          mode: 'summarize'
        })) as unknown as Dto;
        assert.equal(summarized.summarySuppressed, false);
        assert.equal(summarized.summaryStatus, 'pending');
        assert.equal(summarized.state, 'complete');
        assert.equal(summarized.updatedAt, before.updatedAt);
        const edited = (await repo.updateObjective(authored.id, {
          summary: 'Edited by a person after completion.',
          expectedSummaryRevision: summarized.summaryRevision
        })) as unknown as Dto;
        assert.equal(edited.summarySource, 'user');
        assert.equal(edited.summaryAuthorWorkspaceUserId, workspaceUserId);
        assert.equal(edited.updatedAt, before.updatedAt);
        await assert.rejects(
          repo.updateObjective(authored.id, {
            summary: 'Stale',
            expectedSummaryRevision: summarized.summaryRevision
          }),
          isCode(409, 'summary_conflict')
        );
        await assert.rejects(
          runProtocolSubcommand('update-objective', {
            flags: { '--objective-id': authored.id, '--summary': SUMMARY }
          }),
          isCode(400, 'summary_not_editable')
        );

        // The agent context never carries the summary.
        const context = await runProtocolSubcommand('load-context', {
          flags: { '--objective-id': authored.displayId }
        });
        assert.equal(JSON.stringify(context).includes('Edited by a person'), false);
        assert.ok(JSON.stringify(context).includes('Keep every prohibition'));
      } finally {
        await cleanup();
      }
    });
  });
}
