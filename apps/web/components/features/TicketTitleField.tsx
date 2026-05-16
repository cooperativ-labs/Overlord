'use client';

import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { InlineEditField } from '@/components/features/InlineEditField';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { generateTicketTitleAction } from '@/lib/actions/generate-title';
import { useUpdateTicketFieldsMutation } from '@/lib/client-data/tickets/mutations';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import { useTicketObjectivesRealtime } from '@/lib/hooks/use-ticket-objectives-realtime';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

const generateTicketTitleActionWithRetry = withElectronActionRetry(generateTicketTitleAction);

type ObjectiveRow = Pick<
  Database['public']['Tables']['objectives']['Row'],
  | 'id'
  | 'objective'
  | 'created_at'
  | 'title'
  | 'state'
  | 'agent_identifier'
  | 'model_identifier'
  | 'assigned_agent'
  | 'position'
  | 'auto_advance'
  | 'auto_advanced_at'
  | 'approval_reason'
>;

type TicketTitleFieldProps = {
  ticketId: string;
  initialTitle: string;
  fallbackObjective: string;
  initialObjectives: ObjectiveRow[];
  futureObjectivesEnabled?: boolean;
};

export function TicketTitleField({
  ticketId,
  initialTitle,
  fallbackObjective,
  initialObjectives,
  futureObjectivesEnabled = false
}: TicketTitleFieldProps) {
  const objectives = useTicketObjectivesRealtime({ ticketId, initialObjectives });
  const editableObjective =
    objectives.find(objective => objective.state === 'draft') ??
    (futureObjectivesEnabled ? objectives.find(objective => objective.state === 'future') : null) ??
    objectives.find(objective => objective.state === 'submitted') ??
    null;
  const objectiveText = (editableObjective?.objective ?? fallbackObjective ?? '').trim();

  const [titleValue, setTitleValue] = useState(initialTitle);
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');
  const updateFieldsMutation = useUpdateTicketFieldsMutation();
  const isGenerating = buttonState === 'loading';

  async function handleGenerate() {
    if (!objectiveText) {
      toast.error('Add an objective before generating a title.');
      setButtonState('error');
      return;
    }
    setButtonState('loading');
    try {
      const title = await generateTicketTitleActionWithRetry(objectiveText);
      if (!title) {
        toast.error('Failed to generate a title.');
        setButtonState('error');
        return;
      }
      await updateFieldsMutation.mutateAsync({ ticketId, patch: { title } });
      setTitleValue(title);
      setButtonState('success');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate title.');
      setButtonState('error');
    }
  }

  return (
    <div className="relative">
      <InlineEditField
        displayClassName="text-xl font-semibold tracking-tight pr-10"
        field="title"
        initialValue={titleValue}
        inputClassName="text-xl font-semibold tracking-tight pr-10"
        placeholder="Untitled — click to add a title"
        ticketId={ticketId}
      />
      <LoadingButton
        aria-label="Generate title with AI"
        buttonState={buttonState}
        className={cn(
          'absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md p-0 text-muted-foreground transition-colors',
          'hover:bg-muted hover:text-primary'
        )}
        disabled={isGenerating || !objectiveText}
        errorText={<Sparkles className="h-4 w-4 text-destructive" />}
        loadingText={<Loader2 className="h-4 w-4 animate-spin" />}
        onClick={handleGenerate}
        reset
        setButtonState={setButtonState}
        size="icon"
        successText={<Sparkles className="h-4 w-4 text-emerald-600" />}
        text={<Sparkles className="h-4 w-4" />}
        title="Generate title with AI"
        variant="ghost"
      />
    </div>
  );
}
