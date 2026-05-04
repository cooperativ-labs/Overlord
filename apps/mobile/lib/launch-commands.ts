import type { AgentModelSelection, LaunchAgentType } from '@/lib/types';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildCliLaunchCommand(
  agent: LaunchAgentType,
  ticketId: string,
  options: Pick<AgentModelSelection, 'model' | 'thinking'>
): string {
  const parts = ['ovld', 'launch', agent, '--ticket-id', shellQuote(ticketId)];

  if (options.model?.trim()) {
    parts.push('--model', shellQuote(options.model.trim()));
  }

  if (options.thinking?.trim()) {
    parts.push('--thinking', shellQuote(options.thinking.trim()));
  }

  return parts.join(' ');
}
