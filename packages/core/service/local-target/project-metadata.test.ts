import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createIsolatedCheckout } from '../test-checkout.ts';

import {
  PROJECT_JSON_VERSION,
  readProjectJsonLink,
  readProjectJsonLinks,
  writeProjectJson
} from './project-metadata.ts';

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
    writeFileSync(
      projectJsonPath,
      `${JSON.stringify(
        {
          _warning: 'legacy',
          version: 2,
          projectId: 'project-1',
          resourceId: 'resource-1',
          isPrimary: true,
          linkedAt: '2026-01-01T00:00:00.000Z'
        },
        null,
        2
      )}\n`
    );

    const link = readProjectJsonLink(projectJsonPath);
    assert.equal(link?.projectId, 'project-1');
    assert.equal(link?.resourceId, 'resource-1');
    assert.equal(link?.resourceKey, null);
    assert.deepEqual(link?.resourceIdsByExecutionTarget, {});
    assert.equal(link?.isPrimary, true);
    assert.equal(readProjectJsonLinks(projectJsonPath).length, 1);
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
      projects?: Array<{ resourceIdsByExecutionTarget?: Record<string, string> }>;
    };
    assert.equal(parsed.version, PROJECT_JSON_VERSION);
    assert.equal(parsed.resourceId, 'resource-remote');
    assert.equal(parsed.resourceKey, 'overlord');
    assert.deepEqual(parsed.resourceIdsByExecutionTarget, {
      'target-local': 'resource-local',
      'target-remote': 'resource-remote'
    });
    assert.equal(parsed.projects?.length, 1);
    assert.deepEqual(parsed.projects?.[0]?.resourceIdsByExecutionTarget, {
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

  it('merges a second project without replacing the first and keeps one primary', () => {
    const directory = createIsolatedCheckout('ovld-project-json-two-projects-');
    const projectJsonPath = writeProjectJson({
      directoryPath: directory,
      projectId: 'project-a',
      projectName: 'Alpha',
      resourceId: 'resource-a',
      resourceKey: 'overlord',
      executionTargetId: 'target-local',
      isPrimary: true
    });

    writeProjectJson({
      directoryPath: directory,
      projectId: 'project-b',
      projectName: 'Beta',
      resourceId: 'resource-b',
      resourceKey: 'shared',
      executionTargetId: 'target-local',
      isPrimary: false
    });

    const parsed = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as {
      projectId: string;
      isPrimary: boolean;
      projects: Array<{ projectId: string; isPrimary: boolean; projectName?: string }>;
    };
    assert.equal(parsed.projectId, 'project-a');
    assert.equal(parsed.isPrimary, true);
    assert.equal(parsed.projects.length, 2);
    assert.deepEqual(
      parsed.projects.map(entry => ({
        projectId: entry.projectId,
        isPrimary: entry.isPrimary,
        projectName: entry.projectName
      })),
      [
        { projectId: 'project-a', isPrimary: true, projectName: 'Alpha' },
        { projectId: 'project-b', isPrimary: false, projectName: 'Beta' }
      ]
    );

    const defaultLink = readProjectJsonLink(projectJsonPath);
    assert.equal(defaultLink?.projectId, 'project-a');
    assert.equal(defaultLink?.isPrimary, true);

    const beta = readProjectJsonLink(projectJsonPath, { preferredProjectId: 'project-b' });
    assert.equal(beta?.projectId, 'project-b');
    assert.equal(beta?.resourceId, 'resource-b');
    assert.equal(beta?.isPrimary, false);
  });

  it('promotes the most recently set primary and demotes the previous one', () => {
    const directory = createIsolatedCheckout('ovld-project-json-steal-primary-');
    const projectJsonPath = writeProjectJson({
      directoryPath: directory,
      projectId: 'project-a',
      projectName: 'Alpha',
      resourceId: 'resource-a',
      isPrimary: true
    });

    writeProjectJson({
      directoryPath: directory,
      projectId: 'project-b',
      projectName: 'Beta',
      resourceId: 'resource-b',
      isPrimary: true
    });

    const parsed = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as {
      projectId: string;
      isPrimary: boolean;
      projects: Array<{ projectId: string; isPrimary: boolean }>;
    };
    assert.equal(parsed.projectId, 'project-b');
    assert.equal(parsed.isPrimary, true);
    assert.deepEqual(
      parsed.projects.map(entry => ({ projectId: entry.projectId, isPrimary: entry.isPrimary })),
      [
        { projectId: 'project-a', isPrimary: false },
        { projectId: 'project-b', isPrimary: true }
      ]
    );

    assert.equal(readProjectJsonLink(projectJsonPath)?.projectId, 'project-b');
    assert.equal(
      readProjectJsonLink(projectJsonPath, { preferredProjectId: 'project-a' })?.isPrimary,
      false
    );
  });
});
