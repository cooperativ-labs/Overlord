'use client';

import {
  ArrowUpCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  FastForward,
  GripVertical,
  PauseCircle,
  Plus
} from 'lucide-react';
import Image from 'next/image';
import { useCallback, useRef, useState } from 'react';

import { AgentModelChooserTrigger } from '@/components/features/AgentModelChooserTrigger';
import { AgentModelSelector, useAgentModels } from '@/components/features/AgentModelSelector';
import { AgentSplitButton } from '@/components/features/AgentSplitButton';
import { MarkdownContent } from '@/components/features/MarkdownContent';
import {
  ToolbarOverflowCompactProvider,
  useToolbarOverflowCompactState
} from '@/components/features/ToolbarOverflowCompact';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { AgentModelSelection } from '@/lib/helpers/agent-model-preference';
import {
  type AgentSelectorValue,
  isLaunchAgentTypeValue,
  type LaunchAgentType
} from '@/lib/helpers/agent-types';
import { resolveMarketingAgentModels } from '@/lib/marketing/offered-agent-models';
import { cn } from '@/lib/utils';

import { DEMO_OBJECTIVES, type DemoObjective } from './mock-ticket-details';
import { useSeedMarketingAgentModels } from './useSeedMarketingAgentModels';

const DEMO_TICKET_ID = 'demo-ticket';

type DemoObjectivesSectionProps = {
  className?: string;
  onRun?: () => void;
};

export function DemoObjectivesSection({ className, onRun }: DemoObjectivesSectionProps) {
  useSeedMarketingAgentModels();

  const completed = DEMO_OBJECTIVES.filter(objective => objective.state === 'complete');
  const draft = DEMO_OBJECTIVES.filter(objective => objective.state === 'draft');
  const future = DEMO_OBJECTIVES.filter(objective => objective.state === 'future');

  return (
    <div className={cn('flex flex-col', className)}>
      {completed.length > 0 ? (
        <div className="mb-3 space-y-0 rounded-md border bg-background">
          {completed.map(objective => (
            <CompletedObjective key={objective.id} objective={objective} />
          ))}
        </div>
      ) : null}

      <div className="space-y-3">
        {draft.map(objective => (
          <DemoDraftObjective key={objective.id} objective={objective} onRun={onRun} />
        ))}
        {future.map(objective => (
          <DemoFutureObjective key={objective.id} objective={objective} />
        ))}
      </div>

      <div className="mt-3">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed px-2.5 text-xs text-muted-foreground hover:bg-background"
        >
          <Plus className="h-3.5 w-3.5" />
          Add objective
        </button>
      </div>
    </div>
  );
}

function demoSelectionFromObjective(objective: DemoObjective): AgentModelSelection {
  return {
    agent: (objective.agent ?? 'codex') as LaunchAgentType,
    model: objective.model ?? 'gpt-5.4',
    thinking: null
  };
}

function DemoObjectiveAgentControls({
  objective,
  isFuture = false,
  onRun
}: {
  objective: DemoObjective;
  isFuture?: boolean;
  onRun?: () => void;
}) {
  const { models: fetchedModels } = useAgentModels();
  const catalogModels = resolveMarketingAgentModels(fetchedModels);
  const initialSelection = demoSelectionFromObjective(objective);
  const [chooserSelection, setChooserSelection] = useState(initialSelection);
  const [selectedAgent, setSelectedAgent] = useState<AgentSelectorValue>(initialSelection.agent);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(objective.autoAdvance ?? true);
  const toolbarRowRef = useRef<HTMLDivElement>(null);
  const toolbarCompact = useToolbarOverflowCompactState(toolbarRowRef);

  const handleAgentSelect = useCallback((agent: LaunchAgentType) => {
    setSelectedAgent(agent);
    setChooserSelection(current => ({
      ...current,
      agent,
      model: null,
      thinking: null,
      customAgentId: null
    }));
  }, []);

  const splitButtonSelection: AgentModelSelection = isLaunchAgentTypeValue(selectedAgent)
    ? { ...chooserSelection, agent: selectedAgent }
    : chooserSelection;

  return (
    <ToolbarOverflowCompactProvider compact={toolbarCompact}>
      <div
        ref={toolbarRowRef}
        className="flex min-w-0 items-center justify-between gap-2 overflow-hidden px-2 py-1.5"
      >
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            aria-label="Upload objective attachment"
          >
            <Plus size={18} />
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 gap-1 px-2 text-xs text-green-800',
                  !autoAdvance && 'text-amber-600'
                )}
                aria-pressed={autoAdvance}
                onClick={() => setAutoAdvance(value => !value)}
              >
                {autoAdvance ? (
                  <FastForward className="h-3.5 w-3.5" />
                ) : (
                  <PauseCircle className="h-3.5 w-3.5" />
                )}
                Auto
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-56 text-center">
              Objectives marked Auto will automatically launch in your terminal when the previous
              objective completes.
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Popover open={chooserOpen} onOpenChange={setChooserOpen}>
            <PopoverTrigger asChild>
              <AgentModelChooserTrigger
                selection={chooserSelection}
                active={chooserOpen}
                onToggle={() => {}}
              />
            </PopoverTrigger>
            <PopoverContent
              align="start"
              collisionPadding={{ left: 8, right: 8 }}
              className="w-auto md:min-w-[320px] p-2"
            >
              <AgentModelSelector
                demo
                catalogModels={catalogModels}
                value={chooserSelection}
                onChange={setChooserSelection}
                onAgentSelect={handleAgentSelect}
              />
            </PopoverContent>
          </Popover>
          {isFuture ? (
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-3 text-xs">
              <ArrowUpCircle className="h-3.5 w-3.5" />
              Promote
            </Button>
          ) : (
            <AgentSplitButton
              demo
              size="sm"
              ticketId={DEMO_TICKET_ID}
              selectedAgent={selectedAgent}
              onSelectAgent={setSelectedAgent}
              assignedSelection={splitButtonSelection}
              hasProjectWorkingDirectory
              workingDirectory="/demo"
              onDemoRun={onRun}
            />
          )}
        </div>
      </div>
    </ToolbarOverflowCompactProvider>
  );
}

function DemoDraftObjective({
  objective,
  onRun
}: {
  objective: DemoObjective;
  onRun?: () => void;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-muted-foreground/20 bg-card">
      <div className="px-3 pt-3">
        <p className="whitespace-pre-wrap text-base leading-relaxed">{objective.body}</p>
      </div>
      <div className="border-t border-border/40">
        <DemoObjectiveAgentControls objective={objective} onRun={onRun} />
      </div>
    </div>
  );
}

function DemoFutureObjective({ objective }: { objective: DemoObjective }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="relative flex items-stretch gap-2">
      <div className="flex w-5 shrink-0 items-center justify-center self-stretch text-muted-foreground/40">
        <GripVertical className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-border/35 bg-muted/20 opacity-70 transition-opacity focus-within:opacity-100">
        <div
          onClick={() => {
            setIsExpanded(true);
          }}
        >
          <div
            className={cn(
              'relative overflow-hidden transition-[max-height] duration-200 ease-in-out',
              isExpanded ? 'max-h-[500px]' : 'max-h-[3.25rem]'
            )}
          >
            <div className="px-3 pt-3">
              <p className="whitespace-pre-wrap text-base leading-relaxed text-muted-foreground">
                {objective.body}
              </p>
            </div>
            {isExpanded ? (
              <button
                type="button"
                className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border/50 bg-background/90 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-background hover:text-foreground"
                aria-label="Collapse objective"
                onClick={event => {
                  event.stopPropagation();
                  setIsExpanded(false);
                }}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {!isExpanded ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background/80 to-transparent" />
            ) : null}
          </div>
          <div className="border-t border-border/40">
            <DemoObjectiveAgentControls objective={objective} isFuture />
          </div>
        </div>
      </div>
    </div>
  );
}

function ObjectiveAgentIcon({ agent }: { agent?: DemoObjective['agent'] }) {
  if (!agent) return null;
  const src = agent === 'codex' ? '/images/icons/codex.svg' : '/images/icons/claude-code.svg';
  return (
    <Image
      src={src}
      alt={agent}
      width={14}
      height={14}
      className={cn('h-3.5 w-3.5', agent === 'codex' ? 'dark:invert' : '')}
    />
  );
}

function CompletedObjective({ objective }: { objective: DemoObjective }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="relative overflow-hidden rounded-md">
        <div className="flex items-center overflow-hidden rounded-md pr-1 hover:bg-background">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="relative flex flex-1 flex-col rounded-md py-2 pl-3 pr-1 text-left hover:bg-background"
            >
              <div className="flex w-full items-center justify-between gap-2 min-w-0">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-500" />
                  <ObjectiveAgentIcon agent={objective.agent} />
                  <p className="truncate text-sm font-medium min-w-10">{objective.title}</p>
                </div>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                    open && 'rotate-180'
                  )}
                />
              </div>
              {objective.autoAdvance ? (
                <div className="mt-0.5 flex items-center gap-1 pl-[18px] text-[11px] text-muted-foreground">
                  <FastForward className="h-3 w-3" />
                  <span>Auto-advanced</span>
                </div>
              ) : null}
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="border-b px-3 pb-3 pt-1">
          <MarkdownContent compact>{objective.body}</MarkdownContent>
          {objective.completedAt ? (
            <p className="mt-2 font-mono text-[10px] text-muted-foreground/60">
              Completed {objective.completedAt} · {objective.model}
            </p>
          ) : null}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
