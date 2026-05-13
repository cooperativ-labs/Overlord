'use client';

import { Tag } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

import type { TicketTagFilterOption } from './TicketListView.types';

function getTagFilterLabel(selectedTagIds: string[], tagOptions: TicketTagFilterOption[]): string {
  if (selectedTagIds.length === 0) return 'All tags';
  if (selectedTagIds.length === 1) {
    return tagOptions.find(tag => tag.id === selectedTagIds[0])?.label ?? 'Tag';
  }
  return `${selectedTagIds.length} tags`;
}

type TicketTagFilterDropdownProps = {
  tagOptions: TicketTagFilterOption[];
  selectedTagIds: string[];
  onClear: () => void;
  onToggle: (tagId: string) => void;
};

export function TicketTagFilterDropdown({
  tagOptions,
  selectedTagIds,
  onClear,
  onToggle
}: TicketTagFilterDropdownProps) {
  if (tagOptions.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Tag className="h-3.5 w-3.5" />
          {getTagFilterLabel(selectedTagIds, tagOptions)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel>Filter by tag</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={selectedTagIds.length === 0}
          onCheckedChange={() => onClear()}
          onSelect={event => event.preventDefault()}
        >
          All tags
        </DropdownMenuCheckboxItem>
        {tagOptions.map(tag => (
          <DropdownMenuCheckboxItem
            key={tag.id}
            checked={selectedTagIds.includes(tag.id)}
            onCheckedChange={() => onToggle(tag.id)}
            onSelect={event => event.preventDefault()}
            className="gap-2"
          >
            {tag.color ? (
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full border"
                style={{ backgroundColor: tag.color, borderColor: tag.color }}
              />
            ) : null}
            <span className="truncate">{tag.label}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
