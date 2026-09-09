import { type Schema, Type } from '@google/genai';

import { readGeminiConfigFromEnv } from '../title-summarizer/config.js';
import { getGeminiClient, resetGeminiClientForTests } from '../title-summarizer/gemini-client.js';

export { resetGeminiClientForTests };

export type ComposeDeliveryEvidenceItem = {
  id: string;
  action?: string;
  decision?: string;
  reason?: string;
  rationale?: string;
  impact?: string;
  category?: string;
  command?: string;
  verify?: string;
  link?: string;
  alternativesConsidered?: string[];
  source: string;
  sourceRef?: string;
};

export type ComposeDeliveryInput = {
  summary: string;
  objectiveTitle?: string | null;
  objectiveInstruction?: string | null;
  verificationSummary?: string | null;
  followUpNotes?: string | null;
  humanActions: ComposeDeliveryEvidenceItem[];
  tradeoffsMade: ComposeDeliveryEvidenceItem[];
  knownRisks: string[];
  deferredWork: string[];
  assumptions: string[];
  candidateActions: ComposeDeliveryEvidenceItem[];
  changeRationales: Array<{
    id: string;
    filePath: string;
    label: string;
    summary: string;
    why: string;
    impact: string;
  }>;
  recentEvents?: Array<{ type: string; summary: string }>;
};

export type ComposeDeliveryDraft = {
  markdown?: string;
  humanActions?: Array<Record<string, unknown>>;
  tradeoffsMade?: Array<Record<string, unknown>>;
  knownRisks?: string[];
  deferredWork?: string[];
  assumptions?: string[];
  reviewHighlights?: string[];
};

export const COMPOSE_DELIVERY_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    markdown: { type: Type.STRING },
    humanActions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sourceId: { type: Type.STRING },
          action: { type: Type.STRING },
          reason: { type: Type.STRING },
          category: { type: Type.STRING },
          command: { type: Type.STRING },
          verify: { type: Type.STRING },
          link: { type: Type.STRING }
        },
        required: ['sourceId', 'action']
      }
    },
    tradeoffsMade: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sourceId: { type: Type.STRING },
          decision: { type: Type.STRING },
          rationale: { type: Type.STRING },
          alternativesConsidered: { type: Type.ARRAY, items: { type: Type.STRING } },
          impact: { type: Type.STRING }
        },
        required: ['sourceId', 'decision', 'rationale']
      }
    },
    knownRisks: { type: Type.ARRAY, items: { type: Type.STRING } },
    deferredWork: {
      type: Type.ARRAY,
      description:
        'Deferred work rewritten as self-contained objective statements (see DEFERRED WORK rules). Same order and at least the same count as the agent list.',
      items: { type: Type.STRING }
    },
    assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
    reviewHighlights: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ['markdown', 'humanActions', 'tradeoffsMade', 'deferredWork']
};

/** Per-item ceiling for a rewritten deferred-work statement; matches the core detail limit. */
export const DEFERRED_WORK_MAX_CHARS = 800;

export const SYSTEM_INSTRUCTION = `You compose a polished delivery review message for a coding agent handoff.
Return JSON only matching the schema.
Rules:
- Use the agent summary as the factual spine; improve clarity and organization in markdown.
- Human actions and tradeoffs MUST cite sourceId values from the provided evidence or candidateActions.
- Never invent mandatory human actions or implementation tradeoffs without a sourceId match.
- Every deterministic candidate action is real follow-up work: cite each one unless an agent-reported action already covers the same step.
- Carry each action's command, verify, and link fields through unchanged when the evidence supplies them; never fabricate a command, URL, or path that is not in the evidence.
- Never include git commit/push/PR actions or routine "review/test the code" actions.
- Prefer concise, scannable Markdown. Do not include secrets, tokens, or raw diffs.
DEFERRED WORK rules (deferredWork array):
- Each deferred-work item becomes the full text of a future objective handed to another coding agent that has NOT read this delivery, so every item must stand alone.
- Rewrite every agent-listed item as a self-contained statement of one to three sentences: start with an imperative verb naming the work; name the component, feature, file, command, or data set involved; state what the delivered work already covers and why this piece was left; and state what done looks like when the evidence says so.
- Resolve references that only make sense inside this delivery ("finding 3", "P2 items", "the next objective", "remaining ~60 moves") by pulling the referenced detail from the agent summary, objective instruction, change rationales, or recent events.
- Never shorten an item, merge two items, drop an item, or reorder them: output at least as many deferredWork entries as the agent listed, in the same order, each at least as detailed as its source.
- Only add an item beyond the agent's list when the agent summary explicitly says work was left undone, is out of scope, remains, or is pre-existing and untouched; never infer new work from silence, and never restate a human action or known risk as deferred work.
- Use only facts present in the evidence. Do not invent files, commands, scope, or acceptance criteria. Keep each item under ${DEFERRED_WORK_MAX_CHARS} characters.`;

export function buildComposeDeliveryPrompt(input: ComposeDeliveryInput): string {
  return [
    'Compose a delivery presentation from this bounded evidence.',
    '',
    `Agent summary:\n${input.summary}`,
    input.objectiveTitle ? `Objective title: ${input.objectiveTitle}` : null,
    input.objectiveInstruction
      ? `Objective instruction (bounded):\n${input.objectiveInstruction.slice(0, 2000)}`
      : null,
    input.verificationSummary ? `Verification: ${input.verificationSummary}` : null,
    input.followUpNotes ? `Follow-up notes: ${input.followUpNotes}` : null,
    `Human actions evidence:\n${JSON.stringify(input.humanActions)}`,
    `Tradeoffs evidence:\n${JSON.stringify(input.tradeoffsMade)}`,
    `Known risks:\n${JSON.stringify(input.knownRisks)}`,
    `Deferred work (agent-listed, ${input.deferredWork.length} item(s); rewrite each as a standalone objective per the DEFERRED WORK rules):\n${JSON.stringify(input.deferredWork)}`,
    `Assumptions:\n${JSON.stringify(input.assumptions)}`,
    `Deterministic candidate actions:\n${JSON.stringify(input.candidateActions)}`,
    `Change rationales:\n${JSON.stringify(input.changeRationales.slice(0, 20))}`,
    input.recentEvents && input.recentEvents.length > 0
      ? `Recent objective events:\n${JSON.stringify(input.recentEvents.slice(0, 12))}`
      : null
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function composeDeliveryWithGemini(params: {
  input: ComposeDeliveryInput;
  env?: NodeJS.ProcessEnv;
  logPrefix?: string;
  generate?: (args: {
    prompt: string;
    systemInstruction: string;
    responseSchema: Schema;
  }) => Promise<string | null>;
}): Promise<ComposeDeliveryDraft | null> {
  const {
    input,
    env = process.env,
    logPrefix = '[automations/compose-delivery]',
    generate
  } = params;

  const prompt = buildComposeDeliveryPrompt(input);
  const text =
    generate !== undefined
      ? await generate({
          prompt,
          systemInstruction: SYSTEM_INSTRUCTION,
          responseSchema: COMPOSE_DELIVERY_RESPONSE_SCHEMA
        })
      : await generateComposeJson({
          prompt,
          systemInstruction: SYSTEM_INSTRUCTION,
          env,
          logPrefix
        });

  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as ComposeDeliveryDraft;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (error) {
    console.warn(`${logPrefix} failed to parse Gemini JSON:`, error);
    return null;
  }
}

async function generateComposeJson(params: {
  prompt: string;
  systemInstruction: string;
  env: NodeJS.ProcessEnv;
  logPrefix: string;
}): Promise<string | null> {
  const { prompt, systemInstruction, env, logPrefix } = params;
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
        systemInstruction,
        temperature: 0.2,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
        responseSchema: COMPOSE_DELIVERY_RESPONSE_SCHEMA
      }
    });
    const text = (response.text ?? '').trim();
    return text || null;
  } catch (error) {
    console.warn(`${logPrefix} Gemini call failed:`, error);
    return null;
  }
}
