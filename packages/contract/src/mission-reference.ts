/**
 * Exact-reference mission lookup (contract v155, connector objective C2).
 *
 * Ranked mission search is candidate discovery: it is bounded, can fall back to a
 * recency listing and reports truncation, so it can never prove that no mission
 * mentions something. This lookup answers one narrower question exhaustively: which
 * missions in one project currently carry an exact reference token in a live
 * objective's instruction text. Pages follow a stable mission-id order; a caller has
 * examined every match only after following `nextCursor` to a page whose `complete`
 * is true.
 */

export const MISSION_REFERENCE_MIN_LENGTH = 8;
export const MISSION_REFERENCE_MAX_LENGTH = 512;
export const MISSION_REFERENCE_DEFAULT_LIMIT = 50;
export const MISSION_REFERENCE_MAX_LIMIT = 100;

export interface MissionReferenceObjectiveMatch {
  id: string;
  /** `<mission display id>.<objective key>`, accepted by load-context. */
  displayId: string;
  title: string | null;
  state: string;
  position: number;
}

export interface MissionReferenceMatch {
  id: string;
  displayId: string;
  title: string;
  /** Canonical, workspace-invariant status type; `complete` is mission completion. */
  statusType: string;
  statusId: string;
  projectId: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  /** Live objectives whose instruction text contains the exact reference. */
  objectives: MissionReferenceObjectiveMatch[];
}

export interface MissionReferenceSearchResponse {
  kind: 'mission_reference_search';
  version: 1;
  reference: string;
  projectId: string;
  workspaceId: string;
  /** This page's matches in mission-id order. A page may hold fewer than `limit`. */
  results: MissionReferenceMatch[];
  /** Opaque continuation bound to this reference and project; null on the last page. */
  nextCursor: string | null;
  /** True only on the last page of the scan (`nextCursor === null`). */
  complete: boolean;
}

const TOKEN_CHAR = /[A-Za-z0-9_]/;

/**
 * Whether `text` contains `reference` as a whole token: case-sensitive, and not
 * directly preceded or followed by a letter, digit or underscore. Punctuation such as
 * a closing parenthesis or a sentence period may follow it.
 */
export function containsExactReference(text: string, reference: string): boolean {
  if (!reference) return false;
  let from = 0;
  for (;;) {
    const at = text.indexOf(reference, from);
    if (at < 0) return false;
    const before = at > 0 ? text[at - 1]! : '';
    const after = text[at + reference.length] ?? '';
    if (!TOKEN_CHAR.test(before) && !TOKEN_CHAR.test(after)) return true;
    from = at + 1;
  }
}

/** Validation error for a reference token, or null when it is acceptable. */
export function invalidMissionReference(reference: string): string | null {
  if (reference.length < MISSION_REFERENCE_MIN_LENGTH)
    return `reference must be at least ${MISSION_REFERENCE_MIN_LENGTH} characters`;
  if (reference.length > MISSION_REFERENCE_MAX_LENGTH)
    return `reference must be at most ${MISSION_REFERENCE_MAX_LENGTH} characters`;
  if (/\s/.test(reference)) return 'reference must not contain whitespace';
  return null;
}

/** Canonical identity of one Knowledgebase Feature node. */
export interface KnowledgebaseFeatureIdentity {
  /** Knowledgebase server origin, for example https://kb.example.com. */
  origin: string;
  /** Workspace slug. */
  workspace: string;
  /** Feature node UUID. */
  nodeId: string;
}

const WORKSPACE_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const NODE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FEATURE_REFERENCE =
  /^kb-feature:(https?:\/\/[^/\s]+)\/([a-z0-9][a-z0-9-]{0,62})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Normalized identity, or null when any part is malformed. */
export function normalizeKnowledgebaseFeatureIdentity(
  identity: KnowledgebaseFeatureIdentity
): KnowledgebaseFeatureIdentity | null {
  let origin: string;
  try {
    const url = new URL(identity.origin);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    origin = url.origin;
  } catch {
    return null;
  }
  const workspace = identity.workspace;
  const nodeId = identity.nodeId.toLowerCase();
  if (!WORKSPACE_SLUG.test(workspace) || !NODE_UUID.test(nodeId)) return null;
  return { origin, workspace, nodeId };
}

/**
 * The canonical Feature reference token carried in a handoff mission's objective text:
 * `kb-feature:<origin>/<workspace>/<node uuid>`. Identity is never a title or path.
 */
export function knowledgebaseFeatureReference(identity: KnowledgebaseFeatureIdentity): string {
  const normalized = normalizeKnowledgebaseFeatureIdentity(identity);
  if (!normalized) throw new Error('Invalid Knowledgebase Feature identity');
  return `kb-feature:${normalized.origin}/${normalized.workspace}/${normalized.nodeId}`;
}

/** The Feature's stable web link, `<origin>/n/<node uuid>`. */
export function knowledgebaseFeatureUrl(identity: KnowledgebaseFeatureIdentity): string {
  const normalized = normalizeKnowledgebaseFeatureIdentity(identity);
  if (!normalized) throw new Error('Invalid Knowledgebase Feature identity');
  return `${normalized.origin}/n/${normalized.nodeId}`;
}

/** Parses a canonical reference token; null unless it is exactly canonical. */
export function parseKnowledgebaseFeatureReference(
  reference: string
): KnowledgebaseFeatureIdentity | null {
  const match = FEATURE_REFERENCE.exec(reference);
  if (!match) return null;
  const identity = normalizeKnowledgebaseFeatureIdentity({
    origin: match[1]!,
    workspace: match[2]!,
    nodeId: match[3]!
  });
  return identity && knowledgebaseFeatureReference(identity) === reference ? identity : null;
}
