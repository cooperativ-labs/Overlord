import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const GEMINI_MODEL = 'gemini-2.5-flash-lite';

const gemini = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

/**
 * Uses Gemini to generate a concise ticket title from long objective context.
 * Returns null if Gemini is unavailable or the call fails.
 */
export async function generateTitleWithGemini(objective: string): Promise<string | null> {
  if (!gemini) {
    console.warn('[generate-ticket-title] GEMINI_API_KEY not set');
    return null;
  }

  try {
    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Summarize the following ticket objective context into a short, action-oriented title (max 60 characters). The context may include one objective or an ordered list of objectives across different states. Capture the overall theme of the ticket, not just the latest item. Return ONLY the title text, no quotes or punctuation wrapping.\n\nObjective context:\n${objective}`
            }
          ]
        }
      ],
      config: {
        systemInstruction:
          'You write concise ticket titles for a project management tool. Titles should be action-oriented (start with a verb), specific, capture the overall theme across all supplied objectives, and stay under 60 characters. Return only the title, nothing else.',
        temperature: 0.3,
        maxOutputTokens: 100
      }
    });

    const text = (response.text ?? '').trim();
    if (!text) return null;

    // Enforce 60 char limit as a safety net
    return text.length <= 60 ? text : text.slice(0, 60) + '…';
  } catch (err) {
    console.warn('[generate-ticket-title] Gemini call failed; falling back to local title:', err);
    return null;
  }
}
