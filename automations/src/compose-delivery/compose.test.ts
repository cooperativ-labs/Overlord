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
  assumptions: [],
  candidateActions: []
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

describe('compose-delivery deferred work', () => {
  it('never asks the model for deferred work', () => {
    assert.doesNotMatch(SYSTEM_INSTRUCTION, /deferred/i);
    assert.equal('deferredWork' in (COMPOSE_DELIVERY_RESPONSE_SCHEMA.properties ?? {}), false);
    assert.equal(COMPOSE_DELIVERY_RESPONSE_SCHEMA.required?.includes('deferredWork'), false);
  });

  it('sends no deferred-work section in the prompt body', () => {
    const prompt = buildComposeDeliveryPrompt({
      ...sampleInput,
      plannedObjectives: [
        {
          title: 'CSV export API',
          instruction: 'Implement the CSV export API for the reports page.'
        }
      ]
    });
    assert.doesNotMatch(prompt, /deferred/i);
    assert.match(prompt, /Planned future objectives on this mission/);
  });
});

describe('compose-delivery writing rules', () => {
  it('includes the STE-inspired rule list and its exemptions', () => {
    assert.match(SYSTEM_INSTRUCTION, /WRITING rules:/);
    assert.match(SYSTEM_INSTRUCTION, /One topic per sentence/);
    assert.match(SYSTEM_INSTRUCTION, /Use the active voice and name the actor/);
    assert.match(SYSTEM_INSTRUCTION, /When the evidence is unclear, say that it is unclear/);
    assert.match(SYSTEM_INSTRUCTION, /do not apply to command, verify, link, file paths/);
  });
});

describe('compose-delivery file evidence', () => {
  it('never sends per-file prose and forbids path-derived claims', () => {
    const prompt = buildComposeDeliveryPrompt(sampleInput);
    assert.doesNotMatch(prompt, /change rationale|changeRationale/i);
    assert.doesNotMatch(SYSTEM_INSTRUCTION, /change rationales/i);
    assert.match(
      SYSTEM_INSTRUCTION,
      /never infer behavior, impact, tests, or verification from a file or path name/
    );
  });
});
