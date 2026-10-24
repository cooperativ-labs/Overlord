import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildDeliveryReport,
  isValidHumanActionLink,
  readDeliveryReport
} from './delivery-report.js';

function build(humanActions: unknown) {
  return buildDeliveryReport({
    summary: 'Delivered.',
    deliveryReport: { schemaVersion: 1, agentReport: { humanActions } }
  });
}

describe('delivery-report human action normalization (contract v137)', () => {
  it('carries command, verify, and link through to the normalized action', () => {
    const report = build([
      {
        action: 'Set GEMINI_API_KEY in the production environment.',
        reason: 'The compose worker needs a provider credential.',
        category: 'environment',
        blocking: true,
        command: 'railway variables set GEMINI_API_KEY=<key> --service backend',
        verify: 'The next delivery composes instead of falling back.',
        link: 'https://railway.app/project/overlord/service/backend/variables'
      }
    ]);
    const [action] = report.agentReport.humanActions;
    assert.ok(action);
    assert.equal(action.id, 'human-action-1');
    assert.equal(action.command, 'railway variables set GEMINI_API_KEY=<key> --service backend');
    assert.equal(action.verify, 'The next delivery composes instead of falling back.');
    assert.equal(action.link, 'https://railway.app/project/overlord/service/backend/variables');
    assert.equal(action.source, 'agent');
    assert.deepEqual(report.presentation.humanActions, report.agentReport.humanActions);
    assert.equal(report.warnings, undefined);
  });

  it('omits the optional fields entirely when the agent leaves them out', () => {
    const report = build([{ action: 'Rotate the webhook secret.', category: 'external_service' }]);
    const [action] = report.agentReport.humanActions;
    assert.ok(action);
    assert.equal('command' in action, false);
    assert.equal('verify' in action, false);
    assert.equal('link' in action, false);
  });

  it('accepts a repository-relative path as a link', () => {
    const report = build([
      {
        action: 'Apply the new migration.',
        category: 'database',
        link: 'database/sqlite/migrations/20260907_human_actions.sql'
      }
    ]);
    assert.equal(
      report.agentReport.humanActions[0]?.link,
      'database/sqlite/migrations/20260907_human_actions.sql'
    );
  });

  it('discards an action whose link uses a non-HTTP scheme, with a warning', () => {
    const report = build([
      { action: 'Open the runbook.', category: 'other', link: 'javascript:alert(1)' },
      { action: 'Set the flag.', category: 'environment' }
    ]);
    assert.equal(report.agentReport.humanActions.length, 1);
    assert.equal(report.agentReport.humanActions[0]?.action, 'Set the flag.');
    assert.equal(report.warnings?.length, 1);
    assert.match(report.warnings?.[0] ?? '', /humanActions\[0\]/);
  });

  it('discards an action whose command or verify is empty or over the bound', () => {
    const report = build([
      { action: 'Run it.', category: 'other', command: '   ' },
      { action: 'Check it.', category: 'other', verify: 'x'.repeat(801) },
      { action: 'Keep me.', category: 'other', command: 'yarn install' }
    ]);
    assert.deepEqual(
      report.agentReport.humanActions.map(action => action.action),
      ['Keep me.']
    );
    assert.equal(report.warnings?.length, 2);
  });

  it('round-trips a persisted report that carries the new fields', () => {
    const built = build([
      {
        action: 'Redeploy the gateway.',
        category: 'deployment',
        command: 'railway up --service gateway',
        verify: 'GET /healthz returns the new build id.',
        link: 'infra/railway.toml'
      }
    ]);
    const read = readDeliveryReport({ summary: 'Delivered.', deliveryReport: built });
    assert.deepEqual(read, built);
  });

  it('validates links with the same rule the reconciler uses', () => {
    assert.equal(isValidHumanActionLink('https://example.com/x?y=1'), true);
    assert.equal(isValidHumanActionLink('http://localhost:4320/feed'), true);
    assert.equal(isValidHumanActionLink('.env.example'), true);
    assert.equal(isValidHumanActionLink('.github/workflows/ci.yml'), true);
    assert.equal(isValidHumanActionLink('ftp://example.com/x'), false);
    assert.equal(isValidHumanActionLink('javascript:alert(1)'), false);
    assert.equal(isValidHumanActionLink('has space.sql'), false);
    assert.equal(isValidHumanActionLink(''), false);
  });
});

describe('delivery-report provenance (contract v165)', () => {
  it('admits only agent and deterministic_rule item sources', () => {
    const built = buildDeliveryReport({
      summary: 'Delivered.',
      deliveryReport: {
        schemaVersion: 1,
        agentReport: {
          tradeoffsMade: [{ decision: 'Keep the worker', rationale: 'It survives restarts.' }]
        }
      }
    });
    assert.equal(
      readDeliveryReport({ summary: 'Delivered.', deliveryReport: built }).presentation.tradeoffsMade
        .length,
      1
    );

    // A retired per-file rationale item no longer parses; the one-time
    // 20261024130000 migration strips such items from stored reports.
    const retired = {
      ...built,
      presentation: {
        ...built.presentation,
        status: 'composed',
        tradeoffsMade: [
          ...built.presentation.tradeoffsMade,
          {
            id: 'rationale-1',
            decision: 'Add backoff',
            alternativesConsidered: [],
            rationale: 'Transient failures.',
            source: 'change_rationale',
            sourceRef: 'lib/api.ts'
          }
        ]
      }
    };
    const read = readDeliveryReport({ summary: 'Delivered.', deliveryReport: retired });
    assert.equal(read.presentation.status, 'deterministic');
    assert.ok(read.presentation.tradeoffsMade.every(item => item.source === 'agent'));
  });
});
