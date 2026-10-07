import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { OVERLORD_TOOL_DECLARATIONS } from '../../packages/core/service/chat/tools.ts';

import {
  capabilities,
  createToolManifest,
  expandedFamilies,
  initialFamilies,
  TOOL_FAMILIES,
  validToolManifest
} from './tool-manifest.ts';

const catalog = [
  ...OVERLORD_TOOL_DECLARATIONS,
  {
    name: 'kb_abc_list_workspaces',
    description: 'Discover notes',
    parameters: { type: 'object' as const }
  },
  { name: 'kb_abc_search', description: 'Search notes', parameters: { type: 'object' as const } },
  {
    name: 'kb_abc_edit_file',
    effect: 'write' as const,
    description: 'Edit authorized notes',
    parameters: { type: 'object' as const }
  },
  {
    name: 'overlord_find_feature_missions',
    description: 'Exhaustive lookup',
    parameters: { type: 'object' as const }
  }
];
describe('authorized relevance manifests', () => {
  it('selects families, unions cross-family requests and falls back on uncertainty', () => {
    assert.deepEqual(initialFamilies('What is the mission status?'), ['status']);
    assert.deepEqual(initialFamilies('Read the code and notes'), ['repository', 'knowledgebase']);
    assert.deepEqual(initialFamilies('Feature handoff'), ['feature']);
    assert.deepEqual(initialFamilies('Find something useful'), TOOL_FAMILIES);
    assert.deepEqual(initialFamilies('Continue that code investigation'), TOOL_FAMILIES);
    assert.deepEqual(initialFamilies('Read notes', true), ['knowledgebase']);
  });
  it('keeps discovery/question/proposal paths and stable ordering; expansion never adds an unauthorized tool', () => {
    const names = (families: Parameters<typeof createToolManifest>[1]) =>
      createToolManifest(catalog, families).declarations.map(d => d.name);
    const status = names(['status']);
    assert.ok(status.includes('ask_user') && status.includes('overlord_list_projects'));
    assert.ok(status.includes('prepare_proposal') && status.includes('kb_abc_list_workspaces'));
    assert.ok(!status.includes('repository_read') && !status.includes('kb_abc_edit_file'));
    assert.ok(names(['feature']).includes('overlord_find_feature_missions'));
    assert.ok(names(['feature']).includes('kb_abc_edit_file'));
    const noWrites = createToolManifest(
      catalog.filter(d => d.effect !== 'write'),
      expandedFamilies(['status'], ['all'])
    );
    assert.ok(!noWrites.declarations.some(d => d.effect === 'write'));
    assert.deepEqual(noWrites.families, TOOL_FAMILIES);
    assert.deepEqual(
      capabilities([]).flatMap(c => c.tools),
      []
    );
  });
  it('identifies exact historical schemas/effects and rejects corrupted manifests', () => {
    const m = createToolManifest(catalog, ['status']);
    assert.equal(validToolManifest(JSON.parse(JSON.stringify(m))), true);
    assert.equal(m.id, createToolManifest(catalog, ['status']).id);
    const reorder = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(reorder);
      if (v && typeof v === 'object')
        return Object.fromEntries(
          Object.entries(v)
            .reverse()
            .map(([k, item]) => [k, reorder(item)])
        );
      return v;
    };
    assert.ok(validToolManifest(reorder(m)), 'JSONB object-key normalization preserves identity');
    const changed = structuredClone(m);
    changed.declarations[0]!.description = 'changed';
    assert.equal(validToolManifest(changed), false);
    assert.notEqual(m.id, createToolManifest(catalog, ['repository']).id);
    assert.equal(validToolManifest({ ...m, families: ['invented'] }), false);
    assert.equal(
      validToolManifest({ ...m, declarations: [...m.declarations, m.declarations[0]] }),
      false
    );
    assert.deepEqual(expandedFamilies(['status'], ['repository']), ['status', 'repository']);
  });
});
