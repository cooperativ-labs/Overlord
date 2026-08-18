/** Brand icon metadata for an agent connector. */
export interface AgentIconMeta {
  /** Public asset path served from `webapp/public`. */
  src: string;
  /** Whether the icon should be inverted in dark mode (monochrome marks). */
  invertDark: boolean;
}

/**
 * Maps connector agent keys (see `cli/src/agent-catalog-defaults.ts` and the
 * workspace catalog) to their brand icon. Centralizes the easy-to-forget
 * `invertDark` dark-mode rule so call sites don't copy it inline.
 */
const AGENT_ICONS: Record<string, AgentIconMeta> = {
  claude: { src: '/images/icons/claude-code.svg', invertDark: false },
  codex: { src: '/images/icons/codex.svg', invertDark: true },
  cursor: { src: '/images/icons/cursor.svg', invertDark: true },
  opencode: { src: '/images/icons/opencode.svg', invertDark: false },
  antigravity: { src: '/images/icons/antigravity.svg', invertDark: false },
  pi: { src: '/images/icons/pi.svg', invertDark: true },
  gemini: { src: '/images/icons/gemini.svg', invertDark: false }
};

/**
 * Connector identifiers that do not equal their icon key. Provenance records
 * the identifier the connector reports (`claude-code`), while the icon map is
 * keyed by the shorter workspace catalog key (`claude`), so the two only meet
 * through this table.
 */
const AGENT_KEY_ALIASES: Record<string, string> = {
  'claude-code': 'claude',
  'gemini-cli': 'gemini',
  'codex-cli': 'codex',
  'cursor-agent': 'cursor'
};

/** Human-facing names for identifiers whose display name is not just capitalized. */
const AGENT_DISPLAY_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
  antigravity: 'Antigravity',
  pi: 'Pi',
  gemini: 'Gemini',
  'hosted-mcp': 'Overlord MCP'
};

/**
 * Folds a connector/agent identifier onto the canonical key the icon and name
 * tables use. Returns null for a blank identifier or the protocol sentinel
 * `unknown` so callers can branch once.
 */
export function normalizeAgentKey(key: string | null | undefined): string | null {
  const trimmed = key?.trim().toLowerCase();
  if (!trimmed || trimmed === 'unknown') return null;
  return AGENT_KEY_ALIASES[trimmed] ?? trimmed;
}

/**
 * The name to show a person for an agent identifier. Falls back to the raw
 * identifier rather than to a generic label: an unmapped connector is still
 * more useful named than anonymized.
 */
export function agentDisplayName(key: string | null | undefined): string | null {
  const normalized = normalizeAgentKey(key);
  if (!normalized) return null;
  return AGENT_DISPLAY_NAMES[normalized] ?? key?.trim() ?? null;
}

/** Resolve an agent's icon metadata by connector key. Returns null when unmapped. */
export function getAgentIcon(key: string | null | undefined): AgentIconMeta | null {
  const normalized = normalizeAgentKey(key);
  if (!normalized) return null;
  return AGENT_ICONS[normalized] ?? null;
}
