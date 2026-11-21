import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

// coo:1325.2dp2: a Codex installation reports its live `model/list`, and the workspace's Codex
// picker offers exactly those models and efforts instead of the bundled guesses.
describe('agent catalog live models', () => {
  it('merges a live report, keeps workspace choices, and survives refresh and replace', async () => {
    const dir = mkdtempSync(path.join('/tmp', 'ovld-agent-catalog-live-'));
    const { bootstrapIntegrationTestDb, seedAuthenticatedOperator } =
      await import('./test-helpers.ts');
    const { WORKSPACE, db, setActiveWorkspaceUser, operatorWorkspaceUserId } =
      await bootstrapIntegrationTestDb({ sqlitePath: path.join(dir, 'Overlord.sqlite') });
    const workspaceId = WORKSPACE.id;
    const { getAgentCatalog, updateAgentCatalog, refreshAgentCatalog, reportAgentLiveModels } =
      await import('./agent-catalog.ts');
    const { BUNDLED_AGENT_CATALOG } = await import('../cli/src/agent-catalog-defaults.ts');
    const { ApiError } = await import('./errors.ts');

    // The workspace turned one bundled model off and picked a default the installation still has.
    const seeded = await getAgentCatalog(workspaceId);
    const codexSeed = seeded.agents.find(agent => agent.key === 'codex');
    assert.ok(codexSeed);
    assert.equal(codexSeed.liveSource, undefined);
    await updateAgentCatalog(
      {
        agents: seeded.agents.map(agent =>
          agent.key === 'codex'
            ? {
                ...agent,
                label: 'Codex (team)',
                defaultModel: 'gpt-6-luna',
                defaultReasoningEffort: 'high',
                models: agent.models.map(model =>
                  model.id === 'gpt-6-luna' ? { ...model, enabled: false } : model
                )
              }
            : agent
        )
      },
      workspaceId
    );

    const report = {
      agent: 'codex',
      harnessVersion: '0.171.0',
      models: [
        {
          id: 'gpt-6.2-sol',
          displayName: 'GPT-6.2-Sol',
          reasoningOptions: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
          isDefault: true,
          defaultReasoningEffort: 'low'
        },
        {
          id: 'gpt-6-luna',
          displayName: 'GPT-6-Luna',
          reasoningOptions: ['low', 'medium', 'high', ' ', 'max'],
          isDefault: false,
          defaultReasoningEffort: 'ultra'
        }
      ]
    };
    const merged = await reportAgentLiveModels(report, workspaceId);
    const codex = merged.agents.find(agent => agent.key === 'codex');
    assert.ok(codex);
    assert.equal(codex.label, 'Codex (team)', 'the workspace label survives');
    assert.deepEqual(
      codex.models,
      [
        {
          id: 'gpt-6.2-sol',
          displayName: 'GPT-6.2-Sol',
          reasoningOptions: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
          enabled: true
        },
        {
          id: 'gpt-6-luna',
          displayName: 'GPT-6-Luna',
          reasoningOptions: ['low', 'medium', 'high', 'max'],
          enabled: false
        }
      ],
      'bundled models the installation does not list are dropped; the off switch survives'
    );
    assert.equal(codex.defaultModel, 'gpt-6-luna', 'a still-supported default survives');
    assert.equal(codex.defaultReasoningEffort, 'high');
    assert.equal(codex.liveSource?.harnessVersion, '0.171.0');
    assert.ok(codex.liveSource?.reportedAt);
    assert.deepEqual(
      merged.agents.find(agent => agent.key === 'claude')?.models.map(model => model.id),
      seeded.agents.find(agent => agent.key === 'claude')?.models.map(model => model.id),
      'other agents are untouched'
    );

    // "Merge bundled defaults" must not bring the hard-coded Codex models back.
    const refreshed = await refreshAgentCatalog(workspaceId);
    assert.deepEqual(
      refreshed.agents.find(agent => agent.key === 'codex')?.models.map(model => model.id),
      ['gpt-6.2-sol', 'gpt-6-luna']
    );

    // A full replace from the settings page keeps the live source.
    const replaced = await updateAgentCatalog({ agents: refreshed.agents }, workspaceId);
    assert.equal(
      replaced.agents.find(agent => agent.key === 'codex')?.liveSource?.harnessVersion,
      '0.171.0'
    );

    // A default the installation dropped falls back to its own default model and effort.
    const second = await reportAgentLiveModels(
      {
        agent: 'codex',
        harnessVersion: null,
        models: [
          { id: 'gpt-7-sol', reasoningOptions: ['low', 'max'], defaultReasoningEffort: 'max' },
          { id: 'gpt-7-luna', isDefault: true, reasoningOptions: ['medium'] }
        ]
      },
      workspaceId
    );
    const codexSecond = second.agents.find(agent => agent.key === 'codex');
    assert.equal(codexSecond?.defaultModel, 'gpt-7-luna');
    assert.equal(codexSecond?.defaultReasoningEffort, null);
    assert.equal(codexSecond?.models[0]?.displayName, 'gpt-7-sol');
    assert.equal(codexSecond?.liveSource?.harnessVersion, null);

    // Validation.
    for (const body of [
      { agent: 'codex', models: [] },
      { agent: ' ', models: [{ id: 'x' }] },
      { agent: 'codex', models: [{ id: 'x' }, { id: 'x' }] },
      { agent: 'codex', models: [{ id: 42 }] },
      { agent: 'no-such-agent', models: [{ id: 'x' }] }
    ]) {
      await assert.rejects(
        reportAgentLiveModels(body as never, workspaceId),
        (err: unknown) => err instanceof ApiError && err.status === 400
      );
    }

    // The catalog is shared, so an account without launch:configure cannot overwrite it.
    seedAuthenticatedOperator({
      db,
      workspaceId,
      profileId: 'live-models-viewer',
      workspaceUserId: 'live-models-viewer-workspace-user'
    });
    db.prepare(`UPDATE role_assignments SET role_key = 'PUBLIC' WHERE workspace_user_id = ?`).run(
      'live-models-viewer-workspace-user'
    );
    setActiveWorkspaceUser('live-models-viewer-workspace-user');
    await assert.rejects(
      reportAgentLiveModels(report, workspaceId),
      (err: unknown) => err instanceof ApiError && (err.status === 403 || err.status === 404)
    );
    setActiveWorkspaceUser(operatorWorkspaceUserId);

    assert.ok(BUNDLED_AGENT_CATALOG.codex, 'the bundled fallback is still shipped');
  });
});
