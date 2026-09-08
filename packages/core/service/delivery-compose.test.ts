import type { DeliveryReportPayloadV1 } from '@overlord/contract';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyDeliveryPresentation,
  deriveDeterministicActionCandidates,
  mergeDeterministicActionCandidates,
  reconcileDeliveryComposeDraft
} from './delivery-compose.js';
import { buildDeliveryReport } from './delivery-report.js';

function baseReport(): DeliveryReportPayloadV1 {
  return buildDeliveryReport({
    summary: 'Shipped the compose worker.',
    deliveryReport: {
      schemaVersion: 1,
      agentReport: {
        humanActions: [
          {
            action: 'Set GEMINI_API_KEY in production.',
            reason: 'Composition needs a provider credential.',
            category: 'environment',
            command: 'railway variables set GEMINI_API_KEY=<key>',
            verify: 'The next delivery composes instead of falling back.',
            link: 'https://railway.app/project/overlord/variables'
          }
        ],
        tradeoffsMade: [
          {
            decision: 'Compose asynchronously after delivery.',
            alternativesConsidered: ['Block on Gemini'],
            rationale: 'Delivery latency must not depend on the model.',
            impact: 'Users see deterministic content first.'
          }
        ],
        knownRisks: ['Model may paraphrase poorly.'],
        deferredWork: ['Webhook full-payload parity'],
        assumptions: ['worker_jobs is available']
      }
    }
  });
}

describe('delivery-compose reconciliation', () => {
  it('keeps deterministic evidence as fallback when the draft is null', () => {
    const report = baseReport();
    const presentation = reconcileDeliveryComposeDraft({
      report,
      draft: null,
      model: 'gemini-test'
    });
    assert.equal(presentation.status, 'fallback');
    assert.equal(presentation.generatedBy, 'deterministic');
    assert.equal(presentation.markdown, report.presentation.markdown);
    assert.deepEqual(presentation.humanActions, report.agentReport.humanActions);
  });

  it('drops hallucinated actions and tradeoffs without source ids', () => {
    const report = baseReport();
    const presentation = reconcileDeliveryComposeDraft({
      report,
      draft: {
        markdown: 'Polished delivery summary.',
        humanActions: [
          { sourceId: 'human-action-1', action: 'Set the Gemini API key in production.' },
          { sourceId: 'invented-action', action: 'Buy a new laptop for the team.' }
        ],
        tradeoffsMade: [
          {
            sourceId: 'tradeoff-1',
            decision: 'Compose after commit.',
            rationale: 'Keep delivery non-blocking.'
          },
          {
            sourceId: 'invented-tradeoff',
            decision: 'Rewrite the protocol in Rust.',
            rationale: 'Faster somehow.'
          }
        ]
      },
      model: 'gemini-test'
    });

    assert.equal(presentation.status, 'composed');
    assert.equal(presentation.generatedBy, 'gemini');
    assert.equal(presentation.markdown, 'Polished delivery summary.');
    assert.equal(presentation.humanActions.length, 1);
    assert.equal(presentation.humanActions[0]?.id, 'human-action-1');
    assert.equal(presentation.tradeoffsMade.length, 1);
    assert.equal(presentation.tradeoffsMade[0]?.id, 'tradeoff-1');
  });

  it('filters git and routine QA actions even when the model echoes them', () => {
    const report = baseReport();
    const presentation = reconcileDeliveryComposeDraft({
      report,
      draft: {
        markdown: 'Done.',
        humanActions: [
          { sourceId: 'human-action-1', action: 'git push the branch' },
          { sourceId: 'human-action-1', action: 'Review the code' }
        ],
        tradeoffsMade: []
      }
    });
    assert.equal(presentation.humanActions.length, 1);
    assert.equal(presentation.humanActions[0]?.action, report.agentReport.humanActions[0]?.action);
  });

  it('derives deterministic candidates from migration and env paths', () => {
    const candidates = deriveDeterministicActionCandidates({
      filePaths: [
        'database/sqlite/migrations/20260719124600_worker_jobs.sql',
        '.env.local.example',
        'src/feature.ts'
      ]
    });
    assert.ok(candidates.some(candidate => candidate.category === 'database'));
    assert.ok(candidates.some(candidate => candidate.category === 'environment'));
    assert.ok(candidates.every(candidate => candidate.source === 'deterministic_rule'));
  });

  it('links each candidate to the path that triggered it and gives it a verify step', () => {
    const candidates = deriveDeterministicActionCandidates({
      filePaths: [
        'database/sqlite/migrations/20260907_human_actions.sql',
        'database/postgres/migrations/20260907_human_actions.sql',
        '.github/workflows/release.yml',
        'package.json',
        'src/feature.ts'
      ]
    });
    const byCategory = new Map(candidates.map(candidate => [candidate.category, candidate]));
    assert.equal(
      byCategory.get('database')?.link,
      'database/sqlite/migrations/20260907_human_actions.sql'
    );
    assert.equal(
      byCategory.get('database')?.sourceRef,
      'database/sqlite/migrations/20260907_human_actions.sql'
    );
    assert.equal(byCategory.get('deployment')?.link, '.github/workflows/release.yml');
    assert.equal(byCategory.get('packaging')?.link, 'package.json');
    assert.ok(candidates.every(candidate => typeof candidate.verify === 'string'));
    assert.equal(candidates.length, 3, 'one candidate per rule, not per path');
  });

  it('keeps command, verify, and link on composed actions the model does not restate', () => {
    const report = baseReport();
    const presentation = reconcileDeliveryComposeDraft({
      report,
      draft: {
        markdown: 'Done.',
        humanActions: [{ sourceId: 'human-action-1', action: 'Set the Gemini key in prod.' }],
        tradeoffsMade: []
      }
    });
    const [action] = presentation.humanActions;
    assert.equal(action?.command, 'railway variables set GEMINI_API_KEY=<key>');
    assert.equal(action?.verify, 'The next delivery composes instead of falling back.');
    assert.equal(action?.link, 'https://railway.app/project/overlord/variables');
  });

  it('accepts a model-supplied link only when it is an HTTP(S) URL or relative path', () => {
    const report = baseReport();
    const presentation = reconcileDeliveryComposeDraft({
      report,
      draft: {
        markdown: 'Done.',
        humanActions: [
          {
            sourceId: 'human-action-1',
            action: 'Set the key.',
            command: 'railway variables set GEMINI_API_KEY=abc',
            verify: 'Check the worker log.',
            link: 'javascript:alert(1)'
          }
        ],
        tradeoffsMade: []
      }
    });
    const [action] = presentation.humanActions;
    assert.equal(action?.command, 'railway variables set GEMINI_API_KEY=abc');
    assert.equal(action?.verify, 'Check the worker log.');
    assert.equal(action?.link, 'https://railway.app/project/overlord/variables');
  });

  it('appends uncited deterministic candidates after the composed actions', () => {
    const report = baseReport();
    const candidates = deriveDeterministicActionCandidates({
      filePaths: ['database/sqlite/migrations/20260907_x.sql', '.env.example']
    });
    const presentation = reconcileDeliveryComposeDraft({
      report,
      draft: {
        markdown: 'Done.',
        humanActions: [
          { sourceId: 'human-action-1', action: 'Set the Gemini key in prod.' },
          { sourceId: 'rule-action-2', action: 'Set the new variables from .env.example.' }
        ],
        tradeoffsMade: []
      },
      candidates
    });
    assert.deepEqual(
      presentation.humanActions.map(action => action.id),
      ['human-action-1', 'rule-action-2', 'rule-action-1']
    );
    assert.equal(
      presentation.humanActions[1]?.action,
      'Set the new variables from .env.example.',
      'the cited candidate keeps the model wording'
    );
    assert.equal(presentation.humanActions[2]?.source, 'deterministic_rule');
    assert.equal(presentation.humanActions[2]?.category, 'database');
  });

  it('lands deterministic candidates even when the agent reported no actions', () => {
    const report = buildDeliveryReport({ summary: 'Shipped.', deliveryReport: undefined });
    assert.equal(report.agentReport.humanActions.length, 0);
    const candidates = deriveDeterministicActionCandidates({
      filePaths: ['.github/workflows/ci.yml']
    });

    const composed = reconcileDeliveryComposeDraft({
      report,
      draft: { markdown: 'Polished.', humanActions: [], tradeoffsMade: [] },
      candidates
    });
    assert.equal(composed.status, 'composed');
    assert.deepEqual(
      composed.humanActions.map(action => action.source),
      ['deterministic_rule']
    );

    const fallback = reconcileDeliveryComposeDraft({ report, draft: null, candidates });
    assert.equal(fallback.status, 'fallback');
    assert.deepEqual(
      fallback.humanActions.map(action => action.id),
      ['rule-action-1']
    );
    assert.equal(report.presentation.humanActions.length, 0, 'the stored report is untouched');
  });

  it('merges candidates by id without duplicating and within the item bound', () => {
    const report = baseReport();
    const candidates = deriveDeterministicActionCandidates({
      filePaths: ['database/migrations/a.sql']
    });
    const merged = mergeDeterministicActionCandidates({
      actions: [...report.agentReport.humanActions, ...candidates],
      candidates
    });
    assert.equal(merged.length, 2);

    const many = Array.from({ length: 12 }, (_, index) => ({
      ...report.agentReport.humanActions[0]!,
      id: `human-action-${index + 1}`
    }));
    assert.equal(mergeDeterministicActionCandidates({ actions: many, candidates }).length, 12);
  });

  it('preserves normalization warnings when composition replaces the presentation', () => {
    const report = { ...baseReport(), warnings: ['Ignored malformed advisory evidence.'] };
    const presentation = reconcileDeliveryComposeDraft({ report, draft: null });

    assert.deepEqual(applyDeliveryPresentation({ report, presentation }).warnings, report.warnings);
  });
});
