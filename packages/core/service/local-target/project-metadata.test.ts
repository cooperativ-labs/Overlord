import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createIsolatedCheckout } from '../test-checkout.ts';

import { readProjectJsonLink, writeProjectJson } from './project-metadata.ts';

describe('project metadata', () => {
  it('protects generated metadata with instructions and narrow ignores', () => {
    const directory = createIsolatedCheckout('ovld-project-json-protected-');
    writeFileSync(path.join(directory, 'AGENTS.md'), '# Existing agent instructions\n');
    writeFileSync(path.join(directory, 'CLAUDE.md'), '# Existing Claude instructions\n');

    writeProjectJson({
      directoryPath: directory,
      projectId: 'project-1',
      resourceId: 'resource-1',
      isPrimary: true
    });

    const projectJsonPath = path.join(directory, '.overlord', 'project.json');
    const projectJson = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as { _warning: string };
    assert.match(projectJson._warning, /strictly protected/i);

    for (const filename of ['AGENTS.md', 'CLAUDE.md']) {
      const content = readFileSync(path.join(directory, filename), 'utf8');
      assert.match(content, /Existing .* instructions/);
      assert.match(content, /OVERLORD PROJECT METADATA PROTECTION: START/);
      assert.match(content, /exclusively managed by Overlord/i);
      assert.match(content, /do not edit/i);
    }

    const gitignore = readFileSync(path.join(directory, '.gitignore'), 'utf8');
    assert.match(gitignore, /^\.overlord\/tmp\/$/m);
    assert.match(gitignore, /^\.overlord\/logs\/$/m);
    assert.doesNotMatch(gitignore, /project\.json/);
    assert.doesNotMatch(gitignore, /^\.overlord\/$/m);

    writeProjectJson({
      directoryPath: directory,
      projectId: 'project-1',
      resourceId: 'resource-1',
      isPrimary: true
    });
    assert.equal(
      (
        readFileSync(path.join(directory, 'AGENTS.md'), 'utf8').match(
          /OVERLORD PROJECT METADATA PROTECTION: START/g
        ) ?? []
      ).length,
      1
    );
  });

  it('reads legacy single-resource metadata', () => {
    const directory = createIsolatedCheckout('ovld-project-json-legacy-');
    const overlordDir = path.join(directory, '.overlord');
    const projectJsonPath = path.join(overlordDir, 'project.json');

    writeProjectJson({
      directoryPath: directory,
      projectId: 'project-1',
      resourceId: 'resource-1',
      isPrimary: true
    });

    const raw = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as Record<string, unknown>;
    delete raw.resourceIdsByExecutionTarget;

    const contents = `${JSON.stringify(raw, null, 2)}\n`;
    // Rewrite the file without the additive field to simulate an older checkout.
    writeFileSync(projectJsonPath, contents);

    assert.deepEqual(readProjectJsonLink(projectJsonPath), {
      projectId: 'project-1',
      resourceId: 'resource-1',
      resourceKey: null,
      resourceIdsByExecutionTarget: {},
      isPrimary: true
    });
  });

  it('merges resource ids across execution targets and resolves the preferred target', () => {
    const directory = createIsolatedCheckout('ovld-project-json-multi-');
    const projectJsonPath = writeProjectJson({
      directoryPath: directory,
      projectId: 'project-1',
      resourceId: 'resource-local',
      resourceKey: 'overlord',
      executionTargetId: 'target-local',
      isPrimary: true
    });

    writeProjectJson({
      directoryPath: directory,
      projectId: 'project-1',
      resourceId: 'resource-remote',
      resourceKey: 'overlord',
      executionTargetId: 'target-remote',
      isPrimary: true
    });

    const parsed = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as {
      version: number;
      resourceId: string;
      resourceKey?: string;
      resourceIdsByExecutionTarget?: Record<string, string>;
    };
    assert.equal(parsed.version, 2);
    assert.equal(parsed.resourceId, 'resource-remote');
    assert.equal(parsed.resourceKey, 'overlord');
    assert.deepEqual(parsed.resourceIdsByExecutionTarget, {
      'target-local': 'resource-local',
      'target-remote': 'resource-remote'
    });

    assert.equal(
      readProjectJsonLink(projectJsonPath, { preferredExecutionTargetId: 'target-local' })
        ?.resourceId,
      'resource-local'
    );
    assert.equal(
      readProjectJsonLink(projectJsonPath, { preferredExecutionTargetId: 'target-local' })
        ?.resourceKey,
      'overlord'
    );
    assert.equal(
      readProjectJsonLink(projectJsonPath, { preferredExecutionTargetId: 'target-remote' })
        ?.resourceId,
      'resource-remote'
    );
  });
});
