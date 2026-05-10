'use client';

import { ChevronDown } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState, useTransition } from 'react';

import {
  AgentModelSelector,
  useAgentModelPreference,
  useAgentModels
} from '@/components/features/AgentModelSelector';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { AgentModel } from '@/lib/actions/agent-models';
import { updateTicketAssignedAgentAction } from '@/lib/actions/tickets';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import type { AgentModelSelection } from '@/lib/helpers/agent-model-preference';
import { getAgentTypeByValue } from '@/lib/helpers/agent-types';
import type { TicketAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import { cn } from '@/lib/utils';

const updateTicketAssignedAgentActionWithRetry = withElectronActionRetry(
  updateTicketAssignedAgentAction
);

function getSelectionLabel(models: AgentModel[], modelId: string | null): string {
  if (!modelId) return 'Default model';
  if (modelId === 'auto') return 'Auto';
  const name = models.find(model => model.model_id === modelId)?.display_name ?? 'Selected model';
  return name.replace(/^Claude\s+/i, '');
}

function isSameSelection(left: AgentModelSelection, right: AgentModelSelection): boolean {
  return (
    left.agent === right.agent && left.model === right.model && left.thinking === right.thinking
  );
}

function isSameAssigned(
  left: TicketAssignedAgent | null,
  right: TicketAssignedAgent | null
): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  return (
    left.agent === right.agent && left.model === right.model && left.thinking === right.thinking
  );
}

export function AgentModelChooserButton({
  ticketId,
  objectiveId,
  initialSelection,
  disabled = false,
  onSelectionChange,
  persistSelection = true,
  onOpenChange,
  className
}: {
  ticketId?: string | null;
  objectiveId?: string | null;
  initialSelection: TicketAssignedAgent | null;
  disabled?: boolean;
  onSelectionChange?: (selection: AgentModelSelection) => void;
  persistSelection?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const { selection: preferenceSelection, setSelection: setPreferenceSelection } =
    useAgentModelPreference();
  const { models } = useAgentModels();
  const [selection, setSelection] = useState<AgentModelSelection>(
    initialSelection ?? preferenceSelection
  );
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  // Track the last initialSelection value (by content) so we only re-sync local state when the
  // prop actually changes — not on every parent re-render. Without this, our own server save
  // can echo back through live data while the user has already moved on, reverting their pick.
  const lastInitialRef = useRef(initialSelection);

  useEffect(() => {
    const initialChanged = !isSameAssigned(lastInitialRef.current, initialSelection);
    lastInitialRef.current = initialSelection;

    if (initialChanged && initialSelection !== null) {
      // Truly new ticket assignment — sync local to it
      setSelection(current =>
        isSameSelection(current, initialSelection) ? current : initialSelection
      );
      return;
    }

    if (initialSelection === null) {
      // No per-ticket assignment — follow cross-component preference broadcasts
      setSelection(current =>
        isSameSelection(current, preferenceSelection) ? current : preferenceSelection
      );
    }
    // else: initialSelection didn't change and is non-null — local state is authoritative,
    // don't override the user's pick with a stale prop or a preference broadcast.
  }, [initialSelection, preferenceSelection]);

  const agent = getAgentTypeByValue(selection.agent);
  const label = getSelectionLabel(models, selection.model);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          className={cn('h-8 max-w-[230px] gap-2 px-3 text-xs', className)}
          size="sm"
          variant="outline"
          disabled={disabled}
        >
          <Image
            src={agent.icon}
            alt={`${agent.label} icon`}
            width={14}
            height={14}
            className={cn('h-3.5 w-3.5', agent.invertDark ? 'dark:invert' : '')}
          />
          <span>{label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={{ left: 8, right: 8 }}
        className="w-auto min-w-[320px] p-2"
      >
        <AgentModelSelector
          value={selection}
          onChange={nextSelection => {
            setSelection(nextSelection);
            setPreferenceSelection(nextSelection);
            onSelectionChange?.(nextSelection);
            if (persistSelection && ticketId) {
              startTransition(() => {
                void updateTicketAssignedAgentActionWithRetry(ticketId, nextSelection, objectiveId);
              });
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
