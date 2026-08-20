import type { MissionSearchDateField, SearchResponseV3, SearchResultV3 } from '@overlord/contract';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { useAllProjects } from '@/lib/queries';
import { cn } from '@/lib/utils';

import {
  flattenSearchRows,
  SearchCompletenessNotice,
  searchDestination,
  SearchResultRowContent,
  type VisibleSearchRow
} from '../search/search-presentation.tsx';

type MissionSearchProps = {
  className?: string;
};

/**
 * `none` is the default and is deliberately labelled "Date Range": picking a
 * concrete field is what opens the range inputs, so the neutral option reads as
 * the name of the control rather than as an "off" switch.
 */
type SearchDateFieldOption = 'none' | MissionSearchDateField;

function dateInputToIsoBound(value: string, endExclusive = false): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (endExclusive) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

/**
 * Global mission search bar. Debounces input, queries the shared search index via
 * GET /api/search/v3 and renders a one-child-per-mission compact projection.
 * ⌘F / Ctrl+F focuses it; ⌥← / Alt+← goes back.
 *
 * Filters, results, and status notices all live in one absolutely positioned
 * panel anchored below the input. Keeping them out of flow is load-bearing: the
 * NavHeader is a fixed `h-11` strip that centres its children, so anything that
 * grows the search column in flow re-centres it and pushes the input off the
 * top of the window.
 */
export function MissionSearch({ className }: MissionSearchProps) {
  const navigate = useNavigate();
  const router = useRouter();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultV3[]>([]);
  const [searchMeta, setSearchMeta] = useState<SearchResponseV3 | null>(null);
  const [projectId, setProjectId] = useState('');
  const [resourceKey, setResourceKey] = useState('');
  const [resources, setResources] = useState<string[]>([]);
  const [dateField, setDateField] = useState<SearchDateFieldOption>('none');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchShortcutHint, setSearchShortcutHint] = useState('⌘F');
  const [backShortcutHint, setBackShortcutHint] = useState('⌥←');

  const projects = useAllProjects();
  const hasDateFilter = dateField !== 'none' && Boolean(from || to);

  useEffect(() => {
    let isCurrent = true;
    if (!projectId) {
      setResources([]);
      setResourceKey('');
      return;
    }
    void api.listProjectResources(projectId).then(items => {
      if (isCurrent) setResources([...new Set(items.map(item => item.resourceKey))].sort());
    });
    return () => {
      isCurrent = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearchMeta(null);
      setIsOpen(false);
      setActiveIndex(0);
      setIsLoading(false);
      setSearchError(null);
      return;
    }

    let isCurrent = true;
    setIsLoading(true);
    setSearchError(null);

    const timeoutId = window.setTimeout(async () => {
      try {
        const data = await api.searchMissionsV3(query.trim(), {
          projectIds: projectId ? [projectId] : undefined,
          resourceKeys: resourceKey ? [resourceKey] : undefined,
          dateField: hasDateFilter ? dateField : undefined,
          from: hasDateFilter ? dateInputToIsoBound(from) : undefined,
          // The REST contract uses an exclusive upper bound; a calendar day is
          // therefore represented by the following midnight.
          to: hasDateFilter ? dateInputToIsoBound(to, true) : undefined,
          matchesPerResult: 1
        });
        if (!isCurrent) return;
        const missions = data.results;
        setResults(missions);
        setSearchMeta(data);
        setIsOpen(true);
        setActiveIndex(0);
      } catch (error) {
        if (isCurrent) {
          console.error(error);
          setSearchError(error instanceof Error ? error.message : 'Search could not be completed.');
          setIsOpen(true);
        }
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    }, 240);

    return () => {
      isCurrent = false;
      window.clearTimeout(timeoutId);
    };
  }, [query, projectId, resourceKey, dateField, from, to, hasDateFilter]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    setSearchShortcutHint(isMac ? '⌘F' : 'Ctrl+F');
    setBackShortcutHint(isMac ? '⌥←' : 'Alt+←');

    const handleGlobalHotkeys = (event: globalThis.KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key === 'f'
      ) {
        event.preventDefault();
        inputRef.current?.focus();
      } else if (event.altKey && !event.metaKey && !event.ctrlKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        router.history.back();
      }
    };

    window.addEventListener('keydown', handleGlobalHotkeys);
    return () => window.removeEventListener('keydown', handleGlobalHotkeys);
  }, [router]);

  const rows = useMemo(() => flattenSearchRows(results, { childLimit: 1 }), [results]);

  const selectRow = (row: VisibleSearchRow) => {
    void navigate(searchDestination(row.mission, row.kind === 'match' ? row.match : undefined));
    setQuery('');
    setResults([]);
    setIsOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!rows.length) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setActiveIndex(0);
      } else {
        setActiveIndex(prev => Math.min(prev + 1, rows.length - 1));
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setActiveIndex(rows.length - 1);
      } else {
        setActiveIndex(prev => Math.max(prev - 1, 0));
      }
    } else if (event.key === 'Enter' && isOpen) {
      event.preventDefault();
      const activeRow = rows[activeIndex];
      if (activeRow) selectRow(activeRow);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label="Go back"
              onClick={() => router.history.back()}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          }
        />
        <TooltipContent side="bottom">Go back ({backShortcutHint})</TooltipContent>
      </Tooltip>
      <div ref={containerRef} className="relative min-w-0 flex-1">
        <div className="relative">
          <Input
            ref={inputRef}
            placeholder="Search missions…"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onFocus={() => query.trim() && setIsOpen(true)}
            className="w-full rounded-lg pr-10 shadow-sm transition-shadow duration-200 ease-in-out focus:shadow-lg"
            role="combobox"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-activedescendant={
              isOpen && rows[activeIndex] ? `${listboxId}-${activeIndex}` : undefined
            }
            aria-autocomplete="list"
            onKeyDown={handleKeyDown}
          />
          {!isLoading && (
            <kbd className="pointer-events-none hidden md:block absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {searchShortcutHint}
            </kbd>
          )}
          {isLoading && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              Loading…
            </span>
          )}
        </div>
        {(isOpen || query.trim()) && (
          // The panel is deliberately wider than the input so the whole filter
          // row fits on one line; it is capped to the viewport so it can never
          // overflow on a narrow window.
          <div className="absolute left-0 top-full z-20 mt-2 flex max-h-[70vh] w-[44rem] min-w-full max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-card/95 shadow-xl backdrop-blur-md supports-backdrop-filter:bg-card/75">
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-2 text-xs">
              <select
                aria-label="Filter search by project"
                className="h-7 rounded border bg-background/70 px-1 text-xs"
                value={projectId}
                onChange={event => setProjectId(event.target.value)}
              >
                <option value="">All projects</option>
                {(projects.data ?? []).map(project => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter search by resource"
                className="h-7 rounded border bg-background/70 px-1 text-xs"
                value={resourceKey}
                disabled={!projectId}
                onChange={event => setResourceKey(event.target.value)}
              >
                <option value="">All resources</option>
                {resources.map(resource => (
                  <option key={resource} value={resource}>
                    {resource}
                  </option>
                ))}
              </select>
              <select
                aria-label="Date field"
                className="h-7 rounded border bg-background/70 px-1 text-xs"
                value={dateField}
                onChange={event => {
                  const next = event.target.value as SearchDateFieldOption;
                  setDateField(next);
                  if (next === 'none') {
                    setFrom('');
                    setTo('');
                  }
                }}
              >
                <option value="none">Date Range</option>
                <option value="createdAt">Created</option>
                <option value="updatedAt">Updated</option>
                <option value="dueDatetime">Due</option>
              </select>
              {dateField !== 'none' && (
                <>
                  <Input
                    aria-label="From date"
                    type="date"
                    className="h-7 w-32 rounded bg-background/70 text-xs"
                    value={from}
                    onChange={event => setFrom(event.target.value)}
                  />
                  <Input
                    aria-label="To date"
                    type="date"
                    className="h-7 w-32 rounded bg-background/70 text-xs"
                    value={to}
                    onChange={event => setTo(event.target.value)}
                  />
                </>
              )}
            </div>
            {isOpen && rows.length > 0 && (
              <ul role="listbox" id={listboxId} className="min-h-0 flex-1 overflow-y-auto">
                {rows.map((row, index) => {
                  const isActive = index === activeIndex;
                  return (
                    <li
                      key={row.key}
                      id={`${listboxId}-${index}`}
                      role="option"
                      aria-selected={isActive}
                      className={cn(
                        'px-4 py-3 transition hover:bg-muted/70',
                        isActive ? 'bg-primary/10' : 'bg-transparent'
                      )}
                      onMouseDown={() => selectRow(row)}
                      onMouseEnter={() => setActiveIndex(index)}
                    >
                      <SearchResultRowContent row={row} compact />
                    </li>
                  );
                })}
                <li className="border-t border-border/60 px-2 py-2">
                  <Button
                    className="w-full justify-start"
                    size="sm"
                    variant="ghost"
                    onMouseDown={() => {
                      void navigate({ to: '/search', search: { q: query.trim() } });
                      setIsOpen(false);
                    }}
                  >
                    View all results
                  </Button>
                </li>
              </ul>
            )}
            {isOpen && !isLoading && searchError && (
              <p
                role="alert"
                className="shrink-0 border-t border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
              >
                Search could not be completed. {searchError}
              </p>
            )}
            {isOpen && !isLoading && !searchError && searchMeta && rows.length === 0 && (
              <p className="shrink-0 px-3 py-2 text-xs text-muted-foreground">
                No matching missions, objectives, or deliveries.
              </p>
            )}
            {isOpen && searchMeta && (
              <div className="shrink-0 border-t border-border/60 px-3 py-2 text-xs [&_p]:text-xs">
                <SearchCompletenessNotice
                  returned={results.length}
                  totalMatchedBeforeLimit={searchMeta.totalMatchedBeforeLimit}
                  truncatedCandidates={searchMeta.truncatedCandidates}
                />
                {searchMeta.appliedFilters.mode === 'fallback' && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Showing fallback results because the query has no meaningful terms.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
