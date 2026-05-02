import { OVERLORD_TAG_RULES, TAG_SCORE_WEIGHTS } from '../constants';
import type { DescriptionSourceInput, TagEvidence } from '../types';

const PATH_TOKEN_RE =
  /(?:^|[\s`("'[])([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+(?:\.[A-Za-z0-9._-]+)?)/g;

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normalizePath(value: string): string {
  return value.replace(/^\.?\//, '').replace(/\/+$/, '');
}

function collectTextBlobs(input: DescriptionSourceInput): string[] {
  return [
    input.title,
    input.objective,
    input.description,
    input.acceptanceCriteria,
    ...(input.extraText ?? [])
  ]
    .map(normalizeText)
    .filter(Boolean);
}

export function extractExplicitPaths(input: DescriptionSourceInput): string[] {
  const found = new Set<string>((input.explicitPaths ?? []).map(normalizePath).filter(Boolean));

  for (const text of collectTextBlobs(input)) {
    for (const match of text.matchAll(PATH_TOKEN_RE)) {
      const candidate = normalizePath(match[1] ?? '');
      if (candidate.includes('/')) {
        found.add(candidate);
      }
    }
  }

  return [...found].sort();
}

export function collectDescriptionEvidence(input: DescriptionSourceInput): {
  evidence: TagEvidence[];
  explicitPaths: string[];
} {
  const evidence: TagEvidence[] = [];
  const explicitPaths = extractExplicitPaths(input);
  const blobs = collectTextBlobs(input);
  const haystack = blobs.join('\n').toLowerCase();

  for (const rule of OVERLORD_TAG_RULES) {
    for (const path of explicitPaths) {
      if (rule.exactPaths.includes(path)) {
        evidence.push({
          tagKey: rule.key,
          source: 'ticket-text',
          kind: 'path_match',
          weight: TAG_SCORE_WEIGHTS.explicitPathMatch,
          signal: `explicit path ${path}`,
          metadata: { path }
        });
        continue;
      }

      const prefix = rule.pathPrefixes.find(
        candidate => path === candidate || path.startsWith(`${candidate}/`)
      );
      if (prefix) {
        evidence.push({
          tagKey: rule.key,
          source: 'ticket-text',
          kind: 'path_prefix_match',
          weight: TAG_SCORE_WEIGHTS.explicitPathMatch,
          signal: `explicit path under ${prefix}`,
          metadata: { path, prefix }
        });
      }
    }

    for (const keyword of rule.keywords) {
      if (!haystack.includes(keyword.toLowerCase())) continue;
      evidence.push({
        tagKey: rule.key,
        source: 'ticket-text',
        kind: 'keyword_match',
        weight: TAG_SCORE_WEIGHTS.strongKeywordHit,
        signal: `keyword "${keyword}"`,
        metadata: { keyword }
      });
    }
  }

  return { evidence, explicitPaths };
}
