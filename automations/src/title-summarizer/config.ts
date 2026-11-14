export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

export type GeminiConfig = {
  apiKey: string;
  model: string;
};

export function readGeminiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GeminiConfig | null {
  const apiKey = env.OPENROUTER_API_KEY?.trim() ?? '';
  if (!apiKey) {
    return null;
  }

  const model = env.OPENROUTER_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  return { apiKey, model };
}

export function isGeminiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readGeminiConfigFromEnv(env) !== null;
}
