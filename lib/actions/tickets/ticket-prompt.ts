'use server';

import * as Sentry from '@sentry/nextjs';

import { getAllAgentConfigsAction } from '@/lib/actions/agent-config';
import { fetchProfileCustomInstructions } from '@/lib/actions/profile-settings';
import { getOverlordMcpUrl, getPlatformUrl } from '@/lib/env';
import { submitDraftObjective } from '@/lib/objectives';
import { loadFeedDiscussAppendMarkdown } from '@/lib/overlord/load-feed-discuss-append';
import { resolveProtocolObjectiveText } from '@/lib/overlord/protocol-context-objective';
import {
  buildTicketPromptMarkdown,
  type PromptContext,
  type PromptLaunchMode
} from '@/lib/overlord/ticket-prompt';
import type { AgentConfig } from '@/lib/schemas/agent-config';
import { createClientForRequest } from '@/supabase/utils/server';

import { assertTicketAccess, resolvePromptTicketSource } from './internals';

export async function getTicketPromptForCopy(
  ticketId: string,
  launchMode: PromptLaunchMode = 'run',
  context?: PromptContext,
  preferredObjectiveId?: string | null
): Promise<{ error?: string; prompt?: string }> {
  const supabase = await createClientForRequest();
  const submitResult = await submitDraftObjective(
    supabase,
    ticketId,
    preferredObjectiveId ?? undefined
  );
  if (preferredObjectiveId && submitResult.error) {
    return { error: submitResult.error };
  }
  const { error, source } = await resolvePromptTicketSource(supabase, ticketId, {
    preferredObjectiveId: preferredObjectiveId ?? undefined
  });
  if (error || !source) {
    return { error: error ?? 'Unable to load ticket prompt source.' };
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const platformUrl = getPlatformUrl();
  const customInstructions = user ? await fetchProfileCustomInstructions(supabase, user.id) : null;

  let agentConfigs: Record<string, AgentConfig> = {};
  if (user) {
    try {
      agentConfigs = await getAllAgentConfigsAction();
    } catch (error) {
      console.error('Failed to load agent configs for prompt:', error);
      Sentry.captureException(error);
    }
  }

  let mcpUrl: string | undefined;
  try {
    mcpUrl = getOverlordMcpUrl();
  } catch {
    mcpUrl = undefined;
  }

  const prompt = buildTicketPromptMarkdown({
    ticket: {
      ...source.ticket,
      title: source.ticket.title?.trim(),
      objective: source.latestObjective,
      objective_id: source.latestObjectiveId
    },
    platformUrl,
    context,
    options: {
      mcpUrl,
      customInstructions,
      launchMode,
      agentConfigs
    }
  });
  return { prompt };
}

export async function getTicketDiscussionPromptForCopy(
  ticketId: string,
  context?: PromptContext,
  preferredObjectiveId?: string | null
): Promise<{ error?: string; prompt?: string }> {
  return getTicketPromptForCopy(ticketId, 'ask', context, preferredObjectiveId);
}

export async function getFeedDiscussPromptForCopy(input: {
  ticketId: string;
  feedPostId: string;
  initialQuestion: string;
  context?: PromptContext;
}): Promise<{ error?: string; prompt?: string }> {
  const supabase = await createClientForRequest();
  await assertTicketAccess(supabase, input.ticketId);

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select(
      'id,ticket_id,organization_id,title,acceptance_criteria,available_tools,for_human,project_id,status,priority,constraints,output_format'
    )
    .eq('id', input.ticketId)
    .single();

  if (ticketError || !ticket) {
    return { error: ticketError?.message ?? 'Ticket not found.' };
  }

  const objectiveResolution = await resolveProtocolObjectiveText({
    supabase,
    ticketId: input.ticketId,
    organizationId: ticket.organization_id,
    feedPostId: input.feedPostId
  });

  if (!objectiveResolution.ok) {
    return { error: objectiveResolution.error };
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const platformUrl = getPlatformUrl();
  const customInstructions = user ? await fetchProfileCustomInstructions(supabase, user.id) : null;

  let agentConfigs: Record<string, AgentConfig> = {};
  if (user) {
    try {
      agentConfigs = await getAllAgentConfigsAction();
    } catch (error) {
      console.error('Failed to load agent configs for prompt:', error);
      Sentry.captureException(error);
    }
  }

  let mcpUrl: string | undefined;
  try {
    mcpUrl = getOverlordMcpUrl();
  } catch {
    mcpUrl = undefined;
  }

  const trimmedQuestion = input.initialQuestion.trim();
  const safeQuestion =
    trimmedQuestion.length > 6000
      ? `${trimmedQuestion.slice(0, 6000)}\n\n_(truncated)_`
      : trimmedQuestion;

  if (!objectiveResolution.feedPostId) {
    return { error: 'Could not resolve feed post for this discussion.' };
  }

  const append = await loadFeedDiscussAppendMarkdown({
    supabase,
    ticketId: input.ticketId,
    feedPostId: objectiveResolution.feedPostId,
    initialQuestion: safeQuestion || '(User opened discuss without a typed question.)',
    ticketIntent: {
      humanTicketId: ticket.ticket_id || ticket.id,
      ticketTitle: ticket.title,
      sliceObjectiveText: objectiveResolution.objectiveText,
      acceptanceCriteria: ticket.acceptance_criteria,
      constraints: ticket.constraints,
      forHuman: ticket.for_human
    }
  });

  if (!append.ok) {
    return { error: append.error };
  }

  const markdown = buildTicketPromptMarkdown({
    ticket: {
      id: ticket.ticket_id || ticket.id,
      title: ticket.title?.trim(),
      objective: objectiveResolution.objectiveText,
      objective_id: objectiveResolution.objectiveId,
      acceptance_criteria: ticket.acceptance_criteria,
      available_tools: ticket.available_tools,
      constraints: ticket.constraints,
      output_format: ticket.output_format,
      for_human: ticket.for_human,
      project_id: ticket.project_id,
      status: ticket.status,
      priority: ticket.priority
    },
    platformUrl,
    context: input.context,
    options: {
      mcpUrl,
      customInstructions,
      launchMode: 'ask',
      agentConfigs,
      feedDiscussTaskMarkdown: append.markdown
    }
  });

  return { prompt: markdown };
}
