'use client';

import { Columns3, Eye, EyeOff, LucideFolderClosed, Settings } from 'lucide-react';

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

import ScheduledTicketVisibilityControl from './ScheduledTicketVisibilityControl';
import { projectFilterTriggerLabel } from './ticket-toolbar-helpers';
import type { TicketTagFilterOption } from './TicketListView.types';
import TicketsViewControls from './TicketsViewControls';
import { TicketTagFilterDropdown } from './TicketTagFilterDropdown';

type ProjectOption = {
  id: string;
  name: string;
  color: string | null;
};

type ToolbarColumn = {
  id: string;
  title: string;
};

const UNCATEGORIZED_COLUMN_ID = '__uncategorized';

export default function KanbanBoardToolbar({
  initialView,
  projectId,
  projectOptions,
  filteredProjectIds,
  tagOptions,
  selectedTagIds,
  onToggleFilterProject,
  onClearProjectFilter,
  onToggleTag,
  onClearTagFilter,
  columns,
  visibleSlugs,
  showUncategorized,
  scheduledVisibilityDays,
  onToggleColumnVisibility,
  onOpenProjectSettings
}: {
  initialView: string;
  projectId?: string;
  projectOptions: ProjectOption[];
  filteredProjectIds: string[];
  tagOptions: TicketTagFilterOption[];
  selectedTagIds: string[];
  onToggleFilterProject: (projectId: string) => void;
  onClearProjectFilter: () => void;
  onToggleTag: (tagId: string) => void;
  onClearTagFilter: () => void;
  columns: ToolbarColumn[];
  visibleSlugs: Set<string>;
  showUncategorized: boolean;
  scheduledVisibilityDays: number;
  onToggleColumnVisibility: (slug: string) => void;
  onOpenProjectSettings?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 md:px-6">
      <div className="flex items-center gap-2">
        <TicketsViewControls initialView={initialView} projectId={projectId} />
        <ScheduledTicketVisibilityControl scheduledVisibilityDays={scheduledVisibilityDays} />
        {projectOptions.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <LucideFolderClosed className="h-4 w-4" />
                {projectFilterTriggerLabel({
                  filterProjectIds: filteredProjectIds,
                  projectOptions
                })}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuLabel>Filter by project</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={filteredProjectIds.length === 0}
                onCheckedChange={() => onClearProjectFilter()}
                onSelect={event => event.preventDefault()}
              >
                All Projects
              </DropdownMenuCheckboxItem>
              {projectOptions.map(project => (
                <DropdownMenuCheckboxItem
                  key={project.id}
                  checked={filteredProjectIds.includes(project.id)}
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
        )}
        <TicketTagFilterDropdown
          tagOptions={tagOptions}
          selectedTagIds={selectedTagIds}
          onToggle={onToggleTag}
          onClear={onClearTagFilter}
        />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Columns3 className="h-4 w-4" />
            Columns
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Show columns</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {columns.map(column => {
            const visible = visibleSlugs.has(column.id);
            return (
              <DropdownMenuItem
                key={column.id}
                onClick={() => onToggleColumnVisibility(column.id)}
                className="gap-2"
              >
                {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                {column.title}
              </DropdownMenuItem>
            );
          })}
          {showUncategorized && (
            <DropdownMenuItem
              onClick={() => onToggleColumnVisibility(UNCATEGORIZED_COLUMN_ID)}
              className="gap-2"
            >
              {visibleSlugs.has(UNCATEGORIZED_COLUMN_ID) ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
              Uncategorized
            </DropdownMenuItem>
          )}
          {projectId && onOpenProjectSettings ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onOpenProjectSettings} className="gap-2">
                <Settings className="h-4 w-4" />
                Column order
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
