import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { setupSecondaryWorkspaceFixture } from './secondary-workspace-fixture.ts';

/**
 * Human project references over the protocol surface (coo:781.hn9r).
 *
 * MCP and the CLI hand the backend a project the way the user said it — a UUID,
 * a slug, or a name. Slugs and names are unique per *workspace*, so the same
 * name can legitimately exist in two workspaces the caller belongs to. That is a
 * question for the user, not a failure, so it comes back as a structured
 * `project_selection_required` result the caller can retry with `workspaceId`.
 */
const fixture = await setupSecondaryWorkspaceFixture({ namePrefix: 'Project Reference' });
const dbModule = await import('./db.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');
const { createProject } = await import('./repository.ts');
const client = dbModule.requireDatabaseClient();

const SHARED_NAME = 'Shared Portal';

type WorkspaceEntry = {
  workspaceId: string;
  workspaceUserId: string;
  roleKeys: string[];
  workspace: { id: string; slug: string; name: string; kind: string };
};

async function snapshotEntry(workspaceId: string): Promise<WorkspaceEntry> {
  const row = await client.get<{
    id: string;
    slug: string;
    name: string;
    kind: string;
    workspace_user_id: string;
  }>(
    `SELECT w.id, w.slug, w.name, w.kind, wu.id AS workspace_user_id
       FROM workspaces w
       JOIN workspace_users wu ON wu.workspace_id = w.id
      WHERE w.id = ? AND wu.profile_id = 'operator-user'
        AND w.deleted_at IS NULL AND wu.deleted_at IS NULL`,
    [workspaceId]
  );
  assert.ok(row);
  const roles = await client.all<{ role_key: string }>(
    `SELECT role_key FROM role_assignments
      WHERE workspace_id = ? AND workspace_user_id = ? AND deleted_at IS NULL`,
    [workspaceId, row.workspace_user_id]
  );
  return {
    workspaceId,
    workspaceUserId: row.workspace_user_id,
    roleKeys: roles.map(role => role.role_key),
    workspace: { id: row.id, slug: row.slug, name: row.name, kind: row.kind }
  };
}

let workspaceA: WorkspaceEntry;
let workspaceB: WorkspaceEntry;
let projectInA: { id: string };
let projectInB: { id: string };

async function asCaller<T>(fn: () => Promise<T>): Promise<T> {
  return dbModule.withRequestContextAsync(async () => {
    dbModule.setActiveProfileId('operator-user');
    dbModule.setAuthorizedWorkspacesContext({
      organizationId: 'test-organization',
      workspaces: [workspaceA, workspaceB]
    });
    dbModule.setActiveWorkspaceContext(null);
    dbModule.setActiveWorkspaceUser(null);
    return fn();
  });
}

before(async () => {
  workspaceA = await snapshotEntry(fixture.workspaceAId);
  workspaceB = await snapshotEntry(fixture.secondary.id);
  // The same project name in both workspaces: the only shape that makes a human
  // reference genuinely ambiguous.
  projectInA = await createProject({ name: SHARED_NAME, workspaceId: workspaceA.workspaceId });
  projectInB = await createProject({ name: SHARED_NAME, workspaceId: workspaceB.workspaceId });
});

describe('human project references on the protocol surface', () => {
  it('resolves a unique project name without requiring a UUID', async () => {
    const result = (await asCaller(() =>
      runProtocolSubcommand('search-missions', {
        flags: { '--response-version': '2', '--project-id': 'Project Reference Project' }
      })
    )) as { version: number; appliedFilters: { projectIds: string[] } };

    assert.equal(result.version, 2);
    assert.deepEqual(result.appliedFilters.projectIds, [fixture.project.id]);
  });

  it('matches a project name case-insensitively', async () => {
    const result = (await asCaller(() =>
      runProtocolSubcommand('search-missions', {
        flags: { '--response-version': '2', '--project-id': 'project reference project' }
      })
    )) as { appliedFilters: { projectIds: string[] } };

    assert.deepEqual(result.appliedFilters.projectIds, [fixture.project.id]);
  });

  it('asks which workspace when a name matches in more than one', async () => {
    const result = (await asCaller(() =>
      runProtocolSubcommand('search-missions', {
        flags: { '--response-version': '2', '--project-id': SHARED_NAME }
      })
    )) as {
      status: string;
      projectRef: string;
      projects: Array<{ id: string; workspaceId: string; workspaceName: string }>;
    };

    assert.equal(result.status, 'project_selection_required');
    assert.equal(result.projectRef, SHARED_NAME);
    assert.equal(result.projects.length, 2);
    // The workspace labels are the point: without them the caller has two
    // identical-looking projects and nothing to ask the user about.
    assert.deepEqual(
      new Set(result.projects.map(project => project.workspaceId)),
      new Set([workspaceA.workspaceId, workspaceB.workspaceId])
    );
    for (const project of result.projects) assert.ok(project.workspaceName);
  });

  it('narrows an ambiguous name with an explicit workspace', async () => {
    for (const [workspace, project] of [
      [workspaceB, projectInB],
      [workspaceA, projectInA]
    ] as const) {
      const result = (await asCaller(() =>
        runProtocolSubcommand('search-missions', {
          flags: {
            '--response-version': '2',
            '--project-id': SHARED_NAME,
            '--workspace-id': workspace.workspace.slug
          }
        })
      )) as { appliedFilters: { projectIds: string[] } };

      assert.deepEqual(result.appliedFilters.projectIds, [project.id]);
    }
  });

  it('applies the same disambiguation to board-column reads', async () => {
    const ambiguous = (await asCaller(() =>
      runProtocolSubcommand('statuses', { flags: { '--project-id': SHARED_NAME } })
    )) as { status: string; projects: unknown[] };
    assert.equal(ambiguous.status, 'project_selection_required');
    assert.equal(ambiguous.projects.length, 2);

    const narrowed = (await asCaller(() =>
      runProtocolSubcommand('statuses', {
        flags: { '--project-id': SHARED_NAME, '--workspace-id': workspaceB.workspace.name }
      })
    )) as Array<{ projectId: string }>;
    assert.ok(Array.isArray(narrowed));
    assert.ok(narrowed.length > 0);
    for (const status of narrowed) assert.equal(status.projectId, projectInB.id);
  });

  it('still reports a genuinely unknown project as not found', async () => {
    await assert.rejects(
      asCaller(() =>
        runProtocolSubcommand('search-missions', {
          flags: { '--response-version': '2', '--project-id': 'No Such Project' }
        })
      ),
      /Project not found/
    );
  });
});
