'use client';

import { ChevronDown, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';
import { toast } from 'sonner';

import { useProjectSettings } from '@/components/features/projects/ProjectSettingsContext';
import { Button } from '@/components/ui/button';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@/components/ui/popover';
import { ensureAgentTokenAction } from '@/lib/actions/agent-tokens';
import { getTicketPromptForCopy } from '@/lib/actions/tickets';
import { normalizeAgentToken } from '@/lib/helpers/agent-token';
import {
  getAgentTypeByValue,
  getLaunchAgentTypeByIdentifier,
  LAUNCH_AGENT_VALUES,
  type LaunchAgentTypeValue
} from '@/lib/helpers/agent-types';

import { useTerminal } from './terminal/TerminalProvider';
import type { WebAgentMode } from './WebAgentModeButton';

type DiscussTicketButtonProps = {
  ticketId: string;
  organizationId?: number;
  agentIdentifier?: string | null;
  agentToken?: string | null;
  agentFlags?: Partial<Record<LaunchAgentTypeValue, string[]>>;
  workingDirectory?: string | null;
  webMode?: WebAgentMode;
};

const defaultAgentButtonStates: Record<LaunchAgentTypeValue, ButtonLoadingState> = {
  claude: 'default',
  codex: 'default',
  cursor: 'default',
  gemini: 'default',
  opencode: 'default'
};

export function DiscussTicketButton({
  ticketId,
  organizationId,
  agentIdentifier,
  agentToken,
  agentFlags,
  workingDirectory,
  webMode
}: DiscussTicketButtonProps) {
  const { isElectron, launchAgent } = useTerminal();
  const projectSettings = useProjectSettings();
  const [isOpen, setIsOpen] = useState(false);
  const [webCopied, setWebCopied] = useState(false);
  const [agentButtonStates, setAgentButtonStates] =
    useState<Record<LaunchAgentTypeValue, ButtonLoadingState>>(defaultAgentButtonStates);
  const effectiveWorkingDirectory =
    projectSettings?.effectiveWorkingDirectory ?? workingDirectory ?? null;
  const effectiveSshCommand = projectSettings?.effectiveSshCommand ?? null;
  const effectiveRemoteWorkingDirectory = projectSettings?.effectiveRemoteWorkingDirectory ?? null;
  const preferredAgent = getLaunchAgentTypeByIdentifier(agentIdentifier);
  const launchAgents = [
    preferredAgent,
    ...LAUNCH_AGENT_VALUES.filter(agentValue => agentValue !== preferredAgent)
  ];

  function setAgentButtonState(agentValue: LaunchAgentTypeValue, buttonState: ButtonLoadingState) {
    setAgentButtonStates({
      ...defaultAgentButtonStates,
      [agentValue]: buttonState
    });
  }

  async function handleDiscuss(agentValue: LaunchAgentTypeValue) {
    setAgentButtonState(agentValue, 'loading');

    try {
      if (isElectron) {
        const providedAgentToken = normalizeAgentToken(agentToken);
        const resolvedAgentToken =
          providedAgentToken ??
          (organizationId
            ? await ensureAgentTokenAction(organizationId)
            : (() => {
                throw new Error('No workspace is available for agent token resolution.');
              })());
        await launchAgent(
          ticketId,
          agentValue,
          effectiveWorkingDirectory ?? undefined,
          resolvedAgentToken,
          'ask',
          agentFlags?.[agentValue],
          undefined,
          undefined,
          effectiveSshCommand ?? undefined,
          effectiveRemoteWorkingDirectory ?? undefined
        );
      } else {
        const { error, prompt } = await getTicketPromptForCopy(ticketId, 'ask', 'web');
        if (error || !prompt) {
          throw new Error(error ?? 'Unable to build ask prompt.');
        }
        await navigator.clipboard.writeText(prompt);
      }

      setAgentButtonState(agentValue, 'success');
      setIsOpen(false);
    } catch (error) {
      setAgentButtonState(agentValue, 'error');
      console.error('Failed to run discuss flow:', error);
      toast.error('Failed to open terminal', {
        description:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'Check your terminal settings and agent token, then try again.'
      });
    }
  }

  if (!isElectron && webMode !== undefined) {
    const handleWebDiscuss = async () => {
      const context = webMode === 'local' ? 'cli' : 'web';
      const { error, prompt } = await getTicketPromptForCopy(ticketId, 'ask', context);
      if (error || !prompt) return;
      await navigator.clipboard.writeText(prompt);
      setWebCopied(true);
      setTimeout(() => setWebCopied(false), 2000);
    };

    return (
      <Button
        className="h-8 px-3 text-xs"
        size="sm"
        variant="outline"
        onClick={() => void handleWebDiscuss()}
      >
        {webCopied ? 'Copied!' : 'Discuss'}
      </Button>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button className="h-8 px-3 text-xs" size="sm" variant="outline">
          Discuss
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <PopoverHeader className="px-2 py-1">
          <PopoverTitle>Discuss with an agent</PopoverTitle>
          <PopoverDescription className="text-xs">
            Choose which agent should open the ask flow for this ticket.
          </PopoverDescription>
        </PopoverHeader>
        <div className="mt-1 flex flex-col gap-1">
          {launchAgents.map(agentValue => {
            const agent = getAgentTypeByValue(agentValue);
            const buttonState = agentButtonStates[agentValue];
            const label = agentValue === preferredAgent ? `${agent.label} (default)` : agent.label;

            const content = (
              <>
                <Image
                  src={agent.icon}
                  alt={`${agent.label} icon`}
                  width={14}
                  height={14}
                  className="h-3.5 w-3.5"
                />
                <span>{label}</span>
              </>
            );

            return (
              <LoadingButton
                key={agentValue}
                buttonState={buttonState}
                className="h-9 w-full justify-start px-2 text-xs"
                errorText={
                  <>
                    <Image
                      src={agent.icon}
                      alt={`${agent.label} icon`}
                      width={14}
                      height={14}
                      className="h-3.5 w-3.5"
                    />
                    <span>{agent.label} failed</span>
                  </>
                }
                loadingText={
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Opening {agent.label}...</span>
                  </>
                }
                reset
                setButtonState={state => setAgentButtonState(agentValue, state)}
                size="sm"
                successText={
                  <>
                    <Image
                      src={agent.icon}
                      alt={`${agent.label} icon`}
                      width={14}
                      height={14}
                      className="h-3.5 w-3.5"
                    />
                    <span>{agent.label} ready</span>
                  </>
                }
                text={content}
                variant="ghost"
                onClick={() => handleDiscuss(agentValue)}
              />
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
