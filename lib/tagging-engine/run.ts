import { collectDescriptionEvidence } from './sources/description';
import { collectExecutionEvidence } from './sources/execution-evidence';
import { collectRepoProfileEvidence } from './sources/repo-profile';
import { scoreTagEvidence } from './scoring';
import type { TaggingEngineInput, TaggingEngineResult } from './types';

export function runTaggingEngine(input: TaggingEngineInput): TaggingEngineResult {
  const description = collectDescriptionEvidence(input.description);
  const repoProfile = collectRepoProfileEvidence(input.repoProfile);
  const executionEvidence = collectExecutionEvidence(input.executionEvidence);

  return scoreTagEvidence(
    [...description.evidence, ...repoProfile.evidence, ...executionEvidence.evidence],
    {
      threshold: input.threshold,
      consideredPaths: [
        ...description.explicitPaths,
        ...repoProfile.consideredPaths,
        ...executionEvidence.consideredPaths
      ],
      consideredCommands: executionEvidence.consideredCommands
    }
  );
}
