import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const GEMINI_MODEL = 'gemini-2.5-flash';

const gemini = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

const MAX_DIFF_CHARS = 80_000;

const SYSTEM_INSTRUCTION = `You write concise GitHub pull request drafts for a software engineering team.

Return valid JSON with exactly two string fields:
- "title": a clear PR title, under 80 characters
- "body": a markdown PR body

Body requirements:
- Start with a short summary paragraph
- Include a "## Changes" section with bullet points
- Include a "## Testing" section
- Mention important caveats when they are evident from the diff

Do not wrap the JSON in markdown fences.`;

function parseDraft(text: string): { title: string; body: string } | null {
  try {
    const parsed = JSON.parse(text) as Partial<{ title: unknown; body: unknown }>;
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
    if (!title || !body) return null;
    return { title, body };
  } catch {
    return null;
  }
}

export async function generatePullRequestDraftWithGemini(params: {
  baseBranch: string | null;
  branch: string | null;
  diff: string;
  status?: string;
}): Promise<{ title: string; body: string } | null> {
  if (!gemini) {
    console.warn('[generate-pull-request] GEMINI_API_KEY not set');
    return null;
  }

  const trimmedDiff = params.diff.slice(0, MAX_DIFF_CHARS);
  const truncated = params.diff.length > MAX_DIFF_CHARS;

  const prompt = [
    `Head branch: ${params.branch ?? '(unknown)'}`,
    `Base branch: ${params.baseBranch ?? '(unknown)'}`,
    '',
    'git status (short):',
    params.status?.trim() || '(none)',
    '',
    `branch diff${truncated ? ' (truncated)' : ''}:`,
    trimmedDiff || '(empty)'
  ].join('\n');

  try {
    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        maxOutputTokens: 2048
      }
    });

    return parseDraft((response.text ?? '').trim());
  } catch (err) {
    console.error('[generate-pull-request] Gemini call failed:', err);
    return null;
  }
}
