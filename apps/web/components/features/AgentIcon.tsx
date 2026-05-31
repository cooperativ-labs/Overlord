import Image from 'next/image';

import { type AgentType, getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';
import { cn } from '@/lib/utils';

type AgentIconProps = {
  /** Pass a resolved agent type… */
  agentType?: AgentType | null;
  /** …or an identifier to resolve internally. */
  identifier?: string | null;
  /** Rendered width/height in px. Defaults to 16. */
  size?: number;
  className?: string;
  /** Override the `alt` text. Defaults to the agent label. */
  alt?: string;
};

/**
 * Renders an agent's brand icon, centralizing the easy-to-forget
 * `invertDark ? 'dark:invert' : ''` dark-mode rule that was previously copied
 * inline across many call sites. Returns `null` when no icon can be resolved.
 */
export function AgentIcon({ agentType, identifier, size = 16, className, alt }: AgentIconProps) {
  const resolved = agentType ?? (identifier ? getAgentTypeByIdentifier(identifier) : null);
  if (!resolved?.icon) return null;

  return (
    <Image
      src={resolved.icon}
      alt={alt ?? resolved.label}
      width={size}
      height={size}
      className={cn(resolved.invertDark ? 'dark:invert' : '', className)}
    />
  );
}
