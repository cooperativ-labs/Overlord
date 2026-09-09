import type {
  DeliveryAgentReportV1,
  DeliveryPresentationV1,
  DeliveryReportPayloadV1,
  HumanActionCategory,
  HumanActionV1,
  TradeoffMadeV1
} from '@overlord/contract';

import {
  DELIVERY_REPORT_LIMITS,
  isDisplayableHumanAction,
  isValidHumanActionLink
} from './delivery-report.js';
import { nowIso } from './util.js';

const HUMAN_ACTION_CATEGORIES = new Set<HumanActionCategory>([
  'environment',
  'database',
  'deployment',
  'codegen',
  'packaging',
  'external_service',
  'other'
]);

/** Bounded draft returned by the compose-delivery automation before reconciliation. */
export type ComposeDeliveryDraft = {
  markdown?: unknown;
  humanActions?: unknown;
  tradeoffsMade?: unknown;
  knownRisks?: unknown;
  deferredWork?: unknown;
  assumptions?: unknown;
  reviewHighlights?: unknown;
};

export type DeterministicActionCandidate = HumanActionV1;

export type ChangeRationaleEvidence = {
  id: string;
  filePath: string;
  label: string;
  summary: string;
  why: string;
  impact: string;
};

/**
 * Derives human-action candidates from changed file paths. They carry
 * `deterministic_rule` provenance: the model may rephrase or cite them but never
 * invent beyond them, and reconciliation always keeps them in the presentation
 * (see `mergeDeterministicActionCandidates`) so a missing agent report never
 * hides a real step. The first matching path becomes the candidate's `link`
 * and `sourceRef`.
 */
export function deriveDeterministicActionCandidates({
  filePaths
}: {
  filePaths: string[];
}): DeterministicActionCandidate[] {
  const candidates: DeterministicActionCandidate[] = [];
  const seen = new Set<string>();

  const add = ({
    action,
    reason,
    category,
    verify,
    filePath
  }: {
    action: string;
    reason: string;
    category: HumanActionCategory;
    verify: string;
    filePath: string;
  }) => {
    if (!isDisplayableHumanAction(action) || seen.has(action)) return;
    seen.add(action);
    candidates.push({
      id: `rule-action-${candidates.length + 1}`,
      action,
      reason,
      category,
      verify,
      ...(isValidHumanActionLink(filePath) ? { link: filePath } : {}),
      source: 'deterministic_rule',
      sourceRef: filePath
    });
  };

  for (const rawPath of filePaths) {
    const filePath = rawPath.replace(/\\/g, '/');
    const base = filePath.split('/').pop() ?? filePath;
    if (
      /(?:^|\/)(?:migrations?|supabase\/migrations)\//i.test(filePath) ||
      /\.(?:sql)$/i.test(base)
    ) {
      add({
        action: 'Apply the database migration(s) included in this delivery.',
        reason: `Changed path ${filePath} looks like a schema/migration update.`,
        category: 'database',
        verify:
          'The new migration is recorded as applied and the service starts without schema errors.',
        filePath
      });
    }
    if (/(?:^|\/)\.env(?:\.|$)|\.env\.[^/]+$/i.test(filePath) || /env\.example$/i.test(base)) {
      add({
        action: 'Review and set any new environment variables.',
        reason: `Changed path ${filePath} may introduce required configuration.`,
        category: 'environment',
        verify:
          'Every variable added to the example file has a value in each environment and the service boots without a missing-configuration error.',
        filePath
      });
    }
    if (/docker-compose|Dockerfile|fly\.toml|vercel\.json|railway/i.test(filePath)) {
      add({
        action: 'Redeploy the affected service with the updated configuration.',
        reason: `Changed path ${filePath} suggests a deployment/config change.`,
        category: 'deployment',
        verify: 'The new deployment is healthy and serving traffic with the updated configuration.',
        filePath
      });
    }
    if (/(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i.test(filePath)) {
      add({
        action: 'Confirm the new or changed CI workflow runs green on the next push.',
        reason: `Changed path ${filePath} adds or edits a GitHub Actions workflow.`,
        category: 'deployment',
        verify:
          'The workflow appears in the Actions tab for the next push and completes successfully.',
        filePath
      });
    }
    if (/package\.json$|Cargo\.toml$|\.csproj$/i.test(base)) {
      add({
        action: 'Reinstall or rebuild package dependencies if your environment is stale.',
        reason: `Changed path ${filePath} may alter dependency resolution.`,
        category: 'packaging',
        verify: 'The install completes without lockfile drift and the build passes locally.',
        filePath
      });
    }
  }

  return candidates.slice(0, DELIVERY_REPORT_LIMITS.maxItems);
}

/**
 * Appends every deterministic candidate that `actions` does not already carry
 * (matched by id), bounded to the report limit. Agent and composed actions keep
 * their order and lead the list; rule-derived actions follow.
 */
export function mergeDeterministicActionCandidates({
  actions,
  candidates
}: {
  actions: HumanActionV1[];
  candidates: DeterministicActionCandidate[];
}): HumanActionV1[] {
  const merged = actions.slice(0, DELIVERY_REPORT_LIMITS.maxItems);
  const seen = new Set(merged.map(action => action.id));
  for (const candidate of candidates) {
    if (merged.length >= DELIVERY_REPORT_LIMITS.maxItems) break;
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    merged.push(candidate);
  }
  return merged;
}

function clampText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function clampStringList(
  value: unknown,
  maxItems: number = DELIVERY_REPORT_LIMITS.maxItems
): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = clampText(item, DELIVERY_REPORT_LIMITS.maxDetailLength);
    if (!text) continue;
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

export type DeferredWorkObjectiveRef = {
  title?: string | null;
  instruction?: string | null;
};

const DEFERRED_WORK_STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'for',
  'that',
  'this',
  'with',
  'from',
  'into',
  'then',
  'than',
  'when',
  'been',
  'have',
  'does',
  'doing',
  'just',
  'like',
  'over',
  'under',
  'after',
  'before',
  'during',
  'each',
  'only',
  'not',
  'but',
  'was',
  'were',
  'are',
  'will',
  'can',
  'could',
  'would',
  'should',
  'must',
  'make',
  'need',
  'needs',
  'using',
  'used',
  'also',
  'its',
  'their',
  'them',
  'they',
  'you',
  'your',
  'our',
  'any',
  'all',
  'some',
  'more',
  'most',
  'other',
  'such',
  'work',
  'item',
  'items',
  'remaining',
  'left',
  'undone',
  'phase',
  'step',
  'next',
  'add',
  'update',
  'implement'
]);

function normalizeDeferredWorkText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function significantDeferredWorkTokens(value: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of normalizeDeferredWorkText(value).split(' ')) {
    if (token.length < 4 || DEFERRED_WORK_STOP_WORDS.has(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

/** True when two statements are restating the same work closely enough to treat as duplicates. */
export function deferredWorkTextsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeDeferredWorkText(left);
  const normalizedRight = normalizeDeferredWorkText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  const shorter =
    normalizedLeft.length <= normalizedRight.length ? normalizedLeft : normalizedRight;
  const longer = normalizedLeft.length <= normalizedRight.length ? normalizedRight : normalizedLeft;
  if (shorter.length >= 12 && longer.includes(shorter)) return true;
  const leftTokens = significantDeferredWorkTokens(left);
  const rightTokens = significantDeferredWorkTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  if (intersection < 2) return false;
  const union = leftTokens.size + rightTokens.size - intersection;
  const coverage = intersection / Math.min(leftTokens.size, rightTokens.size);
  return intersection / union >= 0.4 || coverage >= 0.75;
}

function collectDeferredWorkExclusionTexts({
  currentObjective,
  plannedObjectives,
  humanActions,
  candidateActions
}: {
  currentObjective?: DeferredWorkObjectiveRef | null;
  plannedObjectives?: DeferredWorkObjectiveRef[];
  humanActions?: Array<{ action: string; reason?: string }>;
  candidateActions?: Array<{ action: string; reason?: string }>;
}): string[] {
  const texts: string[] = [];
  const pushObjective = (objective?: DeferredWorkObjectiveRef | null) => {
    const title = objective?.title?.trim();
    const instruction = objective?.instruction?.trim();
    if (title) texts.push(title);
    if (instruction) texts.push(instruction);
  };
  pushObjective(currentObjective);
  for (const planned of plannedObjectives ?? []) pushObjective(planned);
  for (const action of [...(humanActions ?? []), ...(candidateActions ?? [])]) {
    if (action.action.trim()) texts.push(action.action);
    if (action.reason?.trim()) texts.push(action.reason);
  }
  return texts;
}

/**
 * Drops deferred-work statements that restate planned work on this mission,
 * leftover slices of the current objective, or human implementation follow-up.
 * Eligible items stay in their original order.
 */
export function filterDeferredWork({
  items,
  currentObjective,
  plannedObjectives,
  humanActions,
  candidateActions
}: {
  items: string[];
  currentObjective?: DeferredWorkObjectiveRef | null;
  plannedObjectives?: DeferredWorkObjectiveRef[];
  humanActions?: Array<{ action: string; reason?: string }>;
  candidateActions?: Array<{ action: string; reason?: string }>;
}): string[] {
  const excluded = collectDeferredWorkExclusionTexts({
    currentObjective,
    plannedObjectives,
    humanActions,
    candidateActions
  });
  if (excluded.length === 0) return items.slice();
  return items.filter(item => !excluded.some(text => deferredWorkTextsOverlap(item, text)));
}

function isDeferredWorkRewrite({
  agentItem,
  presentationItem
}: {
  agentItem: string;
  presentationItem: string;
}): boolean {
  if (agentItem === presentationItem) return true;
  const normalizedAgent = normalizeDeferredWorkText(agentItem);
  const normalizedPresentation = normalizeDeferredWorkText(presentationItem);
  if (
    normalizedAgent.length >= 12 &&
    (normalizedPresentation.includes(normalizedAgent) ||
      normalizedAgent.includes(normalizedPresentation))
  ) {
    return true;
  }
  if (deferredWorkTextsOverlap(agentItem, presentationItem)) return true;
  const agentTokens = significantDeferredWorkTokens(agentItem);
  const presentationTokens = significantDeferredWorkTokens(presentationItem);
  if (agentTokens.size === 0 || presentationTokens.size === 0) return false;
  let intersection = 0;
  for (const token of agentTokens) {
    if (presentationTokens.has(token)) intersection += 1;
  }
  return intersection >= 2 && intersection / agentTokens.size >= 0.5;
}

/**
 * Maps a presentation deferred-work item onto the unused agent-report index it
 * was rewritten from. Returns null for compose-added extras. Walks agent items
 * in order so dropped earlier items do not steal a later rewrite's identity.
 */
export function matchDeferredWorkAgentIndex({
  presentationItem,
  agentItems,
  usedIndexes
}: {
  presentationItem: string;
  agentItems: string[];
  usedIndexes: Set<number>;
}): number | null {
  for (let index = 0; index < agentItems.length; index += 1) {
    if (usedIndexes.has(index)) continue;
    if (isDeferredWorkRewrite({ agentItem: agentItems[index]!, presentationItem })) return index;
  }
  return null;
}

/**
 * Presentation deferred work is the operator-facing eligible subset of
 * `agentReport.deferredWork`. The agent list itself is never rewritten.
 */
export function applyDeferredWorkEligibility({
  report,
  currentObjective,
  plannedObjectives,
  candidateActions
}: {
  report: DeliveryReportPayloadV1;
  currentObjective?: DeferredWorkObjectiveRef | null;
  plannedObjectives?: DeferredWorkObjectiveRef[];
  candidateActions?: Array<{ action: string; reason?: string }>;
}): DeliveryReportPayloadV1 {
  const deferredWork = filterDeferredWork({
    items: report.agentReport.deferredWork,
    currentObjective,
    plannedObjectives,
    humanActions: report.agentReport.humanActions,
    candidateActions
  });
  return {
    ...report,
    presentation: {
      ...report.presentation,
      deferredWork
    }
  };
}

function composeEligibility({
  report,
  candidates,
  currentObjective,
  plannedObjectives
}: {
  report: DeliveryReportPayloadV1;
  candidates: DeterministicActionCandidate[];
  currentObjective?: DeferredWorkObjectiveRef | null;
  plannedObjectives?: DeferredWorkObjectiveRef[];
}): {
  currentObjective?: DeferredWorkObjectiveRef | null;
  plannedObjectives?: DeferredWorkObjectiveRef[];
  humanActions: Array<{ action: string; reason?: string }>;
  candidateActions: DeterministicActionCandidate[];
} {
  return {
    currentObjective,
    plannedObjectives,
    humanActions: report.agentReport.humanActions,
    candidateActions: candidates
  };
}

function composeDeferredWorkPresentation({
  eligibleItems,
  draftItems,
  currentObjective,
  plannedObjectives,
  humanActions,
  candidateActions
}: {
  eligibleItems: string[];
  draftItems: string[];
  currentObjective?: DeferredWorkObjectiveRef | null;
  plannedObjectives?: DeferredWorkObjectiveRef[];
  humanActions?: Array<{ action: string; reason?: string }>;
  candidateActions?: Array<{ action: string; reason?: string }>;
}): string[] {
  const merged = reconcileDeferredWork({
    agentItems: eligibleItems,
    draftItems
  });
  const kept = merged.slice(0, eligibleItems.length);
  const extras = filterDeferredWork({
    items: merged.slice(eligibleItems.length),
    currentObjective,
    plannedObjectives,
    humanActions,
    candidateActions
  });
  return [...kept, ...extras];
}

/**
 * Chooses the deferred-work list for a composed presentation. The compose
 * automation is asked to rewrite each *eligible* agent-listed item as a
 * standalone objective statement, so a draft item may only replace its source
 * when it is at least as detailed (never shorter). A draft that drops eligible
 * items keeps that eligible list untouched; extra draft items beyond it are
 * kept only when they still pass eligibility, bounded. With no eligible agent
 * items, the filtered draft list is used as-is.
 */
export function reconcileDeferredWork({
  agentItems,
  draftItems,
  maxItems = DELIVERY_REPORT_LIMITS.maxItems
}: {
  agentItems: string[];
  draftItems: string[];
  maxItems?: number;
}): string[] {
  if (agentItems.length === 0) return draftItems.slice(0, maxItems);
  if (draftItems.length < agentItems.length) return agentItems.slice(0, maxItems);
  const merged = agentItems.map((agentItem, index) => {
    const draftItem = draftItems[index]!;
    return draftItem.length >= agentItem.length ? draftItem : agentItem;
  });
  return [...merged, ...draftItems.slice(agentItems.length)].slice(0, maxItems);
}

function asCategory(value: unknown): HumanActionCategory {
  return typeof value === 'string' && HUMAN_ACTION_CATEGORIES.has(value as HumanActionCategory)
    ? (value as HumanActionCategory)
    : 'other';
}

function evidenceActions({
  agentReport,
  candidates
}: {
  agentReport: DeliveryAgentReportV1;
  candidates: DeterministicActionCandidate[];
}): Map<string, HumanActionV1> {
  const byId = new Map<string, HumanActionV1>();
  for (const action of agentReport.humanActions) byId.set(action.id, action);
  for (const action of candidates) byId.set(action.id, action);
  return byId;
}

function evidenceTradeoffs({
  agentReport,
  rationales
}: {
  agentReport: DeliveryAgentReportV1;
  rationales: ChangeRationaleEvidence[];
}): Map<string, TradeoffMadeV1> {
  const byId = new Map<string, TradeoffMadeV1>();
  for (const tradeoff of agentReport.tradeoffsMade) byId.set(tradeoff.id, tradeoff);
  for (const rationale of rationales) {
    byId.set(rationale.id, {
      id: rationale.id,
      decision: rationale.label,
      alternativesConsidered: [],
      rationale: rationale.why,
      impact: rationale.impact,
      source: 'change_rationale',
      sourceRef: rationale.filePath
    });
  }
  return byId;
}

function optionalActionText(
  draftValue: unknown,
  sourceValue: string | undefined,
  maxLength: number
): string | undefined {
  return clampText(draftValue, maxLength) ?? sourceValue;
}

/** Prefers the model's link when it is well-formed, else the evidence link, else nothing. */
function optionalActionLink(draftValue: unknown, source: HumanActionV1): string | undefined {
  const fromDraft = clampText(draftValue, DELIVERY_REPORT_LIMITS.maxLinkLength);
  if (fromDraft && isValidHumanActionLink(fromDraft)) return fromDraft;
  return source.link && isValidHumanActionLink(source.link) ? source.link : undefined;
}

/** Composed `command`, `verify`, and `link` fields, present only when they have a value. */
function composedActionDetails(
  item: Record<string, unknown>,
  source: HumanActionV1
): Pick<HumanActionV1, 'command' | 'verify' | 'link'> {
  const command = optionalActionText(
    item.command,
    source.command,
    DELIVERY_REPORT_LIMITS.maxCommandLength
  );
  const verify = optionalActionText(
    item.verify,
    source.verify,
    DELIVERY_REPORT_LIMITS.maxDetailLength
  );
  const link = optionalActionLink(item.link, source);
  return {
    ...(command ? { command } : {}),
    ...(verify ? { verify } : {}),
    ...(link ? { link } : {})
  };
}

/**
 * Reconciles a model draft against authoritative evidence. Invented actions or
 * tradeoffs without a matching source id are dropped. Deterministic candidates
 * the draft did not cite are appended so a rule-derived step always lands. On
 * null/invalid drafts the deterministic presentation (plus candidates) is
 * retained with status `fallback`.
 */
export function reconcileDeliveryComposeDraft({
  report,
  draft,
  candidates = [],
  rationales = [],
  model,
  generatedAt = nowIso(),
  currentObjective,
  plannedObjectives
}: {
  report: DeliveryReportPayloadV1;
  draft: ComposeDeliveryDraft | null;
  candidates?: DeterministicActionCandidate[];
  rationales?: ChangeRationaleEvidence[];
  model?: string | null;
  generatedAt?: string;
  currentObjective?: DeferredWorkObjectiveRef | null;
  plannedObjectives?: DeferredWorkObjectiveRef[];
}): DeliveryPresentationV1 {
  const eligibility = composeEligibility({
    report,
    candidates,
    currentObjective,
    plannedObjectives
  });
  const eligibleAgentItems = filterDeferredWork({
    items: report.agentReport.deferredWork,
    ...eligibility
  });
  const fallback: DeliveryPresentationV1 = {
    ...report.presentation,
    status: 'fallback',
    humanActions: mergeDeterministicActionCandidates({
      actions: report.presentation.humanActions,
      candidates
    }),
    deferredWork: filterDeferredWork({
      items: report.presentation.deferredWork,
      ...eligibility
    }),
    generatedBy: 'deterministic',
    generatedAt,
    ...(model ? { model } : {})
  };

  if (!draft || typeof draft !== 'object') {
    return fallback;
  }

  const markdown = clampText(draft.markdown, 12_000) ?? report.presentation.markdown;

  const actionsById = evidenceActions({
    agentReport: report.agentReport,
    candidates
  });
  const tradeoffsById = evidenceTradeoffs({
    agentReport: report.agentReport,
    rationales
  });

  const humanActions: HumanActionV1[] = [];
  if (Array.isArray(draft.humanActions)) {
    for (const raw of draft.humanActions) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const sourceId = clampText(item.sourceId ?? item.id, 80);
      if (!sourceId) continue;
      const source = actionsById.get(sourceId);
      if (!source) continue;
      const actionText =
        clampText(item.action, DELIVERY_REPORT_LIMITS.maxActionLength) ?? source.action;
      if (!isDisplayableHumanAction(actionText)) continue;
      humanActions.push({
        ...source,
        action: actionText,
        ...(clampText(item.reason, DELIVERY_REPORT_LIMITS.maxDetailLength)
          ? { reason: clampText(item.reason, DELIVERY_REPORT_LIMITS.maxDetailLength)! }
          : source.reason
            ? { reason: source.reason }
            : {}),
        category: asCategory(item.category ?? source.category),
        ...composedActionDetails(item, source)
      });
      if (humanActions.length >= DELIVERY_REPORT_LIMITS.maxItems) break;
    }
  }

  const tradeoffsMade: TradeoffMadeV1[] = [];
  if (Array.isArray(draft.tradeoffsMade)) {
    for (const raw of draft.tradeoffsMade) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const sourceId = clampText(item.sourceId ?? item.id, 80);
      if (!sourceId) continue;
      const source = tradeoffsById.get(sourceId);
      if (!source) continue;
      tradeoffsMade.push({
        ...source,
        decision:
          clampText(item.decision, DELIVERY_REPORT_LIMITS.maxActionLength) ?? source.decision,
        rationale:
          clampText(item.rationale, DELIVERY_REPORT_LIMITS.maxDetailLength) ?? source.rationale,
        alternativesConsidered:
          clampStringList(item.alternativesConsidered, DELIVERY_REPORT_LIMITS.maxAlternatives)
            .length > 0
            ? clampStringList(item.alternativesConsidered, DELIVERY_REPORT_LIMITS.maxAlternatives)
            : source.alternativesConsidered,
        ...(clampText(item.impact, DELIVERY_REPORT_LIMITS.maxDetailLength)
          ? { impact: clampText(item.impact, DELIVERY_REPORT_LIMITS.maxDetailLength)! }
          : source.impact
            ? { impact: source.impact }
            : {})
      });
      if (tradeoffsMade.length >= DELIVERY_REPORT_LIMITS.maxItems) break;
    }
  }

  // If the model returned nothing usable for structured sections, keep evidence.
  // Rule-derived candidates always land, cited by the model or not.
  const resolvedActions = mergeDeterministicActionCandidates({
    actions: humanActions.length > 0 ? humanActions : report.presentation.humanActions,
    candidates
  });
  const resolvedTradeoffs =
    tradeoffsMade.length > 0 ? tradeoffsMade : report.presentation.tradeoffsMade;

  return {
    status: 'composed',
    markdown: markdown || report.presentation.markdown,
    humanActions: resolvedActions,
    tradeoffsMade: resolvedTradeoffs,
    knownRisks:
      clampStringList(draft.knownRisks).length > 0
        ? clampStringList(draft.knownRisks)
        : report.presentation.knownRisks,
    deferredWork: composeDeferredWorkPresentation({
      eligibleItems: eligibleAgentItems,
      draftItems: clampStringList(draft.deferredWork),
      ...eligibility
    }),
    assumptions:
      clampStringList(draft.assumptions).length > 0
        ? clampStringList(draft.assumptions)
        : report.presentation.assumptions,
    generatedBy: 'gemini',
    generatedAt,
    ...(model ? { model } : {})
  };
}

/** Applies a composed/fallback presentation onto the versioned delivery report. */
export function applyDeliveryPresentation({
  report,
  presentation
}: {
  report: DeliveryReportPayloadV1;
  presentation: DeliveryPresentationV1;
}): DeliveryReportPayloadV1 {
  return {
    ...report,
    presentation
  };
}
