import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeActiveSession } from '../src/active-objective-sessions.ts';
import { MAX_AGENT_SESSION_PAYLOAD_BYTES } from '../src/agent-session/event.ts';
import { captureChangeFromPayload } from '../src/capture-change.ts';
import { readChangeLedgerHealth, readUnsyncedChangeEvidence } from '../src/change-ledger.ts';

const MISSION_ID = 'coo:825';
const OBJECTIVE_ID = 'objective-uuid';
const OBJECTIVE_DISPLAY_ID = 'coo:825.wyp4';
const SESSION_KEY = 'sess_capture';

function makeWorkspace(): string {
  process.env.OVLD_HOME = mkdtempSync(path.join(os.tmpdir(), 'ovld-capture-home-'));
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'ovld-capture-workspace-'));
  writeActiveSession({
    workingDirectory: workspace,
    missionId: MISSION_ID,
    objectiveId: OBJECTIVE_ID,
    objectiveAliases: [OBJECTIVE_DISPLAY_ID],
    sessionKey: SESSION_KEY
  });
  return workspace;
}

test('captures a direct native path under the canonical objective ledger', () => {
  const workspace = makeWorkspace();
  const editedPath = path.join(workspace, 'src', 'edited.ts');

  const result = captureChangeFromPayload({
    agent: 'claude',
    rawPayload: JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: editedPath },
      cwd: workspace
    }),
    objectiveOverride: OBJECTIVE_DISPLAY_ID,
    fallbackCwd: workspace
  });

  assert.deepEqual(result, { recorded: true, objectiveId: OBJECTIVE_ID, files: 1 });
  assert.deepEqual(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }).map(entry => ({
      filePath: entry.filePath,
      source: entry.source,
      quality: entry.quality
    })),
    [{ filePath: 'src/edited.ts', source: 'declared_edit', quality: 'direct' }]
  );
  assert.deepEqual(
    captureChangeFromPayload({
      agent: 'claude',
      rawPayload: JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { file_path: editedPath },
        cwd: workspace
      }),
      objectiveOverride: OBJECTIVE_DISPLAY_ID,
      fallbackCwd: workspace
    }),
    { recorded: false, reason: 'no new exact path evidence was appended' }
  );
  assert.equal(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }).length,
    1
  );
});

test('read callbacks are silent while shell callbacks record unavailable health', () => {
  const workspace = makeWorkspace();
  writeFileSync(path.join(workspace, 'generated.ts'), 'generated\n');

  const readResult = captureChangeFromPayload({
    agent: 'claude',
    rawPayload: JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: { file_path: path.join(workspace, 'generated.ts') },
      cwd: workspace
    }),
    objectiveOverride: OBJECTIVE_DISPLAY_ID,
    fallbackCwd: workspace
  });

  assert.deepEqual(readResult, {
    recorded: false,
    reason: 'native event is confidently non-mutating'
  });
  assert.deepEqual(
    readChangeLedgerHealth({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }),
    []
  );
  assert.deepEqual(
    captureChangeFromPayload({
      agent: 'claude',
      rawPayload: JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'generate' },
        cwd: workspace
      }),
      objectiveOverride: OBJECTIVE_DISPLAY_ID,
      fallbackCwd: workspace
    }),
    { recorded: false, reason: 'native event is not a declared file edit' }
  );
  assert.deepEqual(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }),
    []
  );
  assert.equal(
    readChangeLedgerHealth({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }).at(-1)?.code,
    'direct_path_unavailable'
  );
});

test('requires an explicit objective and rejects paths outside the workspace', () => {
  const workspace = makeWorkspace();
  assert.deepEqual(
    captureChangeFromPayload({
      agent: 'claude',
      rawPayload: JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { file_path: 'src/edit.ts' },
        cwd: workspace
      }),
      fallbackCwd: workspace
    }),
    { recorded: false, reason: 'explicit objective id is required' }
  );

  const outside = path.join(path.dirname(workspace), 'secret.txt');
  assert.deepEqual(
    captureChangeFromPayload({
      agent: 'claude',
      rawPayload: JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { file_path: outside },
        cwd: workspace
      }),
      objectiveOverride: OBJECTIVE_DISPLAY_ID,
      fallbackCwd: workspace
    }),
    { recorded: false, reason: 'native edit contains no exact path evidence' }
  );
  assert.deepEqual(
    captureChangeFromPayload({
      agent: 'claude',
      rawPayload: JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { file_path: ' src/trimmed.ts ' },
        cwd: workspace
      }),
      objectiveOverride: OBJECTIVE_DISPLAY_ID,
      fallbackCwd: workspace
    }),
    { recorded: false, reason: 'native edit contains no exact path evidence' }
  );
  assert.deepEqual(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }),
    []
  );
  assert.deepEqual(
    readChangeLedgerHealth({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }).map(entry => entry.code),
    ['direct_path_unavailable']
  );
});

test('requires a declared connector codec and captures Edit as a mutation', () => {
  const workspace = makeWorkspace();
  const payload = JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: path.join(workspace, 'src', 'edit.ts') },
    cwd: workspace
  });

  assert.deepEqual(
    captureChangeFromPayload({
      agent: '',
      rawPayload: payload,
      objectiveOverride: OBJECTIVE_DISPLAY_ID,
      fallbackCwd: workspace
    }),
    { recorded: false, reason: 'explicit agent is required' }
  );
  assert.deepEqual(
    captureChangeFromPayload({
      agent: 'unknown',
      rawPayload: payload,
      objectiveOverride: OBJECTIVE_DISPLAY_ID,
      fallbackCwd: workspace
    }),
    { recorded: false, reason: 'agent has no capture codec' }
  );
  assert.deepEqual(
    captureChangeFromPayload({
      agent: 'claude',
      rawPayload: payload,
      objectiveOverride: OBJECTIVE_DISPLAY_ID,
      fallbackCwd: workspace
    }),
    { recorded: true, objectiveId: OBJECTIVE_ID, files: 1 }
  );
});

test('oversized native payloads are not parsed and record bounded health only', () => {
  const workspace = makeWorkspace();
  const result = captureChangeFromPayload({
    agent: 'claude',
    rawPayload: 'x'.repeat(MAX_AGENT_SESSION_PAYLOAD_BYTES + 1),
    objectiveOverride: OBJECTIVE_DISPLAY_ID,
    fallbackCwd: workspace
  });

  assert.deepEqual(result, { recorded: false, reason: 'native payload unavailable' });
  assert.deepEqual(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }),
    []
  );
  assert.equal(
    readChangeLedgerHealth({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }).at(-1)?.code,
    'native_payload_unavailable'
  );
});
