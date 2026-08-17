import { createIsolatedCheckout } from '@overlord/core/service/test-checkout';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { queueableObjectiveId, runManagementCommand } from '../src/commands.ts';
import type { CliRuntime } from '../src/runtime.ts';

test('ovld create sends objectives-json as one REST array payload', async () => {
  const posts: Array<{ path: string; body: unknown }> = [];
  const runtime = {
    backend: {
      baseUrl: 'http://example.test',
      health: async () => ({ ok: true }),
      get: async () => {
        throw new Error('unexpected GET');
      },
      post: async ({ path, body }: { path: string; body?: unknown }) => {
        posts.push({ path, body });
        return {
          id: 'mission-1',
          displayId: 'local:1',
          objectives: [
            { id: 'objective-1', objective: 'First objective' },
            { id: 'objective-2', objective: 'Second objective' }
          ]
        };
      },
      patch: async () => {
        throw new Error('unexpected PATCH');
      },
      delete: async () => {
        throw new Error('unexpected DELETE');
      }
    },
    close: () => {}
  } satisfies CliRuntime;

  const originalLog = console.log;
  console.log = () => {};
  try {
    await runManagementCommand({
      runtime,
      command: 'create',
      rest: [
        '--project-id',
        'project-1',
        '--objectives-json',
        '[{"objective":"First objective"},{"objective":"Second objective","title":"Follow-up"}]'
      ]
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.path, '/api/missions');
  assert.deepEqual(posts[0]?.body, {
    projectId: 'project-1',
    title: 'First objective',
    objectives: [
      { objective: 'First objective' },
      { objective: 'Second objective', title: 'Follow-up' }
    ]
  });
});

test('ovld add-cwd writes local project metadata after resource creation', async () => {
  const directory = createIsolatedCheckout('ovld-add-cwd-');
  const posts: Array<{ path: string; body: unknown }> = [];
  const runtime = {
    backend: {
      baseUrl: 'https://overlord.example.test',
      health: async () => ({ ok: true }),
      get: async () => [{ id: 'project-1', name: 'Project One', slug: 'project-one' }],
      post: async ({ path, body }: { path: string; body?: unknown }) => {
        posts.push({ path, body });
        return {
          id: 'resource-1',
          projectId: 'project-1',
          resourceKey: 'overlord',
          executionTargetId: 'target-1',
          path: directory,
          isPrimary: true
        };
      },
      patch: async () => {
        throw new Error('unexpected PATCH');
      },
      delete: async () => {
        throw new Error('unexpected DELETE');
      }
    },
    close: () => {}
  } satisfies CliRuntime;

  const originalLog = console.log;
  console.log = () => {};
  try {
    await runManagementCommand({
      runtime,
      command: 'add-cwd',
      rest: ['--directory', directory, '--project-id', 'project-1']
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.path, '/api/projects/project-1/resources');
  assert.deepEqual(posts[0]?.body, {
    directoryPath: directory,
    isPrimary: true
  });

  const projectJsonPath = path.join(directory, '.overlord', 'project.json');
  assert.equal(existsSync(projectJsonPath), true);
  const projectJson = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as {
    _warning: string;
    version: number;
    projectId: string;
    resourceId: string;
    resourceKey?: string;
    resourceIdsByExecutionTarget?: Record<string, string>;
    isPrimary: boolean;
    projects?: Array<{
      projectId: string;
      resourceId: string;
      resourceKey?: string;
      resourceIdsByExecutionTarget?: Record<string, string>;
      isPrimary: boolean;
    }>;
  };
  assert.match(projectJson._warning, /managed exclusively by Overlord/i);
  assert.equal(projectJson.version, 3);
  assert.equal(projectJson.projectId, 'project-1');
  assert.equal(projectJson.resourceId, 'resource-1');
  assert.equal(projectJson.resourceKey, 'overlord');
  assert.deepEqual(projectJson.resourceIdsByExecutionTarget, { 'target-1': 'resource-1' });
  assert.equal(projectJson.isPrimary, true);
  assert.equal(projectJson.projects?.length, 1);
  assert.equal(projectJson.projects?.[0]?.projectId, 'project-1');
  assert.equal(projectJson.projects?.[0]?.resourceId, 'resource-1');
  assert.equal(projectJson.projects?.[0]?.isPrimary, true);
});

test('ovld add-cwd sends explicit resource key', async () => {
  const directory = createIsolatedCheckout('ovld-add-cwd-key-');
  const posts: Array<{ path: string; body: unknown }> = [];
  const runtime = {
    backend: {
      baseUrl: 'https://overlord.example.test',
      health: async () => ({ ok: true }),
      get: async () => [{ id: 'project-1', name: 'Project One', slug: 'project-one' }],
      post: async ({ path, body }: { path: string; body?: unknown }) => {
        posts.push({ path, body });
        return {
          id: 'resource-1',
          projectId: 'project-1',
          resourceKey: 'mobile',
          executionTargetId: 'target-1',
          path: directory,
          isPrimary: true
        };
      },
      patch: async () => {
        throw new Error('unexpected PATCH');
      },
      delete: async () => {
        throw new Error('unexpected DELETE');
      }
    },
    close: () => {}
  } satisfies CliRuntime;

  const originalLog = console.log;
  console.log = () => {};
  try {
    await runManagementCommand({
      runtime,
      command: 'add-cwd',
      rest: ['--directory', directory, '--project-id', 'project-1', '--key', 'mobile']
    });
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(posts[0]?.body, {
    directoryPath: directory,
    resourceKey: 'mobile',
    isPrimary: true
  });

  const projectJson = JSON.parse(
    readFileSync(path.join(directory, '.overlord', 'project.json'), 'utf8')
  ) as { resourceKey?: string };
  assert.equal(projectJson.resourceKey, 'mobile');
});

test('ovld add-cwd keeps an existing project link when attaching a second project', async () => {
  const directory = createIsolatedCheckout('ovld-add-cwd-second-project-');
  const runtime = {
    backend: {
      baseUrl: 'https://overlord.example.test',
      health: async () => ({ ok: true }),
      get: async () => [{ id: 'project-1', name: 'Project One', slug: 'project-one' }],
      post: async ({ path, body }: { path: string; body?: unknown }) => {
        const record = (body ?? {}) as { isPrimary?: boolean };
        if (path.endsWith('/project-1/resources')) {
          return {
            id: 'resource-1',
            projectId: 'project-1',
            resourceKey: 'overlord',
            executionTargetId: 'target-1',
            path: directory,
            isPrimary: true
          };
        }
        return {
          id: 'resource-2',
          projectId: 'project-2',
          resourceKey: 'shared',
          executionTargetId: 'target-1',
          path: directory,
          isPrimary: record.isPrimary !== false
        };
      },
      patch: async () => {
        throw new Error('unexpected PATCH');
      },
      delete: async () => {
        throw new Error('unexpected DELETE');
      }
    },
    close: () => {}
  } satisfies CliRuntime;

  const originalLog = console.log;
  console.log = () => {};
  try {
    await runManagementCommand({
      runtime,
      command: 'add-cwd',
      rest: ['--directory', directory, '--project-id', 'project-1']
    });
    await runManagementCommand({
      runtime,
      command: 'add-cwd',
      rest: ['--directory', directory, '--project-id', 'project-2', '--primary', 'false']
    });
  } finally {
    console.log = originalLog;
  }

  const parsed = JSON.parse(
    readFileSync(path.join(directory, '.overlord', 'project.json'), 'utf8')
  ) as {
    projectId: string;
    isPrimary: boolean;
    projects: Array<{ projectId: string; isPrimary: boolean }>;
  };
  assert.equal(parsed.projectId, 'project-1');
  assert.equal(parsed.isPrimary, true);
  assert.deepEqual(
    parsed.projects.map(entry => ({ projectId: entry.projectId, isPrimary: entry.isPrimary })),
    [
      { projectId: 'project-1', isPrimary: true },
      { projectId: 'project-2', isPrimary: false }
    ]
  );
});

test('queueableObjectiveId prefers submitted then launching then draft, never a complete first row', () => {
  const mission = {
    objectives: [
      { id: 'complete-0', state: 'complete' },
      { id: 'draft-1', state: 'draft' },
      { id: 'submitted-2', state: 'submitted' }
    ]
  };
  assert.equal(queueableObjectiveId(mission), 'submitted-2');
  assert.equal(
    queueableObjectiveId({
      objectives: [
        { id: 'complete-0', state: 'complete' },
        { id: 'draft-1', state: 'draft' }
      ]
    }),
    'draft-1'
  );
  assert.equal(
    queueableObjectiveId({
      objectives: [{ id: 'complete-0', state: 'complete' }]
    }),
    undefined
  );
});
