import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const GEMINI_MODEL = 'gemini-2.5-flash';

const gemini = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

const MAX_DIFF_CHARS = 60_000;

const SYSTEM_INSTRUCTION = `You write clear, conventional commit messages for a software engineering team.

Rules:
- First line: imperative subject, <= 72 characters, no trailing period.
- Optional body: blank line, then wrapped bullet points describing the "why" behind the change.
- Prefer conventional commit prefixes (feat, fix, chore, refactor, docs, test, style, perf, build, ci) when a category is obvious.
- Describe the observable change, not every file touched.
- Return ONLY the commit message text. No markdown fences, no commentary.`;

export async function generateCommitMessageWithGemini(params: {
  branch: string | null;
  diff: string;
  status: string;
}): Promise<string | null> {
  if (!gemini) {
    console.warn('[generate-commit-message] GEMINI_API_KEY not set');
    return null;
  }

  const trimmedDiff = params.diff.slice(0, MAX_DIFF_CHARS);
  const truncated = params.diff.length > MAX_DIFF_CHARS;

  const prompt = [
    `Branch: ${params.branch ?? '(unknown)'}`,
    '',
    'git status (short):',
    params.status.trim() || '(none)',
    '',
    `git diff${truncated ? ' (truncated)' : ''}:`,
    trimmedDiff || '(empty)'
  ].join('\n');

  try {
    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.3,
        maxOutputTokens: 512
      }
    });

    const text = (response.text ?? '').trim();
    if (!text) return null;
    // Strip markdown code fences if the model ignored instructions.
    return text
      .replace(/^```[a-z]*\n?/i, '')
      .replace(/```$/i, '')
      .trim();
  } catch (err) {
    console.error('[generate-commit-message] Gemini call failed:', err);
    return null;
  }
}
