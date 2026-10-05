import type {
  AccountConnectionDto,
  AccountConnectionListResponse,
  AnswerChatQuestionBody,
  ChatAckDto,
  ChatEventPageDto,
  ChatPresenceDto,
  ChatProvidersResponse,
  ChatRunDto,
  ChatThreadDto,
  ChatThreadListResponse,
  ChatThreadSnapshotDto,
  CreateChatThreadResponse,
  CreateFromChatProposalResponse,
  StartAccountConnectionResponse,
  SubmitChatMessageBody,
  SubmitChatMessageResponse,
  UpdateChatPresenceBody,
  UpdateChatThreadBody
} from '@overlord/contract';

import { request } from './request.ts';

const thread = (id: string) => `/api/chat/threads/${encodeURIComponent(id)}`;

/**
 * Private assistant conversations and account connections (contract v152). Every
 * route is owner-scoped and Cloud-only; a Local backend answers 404
 * `chat_unavailable`, surfaced as an {@link ApiRequestError} with that `code`.
 */
export const chatApi = {
  getChatProviders: () => request<ChatProvidersResponse>('GET', '/api/chat/providers'),
  listChatThreads: (options: { archived?: boolean; cursor?: string } = {}) => {
    const params = new URLSearchParams();
    if (options.archived) params.set('archived', '1');
    if (options.cursor) params.set('cursor', options.cursor);
    const query = params.toString();
    return request<ChatThreadListResponse>('GET', `/api/chat/threads${query ? `?${query}` : ''}`);
  },
  /** Creates an empty thread; the first message is sent separately so it stays idempotent. */
  createChatThread: () => request<CreateChatThreadResponse>('POST', '/api/chat/threads', {}),
  getChatSnapshot: (id: string, before?: string) =>
    request<ChatThreadSnapshotDto>(
      'GET',
      `${thread(id)}${before ? `?before=${encodeURIComponent(before)}` : ''}`
    ),
  updateChatThread: (id: string, body: UpdateChatThreadBody) =>
    request<ChatThreadDto>('PATCH', thread(id), body),
  submitChatMessage: (id: string, body: SubmitChatMessageBody) =>
    request<SubmitChatMessageResponse>('POST', `${thread(id)}/messages`, body),
  pollChatEvents: (id: string, after: number) =>
    request<ChatEventPageDto>('GET', `${thread(id)}/events?after=${after}&poll=1`),
  chatEventStreamPath: (id: string, after: number) => `${thread(id)}/events?after=${after}`,
  updateChatPresence: (id: string, body: UpdateChatPresenceBody) =>
    request<ChatPresenceDto>('PUT', `${thread(id)}/presence`, body),
  ackChatEvents: (id: string, body: { clientId: string; seq: number }) =>
    request<ChatAckDto>('POST', `${thread(id)}/ack`, body),
  answerChatQuestion: (id: string, body: AnswerChatQuestionBody) =>
    request<SubmitChatMessageResponse>(
      'POST',
      `/api/chat/questions/${encodeURIComponent(id)}/answer`,
      body
    ),
  cancelChatRun: (id: string, clientRequestId: string) =>
    request<ChatRunDto>('POST', `/api/chat/runs/${encodeURIComponent(id)}/cancel`, {
      clientRequestId
    }),
  continueChatRun: (id: string, clientRequestId: string) =>
    request<{ run: ChatRunDto; replayed: boolean }>(
      'POST',
      `/api/chat/runs/${encodeURIComponent(id)}/continue`,
      {
        clientRequestId
      }
    ),
  createFromChatProposal: (
    id: string,
    body: { clientRequestId: string; expectedRevision: number }
  ) =>
    request<CreateFromChatProposalResponse>(
      'POST',
      `/api/chat/proposals/${encodeURIComponent(id)}/create`,
      body
    ),
  listAccountConnections: () => request<AccountConnectionListResponse>('GET', '/api/connections'),
  startAccountConnection: () =>
    request<StartAccountConnectionResponse>('POST', '/api/connections', {
      provider: 'knowledgebase',
      returnTo: 'web'
    }),
  disconnectAccountConnection: (id: string) =>
    request<AccountConnectionDto>('DELETE', `/api/connections/${encodeURIComponent(id)}`)
};
