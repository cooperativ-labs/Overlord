'use server';

import { generateTitleWithGemini } from '@/lib/ai/generate-ticket-title';
import { deriveTitleFromObjective } from '@/lib/helpers/tickets';
import { createClient } from '@/supabase/utils/server';

const AI_TITLE_THRESHOLD = 100;

/**
 * Generates a ticket title from an objective string.
 *
 * - If the objective is <= 100 characters, returns it directly (truncated to 60).
 * - If > 100 characters and the user has AI title generation enabled, calls Gemini.
 * - Falls back to truncation if Gemini fails or is disabled.
 */
export async function generateTicketTitleAction(objective: string): Promise<string> {
  const normalized = objective.trim();
  if (!normalized) return 'Untitled';

  // Short objectives: use full text as title (with standard normalization)
  if (normalized.length <= AI_TITLE_THRESHOLD) {
    return deriveTitleFromObjective(normalized);
  }

  // Check user preference
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return deriveTitleFromObjective(normalized);
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('ai_title_generation')
    .eq('id', user.id)
    .maybeSingle();

  const aiEnabled = profile?.ai_title_generation ?? true;

  if (!aiEnabled) {
    return deriveTitleFromObjective(normalized);
  }

  // Call Gemini for long objectives
  const aiTitle = await generateTitleWithGemini(normalized);
  return aiTitle || deriveTitleFromObjective(normalized);
}
