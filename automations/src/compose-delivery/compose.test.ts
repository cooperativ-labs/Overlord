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
  it('instructs the model to rewrite eligible deferred work as out-of-mission objectives', () => {
    assert.match(SYSTEM_INSTRUCTION, /DEFERRED WORK rules/);
    assert.match(SYSTEM_INSTRUCTION, /not part of this mission/);
    assert.match(SYSTEM_INSTRUCTION, /Never shorten a kept item/);
    assert.match(SYSTEM_INSTRUCTION, /out-of-scope bug/);
  });

  it('requires the deferredWork array so the model cannot silently omit it', () => {
    assert.ok(COMPOSE_DELIVERY_RESPONSE_SCHEMA.required?.includes('deferredWork'));
  });

  it('labels the deferred-work evidence with its eligible count and planned objectives', () => {
    const prompt = buildComposeDeliveryPrompt({
      ...sampleInput,
      plannedObjectives: [
        {
          title: 'CSV export API',
          instruction: 'Implement the CSV export API for the reports page.'
        }
      ],
      omittedDeferredWork: ['Implement the CSV export API for reports.'],
      deferredWork: ['Fix the date-dependent employee lifecycle test that failed in payroll.']
    });
    assert.match(
      prompt,
      /Deferred work \(eligible agent-listed, 1 item\(s\); rewrite each as a standalone out-of-mission objective/
    );
    assert.match(prompt, /Fix the date-dependent employee lifecycle test that failed in payroll\./);
    assert.match(prompt, /Planned future objectives on this mission/);
    assert.match(prompt, /CSV export API/);
    assert.match(prompt, /omitted as ineligible/);
  });
});
