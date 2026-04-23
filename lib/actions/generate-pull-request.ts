'use server';

import { generatePullRequestDraftWithGemini } from '@/lib/ai/generate-pull-request';
import { createClient } from '@/supabase/utils/server';

type GenerateInput = {
  baseBranch: string | null;
  branch: string | null;
  diff: string;
  status?: string;
};

type GenerateResult = { body: string; title: string } | { error: string };

export async function generatePullRequestDraftAction(
  input: GenerateInput
): Promise<GenerateResult> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'You must be signed in to generate a pull request draft.' };
  }

  const diff = (input.diff ?? '').trim();
  if (!diff) {
    return { error: 'No diff content found to summarize into a pull request.' };
  }

  const draft = await generatePullRequestDraftWithGemini({
    baseBranch: input.baseBranch,
    branch: input.branch,
    diff,
    status: input.status ?? ''
  });

  if (!draft) {
    return {
      error:
        'Pull request draft generation is unavailable. Check that GEMINI_API_KEY is configured.'
    };
  }

  return draft;
}
