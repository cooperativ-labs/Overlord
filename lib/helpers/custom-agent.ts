import type { CustomAgent } from '@/lib/schemas/agent-config';

/**
 * Resolve a custom agent command template by substituting `{{token}}` placeholders
 * with the provided values. Tokens with no value collapse to empty, and the
 * surrounding whitespace is normalized so the command stays clean.
 *
 * Example:
 *   resolveCustomAgentCommand('ollama claude {{model}} --effort {{effort}}',
 *     { model: 'qwen', effort: 'high' })
 *   => 'ollama claude qwen --effort high'
 */
export function resolveCustomAgentCommand(
  template: string,
  values: Record<string, string | null | undefined>
): string {
  const substituted = template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, token: string) => {
    const value = values[token];
    return typeof value === 'string' ? value.trim() : '';
  });
  // Collapse the runs of whitespace left behind by empty placeholders.
  return substituted.replace(/\s+/g, ' ').trim();
}

/** All `{{token}}` names referenced by a template, in first-seen order. */
export function extractTemplateTokens(template: string): string[] {
  const tokens: string[] = [];
  const regex = /\{\{\s*([\w.-]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    if (!tokens.includes(match[1])) tokens.push(match[1]);
  }
  return tokens;
}

/** The placeholder that drives the model column, if any. */
export function getModelPlaceholder(agent: CustomAgent) {
  return agent.placeholders.find(placeholder => placeholder.role === 'model') ?? null;
}

/** The placeholder that drives the thinking/effort column, if any. */
export function getThinkingPlaceholder(agent: CustomAgent) {
  return agent.placeholders.find(placeholder => placeholder.role === 'thinking') ?? null;
}

/** Build the default value map for a custom agent given a model/thinking selection. */
export function buildCustomAgentValues(
  agent: CustomAgent,
  model: string | null,
  thinking: string | null
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const placeholder of agent.placeholders) {
    if (placeholder.role === 'model' && model) {
      values[placeholder.token] = model;
    } else if (placeholder.role === 'thinking' && thinking) {
      values[placeholder.token] = thinking;
    } else if (placeholder.options.length > 0) {
      // Fall back to the first predefined option for non-selectable placeholders.
      values[placeholder.token] = placeholder.options[0].value;
    }
  }
  return values;
}
