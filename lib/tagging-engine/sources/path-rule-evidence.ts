import { OVERLORD_TAG_RULES, TAG_SCORE_WEIGHTS } from '../constants';
import type { TagEvidence, TaggingSource } from '../types';

/**
 * For each path, evaluate every rule (path × rule). Keeps execution and
 * description tagging aligned and avoids duplicating prefix/exact matching.
 */
export function collectPathRuleEvidence({
  paths,
  source,
  exactPathSignal,
  prefixPathSignal
}: {
  paths: string[];
  source: TaggingSource;
  exactPathSignal: (args: { path: string }) => string;
  prefixPathSignal: (args: { path: string; prefix: string }) => string;
}): TagEvidence[] {
  const evidence: TagEvidence[] = [];

  for (const path of paths) {
    for (const rule of OVERLORD_TAG_RULES) {
      if (rule.exactPaths.includes(path)) {
        evidence.push({
          tagKey: rule.key,
          source,
          kind: 'path_match',
          weight: TAG_SCORE_WEIGHTS.explicitPathMatch,
          signal: exactPathSignal({ path }),
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
        source,
        kind: 'path_prefix_match',
        weight: TAG_SCORE_WEIGHTS.explicitPathMatch,
        signal: prefixPathSignal({ path, prefix }),
        metadata: { path, prefix }
      });
    }
  }

  return evidence;
}
