import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';

/**
 * The reusable A/B structural fixture for coo:331 (resource-derived workspace
 * scoping). It sets up the one scenario that catches the entire bug class:
 *
 *   a **resource lives in workspace B** while the caller's **active workspace is A**,
 *   both under the one bootstrapped profile (an ADMIN of both).
 *
 * Every workspace-scoped operation must resolve against the *resource's* workspace
 * (B), not the ambient/active one (A). The origin bug (Phase 0) was agent launch
 * config being saved in A but read by `launchObjective` from the objective's own
 * workspace B, so a mission run from a secondary workspace launched with an empty
 * config. As Phase 2 converts each remaining ambient read, a test built on this
 * fixture asserts the converted endpoint reads/writes against B — so the bug class
 * is caught at the door for every newly-converted endpoint.
 *
 * `setupSecondaryWorkspaceFixture` mirrors the inline setup the other suites in
 * `mission-secondary-workspace.test.ts` repeat by hand: bootstrap A, create B,
 * switch active back to A, then create a project (with a primary resource that
 * provisions B's acting-device execution target), a mission, and an objective —
 * all in B. Callers then exercise a scoped operation and assert it lands in B.
 */
export interface SecondaryWorkspaceFixture {
  /** Id of the bootstrapped workspace that stays *active* for the whole test. */
  workspaceAId: string;
  /** The secondary (non-active) workspace B that owns every resource below. */
  secondary: { id: string; slug: string; name: string };
  /** A project in workspace B, with a primary resource + acting-device target. */
  project: { id: string; workspaceId: string };
  /** A mission in workspace B. `mission.workspaceId === secondary.id`. */
  mission: {
    id: string;
    workspaceId: string;
    displayId: string;
    objectives: Array<{ id: string }>;
  };
  /** The mission's first objective (lives in workspace B). */
  objectiveId: string;
}

export async function setupSecondaryWorkspaceFixture(options?: {
  /** Label prefix for the created workspace/project, to disambiguate suites. */
  namePrefix?: string;
}): Promise<SecondaryWorkspaceFixture> {
  const prefix = options?.namePrefix ?? 'Secondary Fixture';
  const dir = mkdtempSync(path.join('/tmp', 'ovld-secondary-fixture-'));

  const { bootstrapIntegrationTestDb, DEFAULT_TEST_ORGANIZATION_ID } =
    await import('./test-helpers.ts');
  const { WORKSPACE } = await bootstrapIntegrationTestDb({
    sqlitePath: path.join(dir, 'Overlord.sqlite')
  });
  // `WORKSPACE` is a live getter over the active workspace (see `backend/db.ts`),
  // and `createWorkspace` below re-points it — capture A's id as a string now.
  const workspaceAId = WORKSPACE.id;

  const { setActiveWorkspace } = await import('./db.ts');
  const { createWorkspace } = await import('./workspaces.ts');
  const { createProject, createProjectResource, createMission } = await import('./repository.ts');

  // A second workspace in the same org. The bootstrapped operator (org admin,
  // ADMIN of the only pre-existing workspace) is auto-granted ADMIN here too.
  // `createWorkspace` activates the workspace it just created, so switch back to
  // A afterward: every operation a caller runs then executes with A active while
  // the resources below live in the non-active workspace B — the reported bug.
  const secondary = await createWorkspace({
    organizationId: DEFAULT_TEST_ORGANIZATION_ID,
    name: `${prefix} Workspace`
  });
  assert.notEqual(secondary.id, workspaceAId);
  await setActiveWorkspace(workspaceAId);

  const project = await createProject({ name: `${prefix} Project`, workspaceId: secondary.id });
  assert.equal(project.workspaceId, secondary.id);

  // Omitting `executionTargetId` links the checkout from *this* machine, which is
  // the declaration that gives workspace B a real execution target (contract v39).
  // An explicit `null` would instead write a project-global source and declare
  // nothing, leaving launch/target resolution with nowhere to land preferences.
  await createProjectResource(project.id, {
    directoryPath: mkdtempSync(path.join('/tmp', 'ovld-secondary-fixture-resource-')),
    isPrimary: true
  });

  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Exercise a workspace-scoped operation from a secondary workspace'
  });
  // Mission creation must stamp the project's workspace, not the active one.
  assert.equal(mission.workspaceId, secondary.id);

  return {
    workspaceAId,
    secondary,
    project,
    mission,
    objectiveId: mission.objectives[0]!.id
  };
}
