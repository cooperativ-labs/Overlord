import { z } from 'zod';

import { DEFERRED_WORK_LIMITS, type DeliveryReportPayloadV1 } from './index.js';

/**
 * The persisted delivery report schema (`deliveries.payload_json.deliveryReport`,
 * contract v166) and its strict reader.
 *
 * One definition shared by every component that reads stored reports: the core
 * service layer (`readDeliveryReport`), and the database package, whose
 * `mission_items` backfill must derive exactly the items the read surfaces show
 * (ADR 0060). A stored report that fails this schema anywhere reads as empty,
 * so no reader can show an item another reader hides.
 *
 * Node-only consumers import it from `@overlord/contract/delivery-report`; it is
 * not part of the browser-facing index.
 */

export const DELIVERY_REPORT_MAX_ITEMS = 12;
export const DELIVERY_REPORT_MAX_ALTERNATIVES = 6;
export const DELIVERY_REPORT_MAX_ACTION_LENGTH = 280;
export const DELIVERY_REPORT_MAX_DETAIL_LENGTH = 800;
export const DELIVERY_REPORT_MAX_COMMAND_LENGTH = 600;
export const DELIVERY_REPORT_MAX_LINK_LENGTH = 400;
export const DELIVERY_REPORT_MAX_WARNINGS = 12;

export const humanActionCategorySchema = z.enum([
  'environment',
  'database',
  'deployment',
  'codegen',
  'packaging',
  'external_service',
  'other'
]);

export const conciseTextSchema = z.string().trim().min(1).max(DELIVERY_REPORT_MAX_DETAIL_LENGTH);
export const commandTextSchema = z.string().trim().min(1).max(DELIVERY_REPORT_MAX_COMMAND_LENGTH);
export const actionTextSchema = z.string().trim().min(1).max(DELIVERY_REPORT_MAX_ACTION_LENGTH);

const LINK_PATTERN = /^(?:https?:\/\/\S+|(?![a-z][a-z0-9+.-]*:)[^\s<>"'`]+)$/i;

/** An HTTP(S) URL or a repository-relative file path; other URI schemes are rejected. */
export const humanActionLinkSchema = z
  .string()
  .trim()
  .min(1)
  .max(DELIVERY_REPORT_MAX_LINK_LENGTH)
  .regex(LINK_PATTERN);

export const deferredWorkFieldSchemas = {
  title: z.string().trim().min(1).max(DEFERRED_WORK_LIMITS.maxTitleLength),
  change: z.string().trim().min(1).max(DEFERRED_WORK_LIMITS.maxChangeLength),
  location: z.string().trim().min(1).max(DEFERRED_WORK_LIMITS.maxLocationLength),
  doneWhen: z.string().trim().min(1).max(DEFERRED_WORK_LIMITS.maxDoneWhenLength)
};

const itemIdSchema = z.string().trim().min(1).max(200);

const normalizedHumanActionSchema = z.strictObject({
  id: itemIdSchema,
  action: actionTextSchema,
  reason: conciseTextSchema.optional(),
  category: humanActionCategorySchema,
  blocking: z.boolean().optional(),
  command: commandTextSchema.optional(),
  verify: conciseTextSchema.optional(),
  link: humanActionLinkSchema.optional(),
  source: z.enum(['agent', 'deterministic_rule']),
  sourceRef: itemIdSchema.optional()
});

const normalizedTradeoffSchema = z.strictObject({
  id: itemIdSchema,
  decision: actionTextSchema,
  alternativesConsidered: z.array(conciseTextSchema).max(DELIVERY_REPORT_MAX_ALTERNATIVES),
  rationale: conciseTextSchema,
  impact: conciseTextSchema.optional(),
  source: z.literal('agent'),
  sourceRef: itemIdSchema.optional()
});

const normalizedDeferredWorkSchema = z.strictObject({
  id: itemIdSchema,
  ...deferredWorkFieldSchemas
});

const normalizedAgentReportSchema = z.strictObject({
  humanActions: z.array(normalizedHumanActionSchema).max(DELIVERY_REPORT_MAX_ITEMS),
  tradeoffsMade: z.array(normalizedTradeoffSchema).max(DELIVERY_REPORT_MAX_ITEMS),
  knownRisks: z.array(conciseTextSchema).max(DELIVERY_REPORT_MAX_ITEMS),
  deferredWork: z.array(normalizedDeferredWorkSchema).max(DELIVERY_REPORT_MAX_ITEMS),
  assumptions: z.array(conciseTextSchema).max(DELIVERY_REPORT_MAX_ITEMS)
});

const deliveryPresentationSchema = z.strictObject({
  status: z.enum(['deterministic', 'pending', 'composed', 'fallback']),
  markdown: z.string(),
  humanActions: z.array(normalizedHumanActionSchema).max(DELIVERY_REPORT_MAX_ITEMS),
  tradeoffsMade: z.array(normalizedTradeoffSchema).max(DELIVERY_REPORT_MAX_ITEMS),
  knownRisks: z.array(conciseTextSchema).max(DELIVERY_REPORT_MAX_ITEMS),
  deferredWork: z.array(normalizedDeferredWorkSchema).max(DELIVERY_REPORT_MAX_ITEMS),
  assumptions: z.array(conciseTextSchema).max(DELIVERY_REPORT_MAX_ITEMS),
  generatedBy: z.enum(['deterministic', 'gemini']),
  generatedAt: z.string().max(64).optional(),
  model: z.string().trim().min(1).max(200).optional()
});

export const persistedDeliveryReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  agentReport: normalizedAgentReportSchema,
  warnings: z.array(conciseTextSchema).max(DELIVERY_REPORT_MAX_WARNINGS).optional(),
  presentation: deliveryPresentationSchema
});

/** The report a delivery without a valid stored report reads as: no items, its summary as text. */
export function emptyDeliveryReport(summary: string): DeliveryReportPayloadV1 {
  return {
    schemaVersion: 1,
    agentReport: {
      humanActions: [],
      tradeoffsMade: [],
      knownRisks: [],
      deferredWork: [],
      assumptions: []
    },
    presentation: {
      status: 'deterministic',
      markdown: summary,
      humanActions: [],
      tradeoffsMade: [],
      knownRisks: [],
      deferredWork: [],
      assumptions: [],
      generatedBy: 'deterministic'
    }
  };
}

/**
 * Returns a safe read-side delivery report. Persisted V1 reports retain their
 * presentation status (including pending/composed/fallback); missing or
 * malformed reports read as {@link emptyDeliveryReport}.
 */
export function readDeliveryReport({
  summary,
  deliveryReport
}: {
  summary: string;
  deliveryReport: unknown;
}): DeliveryReportPayloadV1 {
  const parsed = persistedDeliveryReportSchema.safeParse(deliveryReport);
  // Zod types an optional key as `T | undefined`; parsing never adds an absent key.
  if (parsed.success) return parsed.data as DeliveryReportPayloadV1;
  return emptyDeliveryReport(summary);
}

/** {@link readDeliveryReport} over a raw `deliveries.payload_json` value (text or parsed). */
export function readDeliveryReportFromPayload(
  payloadJson: unknown,
  summary: string
): DeliveryReportPayloadV1 {
  let payload: unknown = payloadJson;
  if (typeof payloadJson === 'string') {
    try {
      payload = JSON.parse(payloadJson);
    } catch {
      payload = null;
    }
  }
  const deliveryReport =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { deliveryReport?: unknown }).deliveryReport
      : undefined;
  return readDeliveryReport({ summary, deliveryReport });
}
