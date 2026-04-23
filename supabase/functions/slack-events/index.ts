/// <reference lib="deno.ns" />
/**
 * Overlord Slack Events — Supabase Edge Function
 *
 * Handles all inbound Slack payloads:
 *   - Events API: app_mention, message.im, link_shared
 *   - Interactive components: block_actions, view_submission, message_action
 *   - Slash commands: /overlord
 *
 * Security: every request is verified via HMAC-SHA256 Slack signing secret.
 * Idempotency: event_ids are deduplicated in slack_event_dedupe.
 * Ticket creation uses service role to act as the owning Overlord user.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SLACK_SIGNING_SECRET = Deno.env.get('SLACK_SIGNING_SECRET')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const OVERLORD_URL = Deno.env.get('OVERLORD_URL') ?? Deno.env.get('NEXT_PUBLIC_SITE_URL') ?? '';

const GEMINI_MODEL = 'gemini-2.5-flash-lite';

// ---------------------------------------------------------------------------
// Slack signature verification
// ---------------------------------------------------------------------------

async function verifySlackSignature(
  signingSecret: string,
  body: string,
  timestamp: string,
  signature: string
): Promise<boolean> {
  // Reject stale timestamps (> 5 minutes) to prevent replay attacks
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const baseString = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(baseString));
  const hex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const expected = `v0=${hex}`;

  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Gemini title generation
// ---------------------------------------------------------------------------

async function generateTitle(text: string): Promise<string | null> {
  if (!GEMINI_API_KEY || text.length <= 100) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [
              {
                text: 'You write concise ticket titles for a project management tool. Titles should be action-oriented (start with a verb), specific, and under 60 characters. Return only the title, nothing else.'
              }
            ]
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Summarize the following ticket objective into a short, action-oriented title (max 60 characters). Return ONLY the title text, no quotes or punctuation wrapping.\n\nObjective:\n${text}`
                }
              ]
            }
          ],
          generationConfig: { temperature: 0.3, maxOutputTokens: 100 }
        })
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const title: string = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    if (!title) return null;
    return title.length <= 60 ? title : title.slice(0, 60) + '…';
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Slack API helpers
// ---------------------------------------------------------------------------

async function slackApi(
  method: string,
  token: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function postEphemeral(
  token: string,
  channel: string,
  userId: string,
  text: string,
  blocks?: unknown[]
) {
  await slackApi('chat.postEphemeral', token, {
    channel,
    user: userId,
    text,
    ...(blocks ? { blocks } : {})
  });
}

async function openModal(token: string, triggerId: string, view: unknown) {
  await slackApi('views.open', token, { trigger_id: triggerId, view });
}

function ticketDeepLink(ticketId: string): string {
  return OVERLORD_URL ? `${OVERLORD_URL}/u/${ticketId}` : '';
}

// ---------------------------------------------------------------------------
// Ticket creation
// ---------------------------------------------------------------------------

type CreateTicketParams = {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  organizationId: number;
  workspaceId: string;
  projectId: string | null;
  status: string;
  priority: string;
  executionTarget: 'agent' | 'human';
  objective: string;
  context: string;
  channelId: string;
  threadTs: string | null;
};

async function createTicket(params: CreateTicketParams): Promise<string | null> {
  const {
    supabase,
    userId,
    organizationId,
    workspaceId,
    projectId,
    status,
    priority,
    executionTarget,
    objective,
    context,
    channelId,
    threadTs
  } = params;

  // Generate a concise title using Gemini if the objective is long
  const aiTitle = await generateTitle(objective);
  const title = aiTitle ?? (objective.length <= 60 ? objective : objective.slice(0, 60) + '…');

  const { data: ticket, error } = await supabase
    .from('tickets')
    .insert({
      organization_id: organizationId,
      project_id: projectId ?? null,
      created_by: userId,
      title,
      status,
      priority: priority as 'low' | 'medium' | 'high' | 'urgent',
      execution_target: executionTarget,
      context,
      source: 'slack',
      slack_workspace_id: workspaceId,
      slack_channel_id: channelId,
      slack_thread_ts: threadTs ?? null
    })
    .select('id')
    .single();

  if (error || !ticket) {
    console.error('[slack-events] ticket insert error:', error?.message);
    return null;
  }

  // Insert the objective in the objectives table
  await supabase.from('objectives').insert({
    ticket_id: ticket.id,
    objective
  });

  return ticket.id;
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

function buildSlackContext(opts: {
  permalink?: string;
  channelName?: string;
  authorName?: string;
  messageTs?: string;
  threadText?: string;
}): string {
  const parts: string[] = ['**Captured from Slack**'];
  if (opts.channelName) parts.push(`Channel: #${opts.channelName}`);
  if (opts.authorName) parts.push(`From: ${opts.authorName}`);
  if (opts.messageTs) {
    const d = new Date(parseFloat(opts.messageTs) * 1000);
    parts.push(`Posted: ${d.toISOString()}`);
  }
  if (opts.permalink) parts.push(`Permalink: ${opts.permalink}`);
  if (opts.threadText) parts.push(`\nThread context:\n${opts.threadText}`);
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Post-creation ephemeral message with action buttons
// ---------------------------------------------------------------------------

function buildTicketCreatedBlocks(ticketId: string, title: string): unknown[] {
  const webUrl = ticketDeepLink(ticketId);
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✅ *Ticket created:* ${title}`
      }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Edit objective' },
          action_id: 'slack_edit_objective',
          value: ticketId
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Change project' },
          action_id: 'slack_change_project',
          value: ticketId
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Change status' },
          action_id: 'slack_change_status',
          value: ticketId
        },
        ...(webUrl
          ? [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Open in Overlord' },
                url: webUrl,
                action_id: 'slack_open_overlord',
                value: ticketId
              }
            ]
          : [])
      ]
    }
  ];
}

// ---------------------------------------------------------------------------
// Workspace + user resolution
// ---------------------------------------------------------------------------

async function resolveWorkspace(supabase: ReturnType<typeof createClient>, teamId: string) {
  const { data } = await supabase
    .from('slack_workspaces')
    .select('*')
    .eq('team_id', teamId)
    .maybeSingle();
  return data;
}

// ---------------------------------------------------------------------------
// Deduplicate event
// ---------------------------------------------------------------------------

async function dedupeEvent(
  supabase: ReturnType<typeof createClient>,
  eventId: string
): Promise<boolean> {
  const { error } = await supabase.from('slack_event_dedupe').insert({ event_id: eventId });
  // If insert fails (duplicate key), the event was already processed
  return !error;
}

// ---------------------------------------------------------------------------
// Handler: app_mention
// ---------------------------------------------------------------------------

async function handleAppMention(
  supabase: ReturnType<typeof createClient>,
  event: Record<string, unknown>,
  teamId: string
) {
  const workspace = await resolveWorkspace(supabase, teamId);
  if (!workspace) return;

  const slackUserId = event.user as string;

  // Restrict to workspace owner unless restriction is disabled
  if (workspace.restrict_to_owner && slackUserId !== workspace.slack_user_id) {
    await postEphemeral(
      workspace.bot_access_token,
      event.channel as string,
      slackUserId,
      'Only the Overlord workspace owner can create tickets from this workspace.'
    );
    return;
  }

  // Strip the bot mention from the text
  const rawText = (event.text as string) ?? '';
  const objective = rawText.replace(/<@[A-Z0-9]+>/g, '').trim();
  if (!objective) return;

  const threadTs = (event.thread_ts as string | undefined) ?? null;

  // If this is a thread reply, check if the parent message has a linked ticket
  // and append to its context instead of creating a new ticket
  if (threadTs && event.ts !== threadTs) {
    await handleThreadFollowUp(supabase, workspace, objective, event, threadTs);
    return;
  }

  const channelId = event.channel as string;
  let context = '';

  if (workspace.include_context) {
    // Resolve Slack permalink
    let permalink = '';
    try {
      const r = (await slackApi('chat.getPermalink', workspace.bot_access_token, {
        channel: channelId,
        message_ts: event.ts as string
      })) as { permalink?: string };
      permalink = r.permalink ?? '';
    } catch {
      // non-critical
    }

    context = buildSlackContext({
      permalink,
      channelId,
      messageTs: event.ts as string
    });
  }

  // Resolve effective status: project-level override > workspace default
  const projectId = workspace.default_project_id ?? null;
  const status = await resolveEffectiveStatus(supabase, projectId, workspace.default_status);

  const ticketId = await createTicket({
    supabase,
    userId: workspace.user_id,
    organizationId: workspace.organization_id,
    workspaceId: workspace.id,
    projectId,
    status,
    priority: workspace.default_priority,
    executionTarget: workspace.default_execution_target,
    objective,
    context,
    channelId,
    threadTs
  });

  if (!ticketId) return;

  const title = objective.length <= 60 ? objective : objective.slice(0, 60) + '…';
  await postEphemeral(
    workspace.bot_access_token,
    channelId,
    workspace.slack_user_id,
    `Ticket created: ${title}`,
    buildTicketCreatedBlocks(ticketId, title)
  );
}

// ---------------------------------------------------------------------------
// Handler: message.im (DM to bot)
// ---------------------------------------------------------------------------

async function handleDirectMessage(
  supabase: ReturnType<typeof createClient>,
  event: Record<string, unknown>,
  teamId: string
) {
  const workspace = await resolveWorkspace(supabase, teamId);
  if (!workspace) return;

  const slackUserId = event.user as string;
  if (workspace.restrict_to_owner && slackUserId !== workspace.slack_user_id) return;

  // Ignore bot messages and subtypes (e.g. channel_join)
  if (event.subtype || event.bot_id) return;

  const objective = ((event.text as string) ?? '').trim();
  if (!objective) return;

  const channelId = event.channel as string;
  const projectId = workspace.default_project_id ?? null;
  const status = await resolveEffectiveStatus(supabase, projectId, workspace.default_status);

  const ticketId = await createTicket({
    supabase,
    userId: workspace.user_id,
    organizationId: workspace.organization_id,
    workspaceId: workspace.id,
    projectId,
    status,
    priority: workspace.default_priority,
    executionTarget: workspace.default_execution_target,
    objective,
    context: workspace.include_context ? buildSlackContext({ channelId: 'DM' }) : '',
    channelId,
    threadTs: null
  });

  if (!ticketId) return;

  const title = objective.length <= 60 ? objective : objective.slice(0, 60) + '…';
  await slackApi('chat.postMessage', workspace.bot_access_token, {
    channel: channelId,
    text: `✅ Ticket created: ${title}`,
    blocks: buildTicketCreatedBlocks(ticketId, title)
  });
}

// ---------------------------------------------------------------------------
// Handler: thread follow-up (append @overlord reply to existing ticket context)
// ---------------------------------------------------------------------------

async function handleThreadFollowUp(
  supabase: ReturnType<typeof createClient>,
  workspace: Record<string, unknown>,
  followUpText: string,
  event: Record<string, unknown>,
  threadTs: string
) {
  // Look for an existing ticket created from this thread
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id,context,objective')
    .eq('slack_workspace_id', workspace.id as string)
    .eq('slack_thread_ts', threadTs)
    .maybeSingle();

  if (!ticket) {
    // No prior ticket for this thread — create a new one
    const channelId = event.channel as string;
    const projectId = (workspace.default_project_id as string | null) ?? null;
    const status = await resolveEffectiveStatus(
      supabase,
      projectId,
      workspace.default_status as string
    );

    const ticketId = await createTicket({
      supabase,
      userId: workspace.user_id as string,
      organizationId: workspace.organization_id as number,
      workspaceId: workspace.id as string,
      projectId,
      status,
      priority: workspace.default_priority as string,
      executionTarget: workspace.default_execution_target as 'agent' | 'human',
      objective: followUpText,
      context: workspace.include_context
        ? buildSlackContext({ channelId, messageTs: event.ts as string })
        : '',
      channelId,
      threadTs
    });

    if (!ticketId) return;
    const title = followUpText.length <= 60 ? followUpText : followUpText.slice(0, 60) + '…';
    await postEphemeral(
      workspace.bot_access_token as string,
      channelId,
      workspace.slack_user_id as string,
      `Ticket created: ${title}`,
      buildTicketCreatedBlocks(ticketId, title)
    );
    return;
  }

  // Append the follow-up to the ticket's objective/context
  const appendedObjective = `${ticket.objective ?? ''}\n\n---\n**Follow-up from Slack thread:**\n${followUpText}`;

  await supabase.from('objectives').insert({
    ticket_id: ticket.id,
    objective: appendedObjective
  });

  // Also update the context with the follow-up note
  const updatedContext = `${ticket.context ?? ''}\n\n**Thread follow-up added** (${new Date().toISOString()}):\n${followUpText}`;
  await supabase.from('tickets').update({ context: updatedContext }).eq('id', ticket.id);

  await postEphemeral(
    workspace.bot_access_token as string,
    event.channel as string,
    workspace.slack_user_id as string,
    `Follow-up appended to ticket.`,
    [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `↩ Follow-up added to ticket. <${ticketDeepLink(ticket.id)}|Open in Overlord>`
        }
      }
    ]
  );
}

// ---------------------------------------------------------------------------
// Handler: slash command /overlord
// ---------------------------------------------------------------------------

async function handleSlashCommand(
  supabase: ReturnType<typeof createClient>,
  params: URLSearchParams
): Promise<Response> {
  const teamId = params.get('team_id') ?? '';
  const slackUserId = params.get('user_id') ?? '';
  const text = (params.get('text') ?? '').trim();
  const channelId = params.get('channel_id') ?? '';
  const triggerId = params.get('trigger_id') ?? '';

  const workspace = await resolveWorkspace(supabase, teamId);
  if (!workspace) {
    return jsonResponse({
      text: 'Overlord is not connected to this workspace.',
      response_type: 'ephemeral'
    });
  }

  if (workspace.restrict_to_owner && slackUserId !== workspace.slack_user_id) {
    return jsonResponse({
      text: 'Only the Overlord workspace owner can use this command.',
      response_type: 'ephemeral'
    });
  }

  if (!text) {
    // Open a modal to capture the objective
    await openModal(workspace.bot_access_token, triggerId, {
      type: 'modal',
      callback_id: 'slack_create_ticket_modal',
      title: { type: 'plain_text', text: 'Create Overlord Ticket' },
      submit: { type: 'plain_text', text: 'Create' },
      close: { type: 'plain_text', text: 'Cancel' },
      private_metadata: JSON.stringify({ channelId }),
      blocks: [
        {
          type: 'input',
          block_id: 'objective_block',
          label: { type: 'plain_text', text: 'Objective' },
          element: {
            type: 'plain_text_input',
            action_id: 'objective_input',
            multiline: true,
            placeholder: { type: 'plain_text', text: 'What needs to be done?' }
          }
        },
        {
          type: 'input',
          block_id: 'project_block',
          label: { type: 'plain_text', text: 'Project (optional)' },
          optional: true,
          element: {
            type: 'external_select',
            action_id: 'select_project',
            placeholder: { type: 'plain_text', text: 'Default project' },
            min_query_length: 0
          }
        }
      ]
    });
    return new Response('', { status: 200 });
  }

  // Text provided inline: create immediately
  const projectId = workspace.default_project_id ?? null;
  const status = await resolveEffectiveStatus(supabase, projectId, workspace.default_status);

  const ticketId = await createTicket({
    supabase,
    userId: workspace.user_id,
    organizationId: workspace.organization_id,
    workspaceId: workspace.id,
    projectId,
    status,
    priority: workspace.default_priority,
    executionTarget: workspace.default_execution_target,
    objective: text,
    context: workspace.include_context ? buildSlackContext({ channelId }) : '',
    channelId,
    threadTs: null
  });

  if (!ticketId) {
    return jsonResponse({
      text: 'Failed to create ticket. Please try again.',
      response_type: 'ephemeral'
    });
  }

  const title = text.length <= 60 ? text : text.slice(0, 60) + '…';
  const webUrl = ticketDeepLink(ticketId);
  return jsonResponse({
    response_type: 'ephemeral',
    text: `✅ Ticket created: ${title}`,
    blocks: buildTicketCreatedBlocks(ticketId, title),
    ...(webUrl ? { replace_original: false } : {})
  });
}

// ---------------------------------------------------------------------------
// Handler: block_actions (button clicks)
// ---------------------------------------------------------------------------

async function handleBlockActions(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>
) {
  const actions = (payload.actions as Array<{ action_id: string; value?: string }>) ?? [];
  const triggerId = payload.trigger_id as string;
  const teamId = (payload.team as { id: string })?.id;
  const slackUserId = (payload.user as { id: string })?.id;

  const workspace = await resolveWorkspace(supabase, teamId);
  if (!workspace) return;

  for (const action of actions) {
    const ticketId = action.value ?? '';

    if (action.action_id === 'slack_edit_objective') {
      // Fetch current objective
      const { data: ticket } = await supabase
        .from('tickets')
        .select('id,title')
        .eq('id', ticketId)
        .maybeSingle();

      const { data: latestObjective } = await supabase
        .from('objectives')
        .select('objective')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      await openModal(workspace.bot_access_token, triggerId, {
        type: 'modal',
        callback_id: 'slack_edit_objective_modal',
        title: { type: 'plain_text', text: 'Edit Objective' },
        submit: { type: 'plain_text', text: 'Save' },
        close: { type: 'plain_text', text: 'Cancel' },
        private_metadata: JSON.stringify({ ticketId }),
        blocks: [
          {
            type: 'input',
            block_id: 'objective_block',
            label: { type: 'plain_text', text: 'Objective' },
            element: {
              type: 'plain_text_input',
              action_id: 'objective_input',
              multiline: true,
              initial_value: latestObjective?.objective ?? ticket?.title ?? ''
            }
          }
        ]
      });
    }

    if (action.action_id === 'slack_change_project') {
      await openModal(workspace.bot_access_token, triggerId, {
        type: 'modal',
        callback_id: 'slack_change_project_modal',
        title: { type: 'plain_text', text: 'Change Project' },
        submit: { type: 'plain_text', text: 'Save' },
        close: { type: 'plain_text', text: 'Cancel' },
        private_metadata: JSON.stringify({ ticketId }),
        blocks: [
          {
            type: 'input',
            block_id: 'project_block',
            label: { type: 'plain_text', text: 'Project' },
            element: {
              type: 'external_select',
              action_id: 'select_project',
              placeholder: { type: 'plain_text', text: 'Select a project' },
              min_query_length: 0
            }
          }
        ]
      });
    }

    if (action.action_id === 'slack_change_status') {
      await openModal(workspace.bot_access_token, triggerId, {
        type: 'modal',
        callback_id: 'slack_change_status_modal',
        title: { type: 'plain_text', text: 'Change Status' },
        submit: { type: 'plain_text', text: 'Save' },
        close: { type: 'plain_text', text: 'Cancel' },
        private_metadata: JSON.stringify({ ticketId }),
        blocks: [
          {
            type: 'input',
            block_id: 'status_block',
            label: { type: 'plain_text', text: 'Status' },
            element: {
              type: 'external_select',
              action_id: 'select_status',
              placeholder: { type: 'plain_text', text: 'Select a status' },
              min_query_length: 0
            }
          }
        ]
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Handler: view_submission (modal submissions)
// ---------------------------------------------------------------------------

async function handleViewSubmission(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>
): Promise<Response> {
  const view = payload.view as Record<string, unknown>;
  const callbackId = view.callback_id as string;
  const teamId = (payload.team as { id: string })?.id;
  const slackUserId = (payload.user as { id: string })?.id;

  const workspace = await resolveWorkspace(supabase, teamId);
  if (!workspace) return new Response('', { status: 200 });

  const stateValues = (view.state as Record<string, unknown>)?.values as Record<
    string,
    Record<string, { value?: string; selected_option?: { value: string } }>
  >;
  const metadata = JSON.parse((view.private_metadata as string) ?? '{}');

  if (callbackId === 'slack_create_ticket_modal') {
    const objective = stateValues?.objective_block?.objective_input?.value?.trim() ?? '';
    const projectId = stateValues?.project_block?.select_project?.selected_option?.value ?? null;

    if (!objective) return new Response('', { status: 200 });

    const effectiveProjectId = projectId ?? workspace.default_project_id ?? null;
    const status = await resolveEffectiveStatus(
      supabase,
      effectiveProjectId,
      workspace.default_status
    );
    const channelId = metadata.channelId ?? '';

    const ticketId = await createTicket({
      supabase,
      userId: workspace.user_id,
      organizationId: workspace.organization_id,
      workspaceId: workspace.id,
      projectId: effectiveProjectId,
      status,
      priority: workspace.default_priority,
      executionTarget: workspace.default_execution_target,
      objective,
      context: workspace.include_context ? buildSlackContext({ channelId }) : '',
      channelId,
      threadTs: null
    });

    if (ticketId && channelId) {
      const title = objective.length <= 60 ? objective : objective.slice(0, 60) + '…';
      await postEphemeral(
        workspace.bot_access_token,
        channelId,
        slackUserId,
        `Ticket created: ${title}`,
        buildTicketCreatedBlocks(ticketId, title)
      );
    }
  }

  if (callbackId === 'slack_edit_objective_modal') {
    const ticketId = metadata.ticketId ?? '';
    const objective = stateValues?.objective_block?.objective_input?.value?.trim() ?? '';
    if (ticketId && objective) {
      await supabase.from('objectives').insert({
        ticket_id: ticketId,
        objective
      });

      const aiTitle = await generateTitle(objective);
      const title = aiTitle ?? (objective.length <= 60 ? objective : objective.slice(0, 60) + '…');
      await supabase.from('tickets').update({ title }).eq('id', ticketId);
    }
  }

  if (callbackId === 'slack_change_project_modal') {
    const ticketId = metadata.ticketId ?? '';
    const projectId = stateValues?.project_block?.select_project?.selected_option?.value ?? null;
    if (ticketId) {
      await supabase.from('tickets').update({ project_id: projectId }).eq('id', ticketId);
    }
  }

  if (callbackId === 'slack_change_status_modal') {
    const ticketId = metadata.ticketId ?? '';
    const status = stateValues?.status_block?.select_status?.selected_option?.value ?? '';
    if (ticketId && status) {
      await supabase.from('tickets').update({ status }).eq('id', ticketId);
    }
  }

  return new Response('', { status: 200 });
}

// ---------------------------------------------------------------------------
// Handler: link_shared (signed deep-link unfurl)
// ---------------------------------------------------------------------------

async function handleLinkShared(
  supabase: ReturnType<typeof createClient>,
  event: Record<string, unknown>,
  teamId: string
) {
  const workspace = await resolveWorkspace(supabase, teamId);
  if (!workspace) return;

  const links = (event.links as Array<{ url: string; domain: string }>) ?? [];
  const channel = event.channel as string;
  const messageTs = event.message_ts as string;

  const unfurls: Record<string, unknown> = {};

  for (const link of links) {
    // Match ticket URLs: /u/<uuid> or /projects/<id>/<uuid>
    const match = link.url.match(/\/u\/([0-9a-f-]{36})|\/projects\/[^/]+\/([0-9a-f-]{36})/);
    const ticketId = match?.[1] ?? match?.[2];
    if (!ticketId) continue;

    const { data: ticket } = await supabase
      .from('tickets')
      .select('id,title,status,assigned_agent,priority,created_at')
      .eq('id', ticketId)
      .maybeSingle();

    if (!ticket) continue;

    const agentJson = ticket.assigned_agent as Record<string, unknown> | null;
    const agentLabel = agentJson?.agent
      ? `${agentJson.agent}${agentJson.model ? ` (${agentJson.model})` : ''}`
      : null;

    unfurls[link.url] = {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*<${link.url}|${ticket.title ?? 'Untitled'}>*\nStatus: *${ticket.status}*${agentLabel ? `  •  Agent: ${agentLabel}` : ''}${ticket.priority ? `  •  Priority: ${ticket.priority}` : ''}`
          }
        }
      ]
    };
  }

  if (Object.keys(unfurls).length > 0) {
    await slackApi('chat.unfurl', workspace.bot_access_token, {
      channel,
      ts: messageTs,
      unfurls
    });
  }
}

// ---------------------------------------------------------------------------
// Utility: resolve effective status (project override > workspace default)
// ---------------------------------------------------------------------------

async function resolveEffectiveStatus(
  supabase: ReturnType<typeof createClient>,
  projectId: string | null,
  workspaceDefault: string
): Promise<string> {
  if (!projectId) return workspaceDefault;
  const { data } = await supabase
    .from('projects')
    .select('slack_default_status')
    .eq('id', projectId)
    .maybeSingle();
  return data?.slack_default_status ?? workspaceDefault;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST' }
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const timestamp = req.headers.get('x-slack-request-timestamp') ?? '';
  const signature = req.headers.get('x-slack-signature') ?? '';

  // Read body as text for signature verification
  const rawBody = await req.text();

  if (SLACK_SIGNING_SECRET) {
    const valid = await verifySlackSignature(SLACK_SIGNING_SECRET, rawBody, timestamp, signature);
    if (!valid) {
      return jsonResponse({ error: 'Invalid signature' }, 401);
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  const contentType = req.headers.get('content-type') ?? '';

  // --- Slash command (application/x-www-form-urlencoded) ---
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(rawBody);
    const command = params.get('command') ?? '';
    if (command === '/overlord') {
      // Slash commands must respond within 3 seconds; handle synchronously
      return await handleSlashCommand(supabase, params);
    }

    // Interactive payload (block_actions, view_submission, message_action)
    const payloadStr = params.get('payload');
    if (payloadStr) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(payloadStr);
      } catch {
        return jsonResponse({ error: 'Invalid payload' }, 400);
      }

      const type = payload.type as string;

      if (type === 'block_actions') {
        // Ack immediately, process async
        EdgeRuntime.waitUntil(
          handleBlockActions(supabase, payload).catch(err =>
            console.error('[slack-events] block_actions error:', err)
          )
        );
        return new Response('', { status: 200 });
      }

      if (type === 'view_submission') {
        return await handleViewSubmission(supabase, payload);
      }

      if (type === 'message_action') {
        // Message shortcut — treat the source message text as the objective
        EdgeRuntime.waitUntil(
          (async () => {
            const teamId = (payload.team as { id: string })?.id;
            const workspace = await resolveWorkspace(supabase, teamId);
            if (!workspace) return;

            const message = payload.message as Record<string, unknown>;
            const channelId = (payload.channel as { id: string })?.id;
            const slackUserId = (payload.user as { id: string })?.id;
            const triggerId = payload.trigger_id as string;

            // Open edit modal pre-filled with the message text
            await openModal(workspace.bot_access_token, triggerId, {
              type: 'modal',
              callback_id: 'slack_create_ticket_modal',
              title: { type: 'plain_text', text: 'Create Overlord Ticket' },
              submit: { type: 'plain_text', text: 'Create' },
              close: { type: 'plain_text', text: 'Cancel' },
              private_metadata: JSON.stringify({ channelId }),
              blocks: [
                {
                  type: 'input',
                  block_id: 'objective_block',
                  label: { type: 'plain_text', text: 'Objective' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'objective_input',
                    multiline: true,
                    initial_value: (message.text as string) ?? ''
                  }
                },
                {
                  type: 'input',
                  block_id: 'project_block',
                  label: { type: 'plain_text', text: 'Project (optional)' },
                  optional: true,
                  element: {
                    type: 'external_select',
                    action_id: 'select_project',
                    placeholder: { type: 'plain_text', text: 'Default project' },
                    min_query_length: 0
                  }
                }
              ]
            });
          })().catch(err => console.error('[slack-events] message_action error:', err))
        );
        return new Response('', { status: 200 });
      }
    }

    return new Response('', { status: 200 });
  }

  // --- Events API (application/json) ---
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  // URL verification challenge
  if (body.type === 'url_verification') {
    return jsonResponse({ challenge: body.challenge });
  }

  if (body.type === 'event_callback') {
    const event = body.event as Record<string, unknown>;
    const eventId = body.event_id as string;
    const teamId = body.team_id as string;

    // Deduplicate (Slack retries on non-200)
    if (eventId) {
      const isNew = await dedupeEvent(supabase, eventId);
      if (!isNew) return new Response('', { status: 200 });
    }

    // Ack immediately; process async within the edge function lifetime
    EdgeRuntime.waitUntil(
      (async () => {
        const eventType = event.type as string;

        if (eventType === 'app_mention') {
          await handleAppMention(supabase, event, teamId);
        } else if (eventType === 'message' && event.channel_type === 'im') {
          await handleDirectMessage(supabase, event, teamId);
        } else if (eventType === 'link_shared') {
          await handleLinkShared(supabase, event, teamId);
        }
      })().catch(err => console.error('[slack-events] event error:', err))
    );
  }

  return new Response('', { status: 200 });
});

// Extend Deno global with EdgeRuntime (Supabase-specific)
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };
