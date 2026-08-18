import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-everhour-service-'));
process.env.EVERHOUR_API_KEY_ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString('base64url');
const { bootstrapIntegrationTestDb } = await import('../../test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'everhour.sqlite') });

const { db, getActorWorkspaceUserId, newId, nowIso, WORKSPACE } = await import('../../db.ts');
const { createMission, createProject } = await import('../../repository.ts');
const { ApiError } = await import('../../errors.ts');
const { decryptEverhourApiKey, requireEverhourEncryptionKey } = await import('./crypto.ts');
const {
  addMissionTime,
  clearEverhourApiKey,
  getEverhourIntegration,
  getMissionEverhourState,
  getProjectEverhourLink,
  getProjectEverhourState,
  linkProjectEverhour,
  setEverhourApiKey,
  startMissionTimer,
  startProjectTimer
} = await import('./service.ts');

const originalFetch = globalThis.fetch;

test.after(() => {
  globalThis.fetch = originalFetch;
  rmSync(tempDir, { recursive: true, force: true });
});

function installEverhourFetchMock(
  handlers: Array<{
    match: (url: string, init?: RequestInit) => boolean;
    respond: (url: string, init?: RequestInit) => Response | Promise<Response>;
  }>
): void {
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    for (const handler of handlers) {
      if (handler.match(url, init)) {
        return handler.respond(url, init);
      }
    }
    if (/\/projects\/ev%3A[^/?]+$/.test(url)) {
      const id = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
      if (!init?.method || init.method === 'GET') {
        return Response.json({ id, name: 'Board', type: 'board', users: [] });
      }
      if (init.method === 'PUT') {
        return Response.json({ id, name: 'Board', type: 'board' });
      }
    }
    throw new Error(`Unexpected Everhour fetch: ${url} ${init?.method ?? 'GET'}`);
  }) as typeof fetch;
}

test('getEverhourIntegration reports disconnected when no user connection exists', async () => {
  assert.deepEqual(await getEverhourIntegration(), { connected: false, accountName: null });
});

test('setEverhourApiKey validates against Everhour and persists the encrypted user connection', async () => {
  installEverhourFetchMock([
    {
      match: url => url.endsWith('/users/me'),
      respond: () => Response.json({ id: 7, name: 'Everhour Operator' }, { status: 200 })
    }
  ]);

  const integration = await setEverhourApiKey('  test-api-key  ');
  assert.deepEqual(integration, { connected: true, accountName: 'Everhour Operator' });

  const row = db
    .prepare(
      `SELECT profile_id, api_key_ciphertext, account_id, account_name
         FROM ext_everhour_user_connections
        WHERE deleted_at IS NULL`
    )
    .get() as {
    profile_id: string;
    api_key_ciphertext: string;
    account_id: string;
    account_name: string;
  };
  assert.ok(row.profile_id);
  assert.notEqual(row.api_key_ciphertext, 'test-api-key');
  assert.equal(
    decryptEverhourApiKey({
      envelope: row.api_key_ciphertext,
      profileId: row.profile_id,
      key: requireEverhourEncryptionKey()
    }),
    'test-api-key'
  );
  assert.equal(row.account_id, '7');
  assert.equal(row.account_name, 'Everhour Operator');
});

test('setEverhourApiKey rejects blank keys before calling Everhour', async () => {
  await assert.rejects(
    () => setEverhourApiKey('   '),
    (err: unknown) => err instanceof ApiError && err.status === 400
  );
});

test('clearEverhourApiKey soft-deletes the user connection', async () => {
  installEverhourFetchMock([
    {
      match: url => url.endsWith('/users/me'),
      respond: () => Response.json({ id: 1, name: 'Temp User' }, { status: 200 })
    }
  ]);
  await setEverhourApiKey('temp-key');

  const cleared = await clearEverhourApiKey();
  assert.deepEqual(cleared, { connected: false, accountName: null });

  const active = db
    .prepare(
      `SELECT COUNT(*) AS count
         FROM ext_everhour_user_connections
        WHERE deleted_at IS NULL`
    )
    .get() as { count: number };
  assert.equal(active.count, 0);
});

test('getEverhourIntegration adopts an unambiguously attributed workspace key onto the actor profile', async () => {
  await clearEverhourApiKey();
  const connectionId = newId();
  const now = nowIso();
  const actorId = getActorWorkspaceUserId();
  assert.ok(actorId);

  db.prepare(
    `INSERT INTO ext_everhour_workspace_connections
       (id, workspace_id, api_key_secret, account_id, account_name, created_at, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(connectionId, WORKSPACE.id, 'legacy-workspace-key', '7', 'Legacy Owner', now, now);

  db.prepare(
    `INSERT INTO entity_changes
       (id, workspace_id, entity_type, entity_id, operation, entity_revision,
        changed_fields_json, actor_workspace_user_id, source, occurred_at)
     VALUES (?, ?, 'everhour:workspace_connection', ?, 'insert', 1, '[]', ?, 'webapp', ?)`
  ).run(newId(), WORKSPACE.id, connectionId, actorId, now);

  installEverhourFetchMock([
    {
      match: url => url.endsWith('/users/me'),
      respond: () => Response.json({ id: 7, name: 'Legacy Owner' }, { status: 200 })
    }
  ]);

  const integration = await getEverhourIntegration();
  assert.deepEqual(integration, { connected: true, accountName: 'Legacy Owner' });

  const userRow = db
    .prepare(
      `SELECT api_key_ciphertext FROM ext_everhour_user_connections WHERE deleted_at IS NULL`
    )
    .get() as { api_key_ciphertext: string };
  assert.notEqual(userRow.api_key_ciphertext, 'legacy-workspace-key');

  const leftover = db
    .prepare(
      `SELECT COUNT(*) AS count FROM ext_everhour_workspace_connections WHERE deleted_at IS NULL`
    )
    .get() as { count: number };
  assert.equal(leftover.count, 0);
});

test('getEverhourIntegration does not adopt a workspace key without unique actor attribution', async () => {
  await clearEverhourApiKey();
  const connectionId = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO ext_everhour_workspace_connections
       (id, workspace_id, api_key_secret, account_id, account_name, created_at, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(connectionId, WORKSPACE.id, 'unattributed-key', '8', 'Unknown', now, now);

  assert.deepEqual(await getEverhourIntegration(), { connected: false, accountName: null });
  db.prepare(`UPDATE ext_everhour_workspace_connections SET deleted_at = ? WHERE id = ?`).run(
    nowIso(),
    connectionId
  );
});

test('getProjectEverhourLink reads extension-owned project link rows', async () => {
  const project = await createProject({ name: 'Everhour Link Project' });
  assert.deepEqual(await getProjectEverhourLink(project.id), {
    projectId: project.id,
    everhourProjectId: null,
    everhourProjectName: null
  });

  installEverhourFetchMock([
    {
      match: url => url.endsWith('/users/me'),
      respond: () => Response.json({ id: 9, name: 'Linker' }, { status: 200 })
    },
    {
      match: url => url.includes('/projects?'),
      respond: () =>
        Response.json([{ id: 'ev:123', name: 'Board Project', type: 'board', users: [9] }], {
          status: 200
        })
    },
    {
      match: url => url.includes('/projects/ev%3A123/sections'),
      respond: () => Response.json([{ id: 55, name: 'Main' }], { status: 200 })
    }
  ]);
  await setEverhourApiKey('link-key');

  const linked = await linkProjectEverhour(project.id, 'Board Project');
  assert.deepEqual(linked, {
    projectId: project.id,
    everhourProjectId: 'ev:123',
    everhourProjectName: 'Board Project'
  });

  const row = db
    .prepare(
      `SELECT everhour_project_id, everhour_project_name, everhour_section_id
         FROM ext_everhour_project_links
        WHERE project_id = ? AND deleted_at IS NULL`
    )
    .get(project.id) as {
    everhour_project_id: string;
    everhour_project_name: string;
    everhour_section_id: string;
  };
  assert.equal(row.everhour_project_id, 'ev:123');
  assert.equal(row.everhour_project_name, 'Board Project');
  assert.equal(row.everhour_section_id, '55');
});

test('linkProjectEverhour clears the extension link when the name is blank', async () => {
  const project = await createProject({ name: 'Clear Link Project' });
  installEverhourFetchMock([
    {
      match: url => url.endsWith('/users/me'),
      respond: () => Response.json({ id: 3, name: 'Linker' }, { status: 200 })
    },
    {
      match: url => url.includes('/projects?'),
      respond: () => Response.json([], { status: 200 })
    },
    {
      match: (url, init) => url.endsWith('/projects') && init?.method === 'POST',
      respond: () =>
        Response.json({ id: 'ev:new', name: 'Fresh Board', type: 'board' }, { status: 201 })
    },
    {
      match: (url, init) => url.includes('/projects/ev%3Anew/sections') && init?.method === 'GET',
      respond: () => Response.json([], { status: 200 })
    },
    {
      match: (url, init) => url.includes('/projects/ev%3Anew/sections') && init?.method === 'POST',
      respond: () => Response.json({ id: 88, name: 'Overlord' }, { status: 201 })
    }
  ]);
  await setEverhourApiKey('clear-key');
  await linkProjectEverhour(project.id, 'Fresh Board');

  const cleared = await linkProjectEverhour(project.id, '   ');
  assert.deepEqual(cleared, {
    projectId: project.id,
    everhourProjectId: null,
    everhourProjectName: null
  });
});

test('getMissionEverhourState returns a disconnected baseline without an API key', async () => {
  await clearEverhourApiKey();
  const project = await createProject({ name: 'Mission State Project' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Track time' });

  const state = await getMissionEverhourState(mission.id);
  assert.equal(state.connected, false);
  assert.equal(state.projectLinked, false);
  assert.equal(state.taskId, null);
  assert.deepEqual(state.records, []);
  assert.equal(state.totalSeconds, 0);
  assert.equal(state.runningTimer, null);
});

test('startMissionTimer creates a mission link and starts the Everhour timer', async () => {
  const project = await createProject({ name: 'Timer Project' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Run timer' });

  installEverhourFetchMock([
    {
      match: url => url.endsWith('/users/me'),
      respond: () => Response.json({ id: 12, name: 'Timer User' }, { status: 200 })
    },
    {
      match: url => url.includes('/projects?'),
      respond: () =>
        Response.json([{ id: 'ev:timer', name: 'Timer Board', type: 'board', users: [12] }], {
          status: 200
        })
    },
    {
      match: url => url.includes('/projects/ev%3Atimer/sections'),
      respond: () => Response.json([{ id: 7, name: 'Main' }], { status: 200 })
    },
    {
      match: (url, init) => url.includes('/projects/ev%3Atimer/tasks') && init?.method === 'POST',
      respond: () => Response.json({ id: 'ev:task-42', name: mission.title }, { status: 201 })
    },
    {
      match: (url, init) => url.endsWith('/timers') && init?.method === 'POST',
      respond: () => new Response(null, { status: 204 })
    },
    {
      match: url => url.includes('/tasks/ev%3Atask-42/time?'),
      respond: () => Response.json([], { status: 200 })
    },
    {
      match: url => url.endsWith('/timers/current'),
      respond: () => Response.json({ status: 'inactive' }, { status: 200 })
    }
  ]);
  await setEverhourApiKey('timer-key');
  await linkProjectEverhour(project.id, 'Timer Board');

  const state = await startMissionTimer(mission.id);
  assert.equal(state.connected, true);
  assert.equal(state.projectLinked, true);
  assert.equal(state.taskId, 'ev:task-42');

  const missionLink = db
    .prepare(
      `SELECT everhour_task_id FROM ext_everhour_mission_links
        WHERE mission_id = ? AND deleted_at IS NULL`
    )
    .get(mission.id) as { everhour_task_id: string };
  assert.equal(missionLink.everhour_task_id, 'ev:task-42');
});

test('addMissionTime rejects non-positive durations', async () => {
  const project = await createProject({ name: 'Duration Project' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Add time' });
  installEverhourFetchMock([
    {
      match: url => url.endsWith('/users/me'),
      respond: () => Response.json({ id: 1, name: 'User' }, { status: 200 })
    }
  ]);
  await setEverhourApiKey('duration-key');

  await assert.rejects(
    () => addMissionTime(mission.id, { timeSeconds: 0 }),
    (err: unknown) => err instanceof ApiError && err.status === 400
  );
});

test('getProjectEverhourState returns a disconnected baseline without an API key', async () => {
  await clearEverhourApiKey();
  const project = await createProject({ name: 'Project State Project' });

  const state = await getProjectEverhourState(project.id);
  assert.equal(state.connected, false);
  assert.equal(state.projectLinked, false);
  assert.equal(state.taskId, null);
  assert.deepEqual(state.records, []);
  assert.equal(state.totalSeconds, 0);
  assert.equal(state.runningTimer, null);
  assert.equal(state.hasRunningTimerInProject, false);
});

test('startProjectTimer creates a general task and starts the Everhour timer', async () => {
  const project = await createProject({ name: 'General Timer Project' });

  installEverhourFetchMock([
    {
      match: url => url.endsWith('/users/me'),
      respond: () => Response.json({ id: 21, name: 'Project Timer User' }, { status: 200 })
    },
    {
      match: url => url.includes('/projects?'),
      respond: () =>
        Response.json([{ id: 'ev:proj', name: 'General Board', type: 'board', users: [21] }], {
          status: 200
        })
    },
    {
      match: url => url.includes('/projects/ev%3Aproj/sections'),
      respond: () => Response.json([{ id: 3, name: 'Main' }], { status: 200 })
    },
    {
      match: url => url.includes('/projects/ev%3Aproj/tasks/search'),
      respond: () => Response.json([], { status: 200 })
    },
    {
      match: (url, init) => url.includes('/projects/ev%3Aproj/tasks') && init?.method === 'POST',
      respond: (_url, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { name?: string };
        assert.equal(body.name, 'general');
        return Response.json({ id: 'ev:general-1', name: 'general' }, { status: 201 });
      }
    },
    {
      match: (url, init) => url.endsWith('/timers') && init?.method === 'POST',
      respond: () => new Response(null, { status: 204 })
    },
    {
      match: url => url.includes('/tasks/ev%3Ageneral-1/time?'),
      respond: () => Response.json([], { status: 200 })
    },
    {
      match: url => url.endsWith('/timers/current'),
      respond: () => Response.json({ status: 'inactive' }, { status: 200 })
    }
  ]);
  await setEverhourApiKey('project-timer-key');
  await linkProjectEverhour(project.id, 'General Board');

  const state = await startProjectTimer(project.id);
  assert.equal(state.connected, true);
  assert.equal(state.projectLinked, true);
  assert.equal(state.taskId, 'ev:general-1');

  const projectLink = db
    .prepare(
      `SELECT everhour_general_task_id FROM ext_everhour_project_links
        WHERE project_id = ? AND deleted_at IS NULL`
    )
    .get(project.id) as { everhour_general_task_id: string };
  assert.equal(projectLink.everhour_general_task_id, 'ev:general-1');
});

test('getProjectEverhourState reports mission timers as running within the project', async () => {
  const project = await createProject({ name: 'Mission Timer Sidebar Project' });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Sidebar indicator mission'
  });

  installEverhourFetchMock([
    {
      match: url => url.endsWith('/users/me'),
      respond: () => Response.json({ id: 31, name: 'Sidebar User' }, { status: 200 })
    },
    {
      match: url => url.includes('/projects?'),
      respond: () =>
        Response.json([{ id: 'ev:sidebar', name: 'Sidebar Board', type: 'board', users: [31] }], {
          status: 200
        })
    },
    {
      match: url => url.includes('/projects/ev%3Asidebar/sections'),
      respond: () => Response.json([{ id: 4, name: 'Main' }], { status: 200 })
    },
    {
      match: (url, init) => url.includes('/projects/ev%3Asidebar/tasks') && init?.method === 'POST',
      respond: () => Response.json({ id: 'ev:mission-task', name: mission.title }, { status: 201 })
    },
    {
      match: (url, init) => url.endsWith('/timers') && init?.method === 'POST',
      respond: () => new Response(null, { status: 204 })
    },
    {
      match: url => url.includes('/tasks/ev%3Amission-task/time?'),
      respond: () => Response.json([], { status: 200 })
    },
    {
      match: url => url.endsWith('/timers/current'),
      respond: () =>
        Response.json(
          {
            status: 'active',
            duration: 125,
            startedAt: '2026-07-10 10:00:00',
            task: { id: 'ev:mission-task', name: mission.title }
          },
          { status: 200 }
        )
    }
  ]);
  await setEverhourApiKey('sidebar-timer-key');
  await linkProjectEverhour(project.id, 'Sidebar Board');
  await startMissionTimer(mission.id);

  const state = await getProjectEverhourState(project.id);
  assert.equal(state.runningTimer, null);
  assert.equal(state.hasRunningTimerInProject, true);
});
