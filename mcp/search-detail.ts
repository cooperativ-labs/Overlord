function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reduces a v3 MCP search response without losing child navigation identity. */
export function compactSearchResponse(value: unknown): unknown {
  if (!isRecord(value) || value.version !== 3 || !Array.isArray(value.results)) return value;
  return {
    ...value,
    results: value.results.map(result => {
      if (!isRecord(result) || !Array.isArray(result.matches)) return result;
      return {
        ...result,
        matches: result.matches.slice(0, 2).map(match => {
          if (!isRecord(match)) return match;
          const compact = { ...match };
          delete compact.snippet;
          delete compact.matchedTerms;
          delete compact.createdAt;
          delete compact.updatedAt;
          return compact;
        })
      };
    })
  };
}
