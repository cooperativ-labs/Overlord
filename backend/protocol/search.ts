import { PERMISSIONS } from '@overlord/auth';

import { parseMissionSearchOptions } from '../../packages/core/service/mission-search.ts';
import { serviceDatabaseClient } from '../db.ts';
import { ApiError } from '../errors.ts';
import {
  callerMembershipsInActiveOrganization,
  searchMissionReferences,
  searchMissionsAcrossWorkspacesV2,
  searchMissionsAcrossWorkspacesV3
} from '../repository.ts';

import { readProtocolAddress } from './addressing.ts';
import {
  hasFlag,
  integerFlag,
  type ProtocolRequestBody,
  strFlag,
  type SubcommandTable
} from './flags.ts';
import { ProjectSelectionRequiredError, resolveProjectRefChoices } from './project-refs.ts';

/**
 * Resolve the `--project-id` filter for a V2 search.
 *
 * V2 is an organization-bounded aggregate read, so the reference resolves
 * against every membership in the active organization rather than one anchor
 * workspace. A name matching in two workspaces raises the selection flow
 * instead of guessing which board the user meant.
 */
async function resolveV2SearchProjectId(
  projectRef: string | null,
  workspaceHint?: string | null
): Promise<string[] | null> {
  if (!projectRef) return null;
  const scopes = await callerMembershipsInActiveOrganization(serviceDatabaseClient());
  const choices = await resolveProjectRefChoices({
    projectRef,
    workspaceHint,
    workspaceIds: scopes.map(scope => scope.workspaceId)
  });
  if (choices.length === 0) throw new ApiError(404, `Project not found: ${projectRef}`);
  if (choices.length > 1) throw new ProjectSelectionRequiredError(projectRef, choices);
  return [choices[0]!.id];
}

/** Ranked-search flags that have no meaning for an exact reference lookup. */
const RANKED_SEARCH_ONLY_FLAGS = [
  '--query',
  '--status',
  '--resource-key',
  '--date-field',
  '--from',
  '--to',
  '--response-version',
  '--entity-types',
  '--objective-states',
  '--matches-per-result'
] as const;

/**
 * `search --reference`: exhaustive exact-token lookup in one project (contract v155).
 * It is not ranked search, so ranked filters are rejected rather than silently ignored.
 */
async function searchExactReference(body: ProtocolRequestBody, reference: string) {
  const conflicting = RANKED_SEARCH_ONLY_FLAGS.filter(flag => hasFlag(body, flag));
  if (conflicting.length) {
    throw new ApiError(400, `--reference cannot be combined with ${conflicting.join(', ')}`);
  }
  const { projectRef, workspaceHint } = readProtocolAddress(body);
  if (!projectRef) throw new ApiError(400, '--reference requires --project-id');
  const limit = integerFlag(body, '--limit') ?? null;
  return searchMissionReferences({
    projectIds: await resolveV2SearchProjectId(projectRef, workspaceHint),
    reference,
    cursor: strFlag(body, '--cursor') ?? null,
    limit
  });
}

export const searchSubcommands: SubcommandTable = {
  search: {
    // Not enforced at dispatch: v2/v3 and --reference authorize per workspace or project.
    permission: PERMISSIONS.MISSION_READ,
    projectAutomation: 'admitted',
    dispatchGate: 'handler',
    handler: async (_ctx, body) => {
      if (hasFlag(body, '--reference')) {
        const reference = strFlag(body, '--reference');
        if (!reference) throw new ApiError(400, '--reference requires a value');
        return searchExactReference(body, reference);
      }
      if (hasFlag(body, '--cursor')) {
        throw new ApiError(400, '--cursor applies only to an exact --reference lookup');
      }
      // Version 1 (the legacy array) is retired (ADR 0054); omitted means v3.
      const responseVersion = hasFlag(body, '--response-version')
        ? integerFlag(body, '--response-version')
        : 3;
      if (responseVersion !== 2 && responseVersion !== 3) {
        throw new ApiError(
          400,
          '--response-version must be 2 or 3 (version 1 is retired)',
          undefined,
          'invalid_input'
        );
      }
      const version: 2 | 3 = responseVersion;
      // Flags map onto the REST query names so every surface shares one parser
      // and its validation. `--project-id` is a human project reference resolved
      // below, so it never reaches the UUID-only `projectIds` check.
      const options = parseMissionSearchOptions(
        {
          q: strFlag(body, '--query'),
          statusTypes: strFlag(body, '--status'),
          resourceKeys: strFlag(body, '--resource-key'),
          dateField: strFlag(body, '--date-field'),
          from: strFlag(body, '--from'),
          to: strFlag(body, '--to'),
          limit: strFlag(body, '--limit'),
          entityTypes: strFlag(body, '--entity-types'),
          objectiveStates: strFlag(body, '--objective-states'),
          matchesPerResult: strFlag(body, '--matches-per-result')
        },
        { version }
      );
      const { projectRef, workspaceHint } = readProtocolAddress(body);
      const limit = options.limit ?? 25;

      // V2/V3 are organization-bounded aggregate reads. They must not inherit the
      // one workspace selected for ordinary protocol entity operations.
      const search = {
        ...options,
        projectIds: await resolveV2SearchProjectId(projectRef, workspaceHint),
        limit
      };
      return version === 3
        ? searchMissionsAcrossWorkspacesV3(search)
        : searchMissionsAcrossWorkspacesV2(search);
    }
  }
};
