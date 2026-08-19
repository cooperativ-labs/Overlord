/**
 * Portable mission-search query parsing. Shared by SQLite and PostgreSQL so
 * stop words, display-id detection, and the term-coverage floor do not drift
 * between adapters.
 */

export type MissionSearchQueryMode = 'display_id' | 'any' | 'all' | 'phrase' | 'fallback';

export type ParsedMissionSearchQuery = {
  raw: string;
  mode: MissionSearchQueryMode;
  /** Mission display id when `mode === 'display_id'`. */
  displayId: string | null;
  /** Distinct meaningful terms (stop words removed, identifiers preserved). */
  terms: string[];
  coverageFloor: number | null;
};

/**
 * Small shared stoplist. PostgreSQL's `english` config already drops these;
 * SQLite FTS5 does not. Stripping them here keeps retrieval comparable.
 */
export const MISSION_SEARCH_STOP_WORDS = new Set([
  'a',
  'about',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'being',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'had',
  'has',
  'have',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'me',
  'my',
  'no',
  'not',
  'of',
  'on',
  'or',
  'our',
  'so',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'too',
  'us',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'will',
  'with',
  'would',
  'you',
  'your'
]);

const DISPLAY_ID_QUERY_RE = /^[a-z0-9-]+:\d+(?:\.[a-z0-9]+)?$/i;

const IDENTIFIER_RE = /[a-z0-9-]+:\d+(?:\.[a-z0-9]+)?/gi;

/**
 * Coverage floor: `min(3, max(1, ceil(termCount / 2)))`. Absolute, explainable,
 * and identical in both adapters. Not a raw bm25/ts_rank threshold.
 */
export function missionSearchCoverageFloor(termCount: number): number {
  if (termCount <= 0) return 0;
  return Math.min(3, Math.max(1, Math.ceil(termCount / 2)));
}

function uniquePreserve(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function tokenizeRemainder(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Parse free-form search input into a portable query plan.
 * A display-id-shaped query bypasses FTS. Quoted phrases stay intact; a small
 * stop-word list is dropped from unquoted tokens.
 */
export function parseMissionSearchQuery(query: string): ParsedMissionSearchQuery {
  const raw = query.trim();
  if (!raw) {
    return { raw, mode: 'fallback', displayId: null, terms: [], coverageFloor: null };
  }

  if (DISPLAY_ID_QUERY_RE.test(raw)) {
    const displayId = raw.replace(/\.[a-z0-9]+$/i, '');
    return { raw, mode: 'display_id', displayId, terms: [], coverageFloor: null };
  }

  const terms: string[] = [];
  const withoutIdentifiers = raw.replace(IDENTIFIER_RE, match => {
    terms.push(match.toLowerCase());
    return ' ';
  });

  const withoutPhrases = withoutIdentifiers.replace(/"([^"]+)"/g, (_match, phrase: string) => {
    const cleaned = phrase.trim().toLowerCase().replace(/\s+/g, ' ');
    if (cleaned) terms.push(cleaned);
    return ' ';
  });

  for (const token of tokenizeRemainder(withoutPhrases)) {
    if (MISSION_SEARCH_STOP_WORDS.has(token)) continue;
    terms.push(token);
  }

  const meaningful = uniquePreserve(terms);
  if (meaningful.length === 0) {
    return { raw, mode: 'fallback', displayId: null, terms: [], coverageFloor: null };
  }

  return {
    raw,
    mode: 'any',
    displayId: null,
    terms: meaningful,
    coverageFloor: missionSearchCoverageFloor(meaningful.length)
  };
}
