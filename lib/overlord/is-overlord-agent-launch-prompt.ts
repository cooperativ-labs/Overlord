/**
 * Detects text that matches the Overlord desktop / CLI ticket bootstrap injected into
 * agent sessions. This must not be recorded as a `user_follow_up` ticket event — it is
 * the ticket/objective spec, not a human follow-up message.
 *
 * Two launch-prompt shapes exist:
 *  1. Inline bootstrap — the full ticket spec is the prompt (`# Overlord Agent
 *     Instructions` / `You are an AI coding agent working on ticket … ## Task`).
 *  2. Context-file bootstrap — used by AgentPod and any context-file launch. The
 *     prompt is short and just points the agent at a context file (see
 *     `buildContextFilePrompt` in the CLI launcher), so the inline markers are
 *     absent and the text can be under the length guard.
 */
export function isLikelyOverlordAgentLaunchPrompt(prompt: string): boolean {
  const p = prompt.trim();
  // Context-file bootstrap markers — Overlord-specific phrases that never appear
  // in a human follow-up. Checked before the length guard because this prompt is short.
  if (p.includes('Read the Overlord launch context from')) return true;
  if (p.includes('Follow the ticket workflow and objective described in that file')) return true;
  if (p.length < 80) return false;
  if (p.includes('# Overlord Agent Instructions')) return true;
  if (p.includes('You are an AI coding agent working on ticket') && p.includes('## Task')) {
    return true;
  }
  return false;
}
