import type { RepoOperationsProfile } from '@/lib/repo-profile/types';

export type TagKey = string;

export type TaggingSource = 'ticket-text' | 'repo-profile' | 'execution-evidence';

export type EvidenceKind =
  | 'path_match'
  | 'path_prefix_match'
  | 'keyword_match'
  | 'workspace_match'
  | 'deployable_match'
  | 'migration_match'
  | 'supporting_signal'
  | 'contradictory_signal';

export type TagDefinition = {
  key: TagKey;
  label: string;
  description?: string;
};

export type TagRule = {
  key: TagKey;
  label: string;
  description?: string;
  pathPrefixes: string[];
  exactPaths: string[];
  keywords: string[];
  repoProfileHints: Array<{
    workspacePath?: string;
    deployablePath?: string;
    deployableKind?: string;
    deployTarget?: string;
    migrationSystem?: string;
    migrationsDir?: string;
    typesOutput?: string;
    seedPaths?: string[];
  }>;
};

export type TagEvidence = {
  tagKey: TagKey;
  source: TaggingSource;
  kind: EvidenceKind;
  weight: number;
  signal: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type TagScore = {
  tagKey: TagKey;
  label: string;
  total: number;
  evidence: TagEvidence[];
  matched: boolean;
};

export type StructuredDebugOutput = {
  threshold: number;
  scores: TagScore[];
  consideredPaths: string[];
  consideredCommands: string[];
};

export type DescriptionSourceInput = {
  title?: string | null;
  objective?: string | null;
  description?: string | null;
  acceptanceCriteria?: string | null;
  extraText?: string[];
  explicitPaths?: string[];
};

export type ExecutionEvidenceInput = {
  changedPaths?: string[];
  commands?: string[];
  fileChanges?: Array<{
    filePath: string;
    impact?: string | null;
    label?: string | null;
    summary?: string | null;
    why?: string | null;
  }>;
};

export type TaggingEngineInput = {
  description: DescriptionSourceInput;
  repoProfile?: RepoOperationsProfile | null;
  executionEvidence?: ExecutionEvidenceInput;
  threshold?: number;
};

export type TaggingEngineResult = {
  matchedTags: TagDefinition[];
  scores: TagScore[];
  evidence: TagEvidence[];
  debug: StructuredDebugOutput;
};

export type ExistingTagAssignment = {
  tagKey: TagKey;
  source: 'engine' | 'user';
};

export type TagSuppression = {
  tagKey: TagKey;
  reason?: string;
};

export type ReconcileInput = {
  candidates: Pick<TagScore, 'tagKey' | 'total' | 'matched'>[];
  existingAssignments: ExistingTagAssignment[];
  suppressions: TagSuppression[];
};

export type ReconcileResult = {
  addEngineTagKeys: TagKey[];
  removeEngineTagKeys: TagKey[];
  keptEngineTagKeys: TagKey[];
  suppressedTagKeys: TagKey[];
  userOwnedTagKeys: TagKey[];
};

export type TagAssignmentProvenance = {
  source: 'engine' | 'user';
  state: 'present';
};

export type TagSuppressionDebug = {
  reason?: string;
  tagKey: TagKey;
};

export type TagDebugEntry = {
  assignments: TagAssignmentProvenance[];
  engineDecision: 'add' | 'keep' | 'remove' | 'skip_below_threshold' | 'skip_suppressed';
  evidence: TagEvidence[];
  label: string;
  matched: boolean;
  score: number;
  suppressions: TagSuppressionDebug[];
  tagKey: TagKey;
};

export type TaggingInspector = {
  assignments: ExistingTagAssignment[];
  consideredCommands: string[];
  consideredPaths: string[];
  suppressions: TagSuppressionDebug[];
  tags: TagDebugEntry[];
  threshold: number;
};
