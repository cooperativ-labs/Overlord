import type { RepoOperationsProfile } from '@/lib/repo-profile/types';

import { OVERLORD_TAG_RULES, TAG_SCORE_WEIGHTS } from '../constants';
import type { TagEvidence } from '../types';

function matchesPath(value: string | undefined, expected: string | undefined): boolean {
  if (!value || !expected) return false;
  return value === expected || value.startsWith(`${expected}/`);
}

export function collectRepoProfileEvidence(profile: RepoOperationsProfile | null | undefined): {
  evidence: TagEvidence[];
  consideredPaths: string[];
} {
  if (!profile) {
    return { evidence: [], consideredPaths: [] };
  }

  const evidence: TagEvidence[] = [];
  const consideredPaths = new Set<string>();

  for (const workspace of profile.workspaces) {
    if (workspace.path) consideredPaths.add(workspace.path);
  }
  for (const deployable of profile.deployables) {
    if (deployable.path) consideredPaths.add(deployable.path);
  }
  if (profile.migrations?.migrations_dir) consideredPaths.add(profile.migrations.migrations_dir);
  if (profile.migrations?.types_output) consideredPaths.add(profile.migrations.types_output);
  for (const seedFile of profile.migrations?.seed_files ?? []) {
    consideredPaths.add(seedFile);
  }

  for (const rule of OVERLORD_TAG_RULES) {
    for (const hint of rule.repoProfileHints) {
      if (hint.workspacePath) {
        for (const workspace of profile.workspaces) {
          if (!matchesPath(workspace.path, hint.workspacePath)) continue;
          evidence.push({
            tagKey: rule.key,
            source: 'repo-profile',
            kind: 'workspace_match',
            weight: TAG_SCORE_WEIGHTS.workspaceMatch,
            signal: `workspace ${workspace.path}`,
            metadata: { workspacePath: workspace.path, workspaceName: workspace.name }
          });
        }
      }

      if (hint.deployablePath || hint.deployableKind || hint.deployTarget) {
        for (const deployable of profile.deployables) {
          const pathMatches =
            !hint.deployablePath || matchesPath(deployable.path, hint.deployablePath);
          const kindMatches = !hint.deployableKind || deployable.kind === hint.deployableKind;
          const targetMatches =
            !hint.deployTarget || deployable.deploy_target === hint.deployTarget;
          if (!pathMatches || !kindMatches || !targetMatches) continue;
          evidence.push({
            tagKey: rule.key,
            source: 'repo-profile',
            kind: 'deployable_match',
            weight: TAG_SCORE_WEIGHTS.workspaceMatch,
            signal: `deployable ${deployable.kind} at ${deployable.path}`,
            metadata: {
              deployablePath: deployable.path,
              deployableKind: deployable.kind,
              deployTarget: deployable.deploy_target ?? null
            }
          });
        }
      }

      const migrations = profile.migrations;
      if (!migrations) continue;

      const migrationMatches =
        (!hint.migrationSystem || migrations.system === hint.migrationSystem) &&
        (!hint.migrationsDir || migrations.migrations_dir === hint.migrationsDir);
      if (migrationMatches && (hint.migrationSystem || hint.migrationsDir)) {
        evidence.push({
          tagKey: rule.key,
          source: 'repo-profile',
          kind: 'migration_match',
          weight: TAG_SCORE_WEIGHTS.repoProfileSignal,
          signal: `migrations ${migrations.migrations_dir ?? 'unknown'}`,
          metadata: {
            migrationSystem: migrations.system ?? null,
            migrationsDir: migrations.migrations_dir ?? null
          }
        });
      }

      if (hint.typesOutput && migrations.types_output === hint.typesOutput) {
        evidence.push({
          tagKey: rule.key,
          source: 'repo-profile',
          kind: 'supporting_signal',
          weight: TAG_SCORE_WEIGHTS.repoProfileSignal,
          signal: `types output ${migrations.types_output}`,
          metadata: { typesOutput: migrations.types_output }
        });
      }

      for (const seedPath of hint.seedPaths ?? []) {
        if (!migrations.seed_files.includes(seedPath)) continue;
        evidence.push({
          tagKey: rule.key,
          source: 'repo-profile',
          kind: 'supporting_signal',
          weight: TAG_SCORE_WEIGHTS.repoProfileSignal,
          signal: `seed file ${seedPath}`,
          metadata: { seedPath }
        });
      }
    }
  }

  return { evidence, consideredPaths: [...consideredPaths].sort() };
}
