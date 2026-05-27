'use client';

import { Check, ChevronDown, Loader2, Tag, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  useApplyTagMutation,
  useProjectTagDefinitions,
  useRemoveTagMutation
} from '@/lib/client-data/tags/hooks';
import type { EffectiveTicketTag } from '@/types/tags';
import type { ProjectTagDefinition } from '@/types/tags';

type TicketTagEditorProps = {
  ticketId: string;
  projectId: string | null | undefined;
  initialTags: EffectiveTicketTag[];
};

export function TicketTagEditor({ ticketId, projectId, initialTags }: TicketTagEditorProps) {
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<EffectiveTicketTag[]>(initialTags);
  const [pendingTagId, setPendingTagId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'add' | 'remove' | null>(null);

  const { data: allDefinitions } = useProjectTagDefinitions(projectId);
  const applyMutation = useApplyTagMutation(ticketId, projectId);
  const removeMutation = useRemoveTagMutation(ticketId, projectId);

  const activeDefinitions = (allDefinitions ?? []).filter(d => d.is_active);
  const appliedIds = new Set(tags.map(t => t.id));

  async function handleToggle(def: ProjectTagDefinition) {
    const previousTags = tags;

    if (appliedIds.has(def.id)) {
      setPendingTagId(def.id);
      setPendingAction('remove');

      // Optimistic remove
      setTags(prev => prev.filter(t => t.id !== def.id));
      try {
        await removeMutation.mutateAsync(def.id);
      } catch (err) {
        setTags(previousTags);
        toast.error(err instanceof Error ? err.message : 'Failed to remove tag');
      } finally {
        setPendingTagId(null);
        setPendingAction(null);
      }
    } else {
      setPendingTagId(def.id);
      setPendingAction('add');

      // Optimistic add
      const newTag: EffectiveTicketTag = {
        id: def.id,
        key: def.key,
        label: def.label,
        color: def.color,
        sources: ['user']
      };
      setTags(prev => [...prev, newTag].sort((a, b) => a.label.localeCompare(b.label)));
      try {
        await applyMutation.mutateAsync(def.id);
      } catch (err) {
        setTags(previousTags);
        toast.error(err instanceof Error ? err.message : 'Failed to add tag');
      } finally {
        setPendingTagId(null);
        setPendingAction(null);
      }
    }
  }

  const isPending = applyMutation.isPending || removeMutation.isPending;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map(tag => (
        <Badge
          key={tag.id}
          variant="secondary"
          className="flex items-center gap-1 pr-1 text-xs"
          style={
            tag.color
              ? { backgroundColor: `${tag.color}22`, borderColor: `${tag.color}66` }
              : undefined
          }
        >
          <Tag className="h-2.5 w-2.5" />
          {tag.label}
          <button
            type="button"
            className="ml-0.5 rounded-sm opacity-60 hover:opacity-100 transition-opacity"
            onClick={() =>
              handleToggle({
                id: tag.id,
                key: tag.key,
                label: tag.label,
                color: tag.color,
                project_id: projectId ?? '',
                is_active: true,
                description: null,
                created_at: '',
                updated_at: ''
              })
            }
            disabled={isPending}
            aria-label={`Remove ${tag.label} tag`}
          >
            {pendingTagId === tag.id && pendingAction === 'remove' ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <X className="h-2.5 w-2.5" />
            )}
          </button>
        </Badge>
      ))}

      {projectId ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Tag className="h-3 w-3" />
              Add tag
              <ChevronDown className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-1" align="start">
            {activeDefinitions.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No tags defined for this project.
              </p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {activeDefinitions.map(def => {
                  const isApplied = appliedIds.has(def.id);
                  return (
                    <button
                      key={def.id}
                      type="button"
                      className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted disabled:opacity-50"
                      onClick={() => handleToggle(def)}
                      disabled={isPending}
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        {isApplied ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
                      </span>
                      <Tag
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        style={def.color ? { color: def.color } : undefined}
                      />
                      <span className="flex-1 text-left">{def.label}</span>
                      {isPending && pendingTagId === def.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
