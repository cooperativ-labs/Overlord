import type {
  ChatBlockDto,
  ChatEventDto,
  ChatMessageDto,
  ChatProposalDto,
  ChatQuestionDto,
  ChatRunDto,
  ChatThreadDto,
  ChatThreadSnapshotDto,
  ChatToolCallState
} from '@overlord/contract';

/**
 * Client projection of one private chat thread: an authorized snapshot plus every
 * stream event applied in sequence order. Pure, so the transport and the tests
 * share one implementation of event semantics.
 */
export interface ChatToolActivity {
  toolCallId: string;
  runId: string;
  label: string;
  state: ChatToolCallState;
}

export interface ChatThreadState {
  thread: ChatThreadDto;
  /** Oldest first. */
  messages: ChatMessageDto[];
  hasEarlierMessages: boolean;
  activeRun: ChatRunDto | null;
  latestRun: ChatRunDto | null;
  openQuestion: ChatQuestionDto | null;
  /** Every proposal the client knows, open or not, keyed by id. */
  proposals: Record<string, ChatProposalDto>;
  /** Tool activity for the active run, in arrival order. */
  tools: ChatToolActivity[];
  /** Highest event sequence applied; the `after` cursor for replay. */
  cursor: number;
  /** Set by `content.invalidated`; the owner reloads an authorized snapshot. */
  needsSnapshot: boolean;
}

const UNFINISHED = new Set(['queued', 'running', 'waiting_user']);

export function stateFromSnapshot(snapshot: ChatThreadSnapshotDto): ChatThreadState {
  const proposals: Record<string, ChatProposalDto> = {};
  for (const proposal of snapshot.referencedProposals ?? []) proposals[proposal.id] = proposal;
  for (const proposal of snapshot.openProposals) proposals[proposal.id] = proposal;
  return {
    thread: snapshot.thread,
    messages: snapshot.messages,
    hasEarlierMessages: snapshot.hasEarlierMessages,
    activeRun: snapshot.activeRun,
    latestRun: snapshot.latestRun,
    openQuestion: snapshot.openQuestion,
    proposals,
    tools: [],
    cursor: snapshot.eventCursor,
    needsSnapshot: false
  };
}

/** Prepends an earlier message page (same projection, older messages). */
export function prependEarlier(
  state: ChatThreadState,
  page: ChatThreadSnapshotDto
): ChatThreadState {
  const known = new Set(state.messages.map(message => message.id));
  const proposals = { ...state.proposals };
  for (const proposal of [...(page.referencedProposals ?? []), ...page.openProposals])
    proposals[proposal.id] ??= proposal;
  return {
    ...state,
    messages: [...page.messages.filter(message => !known.has(message.id)), ...state.messages],
    hasEarlierMessages: page.hasEarlierMessages,
    proposals
  };
}

function upsertMessage(messages: ChatMessageDto[], message: ChatMessageDto): ChatMessageDto[] {
  const index = messages.findIndex(existing => existing.id === message.id);
  if (index === -1) return [...messages, message];
  // Never let an older revision overwrite a newer one.
  if (messages[index]!.revision > message.revision) return messages;
  const next = messages.slice();
  next[index] = message;
  return next;
}

function appendDelta(
  messages: ChatMessageDto[],
  messageId: string,
  blockId: string,
  text: string
): ChatMessageDto[] {
  const index = messages.findIndex(message => message.id === messageId);
  if (index === -1) return messages;
  const message = messages[index]!;
  if (message.state !== 'streaming') return messages;
  let found = false;
  const blocks: ChatBlockDto[] = message.blocks.map(block => {
    if (block.id !== blockId || block.kind !== 'text') return block;
    found = true;
    return { ...block, text: block.text + text, fallbackText: block.fallbackText + text };
  });
  if (!found) blocks.push({ id: blockId, kind: 'text', text, fallbackText: text, evidenceIds: [] });
  const next = messages.slice();
  next[index] = { ...message, blocks };
  return next;
}

function withRun(state: ChatThreadState, run: ChatRunDto): ChatThreadState {
  if (UNFINISHED.has(run.state)) {
    if (state.activeRun && state.activeRun.id === run.id && state.activeRun.revision > run.revision)
      return state;
    const tools =
      state.activeRun && state.activeRun.id !== run.id
        ? state.tools.filter(tool => tool.runId === run.id)
        : state.tools;
    // A Continue run makes the exhausted run's Continue offer obsolete.
    const latestRun =
      state.latestRun && run.continuedFromRunId === state.latestRun.id
        ? { ...state.latestRun, continueAvailable: false }
        : state.latestRun;
    return { ...state, activeRun: run, latestRun, tools };
  }
  if (state.latestRun?.id === run.id && state.latestRun.revision > run.revision) return state;
  const finishedActive = state.activeRun?.id === run.id;
  return {
    ...state,
    activeRun: finishedActive ? null : state.activeRun,
    latestRun: run,
    tools: finishedActive ? [] : state.tools,
    openQuestion: finishedActive && state.openQuestion?.runId === run.id ? null : state.openQuestion
  };
}

/**
 * Applies one event. Events at or below the cursor are duplicates and ignored;
 * callers must not apply an event past a gap (see {@link isGap}).
 */
export function applyChatEvent(state: ChatThreadState, event: ChatEventDto): ChatThreadState {
  if (event.seq <= state.cursor) return state;
  const next = applyEventBody(state, event);
  return { ...next, cursor: event.seq };
}

export function isGap(state: ChatThreadState, event: ChatEventDto): boolean {
  return event.seq > state.cursor + 1;
}

function applyEventBody(state: ChatThreadState, event: ChatEventDto): ChatThreadState {
  switch (event.kind) {
    case 'thread.updated':
      return state.thread.revision > event.thread.revision
        ? state
        : { ...state, thread: event.thread };
    case 'message.created':
    case 'message.completed':
      return { ...state, messages: upsertMessage(state.messages, event.message) };
    case 'message.delta':
      return {
        ...state,
        messages: appendDelta(state.messages, event.messageId, event.blockId, event.text)
      };
    case 'run.updated': {
      const next = withRun(state, event.run);
      const activeRunState = next.activeRun ? next.activeRun.state : null;
      return {
        ...next,
        thread: {
          ...next.thread,
          activeRunState: activeRunState as ChatThreadDto['activeRunState']
        }
      };
    }
    case 'tool.updated': {
      if (state.activeRun && state.activeRun.id !== event.runId) return state;
      const activity: ChatToolActivity = {
        toolCallId: event.toolCallId,
        runId: event.runId,
        label: event.label,
        state: event.state
      };
      const index = state.tools.findIndex(tool => tool.toolCallId === event.toolCallId);
      const tools = state.tools.slice();
      if (index === -1) tools.push(activity);
      else tools[index] = activity;
      return { ...state, tools };
    }
    case 'question.opened':
      return { ...state, openQuestion: event.question };
    case 'question.closed':
      return state.openQuestion?.id === event.question.id
        ? { ...state, openQuestion: null }
        : state;
    case 'proposal.revised':
    case 'proposal.created':
      return {
        ...state,
        proposals: { ...state.proposals, [event.proposal.id]: event.proposal }
      };
    case 'content.invalidated': {
      // Withhold the affected content immediately; the authorized snapshot is the
      // source of truth for what replaces it.
      const messageIds = new Set(event.messageIds);
      const messages = state.messages.map(message =>
        messageIds.has(message.id)
          ? {
              ...message,
              blocks: [
                {
                  id: `${message.id}:unavailable`,
                  kind: 'unavailable' as const,
                  reason: 'source_access_lost' as const,
                  regenerable: false,
                  fallbackText: 'This content is no longer available.'
                }
              ]
            }
          : message
      );
      const proposals = { ...state.proposals };
      for (const id of event.proposalIds) {
        const proposal = proposals[id];
        if (proposal)
          proposals[id] = { ...proposal, current: { ...proposal.current, invalidated: true } };
      }
      return { ...state, messages, proposals, needsSnapshot: true };
    }
    default:
      // Unknown future event kinds are tolerated; the next snapshot reconciles them.
      return state;
  }
}

/** The run a new composer message would interact with. */
export function composerMode(state: ChatThreadState | null): 'send' | 'answer' | 'busy' {
  if (!state?.activeRun) return 'send';
  if (state.activeRun.state === 'waiting_user') return 'answer';
  return 'busy';
}
