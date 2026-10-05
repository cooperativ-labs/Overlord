import { PERMISSIONS } from '@overlord/auth';
import type {
  ChatAssignmentDto,
  ChatCreationReceiptDto,
  ChatProposalDto,
  ChatProposalMissionDto,
  CreateFromChatProposalResponse
} from '@overlord/contract';
import { createHash, randomUUID } from 'node:crypto';

import { createMissionWithObjectives, readProjectLaunchSelection } from '../missions.js';
import { readStoredWorkspaceAgentCatalog } from '../workspace-agent-catalog.js';

import { ChatAccess } from './access.js';
import { assignmentCatalogProjection } from './assignments.js';
import { type ChatAttempt, ChatRuns } from './runs.js';
import {
  ChatError,
  type ChatOwner,
  ChatStore,
  messageDto,
  type MessageRow,
  requiredText,
  revision
} from './store.js';

type ProposalRow = {
  id: string;
  thread_id: string;
  state: ChatProposalDto['state'];
  current_revision: number;
  created_at: string;
  updated_at: string;
};
type RevisionRow = {
  spec_json: string;
  responsible_profile_id: string;
  invalidated_at: string | null;
  dependency_set_id: string | null;
  created_at: string;
};
type ReceiptRow = {
  id: string;
  proposal_id: string;
  proposal_revision: number;
  created_at: string;
};

/** One projector for atomic snapshots, replay payloads and Create responses. */
export async function proposalDto(store: ChatStore, p: ProposalRow): Promise<ChatProposalDto> {
  const r = await store.db.get<RevisionRow>(
    'SELECT * FROM chat_work_proposal_revisions WHERE proposal_id = ? AND proposal_revision = ?',
    [p.id, p.current_revision]
  );
  if (!r) throw new ChatError('not_found');
  const invalidated = Boolean(r.invalidated_at) || !(await store.authorized(r.dependency_set_id));
  const receipt = await store.db.get<ReceiptRow>(
    'SELECT * FROM chat_work_receipts WHERE proposal_id = ?',
    [p.id]
  );
  let receiptDto: ChatCreationReceiptDto | null = null;
  if (receipt) {
    const links = await store.db.all<{
      mission_id: string;
      project_id: string;
      objective_ids_json: string;
    }>('SELECT * FROM chat_work_receipt_missions WHERE receipt_id = ? ORDER BY position', [
      receipt.id
    ]);
    receiptDto = {
      id: receipt.id,
      proposalId: p.id,
      revision: receipt.proposal_revision,
      createdAt: receipt.created_at,
      missions: await Promise.all(
        links.map(async link => ({
          missionId: link.mission_id,
          missionDisplayId:
            (
              await store.db.get<{ display_id: string }>(
                'SELECT display_id FROM missions WHERE id = ?',
                [link.mission_id]
              )
            )?.display_id ?? '',
          projectId: link.project_id,
          objectiveIds: JSON.parse(link.objective_ids_json)
        }))
      )
    };
  }
  return {
    id: p.id,
    threadId: p.thread_id,
    state: p.state,
    currentRevision: p.current_revision,
    current: {
      revision: p.current_revision,
      missions: invalidated ? [] : JSON.parse(r.spec_json).missions,
      responsibleProfileId: r.responsible_profile_id,
      invalidated,
      createdAt: r.created_at
    },
    receipt: receiptDto,
    createdAt: p.created_at,
    updatedAt: p.updated_at
  };
}

/** Private preparation and the sole client-authorized domain creation path. */
export class ChatProposals extends ChatStore {
  private async catalog(workspaceId: string) {
    if (this.options.assignmentCatalog)
      return assignmentCatalogProjection(await this.options.assignmentCatalog(workspaceId));
    return assignmentCatalogProjection(await readStoredWorkspaceAgentCatalog(this.db, workspaceId));
  }
  private async validateAssignment(workspaceId: string, assignment: ChatAssignmentDto) {
    const catalog = await this.catalog(workspaceId);
    const agent = catalog.agents[assignment.agent];
    if (!agent)
      throw new ChatError(
        'proposal_not_creatable',
        `Agent "${assignment.agent}" is not in this workspace's catalog. Supported agents: ${Object.keys(catalog.agents).join(', ') || 'none'}. Ask the user which to use.`
      );
    const model = agent.models.find((m: { id: string }) => m.id === assignment.model);
    // A concrete model avoids silently inheriting a different launch-time model.
    if (!model || model.enabled === false)
      throw new ChatError(
        'proposal_not_creatable',
        `Model "${assignment.model ?? 'none'}" is not enabled for agent "${assignment.agent}". Use a model id from assignmentCatalogs, or ask the user.`
      );
    if (
      assignment.reasoningEffort !== null &&
      !model.reasoningOptions.includes(assignment.reasoningEffort)
    )
      throw new ChatError(
        'proposal_not_creatable',
        `Reasoning option "${assignment.reasoningEffort}" is not supported by ${assignment.agent}/${model.id}. Supported: ${model.reasoningOptions.join(', ') || 'none (omit it)'}.`
      );
  }
  private async destination(owner: ChatOwner, projectId: string) {
    const access = new ChatAccess(this.db);
    const scope = await access.projectGrant(owner, projectId, PERMISSIONS.MISSION_CREATE);
    if (!scope)
      throw new ChatError(
        'not_found',
        'No project with that id accepts new missions from this user. Use a projectId from overlord_list_projects.'
      );
    return { ...scope, ctx: access.context(scope.grant) };
  }
  private strings(value: unknown, maxItems: number, maxLength: number): string[] {
    if (!Array.isArray(value) || value.length > maxItems) throw new ChatError('invalid_request');
    return value.map(v => requiredText(v, maxLength));
  }
  private async missions(
    owner: ChatOwner,
    threadId: string,
    input: unknown
  ): Promise<ChatProposalMissionDto[]> {
    if (!Array.isArray(input) || !input.length || input.length > 10)
      throw new ChatError('invalid_request');
    const out: ChatProposalMissionDto[] = [];
    for (const value of input) {
      if (!value || typeof value !== 'object') throw new ChatError('invalid_request');
      const projectId = requiredText(value.projectId, 200);
      const scope = await this.destination(owner, projectId);
      if (
        !Array.isArray(value.objectives) ||
        !value.objectives.length ||
        value.objectives.length > 20
      )
        throw new ChatError('invalid_request');
      const objectives: ChatProposalMissionDto['objectives'] = [];
      for (const item of value.objectives) {
        if (!item || typeof item !== 'object') throw new ChatError('invalid_request');
        const resourceKey = requiredText(item.resourceKey, 100);
        const registered = await this.db.all<{ resource_key: string }>(
          'SELECT resource_key FROM project_resources WHERE project_id = ? AND deleted_at IS NULL ORDER BY resource_key',
          [projectId]
        );
        if (!registered.some(r => r.resource_key === resourceKey))
          throw new ChatError(
            'not_found',
            registered.length
              ? `Resource key "${resourceKey}" is not registered for project ${scope.project.name}. Registered keys: ${registered.map(r => r.resource_key).join(', ')}.`
              : `Project ${scope.project.name} has no registered resource, so drafts cannot be prepared for it yet. Tell the user a resource must be registered first; do not retry.`
          );
        let assignment: ChatAssignmentDto;
        if (item.assignment === undefined || item.assignment === null) {
          const pref = await readProjectLaunchSelection(scope.ctx, projectId);
          if (!pref.agent)
            throw new ChatError(
              'proposal_not_creatable',
              `Project ${scope.project.name} has no launch preference to inherit. Ask the user which agent and model to use, then pass an explicit assignment.`
            );
          const agent = (await this.catalog(scope.grant.workspaceId)).agents[pref.agent];
          if (!agent)
            throw new ChatError(
              'proposal_not_creatable',
              `Project ${scope.project.name} prefers agent "${pref.agent}", which is no longer in the workspace catalog. Ask the user which agent and model to use.`
            );
          assignment = {
            agent: pref.agent,
            model: pref.model ?? agent.defaultModel,
            reasoningEffort: pref.reasoningEffort ?? agent.defaultReasoningEffort,
            source: 'project_default'
          };
        } else {
          const a = item.assignment;
          assignment = {
            agent: requiredText(a.agent, 100),
            model: requiredText(a.model, 200),
            reasoningEffort:
              a.reasoningEffort === null || a.reasoningEffort === undefined
                ? null
                : requiredText(a.reasoningEffort, 100),
            source: 'assistant_selection'
          };
        }
        await this.validateAssignment(scope.grant.workspaceId, assignment);
        const evidenceIds = this.strings(item.evidenceIds ?? [], 100, 200);
        for (const id of evidenceIds) {
          const evidence = await this.db.get<{ source_ref_id: string }>(
            'SELECT source_ref_id FROM chat_evidence WHERE id = ? AND thread_id = ?',
            [id, threadId]
          );
          if (!evidence)
            throw new ChatError(
              'invalid_request',
              `"${id.slice(0, 60)}" is not an evidence id from this conversation. Use the evidenceId values returned with tool results, not the E refs, or omit evidenceIds.`
            );
          const source = await this.db.get<{ access_state: string }>(
            'SELECT access_state FROM chat_source_refs WHERE id = ?',
            [evidence.source_ref_id]
          );
          if (source?.access_state !== 'authorized')
            throw new ChatError(
              'proposal_not_creatable',
              'One of the cited sources is no longer accessible. Leave that evidence out or read the source again.'
            );
        }
        objectives.push({
          title: requiredText(item.title, 500),
          objective: requiredText(item.objective, 20000),
          acceptanceCriteria: this.strings(item.acceptanceCriteria, 50, 2000),
          resourceKey,
          assignment,
          evidenceIds
        });
      }
      out.push({
        key: requiredText(value.key, 100),
        projectId,
        projectName: scope.project.name,
        workspaceId: scope.grant.workspaceId,
        title: requiredText(value.title, 500),
        objectives,
        dependencies: this.strings(value.dependencies ?? [], 10, 100),
        audienceWarning:
          'Drafts are visible to destination project members. Check any private source details before creating.'
      });
    }
    const keys = new Set(out.map(m => m.key));
    if (
      keys.size !== out.length ||
      out.some(m => m.dependencies.some(k => k === m.key || !keys.has(k)))
    )
      throw new ChatError(
        'invalid_request',
        'Mission keys must be unique, and dependencies may only name other mission keys in this proposal.'
      );
    if (Buffer.byteLength(JSON.stringify(out)) > 96 * 1024)
      throw new ChatError('invalid_request', 'The proposal is too large; shorten the objectives.');
    return out;
  }

  /** Checkpoint operation id makes preparation replayable after a worker dies before recording its result. */
  async prepare(
    a: ChatAttempt,
    operationId: string,
    body: { missions: unknown; proposalId?: string; expectedRevision?: number }
  ): Promise<ChatProposalDto> {
    requiredText(operationId, 200);
    await this.revalidate(a.threadId);
    return this.db.transaction(async tx => {
      const s = new ChatProposals(tx, this.options);
      const thread = await s.lock(a.threadId);
      const runs = new ChatRuns(tx, this.options);
      await runs.assertLease(a);
      const owner = { profileId: thread.owner_profile_id, organizationId: thread.organization_id };
      const previous = await tx.all<{ proposal_id: string; spec_json: string }>(
        'SELECT proposal_id, spec_json FROM chat_work_proposal_revisions WHERE run_id = ?',
        [a.runId]
      );
      const replay = previous.find(r => JSON.parse(r.spec_json).operationId === operationId);
      if (replay)
        return proposalDto(
          s,
          (await tx.get<ProposalRow>('SELECT * FROM chat_work_proposals WHERE id = ?', [
            replay.proposal_id
          ]))!
        );
      const missions = await s.missions(owner, a.threadId, body.missions);
      // The card displays destination metadata even when ids came directly from the user.
      // Track those sources too, so losing read access invalidates snapshots and replay.
      const sourceIds = await s.registerSources(
        owner,
        a.threadId,
        missions.map(m => ({
          scopeKey: `overlord:project:${m.projectId}`,
          locator: {
            kind: 'overlord' as const,
            entityType: 'project' as const,
            entityId: m.projectId,
            projectId: m.projectId
          }
        }))
      );
      await s.checkSources(a.threadId, sourceIds);
      await runs.assertLease(a);
      const destinationSet = await s.dependencySet(a.threadId, sourceIds);
      const dependencySetId = await s.generationDependencies(a.threadId, destinationSet);
      const id = body.proposalId ?? randomUUID();
      let next = 1;
      if (body.proposalId) {
        const old = await tx.get<ProposalRow>(
          'SELECT * FROM chat_work_proposals WHERE id = ? AND thread_id = ?',
          [id, a.threadId]
        );
        if (!old) throw new ChatError('not_found');
        if (old.state !== 'open') throw new ChatError('proposal_not_creatable');
        if (revision(body.expectedRevision) !== old.current_revision)
          throw new ChatError('stale_revision');
        next = old.current_revision + 1;
        await tx.run(
          'UPDATE chat_work_proposals SET current_revision = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
          [next, s.timestamp(), id]
        );
      } else
        await tx.run(
          "INSERT INTO chat_work_proposals (id, thread_id, state, current_revision, created_by_run_id, created_at, updated_at) VALUES (?, ?, 'open', 1, ?, ?, ?)",
          [id, a.threadId, a.runId, s.timestamp(), s.timestamp()]
        );
      await tx.run(
        'INSERT INTO chat_work_proposal_revisions (proposal_id, proposal_revision, spec_json, responsible_profile_id, run_id, dependency_set_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          next,
          JSON.stringify({ missions, operationId }),
          owner.profileId,
          a.runId,
          dependencySetId,
          s.timestamp()
        ]
      );
      const proposal = await proposalDto(
        s,
        (await tx.get<ProposalRow>('SELECT * FROM chat_work_proposals WHERE id = ?', [id]))!
      );
      // The final lease check and fenced event write prevent cancelled preparations publishing.
      await runs.assertLease(a);
      await s.append(a.threadId, { kind: 'proposal.revised', proposal }, dependencySetId, {
        runId: a.runId,
        id: a.id,
        fence: a.fence
      });
      const messageId = randomUUID();
      const blocks = [
        {
          id: randomUUID(),
          kind: 'proposal',
          proposalId: id,
          revision: next,
          fallbackText: `Draft proposal: ${missions.map(m => m.title).join(', ')}. Review the card and tap Create to save drafts.`
        }
      ];
      await tx.run(
        "INSERT INTO chat_messages (id, thread_id, role, state, blocks_json, run_id, dependency_set_id, created_at, updated_at) VALUES (?, ?, 'assistant', 'complete', ?, ?, ?, ?, ?)",
        [
          messageId,
          a.threadId,
          JSON.stringify(blocks),
          a.runId,
          dependencySetId,
          await s.createdAt('chat_messages', a.threadId),
          s.timestamp()
        ]
      );
      await s.append(
        a.threadId,
        {
          kind: 'message.created',
          message: messageDto(
            (await tx.get<MessageRow>('SELECT * FROM chat_messages WHERE id = ?', [messageId]))!
          )
        },
        dependencySetId,
        { runId: a.runId, id: a.id, fence: a.fence }
      );
      return proposal;
    });
  }

  async create(
    owner: ChatOwner,
    id: string,
    body: { clientRequestId?: unknown; expectedRevision?: unknown }
  ): Promise<CreateFromChatProposalResponse> {
    const key = requiredText(body.clientRequestId, 200);
    const expected = revision(body.expectedRevision);
    const initial = await this.db.get<ProposalRow>(
      'SELECT p.* FROM chat_work_proposals p JOIN chat_threads t ON t.id = p.thread_id WHERE p.id = ? AND t.owner_profile_id = ? AND t.organization_id = ?',
      [id, owner.profileId, owner.organizationId]
    );
    if (!initial) throw new ChatError('not_found');
    // Persist source invalidation even if Create is rejected. External checks happen before domain writes.
    await this.revalidate(initial.thread_id);
    const observedRevision = (await this.thread(initial.thread_id, owner)).authorization_revision;
    return this.db.transaction(async tx => {
      const s = new ChatProposals(tx, this.options);
      // Serializes owner request keys across different threads and proposals, not just this card.
      await tx.run('UPDATE profiles SET id = id WHERE id = ?', [owner.profileId]);
      const thread = await s.lock(initial.thread_id, owner);
      const p = (await tx.get<ProposalRow>('SELECT * FROM chat_work_proposals WHERE id = ?', [
        id
      ]))!;
      const existing = await tx.get<ReceiptRow>(
        'SELECT * FROM chat_work_receipts WHERE proposal_id = ?',
        [id]
      );
      const usedKey = await tx.get<{ proposal_id: string }>(
        'SELECT proposal_id FROM chat_work_receipts WHERE owner_profile_id = ? AND client_request_id = ?',
        [owner.profileId, key]
      );
      if (usedKey && usedKey.proposal_id !== id) throw new ChatError('invalid_request');
      if (existing) {
        const proposal = await proposalDto(s, p);
        return { proposal, receipt: proposal.receipt!, replayed: true };
      }
      if (expected !== p.current_revision) throw new ChatError('stale_revision');
      const r = await tx.get<RevisionRow>(
        'SELECT * FROM chat_work_proposal_revisions WHERE proposal_id = ? AND proposal_revision = ?',
        [id, expected]
      );
      if (
        p.state !== 'open' ||
        !r ||
        r.invalidated_at ||
        !(await s.authorized(r.dependency_set_id)) ||
        thread.authorization_revision !== observedRevision ||
        r.responsible_profile_id !== owner.profileId
      )
        throw new ChatError('proposal_not_creatable');
      const missions = JSON.parse(r.spec_json).missions as ChatProposalMissionDto[];
      const scopes = [];
      for (const m of missions) {
        const scope = await s.destination(owner, m.projectId);
        if (scope.grant.workspaceId !== m.workspaceId)
          throw new ChatError('proposal_not_creatable');
        for (const o of m.objectives) {
          if (!o.assignment?.agent) throw new ChatError('proposal_not_creatable');
          await s.validateAssignment(m.workspaceId, o.assignment);
          if (
            !(await tx.get(
              'SELECT id FROM project_resources WHERE project_id = ? AND resource_key = ? AND deleted_at IS NULL',
              [m.projectId, o.resourceKey]
            ))
          )
            throw new ChatError('proposal_not_creatable');
        }
        scopes.push(scope);
      }
      // Avoid cross-owner sequence collisions, and acquire locks in stable workspace order.
      for (const workspaceId of [...new Set(missions.map(m => m.workspaceId))].sort()) {
        await tx.run('UPDATE workspaces SET id = id WHERE id = ?', [workspaceId]);
        await tx.run(
          'UPDATE mission_sequences SET next_value = next_value WHERE workspace_id = ?',
          [workspaceId]
        );
      }
      for (const scope of scopes) {
        await tx.run('UPDATE workspace_users SET id = id WHERE id = ?', [
          scope.grant.workspaceUserId
        ]);
        await tx.run(
          'UPDATE role_assignments SET id = id WHERE workspace_user_id = ? AND deleted_at IS NULL',
          [scope.grant.workspaceUserId]
        );
        await tx.run('UPDATE projects SET id = id WHERE id = ?', [scope.project.id]);
        await tx.run(
          'UPDATE project_statuses SET id = id WHERE project_id = ? AND deleted_at IS NULL',
          [scope.project.id]
        );
        await tx.run(
          'UPDATE project_resources SET id = id WHERE project_id = ? AND deleted_at IS NULL',
          [scope.project.id]
        );
      }
      const receiptId = randomUUID();
      for (const [i, m] of missions.entries()) {
        const scope = scopes[i]!;
        // Recheck local authorization at the point of creation, after acquiring workspace locks.
        await s.destination(owner, m.projectId);
        for (const o of m.objectives) {
          await s.validateAssignment(m.workspaceId, o.assignment);
          if (
            !(await tx.get(
              'SELECT id FROM project_resources WHERE project_id = ? AND resource_key = ? AND deleted_at IS NULL',
              [m.projectId, o.resourceKey]
            ))
          )
            throw new ChatError('proposal_not_creatable');
        }
        const draft = await tx.get<{ id: string }>(
          "SELECT id FROM project_statuses WHERE project_id = ? AND type = 'draft' AND deleted_at IS NULL ORDER BY position, id LIMIT 1",
          [m.projectId]
        );
        if (!draft) throw new ChatError('proposal_not_creatable');
        const created = await createMissionWithObjectives({
          ctx: { ...scope.ctx, origin: { kind: 'agent', agent: 'overlord-assistant' } },
          projectId: m.projectId,
          title: m.title,
          statusId: draft.id,
          statusType: 'draft',
          assignedWorkspaceUserId: scope.grant.workspaceUserId,
          createdFromChatThreadId: p.thread_id,
          objectives: m.objectives.map(o => ({
            title: o.title,
            objective: [
              o.objective,
              ...(o.acceptanceCriteria.length
                ? ['', 'Acceptance criteria:', ...o.acceptanceCriteria.map(c => `- ${c}`)]
                : []),
              ...(o.evidenceIds.length
                ? ['', 'Evidence:', ...o.evidenceIds.map(e => `- ${e}`)]
                : []),
              ...(m.dependencies.length
                ? [
                    '',
                    'Dependencies:',
                    ...m.dependencies.map(
                      k => `- ${missions.find(other => other.key === k)!.title}`
                    )
                  ]
                : [])
            ].join('\n'),
            agent: o.assignment.agent,
            model: o.assignment.model,
            reasoningEffort: o.assignment.reasoningEffort,
            resourceKey: o.resourceKey,
            autoAdvance: false
          }))
        });
        for (const [j, o] of created.objectives.entries()) {
          const saved = await tx.get<{
            assigned_agent: string;
            model: string | null;
            reasoning_effort: string | null;
            resource_key: string;
            auto_advance: unknown;
          }>(
            'SELECT assigned_agent, model, reasoning_effort, resource_key, auto_advance FROM objectives WHERE id = ?',
            [o.id]
          );
          const frozen = m.objectives[j]!;
          if (
            !saved ||
            saved.assigned_agent !== frozen.assignment.agent ||
            saved.model !== frozen.assignment.model ||
            saved.reasoning_effort !== frozen.assignment.reasoningEffort ||
            saved.resource_key !== frozen.resourceKey ||
            saved.auto_advance === true ||
            saved.auto_advance === 1
          )
            throw new ChatError('proposal_not_creatable');
        }
        if (i === 0)
          await tx.run(
            'INSERT INTO chat_work_receipts (id, proposal_id, proposal_revision, owner_profile_id, client_request_id, request_digest, authorization_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
              receiptId,
              id,
              expected,
              owner.profileId,
              key,
              createHash('sha256').update(JSON.stringify({ id, expected })).digest('hex'),
              thread.authorization_revision,
              s.timestamp()
            ]
          );
        await tx.run(
          'INSERT INTO chat_work_receipt_missions (receipt_id, position, mission_id, project_id, workspace_id, objective_ids_json) VALUES (?, ?, ?, ?, ?, ?)',
          [
            receiptId,
            i,
            created.mission.id,
            m.projectId,
            m.workspaceId,
            JSON.stringify(created.objectives.map(o => o.id))
          ]
        );
      }
      await tx.run(
        "UPDATE chat_work_proposals SET state = 'created', updated_at = ?, revision = revision + 1 WHERE id = ?",
        [s.timestamp(), id]
      );
      const proposal = await proposalDto(
        s,
        (await tx.get<ProposalRow>('SELECT * FROM chat_work_proposals WHERE id = ?', [id]))!
      );
      await s.append(p.thread_id, { kind: 'proposal.created', proposal }, r.dependency_set_id);
      return { proposal, receipt: proposal.receipt!, replayed: false };
    });
  }
}
