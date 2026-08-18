import assert from 'node:assert/strict';
import { test } from 'node:test';

import { agentDisplayName, normalizeAgentKey } from './helpers/agent-icons.ts';
import { missionOriginLabel, objectiveOriginLabel } from './mission-origin.ts';

// The mark's whole contract is these two answers: nothing at all for a human
// row, and a named attribution for an agent one. A null label is what makes
// `MissionOriginMark` return null, so "absent for human" is asserted here
// rather than through a DOM render — webapp has no browser test harness, and
// the branch under test is the one that decides whether anything renders.
test('missionOriginLabel is silent for a human-filed mission', () => {
  assert.equal(missionOriginLabel({ createdByKind: 'human', createdByAgent: null }), null);
  // A stale agent identifier on a human row must not resurrect the mark.
  assert.equal(missionOriginLabel({ createdByKind: 'human', createdByAgent: 'claude-code' }), null);
});

test('missionOriginLabel names the agent that authored the mission', () => {
  assert.equal(
    missionOriginLabel({ createdByKind: 'agent', createdByAgent: 'claude-code' }),
    'Created by Claude Code'
  );
  assert.equal(
    missionOriginLabel({ createdByKind: 'agent', createdByAgent: 'hosted-mcp' }),
    'Created by Overlord MCP'
  );
});

test('missionOriginLabel falls back to a generic author, never to silence', () => {
  // No identifier recorded: the row is still provably agent-authored, so the
  // mark must appear. Dropping it would misreport the row as human-filed.
  assert.equal(
    missionOriginLabel({ createdByKind: 'agent', createdByAgent: null }),
    'Created by an agent'
  );
});

test('missionOriginLabel attributes automation to Overlord, not to an agent', () => {
  assert.equal(
    missionOriginLabel({ createdByKind: 'automation', createdByAgent: null }),
    'Created automatically by Overlord'
  );
});

test('objectiveOriginLabel says "Added", since an objective joins an existing mission', () => {
  assert.equal(objectiveOriginLabel({ createdByKind: 'human', createdByAgent: null }), null);
  assert.equal(
    objectiveOriginLabel({ createdByKind: 'agent', createdByAgent: 'claude-code' }),
    'Added by Claude Code'
  );
});

test('normalizeAgentKey folds connector identifiers onto their icon key', () => {
  // The gap this closes: provenance records `claude-code`, while the icon map
  // has only ever known `claude`.
  assert.equal(normalizeAgentKey('claude-code'), 'claude');
  assert.equal(normalizeAgentKey('  Claude-Code '), 'claude');
  assert.equal(normalizeAgentKey('codex'), 'codex');
  assert.equal(normalizeAgentKey(null), null);
  assert.equal(normalizeAgentKey('   '), null);
  // Protocol's missing-agent sentinel must not render as a label or icon key.
  assert.equal(normalizeAgentKey('unknown'), null);
});

test('agentDisplayName prefers naming an unmapped connector over anonymizing it', () => {
  assert.equal(agentDisplayName('some-new-agent'), 'some-new-agent');
  assert.equal(agentDisplayName(null), null);
});
