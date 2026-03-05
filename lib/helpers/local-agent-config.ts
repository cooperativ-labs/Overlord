export const LOCAL_AGENT_FLAGS_STORAGE_KEY = 'overlord_agent_flags';

export type LocalAgentFlags = Record<string, string[]>;

const DEFAULT_LOCAL_AGENT_FLAGS: LocalAgentFlags = {
  claude: []
};

function sanitizeFlag(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/[\r\n]+/g, ' ');
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeFlags(input: unknown): LocalAgentFlags {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const normalized: LocalAgentFlags = {};
  for (const [agent, rawFlags] of Object.entries(input as Record<string, unknown>)) {
    if (!agent.trim() || !Array.isArray(rawFlags)) continue;

    const uniqueFlags = Array.from(
      new Set(
        rawFlags.map(flag => sanitizeFlag(flag)).filter((flag): flag is string => Boolean(flag))
      )
    );
    if (uniqueFlags.length > 0) {
      normalized[agent.trim()] = uniqueFlags;
    }
  }
  return normalized;
}

export function getDefaultLocalAgentFlags(): LocalAgentFlags {
  return {
    claude: [...DEFAULT_LOCAL_AGENT_FLAGS.claude]
  };
}

export function parseLocalAgentFlags(rawValue: string | null | undefined): LocalAgentFlags {
  if (!rawValue) {
    return getDefaultLocalAgentFlags();
  }

  try {
    const parsed = JSON.parse(rawValue);
    return {
      ...getDefaultLocalAgentFlags(),
      ...normalizeFlags(parsed)
    };
  } catch {
    return getDefaultLocalAgentFlags();
  }
}

export function serializeLocalAgentFlags(flags: LocalAgentFlags): string {
  return JSON.stringify(normalizeFlags(flags));
}

export function readLocalAgentFlagsFromStorage(): LocalAgentFlags {
  if (typeof window === 'undefined') {
    return getDefaultLocalAgentFlags();
  }
  const rawValue = window.localStorage.getItem(LOCAL_AGENT_FLAGS_STORAGE_KEY);
  return parseLocalAgentFlags(rawValue);
}
