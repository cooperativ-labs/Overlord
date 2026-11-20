/**
 * Instructions/summary swap guard (coo:1321, contract ADR 0083).
 *
 * An objective has two texts: the instructions, which are the complete brief
 * the executing agent receives, and the summary, a short overview for people
 * that is never sent to the agent. This pure module detects a write that put
 * them the wrong way round and returns an advisory warning; it never refuses a
 * write. It has no imports so the CLI can warn locally before it sends a
 * create through REST, which returns no warnings.
 */

/**
 * Swap guard thresholds (coo:1321). Chosen from 1,815 production objectives,
 * 76 with a summary: legitimate summaries were 1–5 lines, at most 1,734
 * characters and at most 1.22 times their instructions, and none had a
 * Markdown heading or numbered steps. The swap that prompted the guard
 * (coo:1320) was a 111-character instruction with a 1,703-character summary
 * (15.3 times) holding headings and six numbered steps.
 */
export const OBJECTIVE_SWAP_WARN_RATIO = 1.5;
export const OBJECTIVE_SWAP_WARN_MIN_SUMMARY_CHARS = 240;
/** Past this ratio (and length) the texts "look swapped" rather than "may be swapped". */
export const OBJECTIVE_SWAP_LIKELY_RATIO = 3;
export const OBJECTIVE_SWAP_LIKELY_MIN_SUMMARY_CHARS = 400;
/** Structured summaries warn only when the instructions are shorter than this. */
export const OBJECTIVE_SWAP_STRUCTURE_MAX_INSTRUCTION_CHARS = 400;
export const OBJECTIVE_FIELDS_SWAPPED_CODE = 'objective_fields_swapped';

const MARKDOWN_HEADING = /^\s{0,3}#{1,6}\s+\S/m;
const NUMBERED_STEP = /^\s{0,3}\d{1,3}[.)]\s+\S/gm;
const DONE_WHEN_LABEL = /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*|__)?done when(?:\*\*|__)?\s*:/im;

/**
 * Instruction-shaped structure in a summary: a Markdown heading, two or more
 * numbered steps, or a `Done when:` label line. A summary is one to three prose
 * paragraphs that end with a done-when *sentence*, so none of these belong in one.
 */
export function summaryInstructionStructure(text: string): string[] {
  const found: string[] = [];
  if (MARKDOWN_HEADING.test(text)) found.push('Markdown headings');
  if ((text.match(NUMBERED_STEP) ?? []).length >= 2) found.push('numbered steps');
  if (DONE_WHEN_LABEL.test(text)) found.push('a "Done when:" label');
  return found;
}

/**
 * The guard never refuses a write. `likely` is a clear swap by length ratio;
 * `possible` is a weaker length or structure signal.
 */
export type ObjectiveSummaryPlacement =
  | { verdict: 'ok' }
  | { verdict: 'warn'; severity: 'likely' | 'possible'; message: string };

const FIELD_ROLES =
  'The instructions (--objective-instructions, or "instructions" in JSON) are the complete brief the executing agent receives. ' +
  'The summary (--objective-summary, or "summary" in JSON) is a short overview for people, one to three paragraphs, and is never sent to the agent.';

/**
 * Detect an objective whose instructions and summary look swapped (coo:1321).
 *
 * Advisory only: both texts are always stored as written.
 *
 * - `likely` when the summary is at least {@link OBJECTIVE_SWAP_LIKELY_RATIO}
 *   times the instruction length and at least
 *   {@link OBJECTIVE_SWAP_LIKELY_MIN_SUMMARY_CHARS} characters.
 * - `possible` when the summary is more than {@link OBJECTIVE_SWAP_WARN_RATIO}
 *   times the instructions and at least
 *   {@link OBJECTIVE_SWAP_WARN_MIN_SUMMARY_CHARS} characters, or when it holds
 *   instruction structure while the instructions are shorter than
 *   {@link OBJECTIVE_SWAP_STRUCTURE_MAX_INSTRUCTION_CHARS} characters.
 *
 * Both texts are compared trimmed. The message names both fields and says
 * which one the executing agent receives.
 */
export function assessObjectiveSummaryPlacement({
  instructions,
  summary
}: {
  instructions: string;
  summary: string;
}): ObjectiveSummaryPlacement {
  const instructionChars = instructions.trim().length;
  const summaryChars = summary.trim().length;
  if (summaryChars === 0) return { verdict: 'ok' };
  const ratio = summaryChars / Math.max(1, instructionChars);
  const sizes = `The summary is ${summaryChars} characters; the instructions are ${instructionChars}.`;
  const fix =
    'Both texts were stored as written. If they are swapped, move the full brief into the instructions and a short overview into the summary (update-objective --instruction-text-file and --summary).';
  if (
    ratio >= OBJECTIVE_SWAP_LIKELY_RATIO &&
    summaryChars >= OBJECTIVE_SWAP_LIKELY_MIN_SUMMARY_CHARS
  ) {
    return {
      verdict: 'warn',
      severity: 'likely',
      message: `The objective instructions and summary look swapped: the summary is ${ratio.toFixed(1)} times longer than the instructions. ${sizes} ${FIELD_ROLES} ${fix}`
    };
  }
  const structure = summaryInstructionStructure(summary);
  const structured =
    structure.length > 0 && instructionChars < OBJECTIVE_SWAP_STRUCTURE_MAX_INSTRUCTION_CHARS;
  const longer =
    ratio > OBJECTIVE_SWAP_WARN_RATIO && summaryChars >= OBJECTIVE_SWAP_WARN_MIN_SUMMARY_CHARS;
  if (!structured && !longer) return { verdict: 'ok' };
  const reasons = [
    ...(longer ? [`the summary is ${ratio.toFixed(1)} times longer than the instructions`] : []),
    ...(structured ? [`the summary contains ${structure.join(', ')}`] : [])
  ];
  return {
    verdict: 'warn',
    severity: 'possible',
    message: `The objective instructions and summary may be swapped: ${reasons.join(' and ')}. ${sizes} ${FIELD_ROLES} ${fix}`
  };
}
