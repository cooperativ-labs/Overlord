import type { ChatProvidersResponse } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';

import {
  overlordSourceChecker,
  repositorySourceChecker
} from '../../packages/core/service/chat/access.ts';
import { assignmentCatalogProjection } from '../../packages/core/service/chat/assignments.ts';
import type { ChatAssignmentCatalog } from '../../packages/core/service/chat/store.ts';
import type { ChatOwner, SourceChecker } from '../../packages/core/service/chat/store.ts';
import {
  type ChatRepositoryReader,
  ChatToolGateway
} from '../../packages/core/service/chat/tools.ts';
import { performRepositoryRead } from '../../packages/core/service/repository-reads.ts';
import { resolveWorkspaceAgentCatalog } from '../agent-catalog.ts';
import type { ConnectionsRuntime } from '../connections/index.ts';
import { createCompletionListenerFactory } from '../execution/local-target-completion-notify.ts';

import { sdkGeminiClient } from './gemini-client.ts';
import { GeminiChatRuntime } from './gemini-runtime.ts';

/** Default chat model (milestone one); `CHAT_GEMINI_MODEL` overrides it. */
export const DEFAULT_CHAT_MODEL = 'gemini-3.8-flash';

/** Source checkers for the kinds owned outside the connections module. */
export function chatSourceCheckers(
  db: DatabaseClient
): Partial<Record<'overlord' | 'repository', SourceChecker>> {
  return { overlord: overlordSourceChecker(db), repository: repositorySourceChecker(db) };
}

/** The production repository reader: the same core service as `POST /api/projects/:id/repository-reads`. */
export const queuedRepositoryReader: ChatRepositoryReader = ({ ctx, request, scopeKey, signal }) =>
  performRepositoryRead({
    ctx,
    request,
    scopeKey,
    signal,
    queueOptions: { createCompletionListener: createCompletionListenerFactory() }
  });

export interface ChatEngine {
  runtime: GeminiChatRuntime;
  gateway: ChatToolGateway;
  assignmentCatalog(workspaceId: string): Promise<ChatAssignmentCatalog>;
  providers(owner: ChatOwner): Promise<ChatProvidersResponse>;
}

/**
 * Builds the Gemini engine from server configuration. Chat has its own key and model
 * settings (`CHAT_GEMINI_API_KEY`, falling back to `GEMINI_API_KEY`; `CHAT_GEMINI_MODEL`),
 * separate from the title and delivery automations. Without a key the runtime reports
 * `not_configured` and every run fails `provider_unavailable`; it never answers with mocks.
 */
export function createChatEngine(options: {
  db: DatabaseClient;
  env: NodeJS.ProcessEnv;
  connections: () => ConnectionsRuntime;
}): ChatEngine {
  // An empty CHAT_GEMINI_API_KEY (as in the env examples) falls back too.
  const key = options.env.CHAT_GEMINI_API_KEY?.trim() || options.env.GEMINI_API_KEY?.trim() || '';
  const model = (options.env.CHAT_GEMINI_MODEL ?? '').trim() || DEFAULT_CHAT_MODEL;
  const budget = Number(options.env.CHAT_MAX_GATHERED_BYTES_PER_RUN);
  const assignmentCatalog = async (workspaceId: string): Promise<ChatAssignmentCatalog> => {
    return assignmentCatalogProjection(await resolveWorkspaceAgentCatalog(options.db, workspaceId));
  };
  const gateway = new ChatToolGateway({
    assignmentCatalog,
    db: options.db,
    // Resolved lazily so a Knowledgebase configured or disabled at startup is respected.
    knowledgebase: {
      tools: (owner, signal, callOptions) =>
        options.connections().knowledgebase?.tools(owner, signal, callOptions) ??
        Promise.resolve([]),
      call: (owner, toolId, args, signal, callOptions) => {
        const kb = options.connections().knowledgebase;
        if (!kb)
          return Promise.resolve({
            outcome: 'unavailable',
            text: '',
            truncated: false,
            workspace: null,
            upstreamStatus: null,
            sources: [],
            observedAt: new Date().toISOString(),
            detail: 'not_configured'
          });
        return kb.call(owner, toolId, args, signal, callOptions);
      }
    },
    readRepository: queuedRepositoryReader
  });
  const runtime = new GeminiChatRuntime({
    client: key ? sdkGeminiClient(key) : null,
    gateway,
    model,
    ...(Number.isSafeInteger(budget) && budget > 0 ? { maxGatheredBytesPerRun: budget } : {})
  });
  return {
    runtime,
    gateway,
    assignmentCatalog,
    providers: async owner => ({
      providers: [runtime.readiness()],
      connections: (await options.connections().connections.list(owner)).items
    })
  };
}
