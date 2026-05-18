'use client';

import {
  ArrowRightToLine,
  ArrowUpCircle,
  Bot,
  Calendar,
  CalendarClock,
  CheckCircle,
  ChevronDown,
  EllipsisVertical,
  FastForward,
  GripVertical,
  PauseCircle,
  Plus,
  Tag
} from 'lucide-react';
import Image from 'next/image';
import { useLayoutEffect, useState } from 'react';

import { AgentModelChooserTrigger } from '@/components/features/AgentModelChooserTrigger';
import {
  AgentModelSelector,
  seedAgentModelsCache,
  useAgentModels
} from '@/components/features/AgentModelSelector';
import { AgentSplitButton } from '@/components/features/AgentSplitButton';
import { MarkdownContent } from '@/components/features/MarkdownContent';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { AgentModelSelection } from '@/lib/helpers/agent-model-preference';
import type { AgentSelectorValue, LaunchAgentType } from '@/lib/helpers/agent-types';
import {
  MARKETING_OFFERED_AGENT_MODELS,
  resolveMarketingAgentModels
} from '@/lib/marketing/offered-agent-models';
import { cn } from '@/lib/utils';

import { DEMO_OBJECTIVES, DEMO_TICKET_DETAILS, type DemoObjective } from './mock-ticket-details';

const DEMO_TICKET_ID = 'demo-ticket';

export function DemoTicketDetails() {
  useLayoutEffect(() => {
    seedAgentModelsCache(MARKETING_OFFERED_AGENT_MODELS);
  }, []);

  return (
    <div className="overflow-hidden rounded-xl bg-card text-foreground shadow-inner">
      <PanelHeader />
      <div className="bg-card py-5">
        <div className="px-5">
          <div className="mb-4">
            <h2 className="text-xl font-semibold leading-tight">{DEMO_TICKET_DETAILS.title}</h2>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Chip>
              <Calendar className="h-3 w-3" />
              {DEMO_TICKET_DETAILS.due_label}
            </Chip>
            <Chip>
              <CalendarClock className="h-3 w-3" />
              {DEMO_TICKET_DETAILS.schedule_label}
            </Chip>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {DEMO_TICKET_DETAILS.tags.map(tag => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
                style={{ borderColor: `${tag.color}55` }}
              >
                <Tag className="h-2.5 w-2.5" style={{ color: tag.color }} />
                {tag.label}
              </span>
            ))}
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-background"
            >
              <Plus className="h-2.5 w-2.5" />
              Add tag
            </button>
          </div>
        </div>

        <ObjectivesSection />
      </div>

      <div className="border-t px-5 pb-2">
        <Accordion type="multiple" defaultValue={[]}>
          <AccordionItem value="acceptance-criteria" className="border-b-0">
            <AccordionTrigger className="eyebrow text-xs py-3 hover:no-underline">
              Acceptance Criteria
            </AccordionTrigger>
            <AccordionContent>
              <p className="pl-2 pb-2 text-sm leading-relaxed text-muted-foreground">
                {DEMO_TICKET_DETAILS.acceptance_criteria}
              </p>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="tools" className="border-b-0">
            <AccordionTrigger className="eyebrow text-xs py-3 hover:no-underline">
              Tools
            </AccordionTrigger>
            <AccordionContent>
              <p className="pl-2 pb-2 text-sm leading-relaxed text-muted-foreground">
                {DEMO_TICKET_DETAILS.available_tools}
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
}

function PanelHeader() {
  return (
    <div className="relative flex items-center justify-between gap-2 border-b px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Button
          aria-label="Ticket actions"
          className="h-7 w-7"
          size="icon"
          variant="ghost"
          type="button"
        >
          <EllipsisVertical className="h-3.5 w-3.5" />
        </Button>
        <span className="inline-flex h-7 items-center gap-1 rounded-full border bg-background px-2 text-[11px] text-muted-foreground">
          <Bot className="h-3 w-3" />
          Agent
        </span>
      </div>
      <div className="flex items-center justify-end gap-3">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs">
            <span
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{ backgroundColor: DEMO_TICKET_DETAILS.project_color }}
            />
            <span className="font-medium">{DEMO_TICKET_DETAILS.project_name}</span>
            <span className="font-mono text-muted-foreground">
              {DEMO_TICKET_DETAILS.ticket_identifier}
            </span>
          </span>
          <div className="h-3.5 w-px bg-border" />
          <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[11px]">
            {DEMO_TICKET_DETAILS.status}
            <ChevronDown className="ml-1 h-3 w-3" />
          </Badge>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          type="button"
          aria-label="Close panel"
        >
          <ArrowRightToLine className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ObjectivesSection() {
  const completed = DEMO_OBJECTIVES.filter(o => o.state === 'complete');
  const draft = DEMO_OBJECTIVES.filter(o => o.state === 'draft');
  const future = DEMO_OBJECTIVES.filter(o => o.state === 'future');

  return (
    <div className="flex flex-col px-5">
      {completed.length > 0 ? (
        <div className="mb-3 space-y-0 rounded-md border bg-background">
          {completed.map(objective => (
            <CompletedObjective key={objective.id} objective={objective} />
          ))}
        </div>
      ) : null}

      <div className="space-y-3">
        {draft.map(objective => (
          <DemoDraftObjective key={objective.id} objective={objective} />
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
  isFuture = false
}: {
  objective: DemoObjective;
  isFuture?: boolean;
}) {
  const { models: fetchedModels } = useAgentModels();
  const catalogModels = resolveMarketingAgentModels(fetchedModels);
  const initialSelection = demoSelectionFromObjective(objective);
  const [assignedSelection, setAssignedSelection] = useState(initialSelection);
  const [selectedAgent, setSelectedAgent] = useState<AgentSelectorValue>(initialSelection.agent);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(objective.autoAdvance ?? true);

  return (
    <div className="flex min-w-0 items-center gap-2 justify-between overflow-hidden px-2 py-1.5">
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 gap-1 px-2 text-xs text-muted-foreground',
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
      </div>
      <div className="flex items-center gap-2">
        <Popover open={chooserOpen} onOpenChange={setChooserOpen}>
          <PopoverTrigger asChild>
            <AgentModelChooserTrigger
              selection={assignedSelection}
              active={chooserOpen}
              onToggle={() => {}}
            />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            collisionPadding={{ left: 8, right: 8 }}
            className="w-auto min-w-[320px] p-2"
          >
            <AgentModelSelector
              demo
              catalogModels={catalogModels}
              value={assignedSelection}
              onChange={setAssignedSelection}
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
            assignedSelection={assignedSelection}
            hasProjectWorkingDirectory
            workingDirectory="/demo"
          />
        )}
      </div>
    </div>
  );
}

function DemoDraftObjective({ objective }: { objective: DemoObjective }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-muted-foreground/20 bg-card">
      <div className="px-3 pt-3">
        <p className="whitespace-pre-wrap text-base leading-relaxed">{objective.body}</p>
      </div>
      <div className="border-t border-border/40">
        <DemoObjectiveAgentControls objective={objective} />
      </div>
    </div>
  );
}

function DemoFutureObjective({ objective }: { objective: DemoObjective }) {
  return (
    <div className="relative flex items-stretch gap-2">
      <div className="flex w-5 shrink-0 items-center justify-center self-stretch text-muted-foreground/40">
        <GripVertical className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-border/35 bg-muted/20 opacity-70 transition-opacity focus-within:opacity-100">
        <div className="group/future relative max-h-[3.25rem] overflow-hidden transition-[max-height] duration-200 ease-in-out hover:max-h-[500px] focus-within:max-h-[500px]">
          <div className="px-3 pt-3">
            <p className="whitespace-pre-wrap text-base leading-relaxed text-muted-foreground">
              {objective.body}
            </p>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background/80 to-transparent transition-opacity duration-200 group-hover/future:opacity-0 group-focus-within/future:opacity-0" />
        </div>
        <div className="border-t border-border/40">
          <DemoObjectiveAgentControls objective={objective} isFuture />
        </div>
      </div>
    </div>
  );
}

function AgentIcon({ agent }: { agent?: DemoObjective['agent'] }) {
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
              <div className="flex w-full items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-500" />
                  <AgentIcon agent={objective.agent} />
                  <p className="truncate text-sm font-medium">{objective.title}</p>
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

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border bg-background px-2.5 text-[11px] text-muted-foreground">
      {children}
    </span>
  );
}
