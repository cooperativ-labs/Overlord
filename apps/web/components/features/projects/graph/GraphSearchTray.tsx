'use client';

import { Plus, Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { cn } from '@/lib/utils';

import { STATUS_TYPE_COLORS } from './types';

type SearchResult = {
  id: string;
  title: string | null;
  ticket_id: string | null;
  ticket_sequence: number | null;
  project_id: string | null;
  status: string | null;
  project: { name: string | null } | null;
};

interface GraphSearchTrayProps {
  projectId: string;
  selectedTicketIds: string[];
  ticketLabels?: Map<string, { shortId: string; title: string; statusType: string | null }>;
  onAddTicket: (ticketId: string) => void;
  onRemoveTicket: (ticketId: string) => void;
}

export function GraphSearchTray({
  projectId,
  selectedTicketIds,
  ticketLabels,
  onAddTicket,
  onRemoveTicket
}: GraphSearchTrayProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setIsOpen(false);
      setActiveIndex(0);
      abortRef.current?.abort();
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setIsLoading(true);
    const currentSelected = new Set(selectedTicketIds);

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/tickets/search?q=${encodeURIComponent(query.trim())}&projectId=${projectId}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error('Search failed');
        const data = await response.json();
        const tickets = Array.isArray(data?.tickets) ? data.tickets : [];
        setResults(tickets.filter((t: SearchResult) => !currentSelected.has(t.id)));
        setIsOpen(tickets.length > 0);
        setActiveIndex(0);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error(error);
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, 200);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [query, projectId, selectedTicketIds]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectResult = useCallback(
    (ticket: SearchResult) => {
      onAddTicket(ticket.id);
      setQuery('');
      setResults([]);
      setIsOpen(false);
    },
    [onAddTicket]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(prev => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter' && isOpen) {
      event.preventDefault();
      selectResult(results[activeIndex]);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 p-3 border-b bg-card/50">
      <div className="flex flex-wrap items-center gap-1.5">
        {selectedTicketIds.map(id => {
          const label = ticketLabels?.get(id);
          const borderColor = label?.statusType
            ? (STATUS_TYPE_COLORS[label.statusType] ?? '#64748b')
            : '#64748b';
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
              style={{ borderColor }}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: borderColor }}
              />
              <span className="font-mono text-[10px] text-muted-foreground">
                {label?.shortId ?? id.slice(0, 8)}
              </span>
              {label?.title && (
                <span className="max-w-[120px] truncate text-foreground">{label.title}</span>
              )}
              <button
                onClick={() => onRemoveTicket(id)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/10 hover:text-destructive transition-colors"
                aria-label={`Remove ticket ${label?.shortId ?? id.slice(0, 8)}`}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          );
        })}
      </div>

      <div ref={containerRef} className="relative">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            ref={inputRef}
            placeholder="Search tickets to add..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-8 h-8 text-sm"
            aria-label="Search tickets to add to graph"
            aria-expanded={isOpen}
            aria-controls={isOpen ? 'graph-search-results' : undefined}
            role="combobox"
            aria-autocomplete="list"
          />
          {isLoading && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
              ...
            </span>
          )}
        </div>
        {isOpen && results.length > 0 && (
          <ul
            id="graph-search-results"
            role="listbox"
            className="absolute left-0 top-full mt-1 z-30 w-full overflow-hidden rounded-lg border bg-card shadow-lg max-h-[240px] overflow-y-auto"
          >
            {results.map((ticket, index) => (
              <li
                key={ticket.id}
                role="option"
                aria-selected={index === activeIndex}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 cursor-pointer transition hover:bg-muted/90',
                  index === activeIndex && 'bg-primary/10'
                )}
                onMouseDown={() => selectResult(ticket)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <Plus className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{ticket.title || 'Untitled ticket'}</p>
                  <p className="text-[10px] text-muted-foreground">{getTicketIdentifier(ticket)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
