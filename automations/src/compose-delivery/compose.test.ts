import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildComposeDeliveryPrompt,
  COMPOSE_DELIVERY_RESPONSE_SCHEMA,
  type ComposeDeliveryInput,
  composeDeliveryWithGemini,
  SYSTEM_INSTRUCTION
} from './compose.js';

const sampleInput: ComposeDeliveryInput = {
  summary: 'Implemented async delivery composition.',
  objectiveTitle: 'Execute Phase 3',
  humanActions: [
    {
      id: 'human-action-1',
      action: 'Set GEMINI_API_KEY',
      reason: 'Needed for composition',
      category: 'environment',
      source: 'agent'
    }
  ],
  tradeoffsMade: [
    {
      id: 'tradeoff-1',
      decision: 'Use a durable worker job',
      rationale: 'Survives restarts',
      alternativesConsidered: ['Fire-and-forget void'],
      source: 'agent'
    }
  ],
  knownRisks: [],
  deferredWork: [],
  assumptions: [],
  candidateActions: [],
  changeRationales: []
};

describe('compose-delivery automation', () => {
  it('returns null when the generator yields no text', async () => {
    const draft = await composeDeliveryWithGemini({
      input: sampleInput,
      generate: async () => null
    });
    assert.equal(draft, null);
  });

  it('returns null when the generator yields invalid JSON', async () => {
    const draft = await composeDeliveryWithGemini({
      input: sampleInput,
      generate: async () => 'not-json'
    });
    assert.equal(draft, null);
  });

  it('parses schema-shaped JSON from the generator', async () => {
    const draft = await composeDeliveryWithGemini({
      input: sampleInput,
      generate: async () =>
        JSON.stringify({
          markdown: 'Polished markdown.',
          humanActions: [{ sourceId: 'human-action-1', action: 'Set GEMINI_API_KEY' }],
          tradeoffsMade: [
            {
              sourceId: 'tradeoff-1',
              decision: 'Use a durable worker job',
              rationale: 'Survives restarts'
            }
          ]
        })
    });
    assert.ok(draft);
    assert.equal(draft?.markdown, 'Polished markdown.');
    assert.equal(draft?.humanActions?.length, 1);
  });
});

describe('compose-delivery deferred-work enrichment', () => {
  it('instructs the model to rewrite deferred work as standalone objectives', () => {
    assert.match(SYSTEM_INSTRUCTION, /DEFERRED WORK rules/);
    assert.match(SYSTEM_INSTRUCTION, /stand alone/);
    assert.match(
      SYSTEM_INSTRUCTION,
      /Never shorten an item, merge two items, drop an item, or reorder them/
    );
    assert.match(SYSTEM_INSTRUCTION, /explicitly says work was left undone/);
  });

  it('requires the deferredWork array so the model cannot silently omit it', () => {
    assert.ok(COMPOSE_DELIVERY_RESPONSE_SCHEMA.required?.includes('deferredWork'));
  });

  it('labels the deferred-work evidence with its count and the rewrite instruction', () => {
    const prompt = buildComposeDeliveryPrompt({
      ...sampleInput,
      deferredWork: ['Remaining ~60 unassigned moves.', 'P2 composites']
    });
    assert.match(
      prompt,
      /Deferred work \(agent-listed, 2 item\(s\); rewrite each as a standalone objective/
    );
    assert.match(prompt, /Remaining ~60 unassigned moves\./);
  });
});
