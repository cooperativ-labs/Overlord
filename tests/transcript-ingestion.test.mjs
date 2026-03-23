import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  generateRationaleDrafts,
  parseClaudeTranscriptLines,
  parseCodexTranscriptLines
} from '../bin/_cli/transcript-ingestion.mjs';

test('parseClaudeTranscriptLines captures tool use, commentary, and file edits', () => {
  const lines = [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-03-23T10:00:00.000Z',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Read',
            input: { file_path: '/repo/src/example.ts' }
          }
        ]
      }
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-03-23T10:00:01.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Updating the example flow and validation.' }]
      }
    }),
    JSON.stringify({
      type: 'file-history-snapshot',
      snapshot: {
        timestamp: '2026-03-23T10:00:02.000Z',
        trackedFileBackups: {
          'src/example.ts': {
            version: 2,
            backupTime: '2026-03-23T10:00:02.000Z'
          }
        }
      }
    })
  ];

  const parsed = parseClaudeTranscriptLines({
    lines,
    previousFileVersions: { 'src/example.ts': 1 },
    repoRoot: '/repo'
  });

  assert.equal(parsed.events.length, 3);
  assert.equal(parsed.events[0].eventKind, 'tool_use');
  assert.equal(parsed.events[0].filePath, 'src/example.ts');
  assert.equal(parsed.events[1].eventKind, 'commentary');
  assert.match(parsed.events[1].summary, /Updating the example flow/);
  assert.equal(parsed.events[2].eventKind, 'file_edit');
  assert.equal(parsed.events[2].filePath, 'src/example.ts');
});

test('parseCodexTranscriptLines captures commentary, tool calls, and apply_patch edits', () => {
  const sessionId = 'session-123';
  const lines = [
    JSON.stringify({
      type: 'session_meta',
      payload: { id: sessionId }
    }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-03-23T10:00:00.000Z',
      payload: {
        type: 'agent_message',
        message: 'I am updating the terminal shortcut and related UI copy.'
      }
    }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-03-23T10:00:01.000Z',
      payload: {
        type: 'function_call',
        name: 'apply_patch',
        call_id: 'patch-1',
        arguments:
          '*** Begin Patch\n*** Update File: src/hotkeys.ts\n+test\n*** Update File: src/ui.tsx\n+test\n*** End Patch\n'
      }
    })
  ];

  const parsed = parseCodexTranscriptLines({
    lines,
    externalSessionId: sessionId,
    repoRoot: '/repo'
  });

  assert.equal(parsed.events[0].eventKind, 'commentary');
  assert.equal(parsed.events[1].eventKind, 'tool_use');
  assert.equal(parsed.events[2].eventKind, 'file_edit');
  assert.equal(parsed.events[2].filePath, 'src/hotkeys.ts');
  assert.equal(parsed.events[3].filePath, 'src/ui.tsx');
});

test('generateRationaleDrafts prefers file-edit evidence and emits draft metadata', () => {
  const drafts = generateRationaleDrafts({
    events: [
      {
        eventHash: 'comment-1',
        eventKind: 'commentary',
        eventTime: '2026-03-23T10:00:00.000Z',
        filePath: null,
        highSignal: false,
        summary: 'Adding transcript-backed rationale drafts to the current changes flow.',
        toolName: null
      },
      {
        eventHash: 'edit-1',
        eventKind: 'file_edit',
        eventTime: '2026-03-23T10:00:01.000Z',
        filePath: 'src/current-changes.tsx',
        highSignal: true,
        summary: 'Edited src/current-changes.tsx',
        toolName: 'apply_patch'
      }
    ],
    changedFiles: ['src/current-changes.tsx'],
    explicitRationalePaths: [],
    hunkHeadersByFile: new Map([
      ['src/current-changes.tsx', [{ header: '@@ -10,0 +11,8 @@' }]]
    ])
  });

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].file_path, 'src/current-changes.tsx');
  assert.equal(drafts[0].attribution_source, 'transcript_draft');
  assert.equal(drafts[0].confidence, 'high');
  assert.equal(drafts[0].status, 'draft');
  assert.equal(drafts[0].hunks[0].header, '@@ -10,0 +11,8 @@');
  assert.match(drafts[0].why, /nearby agent commentary|local agent transcript/);
});
