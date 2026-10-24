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

export type ComposeDeliveryPlannedObjective = {
  title?: string | null;
  instruction?: string | null;
};

export type ComposeDeliveryInput = {
  summary: string;
  objectiveTitle?: string | null;
  objectiveInstruction?: string | null;
  plannedObjectives?: ComposeDeliveryPlannedObjective[];
  verificationSummary?: string | null;
  followUpNotes?: string | null;
  humanActions: ComposeDeliveryEvidenceItem[];
  tradeoffsMade: ComposeDeliveryEvidenceItem[];
  knownRisks: string[];
  assumptions: string[];
  candidateActions: ComposeDeliveryEvidenceItem[];
  recentEvents?: Array<{ type: string; summary: string }>;
};

export type ComposeDeliveryDraft = {
  markdown?: string;
  humanActions?: Array<Record<string, unknown>>;
  tradeoffsMade?: Array<Record<string, unknown>>;
  knownRisks?: string[];
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
    assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
    reviewHighlights: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ['markdown', 'humanActions', 'tradeoffsMade']
};

/**
 * STE-inspired writing rules (loosely based on ASD-STE100), shared with the
 * mission summary composer. Guidance for the model, not a checker.
 */
export const WRITING_RULES = `WRITING rules:
- One topic per sentence. Keep sentences short: about 20 words for an instruction, about 25 for a description.
- Use the active voice and name the actor: "The migration adds a table", not "A table is added".
- Use the present tense for state and the simple past for what the agent did.
- Use the imperative for anything the operator must do: "Run the test suite", not "The test suite should be run".
- Use one term for one thing throughout a message. Do not vary vocabulary for style.
- Prefer short, common words. Avoid noun stacks longer than three words; rewrite "delivery compose worker fallback path" as "the fallback path of the compose worker".
- Keep articles ("the", "a"). Do not drop them for brevity.
- No idioms, no hedging filler, no marketing adjectives.
- Technical names, commands, paths, and quoted agent text are exempt and are copied exactly.
- When the evidence is unclear, say that it is unclear. Do not smooth it over.`;

export const SYSTEM_INSTRUCTION = `You compose a polished delivery review message for a coding agent handoff.
Return JSON only matching the schema.
Rules:
- Use the agent summary as the factual spine; improve clarity and organization in markdown.
- Human actions and tradeoffs MUST cite sourceId values from the provided evidence or candidateActions.
- Never invent mandatory human actions or implementation tradeoffs without a sourceId match.
- Every deterministic candidate action is real follow-up work: cite each one unless an agent-reported action already covers the same step.
- Carry each action's command, verify, and link fields through unchanged when the evidence supplies them; never fabricate a command, URL, or path that is not in the evidence.
- File paths (a candidate action's link or sourceRef) are context only. Never describe what a file does or why it changed, and never infer behavior, impact, tests, or verification from a file or path name; only the agent summary and the supplied report facts state those.
- Never include git commit/push/PR actions or routine "review/test the code" actions.
- Prefer concise, scannable Markdown. Do not include secrets, tokens, or raw diffs.
Apply the WRITING rules below to markdown, humanActions action and reason, tradeoffsMade text, knownRisks, and assumptions. They do not apply to command, verify, link, file paths, identifiers, or quoted agent text; copy those exactly.
${WRITING_RULES}`;

export function buildComposeDeliveryPrompt(input: ComposeDeliveryInput): string {
  return [
    'Compose a delivery presentation from this bounded evidence.',
    '',
    `Agent summary:\n${input.summary}`,
    input.objectiveTitle ? `Objective title: ${input.objectiveTitle}` : null,
    input.objectiveInstruction
      ? `Objective instruction (bounded):\n${input.objectiveInstruction.slice(0, 2000)}`
      : null,
    input.plannedObjectives && input.plannedObjectives.length > 0
      ? `Planned future objectives on this mission (already queued; never present them as new work):\n${JSON.stringify(
          input.plannedObjectives
        )}`
      : null,
    input.verificationSummary ? `Verification: ${input.verificationSummary}` : null,
    input.followUpNotes ? `Follow-up notes: ${input.followUpNotes}` : null,
    `Human actions evidence:\n${JSON.stringify(input.humanActions)}`,
    `Tradeoffs evidence:\n${JSON.stringify(input.tradeoffsMade)}`,
    `Known risks:\n${JSON.stringify(input.knownRisks)}`,
    `Assumptions:\n${JSON.stringify(input.assumptions)}`,
    `Deterministic candidate actions:\n${JSON.stringify(input.candidateActions)}`,
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
