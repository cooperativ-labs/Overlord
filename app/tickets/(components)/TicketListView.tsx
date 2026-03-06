'use client';

import { ArrowUpDown, Check, Filter } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import {
  getOpenedReviewTimestamps,
  getOpenedWaitingTimestamps,
  getReviewRaisedWhileOpenMap,
  getWaitingRaisedWhileOpenMap,
  hasUnopenedTimestamp,
  markTicketReviewOpened,
  markTicketWaitingOpened,
  type TicketOpenedTimestamps,
  type TicketRaisedWhileOpenMap
} from '@/lib/helpers/ticket-waiting-response';

import type { Ticket } from './KanbanCard';
import TicketListCard from './TicketListCard';

type SortKey = 'updated_at' | 'status' | 'priority';

const SORT_LABELS: Record<SortKey, string> = {
  updated_at: 'Last updated',
  status: 'Status',
  priority: 'Priority'
};

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

function getPathTicketId(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? null;
}

export default function TicketListView({
  tickets,
  showOrganizationName = false,
  ticketUrlBase
}: {
  tickets: Ticket[];
  showOrganizationName?: boolean;
  ticketUrlBase?: string;
}) {
  const pathname = usePathname();

  const [sortKey, setSortKey] = useState<SortKey>('updated_at');
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterProject, setFilterProject] = useState<string | null>(null);

  const [openedWaitingTimestamps, setOpenedWaitingTimestamps] = useState<TicketOpenedTimestamps>(
    () => getOpenedWaitingTimestamps()
  );
  const [openedReviewTimestamps, setOpenedReviewTimestamps] = useState<TicketOpenedTimestamps>(() =>
    getOpenedReviewTimestamps()
  );
  const [waitingRaisedWhileOpen, setWaitingRaisedWhileOpen] = useState<TicketRaisedWhileOpenMap>(
    () => getWaitingRaisedWhileOpenMap()
  );
  const [reviewRaisedWhileOpen, setReviewRaisedWhileOpen] = useState<TicketRaisedWhileOpenMap>(() =>
    getReviewRaisedWhileOpenMap()
  );

  const ticketIdsRef = useRef<Set<string>>(new Set());
  ticketIdsRef.current = new Set(tickets.map(t => t.id));

  useEffect(() => {
    const pathTicketId = getPathTicketId(pathname);
    if (!pathTicketId || !ticketIdsRef.current.has(pathTicketId)) return;

    setOpenedWaitingTimestamps(markTicketWaitingOpened(pathTicketId));
    setOpenedReviewTimestamps(markTicketReviewOpened(pathTicketId));
    setWaitingRaisedWhileOpen(getWaitingRaisedWhileOpenMap());
    setReviewRaisedWhileOpen(getReviewRaisedWhileOpenMap());
  }, [pathname]);

  const ticketsWithIndicators = useMemo(
    () =>
      tickets.map(ticket => ({
        ...ticket,
        has_unopened_waiting_response:
          waitingRaisedWhileOpen[ticket.id] === true ||
          hasUnopenedTimestamp(ticket.waiting_for_response_at, openedWaitingTimestamps[ticket.id]),
        has_unopened_review:
          reviewRaisedWhileOpen[ticket.id] === true ||
          hasUnopenedTimestamp(ticket.review_entered_at, openedReviewTimestamps[ticket.id])
      })),
    [
      tickets,
      waitingRaisedWhileOpen,
      reviewRaisedWhileOpen,
      openedWaitingTimestamps,
      openedReviewTimestamps
    ]
  );

  const uniqueStatuses = useMemo(() => {
    const seen = new Set<string>();
    for (const t of tickets) seen.add(t.status);
    return [...seen].sort();
  }, [tickets]);

  const projectOptions = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: string | null }>();
    for (const t of tickets) {
      if (!seen.has(t.project_id)) {
        seen.set(t.project_id, {
          id: t.project_id,
          name: t.project_name ?? t.project_id,
          color: t.project_color ?? null
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tickets]);

  const sorted = useMemo(() => {
    let filtered = ticketsWithIndicators;
    if (filterStatus) filtered = filtered.filter(t => t.status === filterStatus);
    if (filterProject) filtered = filtered.filter(t => t.project_id === filterProject);

    return [...filtered].sort((a, b) => {
      if (sortKey === 'updated_at')
        return Date.parse(b.updated_at ?? '') - Date.parse(a.updated_at ?? '');
      if (sortKey === 'status') return a.status.localeCompare(b.status);
      if (sortKey === 'priority') {
        const ai = PRIORITY_ORDER.indexOf(a.priority);
        const bi = PRIORITY_ORDER.indexOf(b.priority);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      }
      return 0;
    });
  }, [ticketsWithIndicators, sortKey, filterStatus, filterProject]);

  if (!tickets.length) {
    return (
      <Card>
        <CardContent className="pt-6">No tickets yet. Create the first one.</CardContent>
      </Card>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <ArrowUpDown className="h-3.5 w-3.5" />
              {SORT_LABELS[sortKey]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(Object.keys(SORT_LABELS) as SortKey[]).map(key => (
              <DropdownMenuItem key={key} onClick={() => setSortKey(key)} className="gap-2">
                {SORT_LABELS[key]}
                {sortKey === key && <Check className="ml-auto h-4 w-4" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-3.5 w-3.5" />
              {filterStatus ?? 'All statuses'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setFilterStatus(null)} className="gap-2">
              All statuses
              {filterStatus === null && <Check className="ml-auto h-4 w-4" />}
            </DropdownMenuItem>
            {uniqueStatuses.map(status => (
              <DropdownMenuItem
                key={status}
                onClick={() => setFilterStatus(status)}
                className="gap-2"
              >
                {status}
                {filterStatus === status && <Check className="ml-auto h-4 w-4" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {projectOptions.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                {filterProject
                  ? (projectOptions.find(p => p.id === filterProject)?.name ?? 'Project')
                  : 'All projects'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>Filter by project</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setFilterProject(null)} className="gap-2">
                All projects
                {filterProject === null && <Check className="ml-auto h-4 w-4" />}
              </DropdownMenuItem>
              {projectOptions.map(p => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setFilterProject(p.id)}
                  className="gap-2"
                >
                  {p.color && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-[2px] border"
                      style={{ backgroundColor: p.color, borderColor: p.color }}
                    />
                  )}
                  <span className="truncate">{p.name}</span>
                  {filterProject === p.id && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Ticket rows */}
      <div className="min-h-0 flex-1 overflow-y-auto space-y-1">
        {sorted.map(ticket => {
          const ticketPath = ticketUrlBase
            ? `${ticketUrlBase}/${ticket.id}`
            : buildTicketPath({ projectId: ticket.project_id, ticketId: ticket.id });
          const isSelected = pathname === ticketPath;

          return (
            <TicketListCard
              key={ticket.id}
              ticket={ticket}
              ticketPath={ticketPath}
              isSelected={isSelected}
              showOrganizationName={showOrganizationName}
            />
          );
        })}
      </div>
    </div>
  );
}
