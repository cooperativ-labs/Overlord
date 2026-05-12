/**
 * Detects text that matches the Overlord desktop / CLI ticket bootstrap injected into
 * agent sessions. This must not be recorded as a `user_follow_up` ticket event — it is
 * the ticket/objective spec, not a human follow-up message.
 */
export function isLikelyOverlordAgentLaunchPrompt(prompt: string): boolean {
  const p = prompt.trim();
  if (p.length < 80) return false;
  if (p.includes('# Overlord Agent Instructions')) return true;
  if (p.includes('You are an AI coding agent working on ticket') && p.includes('## Task')) {
    return true;
  }
  return false;
}
