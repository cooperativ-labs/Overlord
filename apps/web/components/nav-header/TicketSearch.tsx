'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { cn } from '@/lib/utils';

type TicketSearchResult = {
  id: string;
  title: string | null;
  ticket_sequence: number | null;
  project_id: string | null;
  project: {
    name: string | null;
  } | null;
};

type TicketSearchProps = {
  className?: string;
};

export function TicketSearch({ className }: TicketSearchProps) {
  const router = useRouter();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TicketSearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [searchShortcutHint, setSearchShortcutHint] = useState('⌘F');
  const [backShortcutHint, setBackShortcutHint] = useState('⌥←');

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

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/tickets/search?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error('Ticket search failed.');
        }
        const data = await response.json();
        const tickets = Array.isArray(data?.tickets) ? data.tickets : [];
        setResults(tickets);
        setIsOpen(tickets.length > 0);
        setActiveIndex(0);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error(error);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 240);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [query]);

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
        router.back();
      }
    };

    window.addEventListener('keydown', handleGlobalHotkeys);
    return () => window.removeEventListener('keydown', handleGlobalHotkeys);
  }, [router]);

  const selectTicket = (ticket: TicketSearchResult) => {
    if (!ticket.project_id) {
      return;
    }
    const path = buildProjectPath({ projectId: ticket.project_id });
    router.push(`${path}/${ticket.id}`);
    setQuery('');
    setResults([]);
    setIsOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(prev => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter' && isOpen) {
      event.preventDefault();
      selectTicket(results[activeIndex]);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label="Go back"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Go back ({backShortcutHint})</TooltipContent>
      </Tooltip>
      <div ref={containerRef} className="relative min-w-0 flex-1">
        <div className="relative">
          <Input
            ref={inputRef}
            placeholder="Search tickets…"
            value={query}
            onChange={event => setQuery(event.target.value)}
            className={cn(
              'w-full pr-10 rounded-lg shadow-sm focus:shadow-lg focus:scale-105 transition-height transition-shadow duration-200 ease-in-out'
            )}
            role="combobox"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-autocomplete="list"
            onKeyDown={handleKeyDown}
          />
          {!isLoading && (
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {searchShortcutHint}
            </kbd>
          )}
          {isLoading && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              Loading…
            </span>
          )}
        </div>
        {isOpen && results.length > 0 && (
          <ul
            role="listbox"
            id={listboxId}
            className="absolute left-0 top-full mt-6 z-20 w-full overflow-hidden rounded-xl border border-border bg-card shadow-xl scale-105"
          >
            {results.map((ticket, index) => {
              const isActive = index === activeIndex;
              return (
                <li
                  key={ticket.id}
                  role="option"
                  aria-selected={isActive}
                  className={`px-4 py-3 transition hover:bg-muted/90 ${
                    isActive ? 'bg-primary/10' : 'bg-card'
                  }`}
                  onMouseDown={() => selectTicket(ticket)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <p className="text-sm font-medium text-foreground truncate">
                    {ticket.title || 'Untitled ticket'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ticket.ticket_sequence
                      ? `#${ticket.ticket_sequence}`
                      : getTicketIdentifier(ticket.id)}{' '}
                    • {ticket.project?.name ?? 'Unknown project'}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
