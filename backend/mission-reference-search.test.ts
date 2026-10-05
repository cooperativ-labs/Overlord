import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  bindWebappDatabaseClient,
  bootstrapIntegrationTestDb,
  type ConformanceAdapter,
  conformanceAdapters,
  createConformanceDatabase
} from './test-helpers.ts';

/**
 * Exact-reference mission lookup through Protocol `search --reference` (contract v155,
 * per:202.5h64): the surface the hosted MCP tool and the CLI forward to. Ranked search
 * stays candidate discovery; this mode is exhaustive within one project.
 *
 * Runs against SQLite (always) and PostgreSQL (when `TEST_DATABASE_URL` is set).
 */
const adapters = conformanceAdapters();

async function open(adapter: ConformanceAdapter): Promise<{ cleanup: () => Promise<void> }> {
  if (adapter === 'sqlite') {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ovld-reference-search-'));
    await bootstrapIntegrationTestDb({ sqlitePath: path.join(dir, 'Overlord.sqlite') });
    return { cleanup: async () => {} };
  }
  const handle = await createConformanceDatabase(adapter, 'ovld_reference_search');
  await bindWebappDatabaseClient({ client: handle.db });
  return handle;
}

const FEATURE = 'kb-feature:https://kb.test/main/0b9e7c1e-8f2a-4c4b-9a7e-2f1d3c4b5a69';

type ReferencePage = {
  kind: string;
  results: Array<{
    id: string;
    displayId: string;
    statusType: string;
    objectives: Array<{ id: string; displayId: string; state: string }>;
  }>;
  nextCursor: string | null;
  complete: boolean;
};

async function lookup(flags: Record<string, string | boolean>): Promise<ReferencePage> {
  const { runProtocolSubcommand } = await import('./protocol.ts');
  return (await runProtocolSubcommand('search', { flags })) as ReferencePage;
}

async function lookupAll(projectId: string, reference: string, limit?: number) {
  const seen: ReferencePage['results'] = [];
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const page = await lookup({
      '--reference': reference,
      '--project-id': projectId,
      ...(limit ? { '--limit': String(limit) } : {}),
      ...(cursor ? { '--cursor': cursor } : {})
    });
    pages++;
    assert.equal(page.complete, page.nextCursor === null);
    seen.push(...page.results);
    if (page.complete) return { seen, pages };
    cursor = page.nextCursor;
  }
}

const rejects400 = (error: unknown) => (error as { status?: number }).status === 400;

for (const adapter of adapters)
  describe(`exact-reference mission lookup [${adapter}]`, () => {
    it('matches whole case-sensitive tokens in live objectives of one project', async () => {
      const { cleanup } = await open(adapter);
      try {
        const { createProject, createMission, deleteMissions } = await import('./repository.ts');
        const project = await createProject({ name: 'Reference Board' });
        const other = await createProject({ name: 'Reference Elsewhere' });
        const inline = await createMission({
          projectId: project.id,
          firstObjective: `Implement it.\nKnowledgebase Feature: ${FEATURE}.`
        });
        const parenthesized = await createMission({
          projectId: project.id,
          firstObjective: `Implement (${FEATURE})`
        });
        await createMission({ projectId: project.id, firstObjective: FEATURE.toUpperCase() });
        await createMission({ projectId: project.id, firstObjective: `${FEATURE}0` });
        await createMission({ projectId: project.id, firstObjective: 'Offline sync by title' });
        await createMission({ projectId: other.id, firstObjective: FEATURE });
        const deleted = await createMission({ projectId: project.id, firstObjective: FEATURE });
        await deleteMissions([deleted.id]);

        const page = await lookup({ '--reference': FEATURE, '--project-id': project.id });
        assert.equal(page.kind, 'mission_reference_search');
        assert.equal(page.complete, true);
        assert.equal(page.nextCursor, null);
        assert.deepEqual(page.results.map(r => r.id).sort(), [inline.id, parenthesized.id].sort());
        const hit = page.results.find(r => r.id === inline.id)!;
        assert.equal(hit.statusType, 'draft');
        assert.equal(hit.objectives.length, 1);
        assert.equal(hit.objectives[0]!.id, inline.objectives[0]!.id);
        assert.match(hit.objectives[0]!.displayId, /\.[a-z0-9]+$/);

        // LIKE wildcards are literal: `%` and `_` in a reference match only themselves.
        const literal = await createMission({
          projectId: project.id,
          firstObjective: 'ref:100%_done here'
        });
        await createMission({ projectId: project.id, firstObjective: 'ref:1000xdone here' });
        const wild = await lookup({ '--reference': 'ref:100%_done', '--project-id': project.id });
        assert.deepEqual(
          wild.results.map(r => r.id),
          [literal.id]
        );
      } finally {
        await cleanup();
      }
    });

    it('pages every match beyond one page and binds cursors to the lookup', async () => {
      const { cleanup } = await open(adapter);
      try {
        const { createProject, createMission } = await import('./repository.ts');
        const project = await createProject({ name: 'Reference Scale' });
        const ids: string[] = [];
        for (let i = 0; i < 105; i++) {
          const m = await createMission({
            projectId: project.id,
            firstObjective: `Handoff ${i}: ${FEATURE}`
          });
          ids.push(m.id);
          // Near misses interleave so candidate pages are not all exact matches.
          if (i % 10 === 0)
            await createMission({ projectId: project.id, firstObjective: FEATURE.toUpperCase() });
        }
        const { seen, pages } = await lookupAll(project.id, FEATURE, 50);
        assert.ok(pages >= 3, 'more than two pages at limit 50');
        assert.equal(new Set(seen.map(r => r.id)).size, seen.length, 'no duplicates');
        assert.deepEqual(seen.map(r => r.id).sort(), ids.sort());

        const first = await lookup({
          '--reference': FEATURE,
          '--project-id': project.id,
          '--limit': '50'
        });
        assert.equal(first.complete, false);
        await assert.rejects(
          lookup({
            '--reference': `${FEATURE}x`,
            '--project-id': project.id,
            '--cursor': first.nextCursor!
          }),
          rejects400
        );
      } finally {
        await cleanup();
      }
    });

    it('rejects ambiguous or ranked combinations instead of guessing', async () => {
      const { cleanup } = await open(adapter);
      try {
        const { createProject } = await import('./repository.ts');
        const project = await createProject({ name: 'Reference Rules' });
        await assert.rejects(lookup({ '--reference': FEATURE }), rejects400);
        await assert.rejects(
          lookup({ '--reference': FEATURE, '--project-id': project.id, '--query': 'x' }),
          rejects400
        );
        await assert.rejects(
          lookup({
            '--reference': FEATURE,
            '--project-id': project.id,
            '--response-version': '3'
          }),
          rejects400
        );
        await assert.rejects(lookup({ '--query': 'x', '--cursor': 'abc' }), rejects400);
        await assert.rejects(
          lookup({ '--reference': 'short', '--project-id': project.id }),
          rejects400
        );
        await assert.rejects(
          lookup({ '--reference': FEATURE, '--project-id': project.id, '--limit': '101' }),
          rejects400
        );
        await assert.rejects(
          lookup({ '--reference': FEATURE, '--project-id': project.id, '--cursor': 'garbage' }),
          rejects400
        );
        await assert.rejects(
          lookup({ '--reference': FEATURE, '--project-id': 'No Such Project' }),
          (error: unknown) => (error as { status?: number }).status === 404
        );
      } finally {
        await cleanup();
      }
    });
  });

after(() => {
  if (!process.env.TEST_DATABASE_URL) {
    console.warn(
      '[mission-reference-search] TEST_DATABASE_URL not set — skipped the PostgreSQL adapter.'
    );
  }
});
