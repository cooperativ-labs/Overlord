'use client';

import {
  Bot,
  Check,
  ChevronDown,
  FastForward,
  Loader2,
  PauseCircle,
  Plus,
  TerminalSquare
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { AgentModelChooserTrigger } from '@/components/features/AgentModelChooserTrigger';
import {
  AgentModelSelector,
  seedAgentModelsCache,
  useAgentModels
} from '@/components/features/AgentModelSelector';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { AgentModelSelection } from '@/lib/helpers/agent-model-preference';
import {
  type AgentSelectorValue,
  isLaunchAgentTypeValue,
  type LaunchAgentType
} from '@/lib/helpers/agent-types';
import {
  MARKETING_OFFERED_AGENT_MODELS,
  resolveMarketingAgentModels
} from '@/lib/marketing/offered-agent-models';
import { cn } from '@/lib/utils';

type DemoTerminalLine = {
  text: string;
  type: 'system' | 'agent' | 'info' | 'success' | 'command';
  delay: number;
};

const DEMO_OBJECTIVE =
  'Click the "Run" button to see the objective launch in the correct repository workspace.';

const INITIAL_SELECTION: AgentModelSelection = {
  agent: 'codex',
  model: 'gpt-5.4',
  thinking: null
};

const TERMINAL_LINES: DemoTerminalLine[] = [
  { text: '[overlord] Switching to the project workspace...', type: 'info', delay: 0 },
  { text: 'cd user/you/project', type: 'command', delay: 350 },
  { text: '', type: 'system', delay: 600 },
  { text: 'Starting Codex from the selected project directory...', type: 'system', delay: 850 },
  {
    text: 'Attaching to ticket objective: Launch in the correct repository workspace.',
    type: 'agent',
    delay: 1450
  },
  {
    text: 'Reading CLAUDE.md and project-specific agent instructions.',
    type: 'agent',
    delay: 2150
  },
  { text: 'Checking the working tree before editing files.', type: 'agent', delay: 2850 },
  {
    text: 'Beginning work from user/you/project so repository context, scripts, and tests all match the ticket.',
    type: 'agent',
    delay: 3600
  },
  { text: '', type: 'system', delay: 4200 },
  { text: '[overlord] Agent is running in the right repo.', type: 'success', delay: 4600 }
];

export function DemoObjectiveTerminal() {
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [terminalKey, setTerminalKey] = useState(0);
  const runStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    seedAgentModelsCache(MARKETING_OFFERED_AGENT_MODELS);
  }, []);

  useEffect(() => {
    return () => {
      if (runStartTimerRef.current) {
        clearTimeout(runStartTimerRef.current);
      }
    };
  }, []);

  function handleRun() {
    if (runStartTimerRef.current) {
      clearTimeout(runStartTimerRef.current);
    }
    setTerminalRunning(false);
    setTerminalKey(key => key + 1);
    runStartTimerRef.current = setTimeout(() => setTerminalRunning(true), 50);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-slate-950 text-foreground shadow-inner">
      <div className="border-b border-white/5 px-2 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <TerminalSquare className="h-4 w-4 text-sky-400" />
            <p className="text-sm font-semibold text-slate-100">Repo-aware launch</p>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-slate-400">
            user/you/project
          </span>
        </div>
      </div>

      <div className="space-y-4 p-2 md:p-4">
        <DemoObjectiveCard onRun={handleRun} running={terminalRunning} />
        <MockTerminal
          key={terminalKey}
          lines={TERMINAL_LINES}
          isRunning={terminalRunning}
          onComplete={() => setTerminalRunning(false)}
        />
      </div>
    </div>
  );
}

function DemoObjectiveCard({ onRun, running }: { onRun: () => void; running: boolean }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-muted-foreground/20 bg-card">
      <div className="px-3 pt-3">
        <p className="whitespace-pre-wrap text-base leading-relaxed">{DEMO_OBJECTIVE}</p>
      </div>
      <div className="border-t border-border/40">
        <DemoObjectiveAgentControls onRun={onRun} running={running} />
      </div>
    </div>
  );
}

function DemoObjectiveAgentControls({ onRun, running }: { onRun: () => void; running: boolean }) {
  const { models: fetchedModels } = useAgentModels();
  const catalogModels = resolveMarketingAgentModels(fetchedModels);
  const [chooserSelection, setChooserSelection] = useState(INITIAL_SELECTION);
  const [selectedAgent, setSelectedAgent] = useState<AgentSelectorValue>(INITIAL_SELECTION.agent);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);

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
    <div className="flex min-w-0 items-center justify-between gap-2 overflow-hidden px-2 py-1.5">
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
              selection={chooserSelection}
              active={chooserOpen}
              onToggle={() => { }}
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
              value={chooserSelection}
              onChange={setChooserSelection}
              onAgentSelect={handleAgentSelect}
            />
          </PopoverContent>
        </Popover>
        <MockAgentSplitButton
          selectedAgent={selectedAgent}
          onSelectAgent={setSelectedAgent}
          assignedSelection={splitButtonSelection}
          running={running}
          onRun={onRun}
        />
      </div>
    </div>
  );
}

function MockAgentSplitButton({
  selectedAgent,
  onSelectAgent,
  assignedSelection,
  running,
  onRun
}: {
  selectedAgent: AgentSelectorValue;
  onSelectAgent: (agent: AgentSelectorValue) => void;
  assignedSelection: AgentModelSelection;
  running: boolean;
  onRun: () => void;
}) {
  function selectAndRun(agent: LaunchAgentType) {
    onSelectAgent(agent);
    onRun();
  }

  return (
    <div className="inline-flex items-stretch rounded-md border border-input bg-background text-sm shadow-sm transition-all hover:bg-accent hover:text-accent-foreground">
      <button
        type="button"
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-l-md px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        onClick={onRun}
      >
        {running ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Bot className="h-3.5 w-3.5" />
        )}
        <span className="whitespace-nowrap">{running ? 'Running' : 'Run'}</span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-8 cursor-pointer items-center rounded-r-md border-l px-2 transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label="Choose launch action"
          >
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[170px]">
          <DropdownMenuItem
            className="gap-2 text-xs"
            onClick={() => selectAndRun(assignedSelection.agent)}
          >
            <Bot className="h-3.5 w-3.5" />
            <span>Run</span>
            {selectedAgent === assignedSelection.agent ? (
              <Check className="ml-auto h-3 w-3 text-muted-foreground" />
            ) : null}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function MockTerminal({
  lines,
  isRunning,
  onComplete
}: {
  lines: DemoTerminalLine[];
  isRunning: boolean;
  onComplete: () => void;
}) {
  const [visibleLines, setVisibleLines] = useState<DemoTerminalLine[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) {
      clearTimeout(timer);
    }
    timersRef.current = [];
  }, []);

  useEffect(() => {
    if (!isRunning) return;

    setVisibleLines([]);
    clearTimers();

    let maxDelay = 0;
    for (const line of lines) {
      const timer = setTimeout(() => {
        setVisibleLines(prev => [...prev, line]);
      }, line.delay);
      timersRef.current.push(timer);
      if (line.delay > maxDelay) maxDelay = line.delay;
    }

    const completeTimer = setTimeout(onComplete, maxDelay + 500);
    timersRef.current.push(completeTimer);

    return clearTimers;
  }, [clearTimers, isRunning, lines, onComplete]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleLines]);

  function getLineColor(type: DemoTerminalLine['type']) {
    switch (type) {
      case 'command':
        return 'text-sky-400';
      case 'agent':
        return 'text-slate-300';
      case 'info':
        return 'text-amber-400';
      case 'success':
        return 'text-emerald-400';
      case 'system':
      default:
        return 'text-slate-500';
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-slate-300 shadow-inner">
      <div className="flex h-9 items-center gap-2 border-b border-slate-800 px-3">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <span className="ml-2 font-mono text-[11px] text-slate-500">Terminal</span>
      </div>
      <div
        ref={scrollRef}
        className="h-[240px] overflow-y-auto p-4 font-mono text-sm leading-relaxed"
      >
        {visibleLines.length === 0 && !isRunning ? (
          <p className="text-slate-600">
            Click <span className="text-slate-400">Run</span> to open the agent in the selected
            repo.
          </p>
        ) : null}
        {visibleLines.map((line, index) => (
          <div
            key={`${line.delay}-${index}`}
            className={cn('animate-in fade-in slide-in-from-bottom-1', getLineColor(line.type))}
          >
            {line.text === '' ? <br /> : line.text}
          </div>
        ))}
        {isRunning && visibleLines.length < lines.length ? (
          <span className="inline-block h-4 w-1.5 animate-pulse bg-slate-400" />
        ) : null}
      </div>
    </div>
  );
}
