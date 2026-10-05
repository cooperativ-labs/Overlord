import type {
  ChatEventDto,
  ChatMessageDto,
  ChatProposalDto,
  ChatQuestionDto,
  ChatRunDto,
  ChatThreadDto,
  ChatThreadSnapshotDto
} from '@overlord/contract';

/** Test fixtures for the chat client; values are minimal but contract-shaped. */
const AT = '2026-10-04T12:00:00.000Z';

export function thread(overrides: Partial<ChatThreadDto> = {}): ChatThreadDto {
  return {
    id: 'thread-1',
    organizationId: 'org-1',
    title: 'Routing',
    titleSource: 'generated',
    archivedAt: null,
    lastActivityAt: AT,
    activeRunState: null,
    createdAt: AT,
    updatedAt: AT,
    revision: 1,
    ...overrides
  };
}

export function run(overrides: Partial<ChatRunDto> = {}): ChatRunDto {
  return {
    id: 'run-1',
    threadId: 'thread-1',
    triggerMessageId: 'm-user',
    state: 'running',
    outcome: null,
    failureCode: null,
    continueAvailable: false,
    continuedFromRunId: null,
    usage: { toolCalls: 0, activeProcessingMs: 0, gatheredContentBytes: 0 },
    cancelRequestedAt: null,
    createdAt: AT,
    updatedAt: AT,
    completedAt: null,
    revision: 1,
    ...overrides
  };
}

export function message(overrides: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    id: 'm-assistant',
    threadId: 'thread-1',
    role: 'assistant',
    state: 'streaming',
    blocks: [{ id: 'b1', kind: 'text', text: '', fallbackText: '', evidenceIds: [] }],
    runId: 'run-1',
    answersQuestionId: null,
    clientRequestId: null,
    createdAt: AT,
    updatedAt: AT,
    revision: 1,
    ...overrides
  };
}

export function question(overrides: Partial<ChatQuestionDto> = {}): ChatQuestionDto {
  return {
    id: 'q-1',
    threadId: 'thread-1',
    runId: 'run-1',
    ordinal: 1,
    state: 'open',
    prompt: 'Which project?',
    options: [
      { id: 'o1', label: 'Overlord' },
      { id: 'o2', label: 'OverlordMobile' }
    ],
    allowFreeText: true,
    answerMessageId: null,
    createdAt: AT,
    answeredAt: null,
    revision: 1,
    ...overrides
  };
}

export function proposal(overrides: Partial<ChatProposalDto> = {}, revision = 1): ChatProposalDto {
  return {
    id: 'p-1',
    threadId: 'thread-1',
    state: 'open',
    currentRevision: revision,
    current: {
      revision,
      responsibleProfileId: 'profile-1',
      invalidated: false,
      createdAt: AT,
      missions: [
        {
          key: 'm1',
          projectId: 'project-1',
          projectName: 'Overlord',
          workspaceId: 'ws-1',
          title: 'Chat client',
          dependencies: [],
          audienceWarning: null,
          objectives: [
            {
              title: 'Build the page',
              objective: 'Add a chat page.',
              acceptanceCriteria: ['Renders transcript'],
              resourceKey: 'primary',
              evidenceIds: [],
              assignment: {
                agent: 'claude-code',
                model: 'opus',
                reasoningEffort: 'high',
                source: 'project_default'
              }
            }
          ]
        }
      ]
    },
    receipt: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides
  };
}

export function snapshot(overrides: Partial<ChatThreadSnapshotDto> = {}): ChatThreadSnapshotDto {
  return {
    thread: thread(),
    messages: [],
    hasEarlierMessages: false,
    activeRun: null,
    latestRun: null,
    openQuestion: null,
    openProposals: [],
    referencedProposals: [],
    eventCursor: 0,
    retainedFromSeq: 1,
    ...overrides
  };
}

type EventBody = ChatEventDto extends infer E
  ? E extends ChatEventDto
    ? Omit<E, 'threadId' | 'seq' | 'createdAt'>
    : never
  : never;

export function event(seq: number, body: EventBody): ChatEventDto {
  return { threadId: 'thread-1', seq, createdAt: AT, ...body } as ChatEventDto;
}
