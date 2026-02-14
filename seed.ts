import { createSeedClient } from '@snaplet/seed';

const PRECOMPUTED_BCRYPT: Record<string, string> = {
  'bqz2bme.edk5dtz8JBW': '$2a$10$Ak5xAbjO2ZkpsgwBqKwsxOWQcnc2XDyCVZ4WN9Dh0GukXjO5PmAm6',
  '12345678*': '$2a$10$5PKcdoG22k185KtjOhfxfO9E6oH11W01yBlhhElM7hzur0oNkVhH.'
};

const hash = async (password: string, _rounds: number): Promise<string> => {
  const hashed = PRECOMPUTED_BCRYPT[password];
  if (!hashed) {
    throw new Error(`Missing precomputed bcrypt hash for password: ${password}`);
  }

  return hashed;
};

async function main() {
  const seed = await createSeedClient({ dryRun: true });

  // Clear existing data
  await seed.$resetDatabase();

  const jakePassword = 'bqz2bme.edk5dtz8JBW';
  const plainPassword = '12345678*';
  const jakeHashedPassword = await hash(jakePassword, 10);
  const plainHashedPassword = await hash(plainPassword, 10);

  const now = new Date();

  const userIds = {
    jake: '11111111-1111-4111-8111-111111111111',
    sara: '22222222-2222-4222-8222-222222222222',
    alex: '33333333-3333-4333-8333-333333333333'
  } as const;

  const ticketIds = {
    attachFlow: '44444444-4444-4444-8444-444444444441',
    overlapAlerts: '44444444-4444-4444-8444-444444444442',
    openInLinks: '44444444-4444-4444-8444-444444444443',
    mobileInbox: '44444444-4444-4444-8444-444444444444'
  } as const;

  const agentSessionIds = {
    attachFlow: '55555555-5555-4555-8555-555555555551',
    overlapAlerts: '55555555-5555-4555-8555-555555555552',
    openInLinks: '55555555-5555-4555-8555-555555555553'
  } as const;

  const organizationId = 1; // Jake's org (created by trigger on first user insert)

  // --- Generate users (auth.users) ---
  // Insert Jake first so trigger creates org 1; Sara and Alex get their own orgs (2, 3)
  const fixedUsers = await seed.users([
    {
      instance_id: '00000000-0000-0000-0000-000000000000',
      id: userIds.jake,
      email: 'jake@c.com',
      encrypted_password: jakeHashedPassword,
      role: 'authenticated',
      aud: 'authenticated',
      is_super_admin: false,
      raw_app_meta_data: { provider: 'email', providers: ['email'] },
      raw_user_meta_data: {
        name: 'Jake',
        email: 'jake@c.com',
        username: 'jchaselubitz'
      }
    }
  ]);

  await seed.users([
    {
      instance_id: '00000000-0000-0000-0000-000000000000',
      id: userIds.sara,
      email: 'sara@c.com',
      encrypted_password: plainHashedPassword,
      role: 'authenticated',
      aud: 'authenticated',
      is_super_admin: false,
      email_confirmed_at: now,
      created_at: now,
      updated_at: now,
      raw_app_meta_data: { provider: 'email', providers: ['email'] },
      raw_user_meta_data: {
        name: 'Sara',
        email: 'sara@c.com',
        username: 'sara-pm'
      }
    },
    {
      instance_id: '00000000-0000-0000-0000-000000000000',
      id: userIds.alex,
      email: 'alex@c.com',
      encrypted_password: plainHashedPassword,
      role: 'authenticated',
      aud: 'authenticated',
      is_super_admin: false,
      email_confirmed_at: now,
      created_at: now,
      updated_at: now,
      raw_app_meta_data: { provider: 'email', providers: ['email'] },
      raw_user_meta_data: {
        name: 'Alex',
        email: 'alex@c.com',
        username: 'alex-agent-ops'
      }
    }
  ]);

  // Add Sara and Alex to Jake's org so they can access tickets
  await seed.members([
    { organization_id: organizationId, user_id: userIds.sara, role: 'AGENT' },
    { organization_id: organizationId, user_id: userIds.alex, role: 'AGENT' }
  ]);

  await seed.tickets([
    {
      id: ticketIds.attachFlow,
      organization_id: organizationId,
      title: 'Implement protocol attach flow',
      objective:
        'Create endpoint flow so Claude Code and ChatGPT can attach to tickets and retrieve structured context.',
      context:
        'MVP focuses on protocol calls and deterministic event logs. Reuse shared state and ticket events for auditability.',
      constraints: 'No hidden state in clients. Every significant step writes to ticket_events.',
      available_tools: 'REST API, MCP server, Supabase SQL, Next.js app router',
      acceptance_criteria:
        'attach returns ticket spec + history + relevant shared state and creates/updates agent session heartbeat.',
      output_format: 'API handlers, tests, and a short implementation summary artifact.',
      assigned_agent: 'Claude Code',
      priority: 'high',
      status: 'execute',
      board_position: 1,
      created_by: userIds.jake,
      created_at: now,
      updated_at: now
    },
    {
      id: ticketIds.overlapAlerts,
      organization_id: organizationId,
      title: 'Build overlap detection alerts',
      objective:
        'Implement shared-state overlap checks and alert events when active tickets collide on modules or tags.',
      context:
        'Use shared_state as deterministic MVP source of truth before coordinator LLM and embeddings in V2.',
      constraints: 'Human PM remains in decision loop for all conflicts in MVP.',
      available_tools: 'Supabase SQL, edge function triggers, ticket events',
      acceptance_criteria:
        'System emits blocking alert event and exposes candidate conflicting ticket IDs and overlap reason.',
      output_format: 'SQL + server action + examples in docs/overlap-detection.md',
      assigned_agent: 'ChatGPT Agent',
      priority: 'urgent',
      status: 'review',
      board_position: 0,
      created_by: userIds.sara,
      created_at: now,
      updated_at: now
    },
    {
      id: ticketIds.openInLinks,
      organization_id: organizationId,
      title: 'Add Open in menu deep-link handlers',
      objective:
        'Provide platform-specific Open in links for Claude, ChatGPT, Terminal, and Cursor from ticket detail.',
      context:
        'Support lightweight attach command handoff while preserving ticket-scoped context retrieval.',
      constraints: 'No platform SDK lock-in; use URL patterns and clipboard fallback.',
      available_tools: 'Next.js UI, browser APIs, protocol routes',
      acceptance_criteria:
        'PM can launch or copy attach flows from a single menu with clear state indicators.',
      output_format: 'UI component, integration notes, and analytics events.',
      assigned_agent: 'Claude App',
      priority: 'medium',
      status: 'complete',
      board_position: 0,
      created_by: userIds.jake,
      created_at: now,
      updated_at: now
    },
    {
      id: ticketIds.mobileInbox,
      organization_id: organizationId,
      title: 'Mobile-first PM inbox layout',
      objective:
        'Design ticket conversation list that surfaces blocked agents and pending PM questions first.',
      context: 'Direct-message first UX with ticket thumbnail, phase chip, and last event preview.',
      constraints: 'Must keep parity with desktop filters and status transitions.',
      available_tools: 'Next.js, Tailwind, Supabase realtime',
      acceptance_criteria:
        'Inbox list is responsive and preserves ticket context isolation and quick actions.',
      output_format: 'Responsive page and component set with accessibility checks.',
      assigned_agent: 'Cursor',
      priority: 'high',
      status: 'blocked',
      board_position: 0,
      created_by: userIds.alex,
      created_at: now,
      updated_at: now
    }
  ]);

  await seed.agent_sessions([
    {
      id: agentSessionIds.attachFlow,
      ticket_id: ticketIds.attachFlow,
      agent_identifier: 'claude-code-local-1',
      connection_method: 'claude_code',
      session_state: 'attached',
      session_key: '88888888-8888-4888-8888-888888888881',
      metadata: {
        transport: 'cli-mcp-bridge',
        runtime: 'claude-code',
        model: 'claude'
      },
      heartbeat_at: now,
      attached_at: now,
      detached_at: null,
      created_at: now,
      updated_at: now
    },
    {
      id: agentSessionIds.overlapAlerts,
      ticket_id: ticketIds.overlapAlerts,
      agent_identifier: 'chatgpt-custom-gpt-2',
      connection_method: 'chatgpt',
      session_state: 'idle',
      session_key: '88888888-8888-4888-8888-888888888882',
      metadata: {
        transport: 'rest',
        runtime: 'chatgpt',
        model: 'gpt'
      },
      heartbeat_at: now,
      attached_at: now,
      detached_at: null,
      created_at: now,
      updated_at: now
    },
    {
      id: agentSessionIds.openInLinks,
      ticket_id: ticketIds.openInLinks,
      agent_identifier: 'claude-desktop-7',
      connection_method: 'claude_app',
      session_state: 'completed',
      session_key: '88888888-8888-4888-8888-888888888883',
      metadata: {
        transport: 'mcp-cloud',
        runtime: 'claude-desktop'
      },
      heartbeat_at: now,
      attached_at: now,
      detached_at: now,
      created_at: now,
      updated_at: now
    }
  ]);

  await seed.ticket_events([
    {
      id: '99999999-9999-4999-8999-999999999991',
      ticket_id: ticketIds.attachFlow,
      session_id: agentSessionIds.attachFlow,
      event_type: 'status_change',
      phase: 'execute',
      summary: 'Ticket moved into execution after clarification confidence threshold reached.',
      payload: {
        from: 'review',
        to: 'execute',
        confidence: 0.92
      },
      is_blocking: false,
      created_at: now
    },
    {
      id: '99999999-9999-4999-8999-999999999992',
      ticket_id: ticketIds.overlapAlerts,
      session_id: agentSessionIds.overlapAlerts,
      event_type: 'question',
      phase: 'review',
      summary: 'Should overlap alerts auto-open a group conversation or require PM confirmation?',
      payload: {
        options: ['auto-open', 'pm-confirmation'],
        default: 'pm-confirmation'
      },
      is_blocking: true,
      created_at: now
    },
    {
      id: '99999999-9999-4999-8999-999999999993',
      ticket_id: ticketIds.openInLinks,
      session_id: agentSessionIds.openInLinks,
      event_type: 'deliver',
      phase: 'review',
      summary: 'Open in menu prototype delivered with per-platform fallbacks.',
      payload: {
        platforms: ['claude', 'chatgpt', 'terminal', 'cursor'],
        includesClipboardFallback: true
      },
      is_blocking: false,
      created_at: now
    },
    {
      id: '99999999-9999-4999-8999-999999999994',
      ticket_id: ticketIds.mobileInbox,
      session_id: null,
      event_type: 'alert',
      phase: 'blocked',
      summary: 'Blocked on design direction for grouped multi-agent messages on mobile.',
      payload: {
        dependency: 'group-thread-ux-decision',
        requestedFrom: 'pm'
      },
      is_blocking: true,
      created_at: now
    }
  ]);

  await seed.shared_state([
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      ticket_id: ticketIds.attachFlow,
      session_id: agentSessionIds.attachFlow,
      state_key: 'attach_contract.v1',
      state_value: {
        operations: ['attach', 'ask', 'update', 'read_context', 'write_context', 'deliver'],
        requiresHeartbeat: true
      },
      tags: ['protocol', 'mvp', 'contract'],
      source: 'agent',
      created_at: now
    },
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      ticket_id: ticketIds.overlapAlerts,
      session_id: agentSessionIds.overlapAlerts,
      state_key: 'working_domains',
      state_value: {
        modules: ['auth', 'tickets', 'shared_state'],
        files: ['app/api/protocol/overlap/route.ts']
      },
      tags: ['overlap', 'collision-detection'],
      source: 'agent',
      created_at: now
    },
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      ticket_id: ticketIds.openInLinks,
      session_id: agentSessionIds.openInLinks,
      state_key: 'deep_link_matrix',
      state_value: {
        claude: 'copy+open',
        chatgpt: 'custom-gpt-deep-link',
        terminal: 'agentdesk-url-scheme',
        cursor: 'ide-url-scheme'
      },
      tags: ['deep-links', 'ux'],
      source: 'agent',
      created_at: now
    }
  ]);

  await seed.artifacts([
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      ticket_id: ticketIds.openInLinks,
      event_id: '99999999-9999-4999-8999-999999999993',
      session_id: agentSessionIds.openInLinks,
      artifact_type: 'summary',
      label: 'Open in menu implementation notes',
      uri: 'docs/open-in-menu.md',
      content:
        'Implemented platform-specific launch actions with graceful fallback to copied attach command.',
      metadata: {
        format: 'markdown',
        status: 'draft'
      },
      created_at: now
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      ticket_id: ticketIds.attachFlow,
      event_id: '99999999-9999-4999-8999-999999999991',
      session_id: agentSessionIds.attachFlow,
      artifact_type: 'diff',
      label: 'Attach flow route handlers',
      uri: 'app/api/protocol/attach/route.ts',
      content: null,
      metadata: {
        linesChanged: 124,
        includesTests: true
      },
      created_at: now
    }
  ]);

  await seed.connections([
    {
      id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      owner_id: userIds.jake,
      provider: 'claude',
      display_name: 'Claude Desktop MCP',
      config: {
        method: 'mcp',
        endpoint: 'https://agentdesk.example.com/mcp',
        supportsDeepLink: false
      },
      is_default: true,
      created_at: now,
      updated_at: now
    },
    {
      id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
      owner_id: userIds.jake,
      provider: 'chatgpt',
      display_name: 'AgentDesk Custom GPT',
      config: {
        method: 'rest',
        deepLinkTemplate: 'https://chat.openai.com/g/agentdesk-agent?q=attach+{ticket_number}'
      },
      is_default: false,
      created_at: now,
      updated_at: now
    },
    {
      id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
      owner_id: userIds.sara,
      provider: 'terminal',
      display_name: 'Local CLI Bridge',
      config: {
        method: 'cli',
        command: 'agentdesk attach {ticket_number}'
      },
      is_default: true,
      created_at: now,
      updated_at: now
    }
  ]);

  // Keep the reference so this section remains explicit in the seed output flow.
  void fixedUsers;

  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
