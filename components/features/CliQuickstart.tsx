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
import { buildNativeResumeCommand } from '@/lib/overlord/launch-commands';

type QuickstartCommands = Record<LaunchAgentTypeValue, string>;

type CliQuickstartProps = {
  activeAgentValue?: string | null;
  externalSessionId?: string | null;
  claudeCommand?: string;
  codexCommand?: string;
  cursorCommand?: string;
  geminiCommand?: string;
  opencodeCommand?: string;
  claudeResumeCommand?: string;
  codexResumeCommand?: string;
  cursorResumeCommand?: string;
  geminiResumeCommand?: string;
  opencodeResumeCommand?: string;
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
    <Button className="h-7 gap-1.5 px-2 text-xs" size="sm" variant="outline" onClick={handleCopy}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function CommandRow({ label, command }: { label: string; command: string }) {
  return (
    <div className="rounded-md border bg-background/80 p-2.5">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded bg-muted/60 px-2 py-1.5 text-xs">
          {command}
        </code>
        <CommandCopyButton value={command} />
      </div>
    </div>
  );
}

export function CliQuickstart({
  activeAgentValue = null,
  externalSessionId = null,
  claudeCommand,
  codexCommand,
  cursorCommand,
  geminiCommand,
  opencodeCommand,
  claudeResumeCommand,
  codexResumeCommand,
  cursorResumeCommand,
  geminiResumeCommand,
  opencodeResumeCommand
}: CliQuickstartProps) {
  const defaultSelectedAgent: LaunchAgentTypeValue =
    activeAgentValue && LAUNCH_AGENT_VALUES.includes(activeAgentValue as LaunchAgentTypeValue)
      ? (activeAgentValue as LaunchAgentTypeValue)
      : 'claude';
  const [selectedAgent, setSelectedAgent] = useState<LaunchAgentTypeValue>(defaultSelectedAgent);

  useEffect(() => {
    setSelectedAgent(defaultSelectedAgent);
  }, [defaultSelectedAgent]);

  const connectCommands = useMemo<QuickstartCommands>(
    () => ({
      claude: claudeCommand ?? 'ovld connect claude',
      codex: codexCommand ?? 'ovld connect codex',
      cursor: cursorCommand ?? 'ovld connect cursor',
      gemini: geminiCommand ?? 'ovld connect gemini',
      opencode: opencodeCommand ?? 'ovld connect opencode'
    }),
    [claudeCommand, codexCommand, cursorCommand, geminiCommand, opencodeCommand]
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

  const nativeResumeCommands: Partial<QuickstartCommands> = useMemo(() => {
    const claudeResume = buildNativeResumeCommand('claude', externalSessionId);
    const codexResume = buildNativeResumeCommand('codex', externalSessionId);
    const cursorResume = buildNativeResumeCommand('cursor', externalSessionId);
    const geminiResume = buildNativeResumeCommand('gemini', externalSessionId);
    const openCodeResume = buildNativeResumeCommand('opencode', externalSessionId);

    return {
      claude: claudeResume ?? 'claude --resume <claude-session-id>',
      codex: codexResume ?? 'codex resume <codex-session-id>',
      ...(cursorResume ? { cursor: cursorResume } : {}),
      ...(geminiResume ? { gemini: geminiResume } : {}),
      opencode: openCodeResume ?? 'opencode --continue --session <opencode-session-id>'
    };
  }, [externalSessionId]);

  return (
    <section className="mb-6">
      <Accordion type="single" collapsible>
        <AccordionItem value="cli-quickstart">
          <AccordionTrigger className="py-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:no-underline">
            CLI Quickstart
          </AccordionTrigger>
          <AccordionContent>
            <div className="rounded-lg border bg-muted/20 p-3">
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
                <CommandRow
                  label="Connect to this ticket"
                  command={connectCommands[selectedAgent]}
                />
                <CommandRow
                  label="Restart session"
                  command={
                    nativeResumeCommands[selectedAgent] ?? overlordResumeCommands[selectedAgent]
                  }
                />
                {nativeResumeCommands[selectedAgent] ? (
                  <CommandRow
                    label="Restart session (Overlord wrapper)"
                    command={overlordResumeCommands[selectedAgent]}
                  />
                ) : null}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
