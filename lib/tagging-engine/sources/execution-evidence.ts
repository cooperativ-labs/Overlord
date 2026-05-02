import { OVERLORD_TAG_RULES, TAG_SCORE_WEIGHTS } from '../constants';
import type { ExecutionEvidenceInput, TagEvidence } from '../types';

import { extractExplicitPaths } from './description';

function normalizePath(value: string): string {
  return value.replace(/^\.?\//, '').replace(/\/+$/, '');
}

function normalizeCommand(value: string): string {
  return value.trim();
}

export function collectExecutionEvidence(input: ExecutionEvidenceInput | null | undefined): {
  evidence: TagEvidence[];
  consideredCommands: string[];
  consideredPaths: string[];
} {
  if (!input) {
    return { evidence: [], consideredCommands: [], consideredPaths: [] };
  }

  const evidence: TagEvidence[] = [];
  const fileChanges = (input.fileChanges ?? []).filter(change => change.filePath.trim().length > 0);
  const commands = [...new Set((input.commands ?? []).map(normalizeCommand).filter(Boolean))];
  const paths = [
    ...new Set(
      [
        ...(input.changedPaths ?? []),
        ...fileChanges.map(change => change.filePath),
        ...extractExplicitPaths({ extraText: commands })
      ]
        .map(normalizePath)
        .filter(Boolean)
    )
  ];
  const metadataHaystack = [
    ...commands,
    ...fileChanges.flatMap(change =>
      [change.label, change.summary, change.why, change.impact]
        .map(value => value?.trim() ?? '')
        .filter(Boolean)
    )
  ].join('\n');
  const loweredMetadataHaystack = metadataHaystack.toLowerCase();

  for (const path of paths) {
    for (const rule of OVERLORD_TAG_RULES) {
      if (rule.exactPaths.includes(path)) {
        evidence.push({
          tagKey: rule.key,
          source: 'execution-evidence',
          kind: 'path_match',
          weight: TAG_SCORE_WEIGHTS.explicitPathMatch,
          signal: `changed path ${path}`,
          metadata: { path }
        });
        continue;
      }

      const prefix = rule.pathPrefixes.find(
        candidate => path === candidate || path.startsWith(`${candidate}/`)
      );
      if (!prefix) continue;
      evidence.push({
        tagKey: rule.key,
        source: 'execution-evidence',
        kind: 'path_prefix_match',
        weight: TAG_SCORE_WEIGHTS.explicitPathMatch,
        signal: `changed path under ${prefix}`,
        metadata: { path, prefix }
      });
    }
  }

  for (const rule of OVERLORD_TAG_RULES) {
    for (const keyword of rule.keywords) {
      if (!loweredMetadataHaystack.includes(keyword.toLowerCase())) continue;
      evidence.push({
        tagKey: rule.key,
        source: 'execution-evidence',
        kind: 'keyword_match',
        weight: TAG_SCORE_WEIGHTS.strongKeywordHit,
        signal: `execution metadata keyword "${keyword}"`,
        metadata: { keyword }
      });
    }
  }

  return {
    evidence,
    consideredCommands: commands.sort(),
    consideredPaths: paths.sort()
  };
}
