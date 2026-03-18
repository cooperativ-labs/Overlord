'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  getDefaultAgentTokenAction,
  updateOnboardingProgressAction
} from '@/lib/actions/onboarding';
import { AGENT_TYPES, type AgentTypeValue } from '@/lib/helpers/agent-types';
import { cn } from '@/lib/utils';

type Props = {
  initialPreferredAgent?: AgentTypeValue;
  onContinue: () => void;
};

type AgentInstallInfo = {
  installCommand: string;
  installLabel: string;
  overlordSetupCommand: string;
  overlordSetupDescription: string;
};

const AGENT_INSTALL_INFO: Record<AgentTypeValue, AgentInstallInfo> = {
  claude: {
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    installLabel: 'Install Claude Code CLI',
    overlordSetupCommand: 'ovld setup claude',
    overlordSetupDescription:
      'Registers Overlord as an MCP server in Claude Code so it can update ticket status and link file changes automatically.'
  },
  codex: {
    installCommand: 'npm install -g @openai/codex',
    installLabel: 'Install Codex CLI',
    overlordSetupCommand: 'ovld setup codex',
    overlordSetupDescription:
      'Injects the Overlord context command into Codex so it picks up your ticket prompt and posts progress back.'
  },
  cursor: {
    installCommand: 'https://cursor.sh',
    installLabel: 'Download Cursor',
    overlordSetupCommand: 'ovld setup cursor',
    overlordSetupDescription:
      'Writes a .cursorrules file and MCP config that give Cursor access to your Overlord ticket context.'
  },
  gemini: {
    installCommand: 'npm install -g @google/gemini-cli',
    installLabel: 'Install Gemini CLI',
    overlordSetupCommand: 'ovld setup gemini',
    overlordSetupDescription:
      'Adds the Overlord tool extension to Gemini CLI so it can read and update tickets as it works.'
  },
  opencode: {
    installCommand: 'npm install -g opencode-ai',
    installLabel: 'Install OpenCode',
    overlordSetupCommand: 'ovld setup opencode',
    overlordSetupDescription:
      'Installs the Overlord workflow instructions, slash commands, and local permission rules into your OpenCode config.'
  }
};

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-muted-foreground hover:text-foreground shrink-0 text-xs underline-offset-2 hover:underline"
    >
      {copied ? 'Copied!' : (label ?? 'Copy')}
    </button>
  );
}

function CodeBlock({ value }: { value: string }) {
  return (
    <div className="bg-muted flex items-center justify-between gap-2 rounded-md px-3 py-2">
      <code className="text-muted-foreground min-w-0 truncate text-xs">{value}</code>
      <CopyButton value={value} />
    </div>
  );
}

export function AgentSetupStep({ initialPreferredAgent, onContinue }: Props) {
  const [selectedAgent, setSelectedAgent] = useState<AgentTypeValue>(
    initialPreferredAgent ?? 'claude'
  );
  const [agentToken, setAgentToken] = useState<string | null>(null);

  useEffect(() => {
    getDefaultAgentTokenAction()
      .then(token => setAgentToken(token))
      .catch(() => null);
  }, []);

  async function handleSelectAgent(value: AgentTypeValue) {
    setSelectedAgent(value);
    try {
      await updateOnboardingProgressAction({ preferredAgent: value });
    } catch {
      // Non-blocking — preference save failure shouldn't interrupt the flow
    }
  }

  const info = AGENT_INSTALL_INFO[selectedAgent];
  const isCursorDownload = selectedAgent === 'cursor';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Set up your AI coding agent</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Choose the agent you'll use to work on tickets. Overlord works with all of them.
        </p>
      </div>

      {/* Agent picker */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {AGENT_TYPES.map(agent => (
          <button
            key={agent.value}
            type="button"
            onClick={() => void handleSelectAgent(agent.value)}
            className={cn(
              'flex flex-col items-center gap-2 rounded-lg border px-3 py-3 transition-colors',
              selectedAgent === agent.value
                ? 'border-primary bg-primary/5 ring-primary ring-1'
                : 'border-input hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <Image src={agent.icon} alt={agent.label} width={28} height={28} />
            <span className="text-xs font-medium">{agent.label}</span>
          </button>
        ))}
      </div>

      {/* Install instructions */}
      <div className="flex flex-col gap-3">
        <div>
          <p className="mb-1.5 text-sm font-medium">{info.installLabel}</p>
          {isCursorDownload ? (
            <div className="bg-muted flex items-center justify-between gap-2 rounded-md px-3 py-2">
              <a
                href={info.installCommand}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary min-w-0 truncate text-xs underline-offset-2 hover:underline"
              >
                {info.installCommand}
              </a>
              <CopyButton value={info.installCommand} label="Copy URL" />
            </div>
          ) : (
            <CodeBlock value={info.installCommand} />
          )}
        </div>

        <div>
          <p className="mb-1 text-sm font-medium">Connect Overlord</p>
          <p className="text-muted-foreground mb-1.5 text-xs">{info.overlordSetupDescription}</p>
          <CodeBlock value={info.overlordSetupCommand} />
        </div>

        {agentToken && (
          <div>
            <p className="mb-1 text-sm font-medium">Your agent token</p>
            <p className="text-muted-foreground mb-1.5 text-xs">
              The setup command will ask for this. Keep it safe — it authorises agents to act on
              your behalf.
            </p>
            <div className="bg-muted flex items-center justify-between gap-2 rounded-md px-3 py-2">
              <code className="text-muted-foreground min-w-0 truncate text-xs font-mono">
                {agentToken}
              </code>
              <CopyButton value={agentToken} label="Copy token" />
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onContinue}>Continue</Button>
        <Button variant="ghost" size="sm" onClick={onContinue} className="text-muted-foreground">
          I'll set this up later →
        </Button>
      </div>
    </div>
  );
}
