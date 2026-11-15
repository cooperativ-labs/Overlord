/**
 * Shared writing rules for human-facing text written by Overlord's model
 * composers, loosely based on ASD-STE100 Simplified Technical English (STE).
 *
 * Two profiles exist:
 *
 * - {@link WRITING_RULES}: the base profile used by the delivery composer and
 *   the mission-summary composer. Its text is pinned by a test so that moving
 *   it here does not change their behavior.
 * - {@link OBJECTIVE_WRITING_RULES}: the stricter objective profile for
 *   objective titles and summaries (coo:1275). It adds the modal rule, the
 *   confidence and ambiguity vocabulary, CAUTION placement and the
 *   no-contraction / no-semicolon rules. Other composers adopt it only with
 *   their own regression fixtures.
 *
 * {@link lintSte} is an advisory, heuristic checker. It does not prove ASD
 * compliance or fidelity; callers use it to ask for one bounded rewrite and to
 * return warnings, never to reject text on its own.
 */

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

/**
 * The stricter objective profile: the base rules plus the Simplified
 * Technical English additions from the objective-description plan (§4.4,
 * §4.5). Applies to objective titles and objective summaries only.
 */
export const OBJECTIVE_WRITING_RULES = `${WRITING_RULES}
Additional rules for objective titles and summaries (Simplified Technical English style):
- Use "must" for a requirement and "can" for an ability or a permission. Do not use "should", "may", "might", "could" or "would": each of them has two meanings.
- Put a condition before its command: "If the migration fails, stop the release", not "Stop the release if the migration fails".
- Start a sentence about a destructive or irreversible step with "CAUTION:" and put it before the sentence for that step.
- Do not use contractions: write "do not", not "don't". Do not use semicolons: write two sentences.
- Do not state a guess as a fact. When you are not sure, use exactly one of these forms and give the reason or the check:
  - Probable: "X is probably true, because Y." or "The most probable cause is X, because Y."
  - Possible: "It is possible that X." Then say what will confirm it.
  - Not known: "X is not known."
  - Expected: "X will occur if Y."
  - Not tested: "The instructions do not say that X was tested."
- Use one confidence level for each claim. Do not stack hedges such as "probably possibly".
- Do not remove a doubt to make a sentence shorter. A doubt is a fact, the same as a warning.
- When the source text is unclear, say so with these forms:
  - A gap: "The instructions do not say X."
  - A contradiction: "The instructions say X in one place and Y in another."
  - A term with two meanings: "X can mean A or B."
  - A choice that a person must make: "Decision needed: A or B." Always name the options.
- When a summary has a "Decision needed:" sentence, the goal sentence must not choose or imply one of its options. Write the goal in a neutral form, for example "Store the brief state in the database that the decision selects."`;

export type SteLintCode =
  | 'sentence_too_long'
  | 'ambiguous_modal'
  | 'contraction'
  | 'semicolon'
  | 'stacked_hedge'
  | 'unsupported_hedge'
  | 'passive_voice';

export type SteLintViolation = {
  code: SteLintCode;
  message: string;
  /** The sentence (or part of it) that has the problem, with exempt text masked. */
  excerpt: string;
  /** A replacement from the confidence vocabulary, when one applies. */
  suggestion?: string;
};

const MODAL_SUGGESTIONS: Record<string, string> = {
  should: 'Use "must" for a requirement, or "X will occur if Y" for an expectation.',
  may: 'Use "can" for a permission, or "It is possible that X" and say what will confirm it.',
  might: 'Use "It is possible that X" and say what will confirm it.',
  could: 'Use "can" for an ability, or "It is possible that X" and say what will confirm it.',
  would: 'Use "will" with its condition: "X will occur if Y".'
};

const CONTRACTION_PATTERN =
  /\b(?:\w+n['’]t|(?:it|that|there|what|here|who|he|she|let)['’]s|\w+['’](?:re|ve|ll|d|m))\b/gi;
const MODAL_PATTERN = /\b(should|may|might|could|would)\b/gi;
const HEDGE_PATTERN = /\b(probably|possibly|possible|perhaps|maybe|likely|i expect)\b/gi;
const STACKABLE_HEDGE_PATTERN =
  /\b(probably|possibly|possible|perhaps|maybe|likely|might|may|could)\b/gi;
const SUPPORT_PATTERN =
  /\b(because|since|as shown by|will confirm|confirms?|to confirm|if|when|a (?:check|test|search) of)\b/i;
const PASSIVE_PATTERN =
  /\b(?:is|are|was|were|been|being|be)\s+(?:\w+ed|written|done|made|given|taken|shown|known|seen|built|sent|kept|left|found|run)\b/i;

/**
 * Mask text that the rules exempt: code spans, double-quoted text, URLs and
 * identifier-like tokens. Masked text keeps sentence boundaries intact.
 */
export function maskSteExemptText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' CODE ')
    .replace(/`[^`\n]*`/g, 'CODE')
    .replace(/"[^"\n]*"/g, 'QUOTE')
    .replace(/“[^”\n]*”/g, 'QUOTE')
    .replace(/https?:\/\/[^\s)]+/g, 'URL')
    .replace(/(?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)+/g, 'PATH')
    .replace(/\b[\w-]+\.[a-z]{1,5}\b/gi, 'FILE')
    .replace(/\b\d+(?:\.\d+)+\b/g, 'NUMBER');
}

/** Split masked prose into sentences. */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .flatMap(paragraph => paragraph.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/))
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
}

/**
 * Advisory STE checks. Approved confidence forms are never flagged; an
 * approved hedge without a reason or a confirmation step is.
 */
export function lintSte(
  text: string,
  { maxSentenceWords = 25 }: { maxSentenceWords?: number } = {}
): SteLintViolation[] {
  const violations: SteLintViolation[] = [];
  const sentences = splitSentences(maskSteExemptText(text));
  sentences.forEach((sentence, index) => {
    const words = countWords(sentence);
    if (words > maxSentenceWords) {
      violations.push({
        code: 'sentence_too_long',
        message: `The sentence has ${words} words. Use at most ${maxSentenceWords}.`,
        excerpt: sentence
      });
    }
    for (const match of sentence.matchAll(MODAL_PATTERN)) {
      const modal = match[1]!.toLowerCase();
      violations.push({
        code: 'ambiguous_modal',
        message: `"${match[1]}" has two meanings.`,
        excerpt: sentence,
        suggestion: MODAL_SUGGESTIONS[modal]!
      });
    }
    for (const match of sentence.matchAll(CONTRACTION_PATTERN)) {
      violations.push({
        code: 'contraction',
        message: `Write "${match[0]}" in full.`,
        excerpt: sentence
      });
    }
    if (sentence.includes(';')) {
      violations.push({
        code: 'semicolon',
        message: 'Write two sentences instead of a semicolon.',
        excerpt: sentence
      });
    }
    const hedges = [...sentence.matchAll(STACKABLE_HEDGE_PATTERN)];
    if (hedges.length > 1) {
      violations.push({
        code: 'stacked_hedge',
        message: 'Use one confidence level for each claim.',
        excerpt: sentence
      });
    }
    if (HEDGE_PATTERN.test(sentence)) {
      HEDGE_PATTERN.lastIndex = 0;
      const next = sentences[index + 1] ?? '';
      if (!SUPPORT_PATTERN.test(sentence) && !SUPPORT_PATTERN.test(next)) {
        violations.push({
          code: 'unsupported_hedge',
          message: 'Give a reason ("because …") or say what will confirm it.',
          excerpt: sentence
        });
      }
    }
    HEDGE_PATTERN.lastIndex = 0;
    if (PASSIVE_PATTERN.test(sentence)) {
      violations.push({
        code: 'passive_voice',
        message: 'Use the active voice and name the actor.',
        excerpt: sentence
      });
    }
  });
  return violations;
}
