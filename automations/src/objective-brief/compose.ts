import type { Schema } from '../openrouter/index.js';
import { readGeminiConfigFromEnv } from '../title-summarizer/config.js';
import { getGeminiClient } from '../title-summarizer/gemini-client.js';

import {
  assembleObjectiveSummary,
  buildObjectiveBriefPrompt,
  checkObjectiveBriefFidelity,
  clampBriefTitle,
  describeFidelityIssue,
  describeStyleIssue,
  isRetryStyleIssue,
  lintObjectiveSummary,
  lintObjectiveTitle,
  normalizeBriefTitle,
  OBJECTIVE_BRIEF_MAX_INPUT_CHARS,
  OBJECTIVE_BRIEF_MAX_OUTPUT_TOKENS,
  OBJECTIVE_BRIEF_SCHEMA_VERSION,
  OBJECTIVE_BRIEF_SYSTEM_INSTRUCTION,
  type ObjectiveBriefFields,
  objectiveBriefResponseSchema,
  type ObjectiveBriefStyleIssue,
  parseObjectiveBriefOutput
} from './brief.js';

/** Default provider timeout for one brief call. */
export const OBJECTIVE_BRIEF_PROVIDER_TIMEOUT_MS = 45_000;
/** One first attempt plus at most one rewrite. */
export const OBJECTIVE_BRIEF_MAX_ATTEMPTS = 2;

export type ObjectiveBriefGenerate = (args: {
  prompt: string;
  systemInstruction: string;
  responseSchema: Schema;
  maxOutputTokens: number;
  signal: AbortSignal;
}) => Promise<string | null>;

/** Why a requested field produced no publishable text. Matches the stored failure codes. */
export type ObjectiveBriefFieldFailure = 'invalid_output' | 'unfaithful_output';

export type ObjectiveBriefFieldOutcome =
  | { status: 'not_requested' }
  | { status: 'ok'; text: string; warnings: ObjectiveBriefStyleIssue[] }
  | { status: 'failed'; code: ObjectiveBriefFieldFailure; problems: string[] };

export type ObjectiveBriefComposeOutcome =
  | { kind: 'provider_unavailable' }
  /** Transient: the caller retries with backoff. No text is included. */
  | { kind: 'provider_error'; message: string }
  | {
      kind: 'composed';
      schemaVersion: number;
      title: ObjectiveBriefFieldOutcome;
      summary: ObjectiveBriefFieldOutcome;
      attempts: number;
      model: string | null;
      inputChars: number;
    };

type Candidate =
  | { status: 'ok'; text: string; style: ObjectiveBriefStyleIssue[] }
  | { status: 'failed'; code: ObjectiveBriefFieldFailure; problems: string[] };

type AttemptResult = {
  raw: string;
  title?: Candidate;
  summary?: Candidate;
};

function evaluateAttempt(
  raw: string,
  fields: ObjectiveBriefFields,
  instructionText: string
): AttemptResult {
  const parsed = parseObjectiveBriefOutput(raw, fields);
  const result: AttemptResult = { raw };
  const malformed = (field: string): Candidate => ({
    status: 'failed',
    code: 'invalid_output',
    problems: [`The ${field} does not match the schema. Return JSON that matches the schema.`]
  });

  if (fields.title) {
    const title = parsed?.title ? normalizeBriefTitle(parsed.title) : '';
    if (!title) {
      result.title = malformed('title');
    } else {
      const fidelity = checkObjectiveBriefFidelity({ instructionText, text: title }).filter(
        issue => issue.code === 'unknown_identifier'
      );
      result.title = fidelity.length
        ? {
            status: 'failed',
            code: 'unfaithful_output',
            problems: fidelity.map(describeFidelityIssue)
          }
        : { status: 'ok', text: title, style: lintObjectiveTitle(title) };
    }
  }

  if (fields.summary) {
    const parts = parsed?.summary ?? null;
    if (!parts) {
      result.summary = malformed('summary');
    } else {
      const assembled = assembleObjectiveSummary(parts);
      if (!assembled.ok) {
        result.summary = {
          status: 'failed',
          code: 'invalid_output',
          problems: [assembled.problem]
        };
      } else {
        const fidelity = checkObjectiveBriefFidelity({ instructionText, text: assembled.text });
        result.summary = fidelity.length
          ? {
              status: 'failed',
              code: 'unfaithful_output',
              problems: fidelity.map(describeFidelityIssue)
            }
          : {
              status: 'ok',
              text: assembled.text,
              style: lintObjectiveSummary(parts, assembled.text)
            };
      }
    }
  }
  return result;
}

function retryProblems(attempt: AttemptResult): string[] {
  const problems: string[] = [];
  for (const [label, candidate] of [
    ['title', attempt.title],
    ['summary', attempt.summary]
  ] as const) {
    if (!candidate) continue;
    if (candidate.status === 'failed') {
      problems.push(...candidate.problems.map(problem => `${label}: ${problem}`));
    } else {
      problems.push(
        ...candidate.style
          .filter(isRetryStyleIssue)
          .map(issue => `${label}: ${describeStyleIssue(issue)}`)
      );
    }
  }
  return problems;
}

function retryStyleCount(candidate: Candidate): number {
  return candidate.status === 'ok' ? candidate.style.filter(isRetryStyleIssue).length : Infinity;
}

/**
 * Pick the better candidate for one field. A valid, faithful candidate always
 * beats an invalid or unfaithful one; between valid candidates the one with
 * fewer style issues wins, and the first one wins a tie. No valid candidate
 * means the field fails, so the caller keeps showing readable instructions.
 */
function selectField(candidates: Candidate[], clampTitle: boolean): ObjectiveBriefFieldOutcome {
  const valid = candidates.filter(
    (candidate): candidate is Extract<Candidate, { status: 'ok' }> => candidate.status === 'ok'
  );
  if (valid.length > 0) {
    const best = valid.reduce((a, b) => (retryStyleCount(b) < retryStyleCount(a) ? b : a));
    const text = clampTitle ? clampBriefTitle(best.text) : best.text;
    return { status: 'ok', text, warnings: best.style };
  }
  const failures = candidates as Array<Extract<Candidate, { status: 'failed' }>>;
  const last = failures[failures.length - 1];
  const code = failures.some(failure => failure.code === 'unfaithful_output')
    ? 'unfaithful_output'
    : 'invalid_output';
  return { status: 'failed', code, problems: last?.problems ?? [] };
}

function defaultGenerate(env: NodeJS.ProcessEnv): ObjectiveBriefGenerate | null {
  const client = getGeminiClient(env);
  const config = readGeminiConfigFromEnv(env);
  if (!client || !config) return null;
  return async ({ prompt, systemInstruction, responseSchema, maxOutputTokens, signal }) => {
    const response = await client.models.generateContent({
      model: config.model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction,
        temperature: 0.2,
        maxOutputTokens,
        responseMimeType: 'application/json',
        responseSchema,
        abortSignal: signal
      }
    });
    const text = (response.text ?? '').trim();
    return text || null;
  };
}

/**
 * Compose an objective brief: the requested title and/or summary in one
 * provider call, validated and checked for fidelity, with at most one rewrite
 * when a field is invalid, unfaithful or breaks a style rule.
 *
 * - No provider configured: `provider_unavailable`; nothing is called.
 * - The first call fails or times out: `provider_error` (retry later).
 * - The rewrite call fails: the first attempt's results are used.
 * - Instructions longer than the bounded input get no generated summary
 *   (`unfaithful_output`: a faithful summary of unseen text is impossible);
 *   a title is still written from the bounded prefix.
 *
 * Nothing here reads or writes the database.
 */
export async function composeObjectiveBrief({
  instructionText,
  fields,
  env = process.env,
  generate,
  timeoutMs = OBJECTIVE_BRIEF_PROVIDER_TIMEOUT_MS,
  signal
}: {
  instructionText: string;
  fields: ObjectiveBriefFields;
  env?: NodeJS.ProcessEnv;
  generate?: ObjectiveBriefGenerate;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<ObjectiveBriefComposeOutcome> {
  const instruction = instructionText.trim();
  const tooLong = instruction.length > OBJECTIVE_BRIEF_MAX_INPUT_CHARS;
  const wanted: ObjectiveBriefFields = {
    title: fields.title && instruction.length > 0,
    summary: fields.summary && instruction.length > 0 && !tooLong
  };
  const tooLongOutcome: ObjectiveBriefFieldOutcome = {
    status: 'failed',
    code: 'unfaithful_output',
    problems: [`The instructions exceed ${OBJECTIVE_BRIEF_MAX_INPUT_CHARS} characters.`]
  };
  const describe = (requested: boolean, outcome: ObjectiveBriefFieldOutcome | undefined) =>
    requested
      ? (outcome ?? { status: 'not_requested' as const })
      : { status: 'not_requested' as const };

  const generator = generate ?? defaultGenerate(env);
  if (!generator) return { kind: 'provider_unavailable' };
  if (!wanted.title && !wanted.summary) {
    return {
      kind: 'composed',
      schemaVersion: OBJECTIVE_BRIEF_SCHEMA_VERSION,
      title: { status: 'not_requested' },
      summary: describe(fields.summary && tooLong, tooLongOutcome),
      attempts: 0,
      model: null,
      inputChars: 0
    };
  }

  const input = tooLong ? instruction.slice(0, OBJECTIVE_BRIEF_MAX_INPUT_CHARS) : instruction;
  const responseSchema = objectiveBriefResponseSchema(wanted);
  const call = async (prompt: string): Promise<string | null> => {
    const timeout = AbortSignal.timeout(timeoutMs);
    return generator({
      prompt,
      systemInstruction: OBJECTIVE_BRIEF_SYSTEM_INSTRUCTION,
      responseSchema,
      maxOutputTokens: OBJECTIVE_BRIEF_MAX_OUTPUT_TOKENS,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
  };

  const attempts: AttemptResult[] = [];
  try {
    const raw = await call(buildObjectiveBriefPrompt({ instructionText: input, fields: wanted }));
    attempts.push(evaluateAttempt(raw ?? '', wanted, input));
  } catch (error) {
    // Bounded and content-free: the error name and HTTP status only.
    const status = (error as { status?: unknown } | null)?.status;
    const name = error instanceof Error ? error.name : 'Error';
    return {
      kind: 'provider_error',
      message: typeof status === 'number' ? `${name} ${status}` : name
    };
  }

  const problems = retryProblems(attempts[0]!);
  if (problems.length > 0 && OBJECTIVE_BRIEF_MAX_ATTEMPTS > 1) {
    try {
      const raw = await call(
        buildObjectiveBriefPrompt({
          instructionText: input,
          fields: wanted,
          feedback: { previousOutput: attempts[0]!.raw.slice(0, 8_000), problems }
        })
      );
      attempts.push(evaluateAttempt(raw ?? '', wanted, input));
    } catch {
      // The rewrite is best effort; keep the first attempt's results.
    }
  }

  const pick = (field: 'title' | 'summary') =>
    selectField(
      attempts.map(attempt => attempt[field]).filter((c): c is Candidate => c !== undefined),
      field === 'title'
    );

  return {
    kind: 'composed',
    schemaVersion: OBJECTIVE_BRIEF_SCHEMA_VERSION,
    title: wanted.title ? pick('title') : { status: 'not_requested' },
    summary: wanted.summary ? pick('summary') : describe(fields.summary && tooLong, tooLongOutcome),
    attempts: attempts.length,
    model: generate ? null : (readGeminiConfigFromEnv(env)?.model ?? null),
    inputChars: input.length
  };
}
