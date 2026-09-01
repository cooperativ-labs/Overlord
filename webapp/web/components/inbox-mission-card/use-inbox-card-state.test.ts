import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MANUAL_AGENT_KEY } from '@/components/objectives/AgentModelSelector.tsx';

import { getInboxCardDefaultSelection, getInboxCardReadiness } from './use-inbox-card-state.ts';

describe('Inbox card state characterization', () => {
  const catalog = {
    agents: [],
    defaultAgent: 'catalog-agent',
    defaultModel: 'catalog-model'
  };

  it('keeps an assigned promoted objective ahead of the saved preference', () => {
    assert.deepEqual(
      getInboxCardDefaultSelection({
        assignedSelection: {
          agent: 'assigned-agent',
          model: 'assigned-model',
          reasoningEffort: 'high'
        },
        preference: {
          selectedAgent: 'preference-agent',
          selectedModel: 'preference-model',
          selectedReasoningEffort: 'low'
        },
        catalog
      }),
      { agent: 'assigned-agent', model: 'assigned-model', reasoningEffort: 'high' }
    );
  });

  it('uses the catalog default for an unassigned item when no preference is saved', () => {
    assert.deepEqual(getInboxCardDefaultSelection({ catalog }), {
      agent: 'catalog-agent',
      model: 'catalog-model',
      reasoningEffort: null
    });
  });

  it('keeps inbox save available without a project but gates a run on a ready project target', () => {
    const selection = { agent: 'claude', model: null, reasoningEffort: null };
    assert.deepEqual(
      getInboxCardReadiness({
        instruction: 'Save this capture',
        hasProject: false,
        selectionLoaded: false,
        isBusy: false,
        isActionable: true,
        selection,
        primaryConnected: false,
        targetAvailable: false
      }),
      { canSubmit: true, canRun: false, isManual: false }
    );
    assert.deepEqual(
      getInboxCardReadiness({
        instruction: 'Run this mission',
        hasProject: true,
        selectionLoaded: true,
        isBusy: false,
        isActionable: true,
        selection,
        primaryConnected: true,
        targetAvailable: true
      }),
      { canSubmit: true, canRun: true, isManual: false }
    );
  });

  it('does not offer Run for a manual agent selection', () => {
    const readiness = getInboxCardReadiness({
      instruction: 'Run this mission',
      hasProject: true,
      selectionLoaded: true,
      isBusy: false,
      isActionable: true,
      selection: { agent: MANUAL_AGENT_KEY, model: null, reasoningEffort: null },
      primaryConnected: true,
      targetAvailable: true
    });

    assert.equal(readiness.canSubmit, true);
    assert.equal(readiness.canRun, false);
    assert.equal(readiness.isManual, true);
  });
});
