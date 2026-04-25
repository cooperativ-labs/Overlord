'use server';

import { generateCommitMessageWithGemini } from '@/lib/ai/generate-commit-message';
import { createClientForRequest } from '@/supabase/utils/server';

type GenerateInput = {
  branch: string | null;
  diff: string;
  status: string;
};

type GenerateResult = { message: string } | { error: string };

export async function generateCommitMessageAction(input: GenerateInput): Promise<GenerateResult> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'You must be signed in to generate a commit message.' };
  }

  const diff = (input.diff ?? '').trim();
  if (!diff) {
    return { error: 'No diff content to summarize. Make changes first.' };
  }

  const message = await generateCommitMessageWithGemini({
    branch: input.branch,
    diff,
    status: input.status ?? ''
  });

  if (!message) {
    return {
      error: 'Commit message generation is unavailable. Check that GEMINI_API_KEY is configured.'
    };
  }

  return { message };
}
