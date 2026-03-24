'use client';

import { Check, Columns3, Eye, EyeOff, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

import TicketsViewControls from './TicketsViewControls';

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
  filteredProjectId,
  onFilterProject,
  columns,
  visibleSlugs,
  showUncategorized,
  onToggleColumnVisibility,
  onOpenProjectSettings
}: {
  initialView: string;
  projectId?: string;
  projectOptions: ProjectOption[];
  filteredProjectId: string | null;
  onFilterProject: (projectId: string | null) => void;
  columns: ToolbarColumn[];
  visibleSlugs: Set<string>;
  showUncategorized: boolean;
  onToggleColumnVisibility: (slug: string) => void;
  onOpenProjectSettings?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 md:px-6">
      <div className="flex items-center gap-2">
        <TicketsViewControls initialView={initialView} projectId={projectId} />
        {projectOptions.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Eye className="h-4 w-4" />
                {filteredProjectId
                  ? (projectOptions.find(p => p.id === filteredProjectId)?.name ?? 'Project')
                  : 'All Projects'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuLabel>Filter by project</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onFilterProject(null)} className="gap-2">
                All Projects
                {filteredProjectId === null && <Check className="ml-auto h-4 w-4" />}
              </DropdownMenuItem>
              {projectOptions.map(project => (
                <DropdownMenuItem
                  key={project.id}
                  onClick={() => onFilterProject(project.id)}
                  className="gap-2"
                >
                  {project.color && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-[2px] border"
                      style={{ backgroundColor: project.color, borderColor: project.color }}
                    />
                  )}
                  <span className="truncate">{project.name}</span>
                  {filteredProjectId === project.id && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
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
