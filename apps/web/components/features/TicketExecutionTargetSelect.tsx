'use client';

import { Bot, User } from 'lucide-react';
import { type ComponentType, useEffect, useState } from 'react';

import { useUpdateTicketForHumanMutation } from '@/lib/client-data/tickets/mutations';
import { ticketForHumanOptions } from '@/lib/options';

import { Select, SelectContent, SelectItem, SelectTrigger } from '../ui/select';

type ExecutionTargetIconProps = { className?: string };

const executionTargetIconMap: Record<'agent' | 'human', ComponentType<ExecutionTargetIconProps>> = {
  agent: Bot,
  human: User
};

type Props = {
  ticketId: string;
  currentForHuman: boolean;
};

export function TicketExecutionTargetSelect({ ticketId, currentForHuman }: Props) {
  const [forHuman, setForHuman] = useState(currentForHuman);
  const mutation = useUpdateTicketForHumanMutation();

  useEffect(() => {
    setForHuman(currentForHuman);
  }, [currentForHuman]);

  function handleChange(value: string) {
    const nextForHuman = value === 'true';
    const previousForHuman = forHuman;
    setForHuman(nextForHuman);
    mutation.mutate(
      { ticketId, forHuman: nextForHuman },
      {
        onError: () => {
          setForHuman(previousForHuman);
        }
      }
    );
  }

  return (
    <Select
      value={String(forHuman)}
      disabled={mutation.isPending}
      onValueChange={handleChange}
      aria-label="Ticket assignment"
    >
      <SelectTrigger
        id="ticket-for-human-select"
        aria-label="Select ticket assignment"
        className="h-6 w-auto rounded-md border bg-transparent px-3 text-xs font-base hover:bg-muted"
      >
        {forHuman ? 'Human' : 'Agent'}
      </SelectTrigger>
      <SelectContent>
        {ticketForHumanOptions.map(({ value, label }) => {
          const Icon = executionTargetIconMap[value ? 'human' : 'agent'];
          return (
            <SelectItem key={String(value)} value={String(value)}>
              <span className="flex w-full items-center justify-between gap-2">
                <span>{label}</span>
                <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
