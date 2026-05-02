import type { SupabaseClient } from '@supabase/supabase-js';

import type { RepoOperationsProfile } from '@/lib/repo-profile/types';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database, Json } from '@/types/database.types';

import { OVERLORD_DEFAULT_TAG_DEFINITIONS } from './constants';
import { buildTaggingInspector } from './debug';
import { reconcileEngineAssignments } from './reconcile';
import { runTaggingEngine } from './run';
import type {
  ExecutionEvidenceInput,
  ExistingTagAssignment,
  TaggingInspector,
  TagSuppression
} from './types';

type TaggingClient = SupabaseClient<Database>;

type TicketTaggingRow = Pick<
  Database['public']['Tables']['tickets']['Row'],
  'acceptance_criteria' | 'project_id' | 'title'
>;

type ProjectTagDefinitionRow = Pick<
  Database['public']['Tables']['project_tag_definitions']['Row'],
  'id' | 'is_active' | 'key'
>;

type FileChangeRow = Pick<
  Database['public']['Tables']['file_changes']['Row'],
  'file_path' | 'impact' | 'label' | 'summary' | 'why'
>;

type TicketEventRow = Pick<Database['public']['Tables']['ticket_events']['Row'], 'payload'>;

type AgentSessionRow = Pick<Database['public']['Tables']['agent_sessions']['Row'], 'metadata'>;

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: Json | null | undefined): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectStringArray(value: Json | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

async function ensureProjectTagDefinitions(supabase: TaggingClient, projectId: string) {
  const { error } = await supabase.from('project_tag_definitions').upsert(
    OVERLORD_DEFAULT_TAG_DEFINITIONS.map(definition => ({
      project_id: projectId,
      key: definition.key,
      label: definition.label
    })),
    {
      onConflict: 'project_id,key',
      ignoreDuplicates: true
    }
  );

  if (error) {
    throw new Error(error.message);
  }
}

async function getLatestObjectiveText(supabase: TaggingClient, ticketId: string) {
  const { data, error } = await supabase
    .from('objectives')
    .select('objective')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.objective ?? null;
}

function extractExecutionEvidenceFromMetadata(
  value: Json | null | undefined
): Pick<ExecutionEvidenceInput, 'changedPaths' | 'commands'> {
  if (!isRecord(value)) {
    return { changedPaths: [], commands: [] };
  }

  const changedPaths = new Set<string>();
  const commands = new Set<string>();

  for (const key of ['changedPaths', 'changed_paths', 'filePaths', 'file_paths']) {
    for (const item of collectStringArray(value[key])) {
      changedPaths.add(item);
    }
  }

  for (const key of ['commands', 'relevantCommands', 'recentCommands']) {
    for (const item of collectStringArray(value[key])) {
      commands.add(item);
    }
  }

  return {
    changedPaths: [...changedPaths],
    commands: [...commands]
  };
}

async function loadTicketExecutionEvidence(
  supabase: TaggingClient,
  ticketId: string
): Promise<ExecutionEvidenceInput> {
  const [fileChangesResult, ticketEventsResult, agentSessionsResult] = await Promise.all([
    supabase
      .from('file_changes')
      .select('file_path,label,summary,why,impact')
      .eq('ticket_id', ticketId)
      .returns<FileChangeRow[]>(),
    supabase
      .from('ticket_events')
      .select('payload')
      .eq('ticket_id', ticketId)
      .returns<TicketEventRow[]>(),
    supabase
      .from('agent_sessions')
      .select('metadata')
      .eq('ticket_id', ticketId)
      .returns<AgentSessionRow[]>()
  ]);

  if (fileChangesResult.error) {
    throw new Error(fileChangesResult.error.message);
  }
  if (ticketEventsResult.error) {
    throw new Error(ticketEventsResult.error.message);
  }
  if (agentSessionsResult.error) {
    throw new Error(agentSessionsResult.error.message);
  }

  const changedPaths = new Set<string>();
  const commands = new Set<string>();

  for (const fileChange of fileChangesResult.data ?? []) {
    const normalizedPath = fileChange.file_path?.trim() ?? '';
    if (normalizedPath) {
      changedPaths.add(normalizedPath);
    }
  }

  for (const row of ticketEventsResult.data ?? []) {
    const extracted = extractExecutionEvidenceFromMetadata(row.payload);
    for (const path of extracted.changedPaths ?? []) changedPaths.add(path);
    for (const command of extracted.commands ?? []) commands.add(command);
  }

  for (const row of agentSessionsResult.data ?? []) {
    const extracted = extractExecutionEvidenceFromMetadata(row.metadata);
    for (const path of extracted.changedPaths ?? []) changedPaths.add(path);
    for (const command of extracted.commands ?? []) commands.add(command);
  }

  return {
    changedPaths: [...changedPaths].sort(),
    commands: [...commands].sort(),
    fileChanges: (fileChangesResult.data ?? []).map(fileChange => ({
      filePath: fileChange.file_path,
      impact: fileChange.impact,
      label: fileChange.label,
      summary: fileChange.summary,
      why: fileChange.why
    }))
  };
}

function mapExistingAssignments(rows: unknown[]): ExistingTagAssignment[] {
  return rows
    .map(row => {
      const typedRow = row as {
        source: 'engine' | 'user';
        project_tag_definitions: Array<{ key: string }>;
      };
      const definition = typedRow.project_tag_definitions?.[0] ?? null;
      if (!definition) return null;
      return {
        source: typedRow.source,
        tagKey: definition.key
      };
    })
    .filter((item): item is ExistingTagAssignment => item !== null);
}

function mapSuppressions(rows: unknown[]): TagSuppression[] {
  const mapped: Array<TagSuppression | null> = rows.map(row => {
    const typedRow = row as {
      reason?: string;
      project_tag_definitions: Array<{ key: string }>;
    };
    const definition = typedRow.project_tag_definitions?.[0] ?? null;
    if (!definition) return null;
    return {
      reason: typedRow.reason,
      tagKey: definition.key
    };
  });

  return mapped.filter((item): item is TagSuppression => item !== null);
}

async function loadTicketTaggingContext(supabase: TaggingClient, ticketId: string) {
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('title,acceptance_criteria,project_id')
    .eq('id', ticketId)
    .single<TicketTaggingRow>();

  if (ticketError || !ticket) {
    throw new Error(ticketError?.message ?? 'Ticket not found.');
  }

  if (!ticket.project_id) {
    return null;
  }

  await ensureProjectTagDefinitions(supabase, ticket.project_id);

  const [objective, projectResult, definitionsResult, assignmentsResult, suppressionsResult] =
    await Promise.all([
      getLatestObjectiveText(supabase, ticketId),
      supabase
        .from('projects')
        .select('operations_profile')
        .eq('id', ticket.project_id)
        .maybeSingle<{ operations_profile: RepoOperationsProfile | null }>(),
      supabase
        .from('project_tag_definitions')
        .select('id,key,is_active')
        .eq('project_id', ticket.project_id)
        .returns<ProjectTagDefinitionRow[]>(),
      supabase
        .from('ticket_tag_assignments')
        .select('source, project_tag_definitions!inner(id,key,is_active)')
        .eq('ticket_id', ticketId),
      supabase
        .from('ticket_tag_engine_suppressions')
        .select('project_tag_definitions!inner(id,key,is_active), reason')
        .eq('ticket_id', ticketId)
    ]);

  if (projectResult.error) {
    throw new Error(projectResult.error.message);
  }
  if (definitionsResult.error) {
    throw new Error(definitionsResult.error.message);
  }
  if (assignmentsResult.error) {
    throw new Error(assignmentsResult.error.message);
  }
  if (suppressionsResult.error) {
    throw new Error(suppressionsResult.error.message);
  }

  return {
    definitions: definitionsResult.data ?? [],
    existingAssignments: mapExistingAssignments(assignmentsResult.data ?? []),
    objective,
    projectId: ticket.project_id,
    repoProfile: projectResult.data?.operations_profile ?? null,
    suppressions: mapSuppressions(suppressionsResult.data ?? []),
    ticket
  };
}

export async function syncTicketTagAssignments(options: {
  executionEvidence?: ExecutionEvidenceInput | null;
  includeExecutionEvidence?: boolean;
  ticketId: string;
  supabase?: TaggingClient;
}): Promise<void> {
  const supabase = options.supabase ?? createServiceRoleClient();
  const context = await loadTicketTaggingContext(supabase, options.ticketId);

  if (!context) {
    return;
  }

  const normalizedTitle = normalizeText(context.ticket.title);
  const normalizedObjective = normalizeText(context.objective);
  const normalizedAcceptanceCriteria = normalizeText(context.ticket.acceptance_criteria);
  const hasPromptMetadata =
    normalizedTitle !== null ||
    normalizedObjective !== null ||
    normalizedAcceptanceCriteria !== null;
  const definitionIdByKey = new Map(
    context.definitions.map(definition => [definition.key, definition.id])
  );
  const activeDefinitionKeys = new Set(
    context.definitions.filter(definition => definition.is_active).map(definition => definition.key)
  );
  const executionEvidence =
    options.executionEvidence ??
    (options.includeExecutionEvidence
      ? await loadTicketExecutionEvidence(supabase, options.ticketId)
      : undefined);

  const candidates = hasPromptMetadata
    ? runTaggingEngine({
        description: {
          acceptanceCriteria: normalizedAcceptanceCriteria,
          objective: normalizedObjective,
          title: normalizedTitle
        },
        repoProfile: context.repoProfile,
        executionEvidence
      }).scores.filter(score => activeDefinitionKeys.has(score.tagKey))
    : [];

  const reconciliation = reconcileEngineAssignments({
    candidates,
    existingAssignments: context.existingAssignments,
    suppressions: context.suppressions
  });

  const tagDefinitionIdsToAdd = reconciliation.addEngineTagKeys
    .map(tagKey => definitionIdByKey.get(tagKey) ?? null)
    .filter((id): id is string => id !== null);
  const tagDefinitionIdsToRemove = reconciliation.removeEngineTagKeys
    .map(tagKey => definitionIdByKey.get(tagKey) ?? null)
    .filter((id): id is string => id !== null);

  if (tagDefinitionIdsToRemove.length > 0) {
    const { error } = await supabase
      .from('ticket_tag_assignments')
      .delete()
      .eq('ticket_id', options.ticketId)
      .eq('source', 'engine')
      .in('tag_definition_id', tagDefinitionIdsToRemove);

    if (error) {
      throw new Error(error.message);
    }
  }

  if (tagDefinitionIdsToAdd.length > 0) {
    const { error } = await supabase.from('ticket_tag_assignments').upsert(
      tagDefinitionIdsToAdd.map(tagDefinitionId => ({
        ticket_id: options.ticketId,
        tag_definition_id: tagDefinitionId,
        source: 'engine'
      })),
      { onConflict: 'ticket_id,tag_definition_id,source' }
    );

    if (error) {
      throw new Error(error.message);
    }
  }
}

export async function getTicketTaggingInspector(options: {
  ticketId: string;
  supabase?: TaggingClient;
}): Promise<TaggingInspector | null> {
  const supabase = options.supabase ?? createServiceRoleClient();
  const context = await loadTicketTaggingContext(supabase, options.ticketId);

  if (!context) {
    return null;
  }

  const result = runTaggingEngine({
    description: {
      acceptanceCriteria: normalizeText(context.ticket.acceptance_criteria),
      objective: normalizeText(context.objective),
      title: normalizeText(context.ticket.title)
    },
    repoProfile: context.repoProfile,
    executionEvidence: await loadTicketExecutionEvidence(supabase, options.ticketId)
  });

  return buildTaggingInspector({
    debug: result.debug,
    existingAssignments: context.existingAssignments,
    reconciliation: reconcileEngineAssignments({
      candidates: result.scores,
      existingAssignments: context.existingAssignments,
      suppressions: context.suppressions
    }),
    suppressions: context.suppressions
  });
}
