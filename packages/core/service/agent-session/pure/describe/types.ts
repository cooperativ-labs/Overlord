/**
 * The description record — §9.1 of the connector interaction core.
 *
 * A formatter emits a small record rather than a string so mobile can render terse and web can
 * render full from the same stored row, and so every field's provenance stays inspectable. The
 * two fields that matter most for safety are the two that are never copied from model-controlled
 * text: `action` is chosen by the formatter from a closed set of phrases, and `riskMarkers` are
 * derived from structure.
 *
 * A person who approves `rm -rf /` because the card said "clean up temporary files" has been
 * failed by this module, not by the model. That is why nothing here is generated: an LLM would
 * need network access from inside a held decision, add latency to something already blocking,
 * cost money on every prompt, and be wrong in exactly the direction that causes harm.
 */

/**
 * Machine-derived flags, decidable at a glance.
 *
 * This closed vocabulary is what makes remote approval viable at all. Nobody audits a
 * 200-character command on a phone, but `sudo` + `network-egress` + `outside-project-directory`
 * is a judgment anyone can make in a second. Every marker is derived from structure, never
 * from prose, and every one is testable.
 */
export const RISK_MARKERS = [
  'sudo',
  'destructive',
  'irreversible',
  'network-egress',
  'pipe-to-shell',
  'outside-project-directory',
  'secret-adjacent',
  'overwrites-existing',
  'non-ascii-path',
  'truncated'
] as const;

export type RiskMarker = (typeof RISK_MARKERS)[number];

export type Description = {
  /** Short verb phrase, chosen by the formatter. Never model text. */
  action: string;
  /** Repo-relative path, program name, host — the thing being acted on. */
  subject: string | null;
  /** Bounded, redacted specifics. May contain reduced model-derived text. */
  detail: string | null;
  riskMarkers: RiskMarker[];
  /** Structural key names when the formatter could not safely emit values. */
  keys?: string[];
};

export type DescribeInput = {
  /** Normalized tool name. Formatters are keyed by this, never by the native name. */
  tool: string;
  /** The native tool input object, untrusted. */
  input: unknown;
  /** Absolute project root, when the adapter knows it. Used only to relativize paths. */
  projectRoot?: string | null;
};

export type Formatter = (input: DescribeInput) => Description;

/**
 * Formatter output version, stored beside every event and request.
 *
 * A request stays interpretable after a formatter changes: the reader knows which rules
 * produced the row it is looking at. Bump on any change to what a formatter emits.
 */
export const FORMATTER_VERSION = 1;

/** Deduplicate and order markers so a card is stable across runs and diffable in fixtures. */
export function normalizeMarkers(markers: (RiskMarker | null | false | undefined)[]): RiskMarker[] {
  const present = new Set(markers.filter((marker): marker is RiskMarker => Boolean(marker)));
  return RISK_MARKERS.filter(marker => present.has(marker));
}
