'use client';

import { ArrowUpDown, Filter } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

import { formatStatusLabel } from './ticket-view-helpers';
import { SORT_LABELS, type SortKey, type TicketListProjectOption } from './TicketListView.types';
import TicketsViewControls from './TicketsViewControls';

function listProjectFilterTriggerLabel({
  filterProjectIds,
  projectOptions
}: {
  filterProjectIds: string[];
  projectOptions: TicketListProjectOption[];
}): string {
  if (filterProjectIds.length === 0) return 'All projects';
  if (filterProjectIds.length === 1) {
    return projectOptions.find(p => p.id === filterProjectIds[0])?.name ?? 'Project';
  }
  return `${filterProjectIds.length} projects`;
}

type TicketListToolbarProps = {
  initialView: string;
  projectId?: string;
  showViewToggle: boolean;
  hasTickets: boolean;
  sortKey: SortKey;
  statusFilterLabel: string;
  areAllStatusesSelected: boolean;
  statusFilterOptions: string[];
  selectedStatusesSet: Set<string>;
  projectOptions: TicketListProjectOption[];
  filterProjectIds: string[];
  onSortKeyChange: (key: SortKey) => void;
  onSelectAllStatuses: () => void;
  onToggleStatus: (status: string) => void;
  onToggleFilterProject: (projectFilterId: string) => void;
  onClearProjectFilters: () => void;
};

export function TicketListToolbar({
  initialView,
  projectId,
  showViewToggle,
  hasTickets,
  sortKey,
  statusFilterLabel,
  areAllStatusesSelected,
  statusFilterOptions,
  selectedStatusesSet,
  projectOptions,
  filterProjectIds,
  onSortKeyChange,
  onSelectAllStatuses,
  onToggleStatus,
  onToggleFilterProject,
  onClearProjectFilters
}: TicketListToolbarProps) {
  return (
    <div className="flex w-full flex-wrap items-start justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {showViewToggle ? (
          <TicketsViewControls initialView={initialView} projectId={projectId} />
        ) : null}
        {hasTickets ? (
          <>
            {/* <DropdownMenu>
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
                  <DropdownMenuItem
                    key={key}
                    onClick={() => onSortKeyChange(key)}
                    className="gap-2"
                  >
                    {SORT_LABELS[key]}
                    {sortKey === key && <Check className="ml-auto h-4 w-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu> */}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Filter className="h-3.5 w-3.5" />
                  {statusFilterLabel}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={areAllStatusesSelected}
                  onCheckedChange={onSelectAllStatuses}
                  onSelect={event => event.preventDefault()}
                >
                  All statuses
                </DropdownMenuCheckboxItem>
                {statusFilterOptions.map(status => (
                  <DropdownMenuCheckboxItem
                    key={status}
                    checked={selectedStatusesSet.has(status)}
                    onCheckedChange={() => onToggleStatus(status)}
                    onSelect={event => event.preventDefault()}
                  >
                    {formatStatusLabel(status)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {projectOptions.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    {listProjectFilterTriggerLabel({ filterProjectIds, projectOptions })}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuLabel>Filter by project</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={filterProjectIds.length === 0}
                    onCheckedChange={() => onClearProjectFilters()}
                    onSelect={event => event.preventDefault()}
                  >
                    All projects
                  </DropdownMenuCheckboxItem>
                  {projectOptions.map(project => (
                    <DropdownMenuCheckboxItem
                      key={project.id}
                      checked={filterProjectIds.includes(project.id)}
                      onCheckedChange={() => onToggleFilterProject(project.id)}
                      onSelect={event => event.preventDefault()}
                      className="gap-2"
                    >
                      {project.color ? (
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-[2px] border"
                          style={{ backgroundColor: project.color, borderColor: project.color }}
                        />
                      ) : null}
                      <span className="truncate">{project.name}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
