import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  CaptureSessionDto,
  FileChangeDto,
  ObjectiveFileChangesDto
} from '../../shared/contract.ts';

import {
  describeCaptureSession,
  fileChangeBasename,
  fileChangeDirname,
  fileChangeSourceLabel,
  summarizeObjectiveFileEvidence
} from './objective-file-changes.ts';

function row(overrides: Partial<FileChangeDto> = {}): FileChangeDto {
  return {
    id: 'fc-1',
    missionId: 'mission-1',
    objectiveId: 'obj-1',
    resourceKey: 'primary',
    filePath: 'src/index.ts',
    source: 'declared_edit',
    observedAt: '2026-10-24T10:00:00.000Z',
    hookHealth: null,
    ...overrides
  };
}

function captureSession(overrides: Partial<CaptureSessionDto> = {}): CaptureSessionDto {
  return {
    sessionId: 'session-1',
    startedAt: '2026-10-24T09:00:00.000Z',
    bindingState: 'bound',
    callbackObservedAt: '2026-10-24T09:01:00.000Z',
    health: [],
    ...overrides
  };
}

function read(overrides: Partial<ObjectiveFileChangesDto> = {}): ObjectiveFileChangesDto {
  return {
    scope: 'server_objective',
    missionId: 'mission-1',
    objectiveId: 'obj-1',
    items: [],
    total: 0,
    limit: 200,
    truncated: false,
    capture: { sessions: [], warnings: [] },
    ...overrides
  };
}

test('labels provenance and never promotes unknown history to native', () => {
  assert.equal(fileChangeSourceLabel('declared_edit'), 'Native');
  assert.equal(fileChangeSourceLabel('agent_declared'), 'Declared');
  assert.equal(fileChangeSourceLabel(null), 'Unknown');
});

test('derives basename and directory from the relative path', () => {
  assert.equal(fileChangeBasename('webapp/web/lib/a.ts'), 'a.ts');
  assert.equal(fileChangeDirname('webapp/web/lib/a.ts'), 'webapp/web/lib');
  assert.equal(fileChangeBasename('README.md'), 'README.md');
  assert.equal(fileChangeDirname('README.md'), '');
  assert.equal(fileChangeBasename('a, b.txt'), 'a, b.txt');
});

test('no capture session and no rows is unavailable tracking, not "no changes"', () => {
  const summary = summarizeObjectiveFileEvidence(read());
  assert.equal(summary.state, 'unavailable');
  assert.equal(summary.truncationNotice, null);
});

test('a healthy session with no rows is an empty capture, distinct from unavailable', () => {
  const summary = summarizeObjectiveFileEvidence(
    read({ capture: { sessions: [captureSession()], warnings: [] } })
  );
  assert.equal(summary.state, 'none_captured');
  assert.deepEqual(summary.warnings, []);
});

test('surfaces every objective warning, including older-session gaps', () => {
  const summary = summarizeObjectiveFileEvidence(
    read({
      items: [row()],
      total: 1,
      capture: {
        sessions: [
          captureSession({ sessionId: 'old', bindingState: 'unbound', callbackObservedAt: null }),
          captureSession({ sessionId: 'new' })
        ],
        warnings: ['unbound', 'bound_no_callback', 'unknown_binding', 'tool_activity_uncaptured']
      }
    })
  );
  assert.equal(summary.state, 'listed');
  assert.deepEqual(summary.warnings, [
    'Automatic file tracking was not active for this session.',
    'File tracking is configured but no callback has been observed.',
    'Automatic file tracking availability is unknown.',
    'Some tool activity could not be captured; declared paths may be needed.'
  ]);
});

test('reports truncation from the pre-cap total', () => {
  const items = Array.from({ length: 200 }, (_, index) => row({ id: `fc-${index}` }));
  const summary = summarizeObjectiveFileEvidence(read({ items, total: 512, truncated: true }));
  assert.equal(summary.truncationNotice, 'Showing 200 of 512 files');
});

test('describes a session without claiming hooks ran', () => {
  assert.equal(
    describeCaptureSession(
      captureSession({
        callbackObservedAt: null,
        health: [
          {
            code: 'shell_activity_unverified',
            firstAt: '2026-10-24T09:00:00.000Z',
            lastAt: '2026-10-24T09:00:00.000Z'
          }
        ]
      })
    ),
    'tracking configured · no callback observed · shell activity unverified'
  );
  assert.equal(
    describeCaptureSession(captureSession({ bindingState: 'unknown' })),
    'tracking availability unknown · callback observed'
  );
});
