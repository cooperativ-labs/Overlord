import {
  type DeferredWorkInputV1,
  type DeferredWorkV1,
  type DeliveryAgentReportInputV1,
  type DeliveryAgentReportV1,
  type DeliveryReportPayloadV1,
  type HumanActionV1,
  type TradeoffMadeV1
} from '@overlord/contract';
import {
  actionTextSchema,
  commandTextSchema,
  conciseTextSchema,
  deferredWorkFieldSchemas,
  DELIVERY_REPORT_MAX_ACTION_LENGTH,
  DELIVERY_REPORT_MAX_ALTERNATIVES,
  DELIVERY_REPORT_MAX_COMMAND_LENGTH,
  DELIVERY_REPORT_MAX_DETAIL_LENGTH,
  DELIVERY_REPORT_MAX_ITEMS,
  DELIVERY_REPORT_MAX_LINK_LENGTH,
  DELIVERY_REPORT_MAX_WARNINGS,
  humanActionCategorySchema,
  humanActionLinkSchema,
  readDeliveryReport as readPersistedDeliveryReport
} from '@overlord/contract/delivery-report';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const MAX_ITEMS = DELIVERY_REPORT_MAX_ITEMS;
const MAX_ALTERNATIVES = DELIVERY_REPORT_MAX_ALTERNATIVES;
const MAX_ACTION_LENGTH = DELIVERY_REPORT_MAX_ACTION_LENGTH;
const MAX_DETAIL_LENGTH = DELIVERY_REPORT_MAX_DETAIL_LENGTH;
const MAX_COMMAND_LENGTH = DELIVERY_REPORT_MAX_COMMAND_LENGTH;
const MAX_LINK_LENGTH = DELIVERY_REPORT_MAX_LINK_LENGTH;

const linkSchema = humanActionLinkSchema;

const humanActionSchema = z.strictObject({
  action: actionTextSchema,
  reason: conciseTextSchema.optional(),
  category: humanActionCategorySchema.optional(),
  blocking: z.boolean().optional(),
  command: commandTextSchema.optional(),
  verify: conciseTextSchema.optional(),
  link: linkSchema.optional()
});

/** Returns true when `link` is an acceptable human-action link (HTTP(S) URL or relative path). */
export function isValidHumanActionLink(link: string): boolean {
  return linkSchema.safeParse(link).success;
}

const tradeoffSchema = z.strictObject({
  decision: actionTextSchema,
  alternativesConsidered: z.array(conciseTextSchema).max(MAX_ALTERNATIVES).optional(),
  rationale: conciseTextSchema,
  impact: conciseTextSchema.optional()
});

const deferredWorkFields = deferredWorkFieldSchemas;

/** Agent-written deferred-work item (contract v166); plain strings are not accepted. */
export const deferredWorkInputSchema = z.strictObject(deferredWorkFields);

/**
 * Strict check of the wire `deliveryReport.agentReport.deferredWork` (contract
 * v166). Unlike the other advisory fields, which are salvaged item by item,
 * a deferred-work list that is not an array of `DeferredWorkInputV1` objects
 * rejects the whole delivery: a string item, a missing, blank or over-long
 * field, or an unknown key. Returns the first problem, or null when the list is
 * absent or valid. Excess items keep the salvage behaviour (truncation with a
 * warning).
 */
export function deferredWorkInputProblem(deliveryReport: unknown): string | null {
  if (typeof deliveryReport !== 'object' || deliveryReport === null) return null;
  const agentReport = (deliveryReport as { agentReport?: unknown }).agentReport;
  if (typeof agentReport !== 'object' || agentReport === null) return null;
  const deferredWork = (agentReport as { deferredWork?: unknown }).deferredWork;
  if (deferredWork === undefined) return null;
  const field = 'deliveryReport.agentReport.deferredWork';
  if (!Array.isArray(deferredWork)) return `${field} must be an array`;
  for (const [index, item] of deferredWork.slice(0, MAX_ITEMS).entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return `${field}[${index}] must be an object with title, change, location, and doneWhen; string items are not accepted`;
    }
    const parsed = deferredWorkInputSchema.safeParse(item);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const key = issue?.path.length ? `.${issue.path.join('.')}` : '';
      return `${field}[${index}]${key}: ${issue?.message ?? 'invalid deferred-work item'}`;
    }
  }
  return null;
}

/**
 * Stable delivery-local deferred-work id (contract v166): the zero-based index in
 * the normalized agent report plus a digest of the canonical object.
 */
export function deferredWorkId(index: number, item: DeferredWorkInputV1): string {
  const canonical = JSON.stringify([
    item.title.trim(),
    item.change.trim(),
    item.location.trim(),
    item.doneWhen.trim()
  ]);
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
  return `deferred-work-${index}-${digest}`;
}

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
      ...(action.command ? { command: action.command } : {}),
      ...(action.verify ? { verify: action.verify } : {}),
      ...(action.link ? { link: action.link } : {}),
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

  const deferredWork: DeferredWorkV1[] = (input.deferredWork ?? []).map((item, index) => ({
    id: deferredWorkId(index, item),
    title: item.title,
    change: item.change,
    location: item.location,
    doneWhen: item.doneWhen
  }));

  return {
    humanActions,
    tradeoffsMade,
    knownRisks: input.knownRisks ?? [],
    deferredWork,
    assumptions: input.assumptions ?? []
  };
}

const MAX_WARNINGS = DELIVERY_REPORT_MAX_WARNINGS;
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
        deferredWorkInputSchema,
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
 * payloads receive the same deterministic projection used by REST readers. The
 * schema lives in `@overlord/contract/delivery-report` so the database backfill
 * reads stored reports exactly as this function does.
 */
export function readDeliveryReport({
  summary,
  deliveryReport
}: {
  summary: string;
  deliveryReport: unknown;
}): DeliveryReportPayloadV1 {
  return readPersistedDeliveryReport({ summary, deliveryReport });
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
  maxDetailLength: MAX_DETAIL_LENGTH,
  maxCommandLength: MAX_COMMAND_LENGTH,
  maxLinkLength: MAX_LINK_LENGTH
} as const;
