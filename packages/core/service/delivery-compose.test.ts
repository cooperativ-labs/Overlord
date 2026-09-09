import type { DeliveryReportPayloadV1 } from '@overlord/contract';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyDeferredWorkEligibility,
  applyDeliveryPresentation,
  deriveDeterministicActionCandidates,
  filterDeferredWork,
  matchDeferredWorkAgentIndex,
  mergeDeterministicActionCandidates,
  reconcileDeferredWork,
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

describe('deferred-work reconciliation', () => {
  const agentItems = ['Webhook full-payload parity', 'Remaining ~60 unassigned moves.'];

  it('accepts enriched draft items in place of their agent sources', () => {
    const draftItems = [
      'Bring the webhook payload to parity with the delivery DTO: the dispatcher currently sends only the summary, so add the normalized report fields the docs promise.',
      'Match the remaining 60 unassigned Cooperativ Labs, Inc. journal moves to vendors; the memo-text pass covered OpenAI, Stratechery, Everhour, and Medium, and the rest need manual matching.'
    ];
    assert.deepEqual(reconcileDeferredWork({ agentItems, draftItems }), draftItems);
  });

  it('keeps the agent text for any item the draft made shorter', () => {
    const draftItems = ['Webhook parity', agentItems[1]! + ' They belong to Cooperativ Labs, Inc.'];
    assert.deepEqual(reconcileDeferredWork({ agentItems, draftItems }), [
      agentItems[0],
      draftItems[1]
    ]);
  });

  it('keeps the whole agent list when the draft drops items', () => {
    assert.deepEqual(
      reconcileDeferredWork({
        agentItems,
        draftItems: ['One merged and much longer item covering both.']
      }),
      agentItems
    );
  });

  it('keeps extra draft items the summary surfaced and bounds the total', () => {
    const extra =
      'Fix the date-dependent employee lifecycle test that failed before this delivery.';
    assert.deepEqual(reconcileDeferredWork({ agentItems, draftItems: [...agentItems, extra] }), [
      ...agentItems,
      extra
    ]);
    const many = Array.from({ length: 15 }, (_, index) => `Deferred item ${index + 1}`);
    assert.equal(reconcileDeferredWork({ agentItems: [], draftItems: many }).length, 12);
  });

  it('applies the guard inside reconcileDeliveryComposeDraft', () => {
    const report = baseReport();
    const shortened = reconcileDeliveryComposeDraft({
      report,
      draft: { markdown: 'x', deferredWork: ['Parity'] }
    });
    assert.deepEqual(shortened.deferredWork, ['Webhook full-payload parity']);

    const enriched = reconcileDeliveryComposeDraft({
      report,
      draft: {
        markdown: 'x',
        deferredWork: [
          'Bring webhook payloads to full parity with the delivery DTO so consumers receive the normalized report fields.'
        ]
      }
    });
    assert.deepEqual(enriched.deferredWork, [
      'Bring webhook payloads to full parity with the delivery DTO so consumers receive the normalized report fields.'
    ]);
  });
});

describe('deferred-work eligibility', () => {
  it('keeps an out-of-scope bug that does not restate planned or current work', () => {
    assert.deepEqual(
      filterDeferredWork({
        items: [
          'Investigate the race in webhook-dispatcher.ts that dropped a retry while composing deliveries; left because it belongs outside this enrichment work.'
        ],
        currentObjective: {
          title: 'Enrich deferred work',
          instruction: 'Rewrite sparse deferred-work items into standalone objective statements.'
        },
        plannedObjectives: [
          {
            title: 'Stable rail ids',
            instruction:
              'Give Feed rail deferred-work items an identifier that survives composition.'
          }
        ]
      }),
      [
        'Investigate the race in webhook-dispatcher.ts that dropped a retry while composing deliveries; left because it belongs outside this enrichment work.'
      ]
    );
  });

  it('drops items that restate a planned future objective', () => {
    assert.deepEqual(
      filterDeferredWork({
        items: [
          'Implement the CSV export API for the reports page.',
          'Fix the date-dependent employee lifecycle test that failed in payroll.'
        ],
        plannedObjectives: [
          {
            title: 'CSV export API',
            instruction:
              'Implement the CSV export API for the reports page so operators can download filtered rows.'
          }
        ]
      }),
      ['Fix the date-dependent employee lifecycle test that failed in payroll.']
    );
  });

  it('drops items that restate a human action or leftover current-objective work', () => {
    assert.deepEqual(
      filterDeferredWork({
        items: [
          'Add GEMINI_API_KEY to the production backend service on Railway.',
          'Finish remaining form validation on the settings page.',
          'Investigate the payroll timezone bug found in employee-lifecycle.ts; left because it is outside this settings work.'
        ],
        currentObjective: {
          title: 'Settings validation',
          instruction:
            'Add form validation to the settings page including email and password fields.'
        },
        humanActions: [
          {
            action: 'Add GEMINI_API_KEY to the production backend service on Railway.',
            reason: 'Composition needs a provider credential.'
          }
        ]
      }),
      [
        'Investigate the payroll timezone bug found in employee-lifecycle.ts; left because it is outside this settings work.'
      ]
    );
  });

  it('applies eligibility to presentation without rewriting agentReport', () => {
    const report = applyDeferredWorkEligibility({
      report: buildDeliveryReport({
        summary: 'Shipped.',
        deliveryReport: {
          schemaVersion: 1,
          agentReport: {
            deferredWork: [
              'Implement the CSV export API for reports.',
              'Fix the date-dependent employee lifecycle test that failed in payroll.'
            ]
          }
        }
      }),
      plannedObjectives: [
        {
          title: 'CSV export API',
          instruction: 'Implement the CSV export API for the reports page.'
        }
      ]
    });
    assert.deepEqual(report.agentReport.deferredWork, [
      'Implement the CSV export API for reports.',
      'Fix the date-dependent employee lifecycle test that failed in payroll.'
    ]);
    assert.deepEqual(report.presentation.deferredWork, [
      'Fix the date-dependent employee lifecycle test that failed in payroll.'
    ]);
  });

  it('drops ineligible extras from a compose draft while keeping eligible rewrites', () => {
    const report = buildDeliveryReport({
      summary: 'Shipped.',
      deliveryReport: {
        schemaVersion: 1,
        agentReport: {
          deferredWork: ['Fix the date-dependent employee lifecycle test that failed in payroll.']
        }
      }
    });
    const presentation = reconcileDeliveryComposeDraft({
      report,
      draft: {
        markdown: 'x',
        deferredWork: [
          'Fix the date-dependent employee lifecycle test that failed in payroll before the next close; the previous run broke when the fixture clock crossed a month boundary.',
          'Implement the CSV export API for the reports page.'
        ]
      },
      plannedObjectives: [
        {
          title: 'CSV export API',
          instruction: 'Implement the CSV export API for the reports page.'
        }
      ]
    });
    assert.deepEqual(presentation.deferredWork, [
      'Fix the date-dependent employee lifecycle test that failed in payroll before the next close; the previous run broke when the fixture clock crossed a month boundary.'
    ]);
  });

  it('matches a presentation rewrite to its original agent index after an earlier item was dropped', () => {
    const usedIndexes = new Set<number>();
    const agentItems = [
      'Implement the CSV export API for reports.',
      'Fix the date-dependent employee lifecycle test that failed in payroll.'
    ];
    const matched = matchDeferredWorkAgentIndex({
      presentationItem:
        'Fix the date-dependent employee lifecycle test that failed in payroll before the next close.',
      agentItems,
      usedIndexes
    });
    assert.equal(matched, 1);
  });
});
