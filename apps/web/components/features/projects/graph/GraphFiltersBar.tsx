'use client';

import { Filter, X } from 'lucide-react';
import { useCallback } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

import type { GraphFilters } from './types';
import { CHANGE_KIND_COLORS, hasActiveFilters, STATUS_TYPE_COLORS } from './types';

interface GraphFiltersBarProps {
  filters: GraphFilters;
  onFiltersChange: (filters: GraphFilters) => void;
  availableChangeKinds: string[];
  availableImpacts: string[];
  availableDirectories: string[];
  availableStatusTypes: string[];
}

function toggleSet(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

function FilterDropdown({
  label,
  items,
  selected,
  onToggle,
  colorMap
}: {
  label: string;
  items: string[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  colorMap?: Record<string, string>;
}) {
  if (items.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
          {label}
          {selected.size > 0 && (
            <Badge variant="secondary" className="h-4 min-w-4 text-[10px] px-1">
              {selected.size}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuLabel className="text-xs">{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map(item => (
          <DropdownMenuCheckboxItem
            key={item}
            checked={selected.has(item)}
            onCheckedChange={() => onToggle(item)}
            className="text-xs"
          >
            <span className="flex items-center gap-1.5">
              {colorMap?.[item] && (
                <span
                  className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: colorMap[item] }}
                />
              )}
              {item}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function GraphFiltersBar({
  filters,
  onFiltersChange,
  availableChangeKinds,
  availableImpacts,
  availableDirectories,
  availableStatusTypes
}: GraphFiltersBarProps) {
  const active = hasActiveFilters(filters);

  const clearAll = useCallback(() => {
    onFiltersChange({
      changeKinds: new Set(),
      impacts: new Set(),
      directories: new Set(),
      statusTypes: new Set(),
      maxTime: null
    });
  }, [onFiltersChange]);

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b bg-card/30">
      <Filter className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />

      <FilterDropdown
        label="Kind"
        items={availableChangeKinds}
        selected={filters.changeKinds}
        onToggle={v =>
          onFiltersChange({ ...filters, changeKinds: toggleSet(filters.changeKinds, v) })
        }
        colorMap={CHANGE_KIND_COLORS}
      />

      <FilterDropdown
        label="Impact"
        items={availableImpacts}
        selected={filters.impacts}
        onToggle={v => onFiltersChange({ ...filters, impacts: toggleSet(filters.impacts, v) })}
      />

      <FilterDropdown
        label="Directory"
        items={availableDirectories}
        selected={filters.directories}
        onToggle={v =>
          onFiltersChange({ ...filters, directories: toggleSet(filters.directories, v) })
        }
      />

      <FilterDropdown
        label="Status"
        items={availableStatusTypes}
        selected={filters.statusTypes}
        onToggle={v =>
          onFiltersChange({ ...filters, statusTypes: toggleSet(filters.statusTypes, v) })
        }
        colorMap={STATUS_TYPE_COLORS}
      />

      {active && (
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 ml-1" onClick={clearAll}>
          <X className="h-3 w-3" />
          Clear
        </Button>
      )}
    </div>
  );
}
