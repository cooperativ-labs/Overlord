'use client';

import { Tag } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  useApplyTagMutation,
  useProjectTagDefinitions,
  useRemoveTagMutation
} from '@/lib/client-data/tags/hooks';
import { cn } from '@/lib/utils';
import type { EffectiveTicketTag } from '@/types/tags';

type KanbanCardTagSelectorProps = {
  ticketId: string;
  projectId: string | null | undefined;
  tags: EffectiveTicketTag[];
};

export function KanbanCardTagSelector({
  ticketId,
  projectId,
  tags: initialTags
}: KanbanCardTagSelectorProps) {
  const [tags, setTags] = useState<EffectiveTicketTag[]>(initialTags);
  const [pendingTagId, setPendingTagId] = useState<string | null>(null);
  const instanceId = useId().replace(/:/g, '');
  const tagMenuScopeClass = `kanban-card-tag-menu-${instanceId}`;

  const { data: tagDefinitions } = useProjectTagDefinitions(projectId);
  const applyMutation = useApplyTagMutation(ticketId, projectId);
  const removeMutation = useRemoveTagMutation(ticketId, projectId);

  const activeTagDefinitions = useMemo(
    () => (tagDefinitions ?? []).filter(definition => definition.is_active),
    [tagDefinitions]
  );
  const appliedTagIds = useMemo(() => new Set(tags.map(tag => tag.id)), [tags]);
  const showTagPicker = Boolean(projectId) && activeTagDefinitions.length > 0;
  const isPending = applyMutation.isPending || removeMutation.isPending;

  useEffect(() => {
    setTags(initialTags);
  }, [initialTags]);

  const toggleTag = useCallback(
    async (tagDefinitionId: string) => {
      if (isPending) return;

      const definition = activeTagDefinitions.find(def => def.id === tagDefinitionId);
      if (!definition) return;

      const previousTags = tags;
      const isApplied = appliedTagIds.has(tagDefinitionId);

      setPendingTagId(tagDefinitionId);

      if (isApplied) {
        setTags(current => current.filter(tag => tag.id !== tagDefinitionId));
        try {
          await removeMutation.mutateAsync(tagDefinitionId);
        } catch (err) {
          setTags(previousTags);
          toast.error(err instanceof Error ? err.message : 'Failed to remove tag');
        } finally {
          setPendingTagId(null);
        }
        return;
      }

      const optimisticTag: EffectiveTicketTag = {
        id: definition.id,
        key: definition.key,
        label: definition.label,
        color: definition.color,
        sources: ['user']
      };
      setTags(current =>
        [...current, optimisticTag].sort((a, b) => a.label.localeCompare(b.label))
      );
      try {
        await applyMutation.mutateAsync(tagDefinitionId);
      } catch (err) {
        setTags(previousTags);
        toast.error(err instanceof Error ? err.message : 'Failed to add tag');
      } finally {
        setPendingTagId(null);
      }
    },
    [activeTagDefinitions, appliedTagIds, applyMutation, isPending, removeMutation, tags]
  );

  if (!showTagPicker) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground',
            appliedTagIds.size > 0 && 'text-foreground'
          )}
          aria-label="Edit ticket tags"
          disabled={isPending}
          onClick={event => event.stopPropagation()}
          onPointerDown={event => event.stopPropagation()}
        >
          <Tag className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={cn('w-48', tagMenuScopeClass)}
        onClick={event => event.stopPropagation()}
        onPointerDown={event => event.stopPropagation()}
      >
        {activeTagDefinitions.map(definition => (
          <DropdownMenuCheckboxItem
            key={definition.id}
            checked={appliedTagIds.has(definition.id)}
            disabled={isPending && pendingTagId === definition.id}
            onCheckedChange={() => {
              void toggleTag(definition.id);
            }}
            onSelect={event => event.preventDefault()}
            className="gap-2"
          >
            {definition.color ? (
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full border"
                style={{
                  backgroundColor: definition.color,
                  borderColor: definition.color
                }}
              />
            ) : null}
            <span className="truncate">{definition.label}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
