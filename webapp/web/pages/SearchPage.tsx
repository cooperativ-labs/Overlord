import type { SearchResponseV3 } from '@overlord/contract';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  flattenSearchRows,
  SearchCompletenessNotice,
  searchDestination,
  SearchResultRowContent
} from '@/components/search/search-presentation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

export function SearchPage() {
  const navigate = useNavigate({ from: '/search' });
  const search = useSearch({ from: '/search' });
  const [query, setQuery] = useState(search.q ?? '');
  const [response, setResponse] = useState<SearchResponseV3 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [expandedMissionIds, setExpandedMissionIds] = useState<Set<string>>(() => new Set());

  useEffect(() => setQuery(search.q ?? ''), [search.q]);

  useEffect(() => {
    const trimmed = search.q?.trim();
    if (!trimmed) {
      setResponse(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    let current = true;
    setIsLoading(true);
    setError(null);
    void api
      .searchMissionsV3(trimmed, { limit: 25, matchesPerResult: 10 })
      .then(result => {
        if (current) setResponse(result);
      })
      .catch(reason => {
        if (current)
          setError(reason instanceof Error ? reason.message : 'Search could not be completed.');
      })
      .finally(() => {
        if (current) setIsLoading(false);
      });
    return () => {
      current = false;
    };
  }, [search.q, retryCount]);

  const rows = useMemo(
    () => flattenSearchRows(response?.results ?? [], { childLimit: 2, expandedMissionIds }),
    [response?.results, expandedMissionIds]
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void navigate({ to: '/search', search: query.trim() ? { q: query.trim() } : {} });
  };

  const toggleMission = (missionId: string) => {
    setExpandedMissionIds(previous => {
      const next = new Set(previous);
      if (next.has(missionId)) next.delete(missionId);
      else next.add(missionId);
      return next;
    });
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">Search</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Find mission evidence, matching objectives, and delivery summaries.
          </p>
        </header>
        <form onSubmit={submit} className="flex gap-2">
          <Input
            autoFocus
            aria-label="Search missions, objectives, and deliveries"
            placeholder="Search missions, objectives, and deliveries…"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <Button type="submit" aria-label="Run search">
            <Search className="size-4" />
            Search
          </Button>
        </form>

        {!search.q && (
          <p className="mt-8 text-sm text-muted-foreground">
            Enter a query to search across your accessible work.
          </p>
        )}
        {isLoading && <p className="mt-8 text-sm text-muted-foreground">Searching…</p>}
        {error && (
          <div
            role="alert"
            className="mt-8 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
          >
            <p>Search could not be completed. {error}</p>
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => setRetryCount(count => count + 1)}
            >
              Try again
            </Button>
          </div>
        )}
        {response && !isLoading && !error && (
          <section className="mt-6" aria-label="Search results">
            <SearchCompletenessNotice
              returned={response.results.length}
              totalMatchedBeforeLimit={response.totalMatchedBeforeLimit}
              truncatedCandidates={response.truncatedCandidates}
            />
            {response.appliedFilters.mode === 'fallback' && (
              <p className="mt-2 text-sm text-muted-foreground">
                No meaningful search terms were supplied, so these are fallback results.
              </p>
            )}
            {response.results.length === 0 ? (
              <p className="mt-8 text-sm text-muted-foreground">
                No missions or child matches found.
              </p>
            ) : (
              <ol className="mt-4 space-y-3">
                {rows.map(row => {
                  const destination = searchDestination(
                    row.mission,
                    row.kind === 'match' ? row.match : undefined
                  );
                  return (
                    <li key={row.key} className="rounded-xl border bg-card p-4 shadow-sm">
                      <button
                        type="button"
                        className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Open ${row.kind === 'match' ? row.match.entityType : 'mission'} ${row.kind === 'match' ? row.match.title : row.mission.title}`}
                        onClick={() => void navigate(destination)}
                      >
                        <SearchResultRowContent row={row} />
                      </button>
                      {row.kind === 'mission' && row.mission.matches.length > 2 && (
                        <Button
                          className="mt-3"
                          size="sm"
                          variant="ghost"
                          aria-expanded={expandedMissionIds.has(row.mission.id)}
                          onClick={() => toggleMission(row.mission.id)}
                        >
                          {expandedMissionIds.has(row.mission.id)
                            ? 'Show fewer matches'
                            : `Show ${Math.min(row.mission.matches.length, row.mission.matchCounts.objective + row.mission.matchCounts.delivery) - 2} more matches`}
                        </Button>
                      )}
                      {row.kind === 'mission' &&
                        row.mission.matchCounts.objective + row.mission.matchCounts.delivery >
                          row.mission.matches.length && (
                          <p className="mt-3 text-xs text-muted-foreground">
                            Only the top {row.mission.matches.length} child matches are available
                            for this mission.
                          </p>
                        )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
