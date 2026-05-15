'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import {
  getAgentTypeByValue,
  LAUNCH_AGENT_VALUES,
  type LaunchAgentTypeValue
} from '@/lib/helpers/agent-types';
import { AgentCommands, buildNativeResumeCommand } from '@/lib/overlord/launch-commands';

type QuickstartCommands = Record<LaunchAgentTypeValue, string>;

type CliQuickstartProps = {
  /** `panel` keeps the collapsible section used in the live ticket panel; `embedded` is body-only for parent-controlled expand/collapse. */
  variant?: 'panel' | 'embedded';
  activeAgentValue?: string | null;
  externalSessionId?: string | null;
  hasExecutedObjectives?: boolean;
  agentCommands?: AgentCommands;
};

function CommandCopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button
      className="h-7 gap-1.5 px-2 text-xs"
      size="sm"
      variant="ghost"
      onClick={handleCopy}
      aria-label="Copy command"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function CommandRow({ label, command }: { label: string; command: string }) {
  return (
    <div className="rounded-md border bg-background/80 p-2.5 min-w-[325px]">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex items-center ">
        <code className="relative min-w-0 flex-1 whitespace-pre-wrap wrap-break-word rounded bg-muted/60 px-2 pr-8 py-1.5 text-xs gap-2">
          {command}
          <div className="absolute right-0 top-0">
            <CommandCopyButton value={command} />
          </div>
        </code>
      </div>
    </div>
  );
}

function CliQuickstartBody({
  activeAgentValue = null,
  externalSessionId = null,
  agentCommands
}: Omit<CliQuickstartProps, 'variant' | 'hasExecutedObjectives'>) {
  const defaultSelectedAgent: LaunchAgentTypeValue =
    activeAgentValue && LAUNCH_AGENT_VALUES.includes(activeAgentValue as LaunchAgentTypeValue)
      ? (activeAgentValue as LaunchAgentTypeValue)
      : 'claude';
  const [selectedAgent, setSelectedAgent] = useState<LaunchAgentTypeValue>(defaultSelectedAgent);

  const { claudeCode, codex, cursor, gemini, opencode } = agentCommands?.launchCommands ?? {};
  const {
    claudeCode: claudeResumeCommand,
    codex: codexResumeCommand,
    cursor: cursorResumeCommand,
    gemini: geminiResumeCommand,
    opencode: opencodeResumeCommand
  } = agentCommands?.resumeCommands ?? {};

  useEffect(() => {
    setSelectedAgent(defaultSelectedAgent);
  }, [defaultSelectedAgent]);

  const connectCommands = useMemo<QuickstartCommands>(
    () => ({
      claude: claudeCode ?? 'ovld launch claude',
      codex: codex ?? 'ovld launch codex',
      cursor: cursor ?? 'ovld launch cursor',
      gemini: gemini ?? 'ovld launch gemini',
      opencode: opencode ?? 'ovld launch opencode'
    }),
    [claudeCode, codex, cursor, gemini, opencode]
  );

  const overlordResumeCommands = useMemo<QuickstartCommands>(
    () => ({
      claude: claudeResumeCommand ?? 'ovld restart claude',
      codex: codexResumeCommand ?? 'ovld restart codex',
      cursor: cursorResumeCommand ?? 'ovld restart cursor',
      gemini: geminiResumeCommand ?? 'ovld restart gemini',
      opencode: opencodeResumeCommand ?? 'ovld restart opencode'
    }),
    [
      claudeResumeCommand,
      codexResumeCommand,
      cursorResumeCommand,
      geminiResumeCommand,
      opencodeResumeCommand
    ]
  );

  // Only the agent that issued the session ID can use its native resume command.
  // A Codex session ID won't work with Claude (and vice versa), so we scope this
  // to the active/issuing agent only.
  const nativeResumeCommand = useMemo(
    () => buildNativeResumeCommand(activeAgentValue, externalSessionId),
    [activeAgentValue, externalSessionId]
  );

  return (
    <div className=" bg-muted/20 ">
      <div className="mb-3 flex flex-wrap gap-2">
        {LAUNCH_AGENT_VALUES.map(agentValue => {
          const agent = getAgentTypeByValue(agentValue);
          const isSelected = selectedAgent === agentValue;
          return (
            <Button
              key={agent.value}
              className="h-7 px-2 text-xs"
              size="sm"
              variant={isSelected ? 'default' : 'outline'}
              onClick={() => setSelectedAgent(agentValue)}
            >
              {agent.label}
            </Button>
          );
        })}
      </div>
      <div className="grid gap-2.5">
        {externalSessionId ? (
          <>
            {selectedAgent === activeAgentValue && nativeResumeCommand ? (
              <CommandRow label="Restart session" command={nativeResumeCommand} />
            ) : null}
            <CommandRow
              label={
                selectedAgent === activeAgentValue && nativeResumeCommand
                  ? 'Restart session (Overlord wrapper)'
                  : 'Restart session'
              }
              command={overlordResumeCommands[selectedAgent]}
            />
          </>
        ) : (
          <CommandRow label="Launch on this ticket" command={connectCommands[selectedAgent]} />
        )}
      </div>
    </div>
  );
}

export function CliQuickstart({
  variant = 'panel',
  activeAgentValue = null,
  externalSessionId = null,
  hasExecutedObjectives: _hasExecutedObjectives = false,
  agentCommands
}: CliQuickstartProps) {
  const bodyProps = {
    activeAgentValue,
    externalSessionId,
    agentCommands
  };

  if (variant === 'embedded') {
    return <CliQuickstartBody {...bodyProps} />;
  }

  return (
    <section className="mb-6">
      <Accordion type="single" collapsible>
        <AccordionItem value="cli-quickstart">
          <AccordionTrigger className="eyebrow py-3 hover:no-underline">
            CLI Quickstart
          </AccordionTrigger>
          <AccordionContent>
            <CliQuickstartBody {...bodyProps} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
