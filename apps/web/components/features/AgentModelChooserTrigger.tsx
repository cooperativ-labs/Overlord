'use client';

import { ChevronDown } from 'lucide-react';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';

import { AgentIcon } from '@/components/features/AgentIcon';
import { useAgentModels } from '@/components/features/AgentModelSelector';
import { Button } from '@/components/ui/button';
import type { AgentModel } from '@/lib/actions/agent-models';
import type { AgentModelSelection } from '@/lib/helpers/agent-model-preference';
import { getAgentTypeByValue } from '@/lib/helpers/agent-types';
import { cn } from '@/lib/utils';

function getSelectionLabel(models: AgentModel[], modelId: string | null): string {
  if (!modelId) return 'Default model';
  if (modelId === 'auto') return 'Auto';
  const name = models.find(model => model.model_id === modelId)?.display_name ?? 'Selected model';
  return name.replace(/^Claude\s+/i, '');
}

/**
 * Same chrome as {@link AgentModelChooserButton} but no popover — the parent renders
 * {@link AgentModelSelector} inline and toggles visibility via `active` / `onToggle`.
 */
type AgentModelChooserTriggerProps = Omit<ComponentPropsWithoutRef<typeof Button>, 'children'> & {
  selection: AgentModelSelection;
  active: boolean;
  onToggle: () => void;
};

export const AgentModelChooserTrigger = forwardRef<
  HTMLButtonElement,
  AgentModelChooserTriggerProps
>(function AgentModelChooserTrigger(
  { selection, active, onToggle, disabled = false, className, onClick, ...buttonProps },
  ref
) {
  const { models } = useAgentModels();
  const agent = getAgentTypeByValue(selection.agent);
  const label = getSelectionLabel(models, selection.model);

  return (
    <Button
      {...buttonProps}
      ref={ref}
      type="button"
      className={cn('h-8 max-w-[230px] gap-2 px-3 text-xs', className)}
      size="sm"
      variant="outline"
      disabled={disabled}
      onClick={event => {
        onClick?.(event);
        if (!event.defaultPrevented) onToggle();
      }}
      aria-expanded={active}
      aria-haspopup="true"
      aria-label="Choose agent and model"
    >
      <AgentIcon agentType={agent} size={14} alt={`${agent.label} icon`} className="h-3.5 w-3.5" />
      <span className="truncate">{label}</span>
      <ChevronDown
        className={cn(
          'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
          active && 'rotate-180'
        )}
        aria-hidden
      />
    </Button>
  );
});
