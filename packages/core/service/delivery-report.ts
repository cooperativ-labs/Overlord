import type {
  DeliveryAgentReportInputV1,
  DeliveryAgentReportV1,
  DeliveryReportPayloadV1,
  HumanActionV1,
  TradeoffMadeV1
} from '@overlord/contract';
import { z } from 'zod';

const MAX_ITEMS = 12;
const MAX_ALTERNATIVES = 6;
const MAX_ACTION_LENGTH = 280;
const MAX_DETAIL_LENGTH = 800;

const humanActionCategorySchema = z.enum([
  'environment',
  'database',
  'deployment',
  'codegen',
  'packaging',
  'external_service',
  'other'
]);

const conciseTextSchema = z.string().trim().min(1).max(MAX_DETAIL_LENGTH);

const humanActionSchema = z.strictObject({
  action: z.string().trim().min(1).max(MAX_ACTION_LENGTH),
  reason: conciseTextSchema.optional(),
  category: humanActionCategorySchema.optional(),
  blocking: z.boolean().optional()
});

const tradeoffSchema = z.strictObject({
  decision: z.string().trim().min(1).max(MAX_ACTION_LENGTH),
  alternativesConsidered: z.array(conciseTextSchema).max(MAX_ALTERNATIVES).optional(),
  rationale: conciseTextSchema,
  impact: conciseTextSchema.optional()
});

const GIT_ACTION_PATTERN =
  /\b(?:git\s+(?:commit|push|pull|merge|rebase|checkout|switch|branch)|(?:commit|push|pull|merge|rebase|create|open)\s+(?:a\s+)?(?:branch|pull request|pr))\b/i;
const ROUTINE_QA_PATTERN =
  /\b(?:code review|review (?:the )?code|run (?:the )?tests?|test (?:the )?(?:code|feature)|verify (?:the )?(?:code|feature|implementation|it)(?:\s+(?:works|is working))?|qa)\b/i;

/** Excludes actions agents should complete themselves or that are Git-only workflow. */
export function isDisplayableHumanAction(action: string): boolean {
  return !GIT_ACTION_PATTERN.test(action) && !ROUTINE_QA_PATTERN.test(action);
}

function normalizeAgentReport(input: DeliveryAgentReportInputV1): DeliveryAgentReportV1 {
  const humanActionInputs = input.humanActions ?? [];
  const tradeoffInputs = input.tradeoffsMade ?? [];
  const humanActions: HumanActionV1[] = humanActionInputs
    .filter(action => isDisplayableHumanAction(action.action))
    .map((action, index) => ({
      id: `human-action-${index + 1}`,
      action: action.action,
      ...(action.reason ? { reason: action.reason } : {}),
      category: action.category ?? 'other',
      ...(action.blocking === undefined ? {} : { blocking: action.blocking }),
      source: 'agent'
    }));
  const tradeoffsMade: TradeoffMadeV1[] = tradeoffInputs.map((tradeoff, index) => ({
    id: `tradeoff-${index + 1}`,
    decision: tradeoff.decision,
    alternativesConsidered: tradeoff.alternativesConsidered ?? [],
    rationale: tradeoff.rationale,
    ...(tradeoff.impact ? { impact: tradeoff.impact } : {}),
    source: 'agent'
  }));

  return {
    humanActions,
    tradeoffsMade,
    knownRisks: input.knownRisks ?? [],
    deferredWork: input.deferredWork ?? [],
    assumptions: input.assumptions ?? []
  };
}

const MAX_WARNINGS = 12;
const DELIVERY_REPORT_ROOT_KEYS = new Set(['schemaVersion', 'agentReport']);
const AGENT_REPORT_INPUT_KEYS = new Set([
  'humanActions',
  'tradeoffsMade',
  'knownRisks',
  'deferredWork',
  'assumptions'
]);

function reportWarning(warnings: string[], message: string): void {
  if (warnings.length < MAX_WARNINGS) warnings.push(message);
}

function salvageArray<T>(
  value: unknown,
  schema: z.ZodType<T>,
  field: string,
  warnings: string[]
): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    reportWarning(warnings, `Ignored deliveryReport.${field}: expected an array.`);
    return [];
  }
  if (value.length > MAX_ITEMS) {
    reportWarning(
      warnings,
      `Ignored ${value.length - MAX_ITEMS} excess deliveryReport.${field} item(s).`
    );
  }
  return value.slice(0, MAX_ITEMS).flatMap((item, index) => {
    const parsed = schema.safeParse(item);
    if (parsed.success) return [parsed.data];
    reportWarning(warnings, `Ignored deliveryReport.${field}[${index}]: invalid advisory item.`);
    return [];
  });
}

function salvageWireAgentReport(deliveryReport: unknown): {
  input: DeliveryAgentReportInputV1;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (deliveryReport === undefined || deliveryReport === null) return { input: {}, warnings };
  if (typeof deliveryReport !== 'object' || Array.isArray(deliveryReport)) {
    reportWarning(warnings, 'Ignored deliveryReport: expected an object.');
    return { input: {}, warnings };
  }
  const root = deliveryReport as Record<string, unknown>;
  if (root.schemaVersion !== 1) {
    reportWarning(warnings, 'Ignored deliveryReport: schemaVersion must be 1.');
    return { input: {}, warnings };
  }
  if (Object.keys(root).some(key => !DELIVERY_REPORT_ROOT_KEYS.has(key))) {
    reportWarning(warnings, 'Ignored unsupported deliveryReport fields.');
  }
  const candidate = root.agentReport;
  if (candidate === undefined) return { input: {}, warnings };
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    reportWarning(warnings, 'Ignored deliveryReport.agentReport: expected an object.');
    return { input: {}, warnings };
  }
  const report = candidate as Record<string, unknown>;
  if (Object.keys(report).some(key => !AGENT_REPORT_INPUT_KEYS.has(key))) {
    reportWarning(warnings, 'Ignored unsupported deliveryReport.agentReport fields.');
  }
  return {
    input: {
      humanActions: salvageArray(
        report.humanActions,
        humanActionSchema,
        'agentReport.humanActions',
        warnings
      ),
      tradeoffsMade: salvageArray(
        report.tradeoffsMade,
        tradeoffSchema,
        'agentReport.tradeoffsMade',
        warnings
      ),
      knownRisks: salvageArray(
        report.knownRisks,
        conciseTextSchema,
        'agentReport.knownRisks',
        warnings
      ),
      deferredWork: salvageArray(
        report.deferredWork,
        conciseTextSchema,
        'agentReport.deferredWork',
        warnings
      ),
      assumptions: salvageArray(
        report.assumptions,
        conciseTextSchema,
        'agentReport.assumptions',
        warnings
      )
    },
    warnings
  };
}

const normalizedHumanActionSchema = z.strictObject({
  id: z.string().trim().min(1).max(200),
  action: z.string().trim().min(1).max(MAX_ACTION_LENGTH),
  reason: conciseTextSchema.optional(),
  category: humanActionCategorySchema,
  blocking: z.boolean().optional(),
  source: z.enum(['agent', 'change_rationale', 'deterministic_rule']),
  sourceRef: z.string().trim().min(1).max(200).optional()
});

const normalizedTradeoffSchema = z.strictObject({
  id: z.string().trim().min(1).max(200),
  decision: z.string().trim().min(1).max(MAX_ACTION_LENGTH),
  alternativesConsidered: z.array(conciseTextSchema).max(MAX_ALTERNATIVES),
  rationale: conciseTextSchema,
  impact: conciseTextSchema.optional(),
  source: z.enum(['agent', 'change_rationale']),
  sourceRef: z.string().trim().min(1).max(200).optional()
});

const normalizedAgentReportSchema = z.strictObject({
  humanActions: z.array(normalizedHumanActionSchema).max(MAX_ITEMS),
  tradeoffsMade: z.array(normalizedTradeoffSchema).max(MAX_ITEMS),
  knownRisks: z.array(conciseTextSchema).max(MAX_ITEMS),
  deferredWork: z.array(conciseTextSchema).max(MAX_ITEMS),
  assumptions: z.array(conciseTextSchema).max(MAX_ITEMS)
});

const deliveryPresentationSchema = z.strictObject({
  status: z.enum(['deterministic', 'pending', 'composed', 'fallback']),
  markdown: z.string(),
  humanActions: z.array(normalizedHumanActionSchema).max(MAX_ITEMS),
  tradeoffsMade: z.array(normalizedTradeoffSchema).max(MAX_ITEMS),
  knownRisks: z.array(conciseTextSchema).max(MAX_ITEMS),
  deferredWork: z.array(conciseTextSchema).max(MAX_ITEMS),
  assumptions: z.array(conciseTextSchema).max(MAX_ITEMS),
  generatedBy: z.enum(['deterministic', 'gemini']),
  generatedAt: z.string().max(64).optional(),
  model: z.string().trim().min(1).max(200).optional()
});

const persistedDeliveryReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  agentReport: normalizedAgentReportSchema,
  warnings: z.array(conciseTextSchema).max(MAX_WARNINGS).optional(),
  presentation: deliveryPresentationSchema
});

/**
 * Builds the contract-v15 fallback synchronously. A later worker may replace only
 * `presentation`; the immutable summary and normalized evidence always remain.
 */
export function buildDeliveryReport({
  summary,
  deliveryReport
}: {
  summary: string;
  deliveryReport: unknown;
}): DeliveryReportPayloadV1 {
  const { input, warnings } = salvageWireAgentReport(deliveryReport);
  const agentReport = normalizeAgentReport(input);

  return {
    schemaVersion: 1,
    agentReport,
    ...(warnings.length > 0 ? { warnings } : {}),
    presentation: {
      status: 'deterministic',
      markdown: summary,
      humanActions: agentReport.humanActions,
      tradeoffsMade: agentReport.tradeoffsMade,
      knownRisks: agentReport.knownRisks,
      deferredWork: agentReport.deferredWork,
      assumptions: agentReport.assumptions,
      generatedBy: 'deterministic'
    }
  };
}

/**
 * Returns a safe read-side delivery report. Persisted V1 reports retain their
 * presentation status (including pending/composed/fallback); missing or malformed
 * payloads receive the same deterministic projection used by REST readers.
 */
export function readDeliveryReport({
  summary,
  deliveryReport
}: {
  summary: string;
  deliveryReport: unknown;
}): DeliveryReportPayloadV1 {
  const parsed = persistedDeliveryReportSchema.safeParse(deliveryReport);
  if (parsed.success) return parsed.data;
  return buildDeliveryReport({ summary, deliveryReport: undefined });
}

/** Marks an immediate deterministic report as awaiting async composition. */
export function markDeliveryPresentationPending(
  report: DeliveryReportPayloadV1
): DeliveryReportPayloadV1 {
  return {
    ...report,
    presentation: {
      ...report.presentation,
      status: 'pending'
    }
  };
}

export const DELIVERY_REPORT_LIMITS = {
  maxItems: MAX_ITEMS,
  maxAlternatives: MAX_ALTERNATIVES,
  maxActionLength: MAX_ACTION_LENGTH,
  maxDetailLength: MAX_DETAIL_LENGTH
} as const;
