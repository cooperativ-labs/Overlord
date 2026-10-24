import { type Schema, Type } from '@google/genai';

import { WRITING_RULES } from '../compose-delivery/compose.js';
import { readGeminiConfigFromEnv } from '../title-summarizer/config.js';
import { getGeminiClient } from '../title-summarizer/gemini-client.js';

/**
 * Bounded model input for the mission summary (plan §4.5, with §11 item 5:
 * the mission carries title and status type only). The worker builds it from
 * current-run evidence; nothing here reads the database.
 */
export type ComposeMissionSummaryInput = {
  mission: { title: string; statusType: string };
  previousSummary: { headline: string; summary: string } | null;
  objectives: Array<{
    key: string;
    title: string;
    state: string;
    latestDelivery: { deliveryId: string; deliveredAt: string; firstParagraph: string } | null;
  }>;
  newestDelivery: { objectiveKey: string; markdown: string } | null;
  openActions: Array<{
    ref: string;
    objectiveKey: string;
    action: string;
    reason?: string;
    blocking: boolean;
    category: string;
  }>;
  openQuestions: Array<{ requestId: string; objectiveKey: string; prompt: string }>;
  pendingSuggestions: Array<{ objectiveKey: string; title: string }>;
  knownRisks: Array<{ ref: string; objectiveKey: string; text: string }>;
  counts: { deliveries: number; filePaths: number };
};

export type ComposeMissionSummaryDraft = {
  headline?: unknown;
  summary?: unknown;
  risks?: unknown;
};

export const COMPOSE_MISSION_SUMMARY_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    headline: { type: Type.STRING },
    summary: { type: Type.STRING },
    risks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          ref: { type: Type.STRING },
          text: { type: Type.STRING }
        },
        required: ['ref']
      }
    }
  },
  required: ['headline', 'summary', 'risks']
};

export const MISSION_SUMMARY_SYSTEM_INSTRUCTION = `You maintain the summary of one software mission for the operator who owns it.
Return JSON only matching the schema.
Rules:
- Write for the operator who owns the mission. Say what is done, what is in flight, what is blocked, and what is waiting on them, in that order.
- The headline is one sentence of at most 140 characters. It names the single most important fact right now. Prefer the newest delivery unless an open blocking action or question outranks it.
- The summary is Markdown of two to five sentences.
- When a previous summary is given, update it to match the evidence. Do not restart it from nothing.
- Keep a risk only when it can change what the operator does next or hides a real follow-up. Drop routine caveats. Cite each kept risk by its ref from the evidence; you may shorten its text.
- Pending suggestions are context only. You may say that work is waiting; do not restate the suggestions.
- Use only facts in the evidence. Never invent files, commands, or state.
Apply the WRITING rules below to headline, summary, and risk text. They do not apply to commands, paths, identifiers, or quoted agent text; copy those exactly.
${WRITING_RULES}`;

export function buildComposeMissionSummaryPrompt(input: ComposeMissionSummaryInput): string {
  return [
    'Update the mission summary from this bounded evidence.',
    '',
    `Mission:\n${JSON.stringify(input.mission)}`,
    `Previous summary:\n${JSON.stringify(input.previousSummary)}`,
    `Objectives:\n${JSON.stringify(input.objectives)}`,
    `Newest delivery:\n${JSON.stringify(input.newestDelivery)}`,
    `Open actions:\n${JSON.stringify(input.openActions)}`,
    `Open questions:\n${JSON.stringify(input.openQuestions)}`,
    `Pending suggestions (context only):\n${JSON.stringify(input.pendingSuggestions)}`,
    `Known risks:\n${JSON.stringify(input.knownRisks)}`,
    `Counts:\n${JSON.stringify(input.counts)}`
  ].join('\n\n');
}

/**
 * Asks Gemini for the model-written parts of the mission summary. Returns null
 * when the provider is not configured, the call fails, or the reply is not a
 * JSON object; the caller then publishes the deterministic fallback.
 */
export async function composeMissionSummaryWithGemini(params: {
  input: ComposeMissionSummaryInput;
  env?: NodeJS.ProcessEnv;
  logPrefix?: string;
  generate?: (args: {
    prompt: string;
    systemInstruction: string;
    responseSchema: Schema;
  }) => Promise<string | null>;
}): Promise<ComposeMissionSummaryDraft | null> {
  const {
    input,
    env = process.env,
    logPrefix = '[automations/compose-mission-summary]',
    generate
  } = params;

  const prompt = buildComposeMissionSummaryPrompt(input);
  const text =
    generate !== undefined
      ? await generate({
          prompt,
          systemInstruction: MISSION_SUMMARY_SYSTEM_INSTRUCTION,
          responseSchema: COMPOSE_MISSION_SUMMARY_RESPONSE_SCHEMA
        })
      : await generateMissionSummaryJson({ prompt, env, logPrefix });

  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as ComposeMissionSummaryDraft;
  } catch (error) {
    console.warn(`${logPrefix} failed to parse Gemini JSON:`, error);
    return null;
  }
}

async function generateMissionSummaryJson(params: {
  prompt: string;
  env: NodeJS.ProcessEnv;
  logPrefix: string;
}): Promise<string | null> {
  const { prompt, env, logPrefix } = params;
  const client = getGeminiClient(env);
  const config = readGeminiConfigFromEnv(env);
  if (!client || !config) {
    console.warn(`${logPrefix} GEMINI_API_KEY not set`);
    return null;
  }

  try {
    const response = await client.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: MISSION_SUMMARY_SYSTEM_INSTRUCTION,
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: COMPOSE_MISSION_SUMMARY_RESPONSE_SCHEMA
      }
    });
    const text = (response.text ?? '').trim();
    return text || null;
  } catch (error) {
    console.warn(`${logPrefix} Gemini call failed:`, error);
    return null;
  }
}
