import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';

import {
  type AgentCatalogAgentDto,
  type AgentLaunchConfigDto,
  type AgentLaunchFlagDto,
  agentLaunchFlagKey,
  formatAgentLaunchFlagText,
  parseAgentLaunchFlagText
} from '../../../../../shared/contract.ts';

const EMPTY_CONFIG: AgentLaunchConfigDto = { preCommand: '', flags: [] };

function cleanFlags(flags: AgentLaunchFlagDto[]): AgentLaunchFlagDto[] {
  return flags
    .map(flag => ({ name: flag.name.trim(), value: flag.value?.trim() ? flag.value.trim() : null }))
    .filter(flag => flag.name.length > 0);
}

function isConfigured(config: AgentLaunchConfigDto): boolean {
  return config.preCommand.trim().length > 0 || config.flags.length > 0;
}

function AgentDefaultsRow({
  agent,
  config,
  configured,
  disabled,
  onCommit
}: {
  agent: AgentCatalogAgentDto;
  config: AgentLaunchConfigDto;
  configured: boolean;
  disabled: boolean;
  onCommit: (config: AgentLaunchConfigDto) => void;
}) {
  const [preCommand, setPreCommand] = useState(config.preCommand);
  const [draftFlag, setDraftFlag] = useState('');

  // Re-seed from the server value whenever the saved config changes so a
  // successful save (or another surface's edit) is reflected here.
  useEffect(() => setPreCommand(config.preCommand), [config.preCommand]);

  function commit(next: AgentLaunchConfigDto) {
    onCommit({ preCommand: next.preCommand.trim(), flags: cleanFlags(next.flags) });
  }

  function addDraftFlag() {
    const parsed = parseAgentLaunchFlagText(draftFlag);
    if (!parsed) return;
    setDraftFlag('');
    commit({ preCommand, flags: [...config.flags, parsed] });
  }

  return (
    <tr className="border-t align-top">
      <th scope="row" className="w-32 py-2 pr-3 text-left text-xs font-medium">
        <span className="flex flex-col gap-0.5">
          <span>{agent.label}</span>
          {configured ? null : (
            <span className="text-[10px] font-normal text-muted-foreground">Not configured</span>
          )}
        </span>
      </th>
      <td className="w-1/3 py-2 pr-3">
        <Input
          value={preCommand}
          placeholder="none"
          disabled={disabled}
          aria-label={`Pre-command for ${agent.label}`}
          className="h-8 font-mono text-xs"
          onChange={event => setPreCommand(event.target.value)}
          onBlur={() => {
            if (preCommand.trim() === config.preCommand) return;
            commit({ preCommand, flags: config.flags });
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </td>
      <td className="py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {config.flags.map(flag => (
            <span
              key={agentLaunchFlagKey(flag)}
              className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-xs"
            >
              {formatAgentLaunchFlagText(flag)}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove flag ${formatAgentLaunchFlagText(flag)} for ${agent.label}`}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted-foreground/20"
                onClick={() =>
                  commit({
                    preCommand,
                    flags: config.flags.filter(
                      existing => agentLaunchFlagKey(existing) !== agentLaunchFlagKey(flag)
                    )
                  })
                }
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <span className="inline-flex items-center gap-1 rounded border border-dashed px-1.5">
            <input
              type="text"
              value={draftFlag}
              disabled={disabled}
              placeholder="--flag value"
              aria-label={`Add flag for ${agent.label}`}
              className="w-32 bg-transparent py-1 font-mono text-xs focus:outline-none"
              onChange={event => setDraftFlag(event.target.value)}
              onBlur={addDraftFlag}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addDraftFlag();
                }
              }}
            />
            <button
              type="button"
              disabled={disabled}
              aria-label={`Add flag for ${agent.label}`}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted-foreground/20"
              onClick={addDraftFlag}
            >
              <Plus className="size-3" />
            </button>
          </span>
        </div>
      </td>
    </tr>
  );
}

/**
 * Per-agent launch defaults for one resource source, laid out as a table so the
 * pre-command and flags of every agent are visible side by side. Every agent in
 * the workspace catalog gets a row whether or not this source has defaults for
 * it, so an unconfigured agent can be configured from here. Each edit commits
 * immediately through `onCommit`.
 */
export function SourceAgentDefaultsTable({
  agents,
  launchDefaults,
  agentsLoading = false,
  disabled = false,
  onCommit
}: {
  agents: AgentCatalogAgentDto[];
  launchDefaults: Record<string, AgentLaunchConfigDto>;
  agentsLoading?: boolean;
  disabled?: boolean;
  onCommit: (args: { agentKey: string; config: AgentLaunchConfigDto }) => void;
}) {
  if (agents.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {agentsLoading
          ? 'Loading agents…'
          : "This workspace's agent catalog is empty. Add agents in workspace settings to configure launch defaults here."}
      </p>
    );
  }

  return (
    <table className="w-full table-fixed border-collapse text-left">
      <thead>
        <tr className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <th scope="col" className="w-32 pb-1 pr-3">
            Agent
          </th>
          <th scope="col" className="w-1/3 pb-1 pr-3">
            Pre-command
          </th>
          <th scope="col" className="pb-1">
            Flags
          </th>
        </tr>
      </thead>
      <tbody>
        {agents.map(agent => {
          const config = launchDefaults[agent.key] ?? EMPTY_CONFIG;
          return (
            <AgentDefaultsRow
              key={agent.key}
              agent={agent}
              config={config}
              configured={isConfigured(config)}
              disabled={disabled}
              onCommit={next => onCommit({ agentKey: agent.key, config: next })}
            />
          );
        })}
      </tbody>
    </table>
  );
}
