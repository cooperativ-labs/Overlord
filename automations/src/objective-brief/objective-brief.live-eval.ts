/**
 * Live fidelity evaluation for the objective-brief composer (coo:1275).
 *
 * Runs the synthetic instructions in `fixtures/fidelity.json` through the
 * configured provider (OPENROUTER_API_KEY) and reports the deterministic
 * properties for each result. It is not part of `yarn test`: it calls a paid
 * provider and its output varies between runs.
 *
 *   OPENROUTER_API_KEY=... npx tsx src/objective-brief/objective-brief.live-eval.ts
 */
import { readFileSync } from 'node:fs';

import { lintSte } from '../writing/ste.js';

import {
  DECISION_PREFIX,
  findGoalDecisionOptions,
  OBJECTIVE_BRIEF_MISSING_DONE_WHEN
} from './brief.js';
import { composeObjectiveBrief } from './compose.js';

type Fixture = { name: string; instruction: string };

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/fidelity.json', import.meta.url), 'utf8')
) as Fixture[];

let failures = 0;
for (const fixture of fixtures) {
  const outcome = await composeObjectiveBrief({
    instructionText: fixture.instruction,
    fields: { title: true, description: fixture.instruction.trim().length >= 280 }
  });
  if (outcome.kind !== 'composed') {
    console.log(`${fixture.name}: ${outcome.kind}`);
    failures += 1;
    continue;
  }
  const description = outcome.description.status === 'ok' ? outcome.description.text : null;
  // The goal is the text before the first "Decision needed:" sentence, or the
  // first sentence when there is no decision.
  const firstParagraph = description?.split('\n\n')[0] ?? '';
  const decisionAt = firstParagraph.indexOf(DECISION_PREFIX);
  const goal = description
    ? decisionAt >= 0
      ? firstParagraph.slice(0, decisionAt).trim()
      : (firstParagraph.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? firstParagraph)
    : null;
  const decisions = description
    ? firstParagraph
        .split(DECISION_PREFIX)
        .slice(1)
        .map(item => item.trim())
    : [];
  const report = {
    attempts: outcome.attempts,
    title: outcome.title.status === 'ok' ? outcome.title.text : outcome.title.status,
    description:
      description ?? (outcome.description.status === 'failed' ? outcome.description.code : null),
    paragraphs: description ? description.split('\n\n').length : null,
    words: description ? description.split(/\s+/).length : null,
    goal,
    decisions: description ? description.split(DECISION_PREFIX).length - 1 : null,
    goalPicksDecisionOption: goal ? findGoalDecisionOptions(goal, decisions) : null,
    missingDoneWhen: description ? description.endsWith(OBJECTIVE_BRIEF_MISSING_DONE_WHEN) : null,
    lint: description ? lintSte(description).map(issue => issue.code) : null
  };
  console.log(`\n## ${fixture.name}\n${JSON.stringify(report, null, 2)}`);
}
process.exitCode = failures > 0 ? 1 : 0;
