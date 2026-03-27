'use client';

import { ArrowLeft, Bot, Moon, Sun, TerminalSquare, UserRound } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { useCallback, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import { DemoCurrentChangesPage } from './DemoCurrentChangesPage';
import { DemoFeedPage } from './DemoFeedPage';
import { DemoSettings } from './DemoSettings';
import { DemoTerminal } from './DemoTerminal';
import { DemoTicketPanel } from './DemoTicketPanel';
import {
  DEMO_PROJECT,
  DEMO_TICKETS,
  type DemoTicket,
  DISCUSS_TERMINAL_LINES,
  OVLD_COMMANDS_TERMINAL_LINES,
  RUN_TERMINAL_LINES,
  type TerminalLine
} from './mock-data';

function toColumnTitle(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/* ─── Kanban card (simplified demo version) ─── */

function DemoKanbanCard({
  ticket,
  isSelected,
  onClick
}: {
  ticket: DemoTicket;
  isSelected: boolean;
  onClick: () => void;
}) {
  const isAgentRunning = ticket.agent_session_state === 'attached';
  const hasUnopenedReview = !ticket.is_read;

  const activeAgentIdentifier = ticket.running_agent ?? ticket.latest_objective_agent;
  const agentType = activeAgentIdentifier
    ? activeAgentIdentifier === 'codex'
      ? { icon: '/images/icons/codex.svg', label: 'Codex' }
      : { icon: '/images/icons/claude-code.svg', label: 'Claude Code' }
    : null;

  return (
    <Card
      className={cn(
        'relative cursor-pointer overflow-hidden rounded-md border-gray-300/40 transition-all hover:shadow-md dark:border-gray-700/40 bg-linear-to-br from-blue-300/10 to-transparent',
        isAgentRunning && 'animate-pulse border-emerald-500/40',
        isSelected &&
          'border-gray-400/60 dark:border-gray-500/70 bg-gray-100/70 dark:bg-gray-950/25',
        hasUnopenedReview &&
          'border-sky-500/40 bg-sky-50/60 bg-linear-to-br from-sky-300/18 to-transparent dark:bg-sky-950/25'
      )}
      onClick={onClick}
    >
      {hasUnopenedReview && (
        <span className="absolute right-2 top-2 z-10">
          <span
            className="h-2.5 w-2.5 rounded-full ring-2 ring-background bg-sky-500 inline-block"
            title="This ticket moved to review and has not been opened yet"
          />
        </span>
      )}
      {isAgentRunning && (
        <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2s_linear_infinite] bg-linear-to-r from-transparent via-emerald-500/20 to-transparent" />
      )}
      <CardContent className="flex h-full flex-col p-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-start gap-2">
            <span
              className="mt-1 block h-2.5 w-2.5 shrink-0 rounded-[2px] border"
              style={{
                backgroundColor: ticket.project_color,
                borderColor: ticket.project_color
              }}
              title={ticket.project_name}
            />
            <h4 className="text-sm font-medium leading-snug">{ticket.title}</h4>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge
            variant="outline"
            className={cn(
              'gap-1 rounded-full px-2.5 py-0 text-[11px] font-medium',
              ticket.execution_target === 'agent'
                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200'
            )}
          >
            {ticket.execution_target === 'agent' ? (
              <Bot className="h-3 w-3" />
            ) : (
              <UserRound className="h-3 w-3" />
            )}
            {ticket.execution_target === 'agent' ? 'Agent' : 'Human'}
          </Badge>
        </div>
        <div className="mt-auto flex items-center justify-end gap-2 pt-2">
          {agentType && (
            <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
              <Image
                src={agentType.icon}
                alt={`${agentType.label} icon`}
                width={12}
                height={12}
                className="h-3 w-3 shrink-0"
              />
              <span className="truncate">{agentType.label}</span>
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Kanban column ─── */

function DemoKanbanColumn({
  title,
  tickets,
  selectedTicketId,
  onSelectTicket
}: {
  title: string;
  tickets: DemoTicket[];
  selectedTicketId: string | null;
  onSelectTicket: (ticket: DemoTicket) => void;
}) {
  return (
    <div className="flex min-w-[260px] shrink-0 flex-1 flex-col rounded-lg bg-muted/30">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <Badge variant="secondary" className="rounded-full">
          {tickets.length}
        </Badge>
      </div>
      <div className="flex-1 px-3">
        <div className="flex flex-col gap-2">
          {tickets.map(ticket => (
            <DemoKanbanCard
              key={ticket.id}
              ticket={ticket}
              isSelected={selectedTicketId === ticket.id}
              onClick={() => onSelectTicket(ticket)}
            />
          ))}
        </div>
        <div className="h-6" />
      </div>
    </div>
  );
}

/* ─── Window frame ─── */

function WindowFrame({
  children,
  title = 'Overlord',
  className,
  focused = true,
  onClick
}: {
  children: React.ReactNode;
  title?: string;
  className?: string;
  focused?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className={cn('flex flex-col items-center', className)} onClick={onClick}>
      <div
        className={cn(
          'w-full overflow-hidden rounded-xl border border-border/60 bg-[#1a1a1a] transition-shadow duration-500 dark:border-border/40',
          focused ? 'shadow-2xl' : 'shadow-sm'
        )}
      >
        {/* Title bar with traffic lights */}
        <div className="flex items-center gap-2 bg-[#2a2a2a] px-4 py-2.5 dark:bg-[#1e1e1e]">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-xs text-[#999]">{title}</span>
        </div>
        {/* Content */}
        {children}
      </div>
    </div>
  );
}

/* ─── Theme toggle ─── */

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="outline"
      size="icon"
      className="h-8 w-8"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

/* ─── Main demo component ─── */

export function DemoContent() {
  const [tickets, setTickets] = useState<DemoTicket[]>(() => [...DEMO_TICKETS]);
  const [selectedTicket, setSelectedTicket] = useState<DemoTicket | null>(null);
  const [showCurrentChanges, setShowCurrentChanges] = useState(false);
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [terminalKey, setTerminalKey] = useState(0);
  const [terminalFocused, setTerminalFocused] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  const columns = useMemo(() => {
    const statuses = ['draft', 'execute', 'review'] as const;
    return statuses.map(status => ({
      id: status,
      title: toColumnTitle(status),
      tickets: tickets.filter(t => t.status === status)
    }));
  }, [tickets]);

  const reviewTickets = useMemo(
    () => tickets.filter(ticket => ticket.status === 'review'),
    [tickets]
  );

  const scrollToTerminal = useCallback(() => {
    setTimeout(() => {
      terminalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }, []);

  const handleDiscuss = useCallback(() => {
    setTerminalLines(DISCUSS_TERMINAL_LINES);
    setTerminalRunning(false);
    setTerminalKey(k => k + 1);
    setTerminalFocused(true);
    setTimeout(() => setTerminalRunning(true), 50);
    scrollToTerminal();
  }, [scrollToTerminal]);

  const handleRun = useCallback(() => {
    // Move the selected ticket into execute state
    if (selectedTicket) {
      const updatedTicket: DemoTicket = {
        ...selectedTicket,
        status: 'execute',
        agent_session_state: 'attached',
        running_agent: 'claude-code',
        latest_objective_agent: 'claude-code'
      };
      setTickets(prev => prev.map(t => (t.id === selectedTicket.id ? updatedTicket : t)));
      setSelectedTicket(updatedTicket);
    }

    setTerminalLines(RUN_TERMINAL_LINES);
    setTerminalRunning(false);
    setTerminalKey(k => k + 1);
    setTerminalFocused(true);
    setTimeout(() => setTerminalRunning(true), 50);
    scrollToTerminal();
  }, [scrollToTerminal, selectedTicket]);

  const handleOvldDemo = useCallback(() => {
    setTerminalLines(OVLD_COMMANDS_TERMINAL_LINES);
    setTerminalRunning(false);
    setTerminalKey(k => k + 1);
    setTimeout(() => setTerminalRunning(true), 50);
  }, []);

  return (
    <div className="min-h-dvh bg-linear-to-b from-muted/40 to-background">
      <Tabs defaultValue="board" className="flex flex-col">
        {/* Page header — back button left, tabs + theme toggle centered */}
        <div className="relative flex flex-col items-center gap-4 px-6 pt-8 pb-6">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="absolute left-6 top-8 gap-1.5 text-muted-foreground"
          >
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              Home
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl border bg-background text-sm font-semibold shadow-sm">
              OV
            </div>
            <div>
              <p className="text-base font-semibold">Overlord Demo</p>
              <p className="text-xs text-muted-foreground">Interactive product walkthrough</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <TabsList>
              <TabsTrigger value="board">Project Board</TabsTrigger>
              <TabsTrigger value="feed">Feed</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="cli">CLI Preview</TabsTrigger>
            </TabsList>
            <ThemeToggle />
          </div>
        </div>

        {/* Board tab */}
        <TabsContent value="board" className="mt-0 px-6 pb-12">
          <div className="mx-auto mb-6 max-w-[1200px] rounded-2xl  bg-background/80 px-6 py-5 text-center">
            <p className="text-lg font-semibold tracking-tight text-foreground">
              Click on any task in the draft column to open it, then click the "Run" button to see
              how Overlord interacts with agents in your terminal
            </p>
          </div>

          {/* Main app window */}
          <WindowFrame
            className="max-w-[1200px] mx-auto"
            focused={!terminalFocused}
            onClick={() => setTerminalFocused(false)}
          >
            <div className="h-[680px] overflow-hidden bg-background">
              <div className="flex h-full flex-col overflow-hidden">
                <div className="flex flex-1 min-h-0 overflow-hidden">
                  {/* Board */}
                  <div
                    className={cn(
                      'flex-1 overflow-y-auto overflow-x-auto',
                      selectedTicket && !showCurrentChanges && 'hidden lg:block'
                    )}
                  >
                    {/* Project header */}
                    <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
                      <span
                        className="h-3 w-3 rounded-[3px]"
                        style={{ backgroundColor: DEMO_PROJECT.color }}
                      />
                      <h2 className="text-sm font-semibold">{DEMO_PROJECT.name}</h2>
                      <span className="text-xs text-muted-foreground">
                        {DEMO_PROJECT.description}
                      </span>
                      <div className="ml-auto flex items-center rounded-lg border bg-muted/40 p-1">
                        <button
                          type="button"
                          className={cn(
                            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                            !showCurrentChanges
                              ? 'bg-background text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                          onClick={() => setShowCurrentChanges(false)}
                          aria-pressed={!showCurrentChanges}
                        >
                          Board
                        </button>
                        <button
                          type="button"
                          className={cn(
                            'relative overflow-hidden rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                            showCurrentChanges
                              ? 'bg-background text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                          onClick={() => setShowCurrentChanges(true)}
                          aria-pressed={showCurrentChanges}
                        >
                          {!showCurrentChanges && (
                            <span className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_6s_ease-in-out_infinite] bg-linear-to-r from-transparent via-sky-500/20 to-transparent" />
                          )}
                          <span className="relative z-10">Current Changes</span>
                        </button>
                      </div>
                    </div>

                    {showCurrentChanges ? (
                      <DemoCurrentChangesPage
                        projectName={DEMO_PROJECT.name}
                        reviewTickets={reviewTickets}
                      />
                    ) : (
                      <div className="flex gap-4 p-4">
                        {columns.map(col => (
                          <DemoKanbanColumn
                            key={col.id}
                            title={col.title}
                            tickets={col.tickets}
                            selectedTicketId={selectedTicket?.id ?? null}
                            onSelectTicket={setSelectedTicket}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Ticket panel */}
                  {selectedTicket && !showCurrentChanges && (
                    <div className="w-full lg:w-[420px] lg:shrink-0">
                      <DemoTicketPanel
                        ticket={selectedTicket}
                        onClose={() => setSelectedTicket(null)}
                        onDiscuss={handleDiscuss}
                        onRun={handleRun}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </WindowFrame>

          {/* Terminal window — separate, below, not full width */}
          {terminalLines.length > 0 && (
            <div ref={terminalRef}>
              <WindowFrame
                title="Terminal"
                className="mx-auto mt-6 max-w-[800px]"
                focused={terminalFocused}
              >
                <div className="bg-[#0c0c0c]">
                  <DemoTerminal
                    key={terminalKey}
                    lines={terminalLines}
                    isRunning={terminalRunning}
                    onComplete={() => setTerminalRunning(false)}
                  />
                </div>
              </WindowFrame>
            </div>
          )}
        </TabsContent>

        {/* Feed tab */}
        <TabsContent value="feed" className="mt-0 px-6 pb-12">
          <DemoFeedPage />
        </TabsContent>

        {/* Settings tab */}
        <TabsContent value="settings" className="mt-0 px-6 pb-12">
          <div className="mx-auto max-w-[1000px] space-y-4">
            <div className="text-center">
              <h2 className="text-lg font-semibold">Settings</h2>
              <p className="text-sm text-muted-foreground">
                Explore the settings interface. Changes in this demo don&apos;t persist.
              </p>
            </div>
            <WindowFrame title="Settings">
              <div className="h-[560px] overflow-hidden bg-background">
                <DemoSettings />
              </div>
            </WindowFrame>
          </div>
        </TabsContent>

        {/* CLI preview tab */}
        <TabsContent value="cli" className="mt-0 px-6 pb-12">
          <div className="mx-auto max-w-[800px] space-y-4">
            <div className="text-center">
              <h2 className="text-lg font-semibold">CLI Preview</h2>
              <p className="text-sm text-muted-foreground">
                See what the Overlord CLI looks like in action.
              </p>
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              <Button variant="outline" className="gap-2" onClick={handleOvldDemo}>
                <TerminalSquare className="h-4 w-4" />
                ovld --help
              </Button>
              <Button variant="outline" className="gap-2" onClick={handleDiscuss}>
                <TerminalSquare className="h-4 w-4" />
                ovld discuss
              </Button>
              <Button variant="outline" className="gap-2" onClick={handleRun}>
                <TerminalSquare className="h-4 w-4" />
                ovld run
              </Button>
            </div>

            <WindowFrame title="Terminal">
              <div className="bg-[#0c0c0c]">
                <DemoTerminal
                  key={terminalKey + 1000}
                  lines={terminalLines}
                  isRunning={terminalRunning}
                  onComplete={() => setTerminalRunning(false)}
                />
              </div>
            </WindowFrame>

            <div className="rounded-lg border bg-muted/30 p-4">
              <h3 className="text-sm font-semibold mb-2">How it works</h3>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  The Overlord CLI (
                  <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">ovld</code>)
                  connects your terminal to tickets. Agents use it to:
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Attach to a ticket and start a session</li>
                  <li>Post progress updates as they work</li>
                  <li>Ask blocking questions when they need human input</li>
                  <li>Deliver results back to the ticket for review</li>
                </ul>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
