import { DEFAULT_TAG_THRESHOLD, OVERLORD_DEFAULT_TAG_DEFINITIONS } from './constants';
import type { TagEvidence, TaggingEngineResult, TagScore } from './types';

function compareEvidence(a: TagEvidence, b: TagEvidence): number {
  if (b.weight !== a.weight) return b.weight - a.weight;
  return a.signal.localeCompare(b.signal);
}

export function scoreTagEvidence(
  evidence: TagEvidence[],
  options?: { threshold?: number; consideredPaths?: string[]; consideredCommands?: string[] }
): TaggingEngineResult {
  const threshold = options?.threshold ?? DEFAULT_TAG_THRESHOLD;
  const byKey = new Map<string, TagEvidence[]>();

  for (const item of evidence) {
    const group = byKey.get(item.tagKey) ?? [];
    group.push(item);
    byKey.set(item.tagKey, group);
  }

  const scores: TagScore[] = OVERLORD_DEFAULT_TAG_DEFINITIONS.map(definition => {
    const tagEvidence = (byKey.get(definition.key) ?? []).sort(compareEvidence);
    const total = tagEvidence.reduce((sum, item) => sum + item.weight, 0);
    return {
      tagKey: definition.key,
      label: definition.label,
      total,
      evidence: tagEvidence,
      matched: total >= threshold
    };
  }).sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.tagKey.localeCompare(b.tagKey);
  });

  return {
    matchedTags: scores
      .filter(score => score.matched)
      .map(score => {
        const definition = OVERLORD_DEFAULT_TAG_DEFINITIONS.find(item => item.key === score.tagKey);
        return definition ?? { key: score.tagKey, label: score.label };
      }),
    scores,
    evidence: [...evidence].sort(compareEvidence),
    debug: {
      threshold,
      scores,
      consideredPaths: [...new Set(options?.consideredPaths ?? [])].sort(),
      consideredCommands: [...new Set(options?.consideredCommands ?? [])].sort()
    }
  };
}
