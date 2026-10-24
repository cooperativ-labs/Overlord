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
      source: entry.source
    })),
    [{ filePath: 'src/edited.ts', source: 'declared_edit' }]
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

test('captures declared notebook and apply_patch paths without retaining native content', () => {
  const workspace = makeWorkspace();

  assert.deepEqual(
    captureChangeFromPayload({
      agent: 'claude',
      rawPayload: JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'NotebookEdit',
        tool_input: { notebook_path: path.join(workspace, 'notebooks', 'report.ipynb') },
        cwd: workspace
      }),
      objectiveOverride: OBJECTIVE_DISPLAY_ID,
      fallbackCwd: workspace
    }),
    { recorded: true, objectiveId: OBJECTIVE_ID, files: 1 }
  );
  assert.deepEqual(
    captureChangeFromPayload({
      agent: 'codex',
      rawPayload: JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'apply_patch',
        tool_input: {
          command:
            '*** Begin Patch\n*** Update File: ' +
            path.join(workspace, 'generated', 'one.ts') +
            '\nsecret=AKIAIOSFODNN7EXAMPLE\n*** Add File: generated/two.ts\n*** End Patch'
        },
        tool_response:
          'Exit code: 0\nWall time: 0.1 seconds\nOutput:\nSuccess. Updated the following files:\nM generated/one.ts\nA generated/two.ts\n',
        cwd: workspace
      }),
      objectiveOverride: OBJECTIVE_DISPLAY_ID,
      fallbackCwd: workspace
    }),
    { recorded: true, objectiveId: OBJECTIVE_ID, files: 2 }
  );

  assert.deepEqual(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }).map(entry => entry.filePath),
    ['notebooks/report.ipynb', 'generated/one.ts', 'generated/two.ts']
  );
});

test('read callbacks are silent while shell callbacks record a shell coverage gap', () => {
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
    'shell_activity_unverified'
  );
});

function codexPatchPayload(workspace: string, patch: string, toolResponse?: string): string {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: { command: patch },
    ...(toolResponse === undefined ? {} : { tool_response: toolResponse }),
    cwd: workspace
  });
}

test('Codex apply_patch renames and deletes record both endpoints only on exit code 0', () => {
  const workspace = makeWorkspace();
  const patch =
    '*** Begin Patch\n*** Update File: src/old-name.ts\n*** Move to: src/new-name.ts\n@@\n-old\n+new\n' +
    '*** Delete File: src/removed.ts\n*** End Patch';

  assert.deepEqual(
    captureChangeFromPayload({
      agent: 'codex',
      rawPayload: codexPatchPayload(
        workspace,
        patch,
        'Exit code: 0\nWall time: 0 seconds\nOutput:\nSuccess. Updated the following files:\nM src/new-name.ts\nD src/removed.ts\n'
      ),
      objectiveOverride: OBJECTIVE_DISPLAY_ID,
      fallbackCwd: workspace
    }),
    { recorded: true, objectiveId: OBJECTIVE_ID, files: 3 }
  );
  assert.deepEqual(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }).map(entry => entry.filePath),
    ['src/old-name.ts', 'src/new-name.ts', 'src/removed.ts']
  );
});

test('failed and unknown native edit outcomes append no evidence and record bounded gaps', () => {
  const workspace = makeWorkspace();
  const patch = '*** Begin Patch\n*** Update File: src/attempted.ts\n@@\n-a\n+b\n*** End Patch';
  const identity = {
    workingDirectory: workspace,
    objectiveId: OBJECTIVE_ID,
    sessionKey: SESSION_KEY
  };

  assert.deepEqual(
    captureChangeFromPayload({
      agent: 'codex',
      rawPayload: codexPatchPayload(workspace, patch, 'Exit code: 1\nOutput:\nerror: hunk failed'),
      objectiveOverride: OBJECTIVE_DISPLAY_ID,
      fallbackCwd: workspace
    }),
    { recorded: false, reason: 'native edit failed' }
  );
  assert.equal(readChangeLedgerHealth(identity).at(-1)?.code, 'outcome_partial');

  for (const toolResponse of [
    undefined,
    'Success. Updated the following files:\nM src/attempted.ts'
  ]) {
    assert.deepEqual(
      captureChangeFromPayload({
        agent: 'codex',
        rawPayload: codexPatchPayload(workspace, patch, toolResponse),
        objectiveOverride: OBJECTIVE_DISPLAY_ID,
        fallbackCwd: workspace
      }),
      { recorded: false, reason: 'native edit outcome is unavailable' }
    );
  }
  assert.deepEqual(readUnsyncedChangeEvidence(identity), []);
  assert.deepEqual(
    readChangeLedgerHealth(identity).map(entry => entry.code),
    ['outcome_partial', 'outcome_unavailable']
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

test('recovers the objective worktree when Cursor omits cwd and the hook cwd is unrelated', () => {
  const workspace = makeWorkspace();
  const editedPath = path.join(workspace, 'src', 'cursor-edit.ts');
  const unrelatedHookCwd = mkdtempSync(path.join(os.tmpdir(), 'ovld-cursor-hook-cwd-'));

  const result = captureChangeFromPayload({
    agent: 'cursor',
    rawPayload: JSON.stringify({
      conversation_id: 'conv_cursor_1',
      event: 'postToolUse',
      tool_name: 'Write',
      tool_input: { file_path: editedPath, content: 'x\n' },
      tool_use_id: 'call_1'
    }),
    objectiveOverride: OBJECTIVE_DISPLAY_ID,
    fallbackCwd: unrelatedHookCwd
  });

  assert.deepEqual(result, { recorded: true, objectiveId: OBJECTIVE_ID, files: 1 });
  assert.deepEqual(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }).map(entry => entry.filePath),
    ['src/cursor-edit.ts']
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
