import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { event, message, proposal, question, run, snapshot } from './chat-fixtures.ts';
import { applyChatEvent, composerMode, isGap, stateFromSnapshot } from './thread-state.ts';

describe('chat thread state', () => {
  it('starts from the snapshot cursor and merges open and referenced proposals', () => {
    const created = proposal({ id: 'p-created', state: 'created' });
    const state = stateFromSnapshot(
      snapshot({ eventCursor: 7, openProposals: [proposal()], referencedProposals: [created] })
    );
    assert.equal(state.cursor, 7);
    assert.deepEqual(Object.keys(state.proposals).sort(), ['p-1', 'p-created']);
  });

  it('ignores duplicates and flags gaps', () => {
    let state = stateFromSnapshot(snapshot({ eventCursor: 2, messages: [message()] }));
    const delta = event(3, {
      kind: 'message.delta',
      messageId: 'm-assistant',
      blockId: 'b1',
      text: 'Hi'
    });
    state = applyChatEvent(state, delta);
    state = applyChatEvent(state, delta);
    const text = state.messages[0]!.blocks[0]!;
    assert.equal(text.kind === 'text' && text.text, 'Hi');
    assert.equal(state.cursor, 3);
    assert.equal(
      isGap(
        state,
        event(5, { kind: 'message.delta', messageId: 'm-assistant', blockId: 'b1', text: '!' })
      ),
      true
    );
    assert.equal(
      isGap(
        state,
        event(4, { kind: 'message.delta', messageId: 'm-assistant', blockId: 'b1', text: '!' })
      ),
      false
    );
  });

  it('never lets an older message revision replace a newer one', () => {
    let state = stateFromSnapshot(
      snapshot({ messages: [message({ revision: 3, state: 'complete' })] })
    );
    state = applyChatEvent(
      state,
      event(1, { kind: 'message.completed', message: message({ revision: 2 }) })
    );
    assert.equal(state.messages[0]!.revision, 3);
  });

  it('tracks run, question, and composer mode transitions', () => {
    let state = stateFromSnapshot(snapshot());
    assert.equal(composerMode(state), 'send');
    state = applyChatEvent(state, event(1, { kind: 'run.updated', run: run() }));
    assert.equal(composerMode(state), 'busy');
    assert.equal(state.thread.activeRunState, 'running');
    state = applyChatEvent(
      state,
      event(2, {
        kind: 'tool.updated',
        runId: 'run-1',
        toolCallId: 't1',
        label: 'Reading git status',
        state: 'executing'
      })
    );
    state = applyChatEvent(state, event(3, { kind: 'question.opened', question: question() }));
    state = applyChatEvent(
      state,
      event(4, { kind: 'run.updated', run: run({ state: 'waiting_user', revision: 2 }) })
    );
    assert.equal(composerMode(state), 'answer');
    state = applyChatEvent(
      state,
      event(5, { kind: 'question.closed', question: question({ state: 'answered' }) })
    );
    assert.equal(state.openQuestion, null);
    state = applyChatEvent(
      state,
      event(6, {
        kind: 'run.updated',
        run: run({
          state: 'completed',
          outcome: 'allowance_exhausted',
          continueAvailable: true,
          revision: 4
        })
      })
    );
    assert.equal(state.activeRun, null);
    assert.equal(state.tools.length, 0);
    assert.equal(state.latestRun?.continueAvailable, true);
    // Continue: the new run supersedes the exhausted run's offer.
    state = applyChatEvent(
      state,
      event(7, {
        kind: 'run.updated',
        run: run({ id: 'run-2', state: 'queued', continuedFromRunId: 'run-1' })
      })
    );
    assert.equal(state.latestRun?.continueAvailable, false);
    assert.equal(state.activeRun?.id, 'run-2');
  });

  it('withholds invalidated content at once and asks for an authorized snapshot', () => {
    let state = stateFromSnapshot(
      snapshot({
        messages: [
          message({
            state: 'complete',
            blocks: [
              {
                id: 'b1',
                kind: 'text',
                text: 'Secret note says…',
                fallbackText: 'Secret note says…',
                evidenceIds: ['e1']
              }
            ]
          })
        ],
        openProposals: [proposal()]
      })
    );
    state = applyChatEvent(
      state,
      event(1, { kind: 'content.invalidated', messageIds: ['m-assistant'], proposalIds: ['p-1'] })
    );
    assert.equal(state.needsSnapshot, true);
    assert.deepEqual(
      state.messages[0]!.blocks.map(block => block.kind),
      ['unavailable']
    );
    assert.equal(JSON.stringify(state.messages).includes('Secret'), false);
    assert.equal(state.proposals['p-1']!.current.invalidated, true);
  });

  it('tolerates unknown future event kinds', () => {
    const state = stateFromSnapshot(snapshot());
    const next = applyChatEvent(state, {
      threadId: 'thread-1',
      seq: 1,
      createdAt: '',
      kind: 'future.kind'
    } as never);
    assert.equal(next.cursor, 1);
  });
});
