import type {
  ExistingTagAssignment,
  ReconcileResult,
  StructuredDebugOutput,
  TaggingInspector,
  TagScore,
  TagSuppression
} from './types';

function renderScore(score: TagScore): string {
  const header = `${score.tagKey}: ${score.total} (${score.matched ? 'matched' : 'below-threshold'})`;
  const lines = score.evidence.map(
    item => `  - [${item.source}] ${item.kind} +${item.weight}: ${item.signal}`
  );
  return [header, ...lines].join('\n');
}

export function formatTaggingDebugOutput(debug: StructuredDebugOutput): string {
  const parts = [`threshold: ${debug.threshold}`];
  if (debug.consideredPaths.length > 0) {
    parts.push(`considered paths: ${debug.consideredPaths.join(', ')}`);
  }
  if (debug.consideredCommands.length > 0) {
    parts.push(`considered commands: ${debug.consideredCommands.join(' | ')}`);
  }
  for (const score of debug.scores) {
    parts.push(renderScore(score));
  }
  return parts.join('\n\n');
}

export function buildTaggingInspector(input: {
  debug: StructuredDebugOutput;
  existingAssignments: ExistingTagAssignment[];
  reconciliation: ReconcileResult;
  suppressions: TagSuppression[];
}): TaggingInspector {
  return {
    threshold: input.debug.threshold,
    consideredPaths: input.debug.consideredPaths,
    consideredCommands: input.debug.consideredCommands,
    assignments: [...input.existingAssignments].sort((a, b) => {
      if (a.tagKey !== b.tagKey) return a.tagKey.localeCompare(b.tagKey);
      return a.source.localeCompare(b.source);
    }),
    suppressions: [...input.suppressions].sort((a, b) => a.tagKey.localeCompare(b.tagKey)),
    tags: input.debug.scores.map(score => {
      const assignments = input.existingAssignments
        .filter(assignment => assignment.tagKey === score.tagKey)
        .map(assignment => ({ source: assignment.source, state: 'present' as const }))
        .sort((a, b) => a.source.localeCompare(b.source));
      const suppressions = input.suppressions
        .filter(suppression => suppression.tagKey === score.tagKey)
        .sort((a, b) => (a.reason ?? '').localeCompare(b.reason ?? ''));
      let engineDecision: TaggingInspector['tags'][number]['engineDecision'] =
        'skip_below_threshold';
      if (input.reconciliation.addEngineTagKeys.includes(score.tagKey)) {
        engineDecision = 'add';
      } else if (input.reconciliation.keptEngineTagKeys.includes(score.tagKey)) {
        engineDecision = 'keep';
      } else if (input.reconciliation.removeEngineTagKeys.includes(score.tagKey)) {
        engineDecision = 'remove';
      } else if (input.reconciliation.suppressedTagKeys.includes(score.tagKey)) {
        engineDecision = 'skip_suppressed';
      }
      return {
        tagKey: score.tagKey,
        label: score.label,
        score: score.total,
        matched: score.matched,
        evidence: score.evidence,
        assignments,
        suppressions,
        engineDecision
      };
    })
  };
}
