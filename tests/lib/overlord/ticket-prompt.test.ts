import { resolveAgentCapabilities } from '@/lib/overlord/agent-capabilities';
import { buildTicketPromptMarkdown } from '@/lib/overlord/ticket-prompt';

describe('Codex bundle prompt routing', () => {
  it('treats Codex as bundle-capable when the plugin is installed', () => {
    expect(resolveAgentCapabilities('codex', true)).toEqual({
      agent: 'codex',
      instructionMode: 'bundle',
      hasPermissionHook: false
    });
  });

  it('describes local auth env vars as optional overrides for non-desktop runs', () => {
    const prompt = buildTicketPromptMarkdown({
      ticket: {
        id: 'ticket-123',
        title: 'Investigate auth prompt',
        objective: 'Verify auth instructions',
        acceptance_criteria: null,
        available_tools: null,
        constraints: null,
        output_format: null,
        execution_target: 'agent',
        project_id: 'project-123',
        status: 'draft',
        priority: 'medium'
      },
      platformUrl: 'http://localhost:3000',
      context: 'cli',
      options: {
        agent: 'codex',
        instructionMode: 'bundle'
      }
    });

    expect(prompt).toContain('reads shared credentials from `ovld auth login` or Overlord Desktop');
    expect(prompt).toContain('Export env vars only when overriding stored credentials');
    expect(prompt).not.toContain('If those environment variables are not already set, export');
  });

  it('keeps desktop launch wording focused on ovld protocol instead of raw credentials', () => {
    const prompt = buildTicketPromptMarkdown({
      ticket: {
        id: 'ticket-123',
        title: 'Investigate desktop prompt',
        objective: 'Verify desktop instructions',
        acceptance_criteria: null,
        available_tools: null,
        constraints: null,
        output_format: null,
        execution_target: 'agent',
        project_id: 'project-123',
        status: 'draft',
        priority: 'medium'
      },
      platformUrl: 'http://localhost:3000',
      context: 'electron',
      options: {
        agent: 'codex',
        instructionMode: 'bundle'
      }
    });

    expect(prompt).toContain('This terminal already has the needed Overlord environment');
    expect(prompt).toContain('Use `ovld protocol ...` commands');
    expect(prompt).not.toContain('already has `OVERLORD_URL`, `AGENT_TOKEN`, and `TICKET_ID` set');
  });

  it('uses the minimal Codex plugin protocol instructions for Codex bundle launches', () => {
    const prompt = buildTicketPromptMarkdown({
      ticket: {
        id: 'ticket-123',
        title: 'Investigate launcher regression',
        objective: 'Fix the Codex launcher prompt selection',
        acceptance_criteria: null,
        available_tools: null,
        constraints: null,
        output_format: null,
        execution_target: 'agent',
        project_id: 'project-123',
        status: 'draft',
        priority: 'medium'
      },
      platformUrl: 'http://localhost:3000',
      context: 'cli',
      options: {
        agent: 'codex',
        instructionMode: 'bundle'
      }
    });

    expect(prompt).toContain('Use the installed Overlord Codex plugin');
    expect(prompt).toContain('`overlord-ticket` skill');
    expect(prompt).not.toContain('### Codex local workflow');
    expect(prompt).not.toContain('look for and invoke the overlord-local skill');
  });

  it('uses the minimal Codex plugin protocol instructions for Codex bundle discussions', () => {
    const prompt = buildTicketPromptMarkdown({
      ticket: {
        id: 'ticket-123',
        title: 'Investigate launcher regression',
        objective: 'Discuss the Codex launcher prompt selection',
        acceptance_criteria: null,
        available_tools: null,
        constraints: null,
        output_format: null,
        execution_target: 'agent',
        project_id: 'project-123',
        status: 'draft',
        priority: 'medium'
      },
      platformUrl: 'http://localhost:3000',
      context: 'cli',
      options: {
        agent: 'codex',
        instructionMode: 'bundle',
        launchMode: 'ask'
      }
    });

    expect(prompt).toContain('Use the installed Overlord Codex plugin');
    expect(prompt).toContain('This is Ask mode: discuss the ticket');
    expect(prompt).not.toContain('### Codex local workflow');
    expect(prompt).not.toContain('Where the stdin payload contains');
  });
});

describe('Cursor bundled prompt routing', () => {
  const baseTicket = {
    id: 'ticket-cursor-1',
    title: 'Cursor connector',
    objective: 'Verify bundled prompt text',
    acceptance_criteria: null,
    available_tools: null,
    constraints: null,
    output_format: null,
    execution_target: 'agent' as const,
    project_id: 'project-123',
    status: 'draft',
    priority: 'medium' as const
  };

  it('uses Cursor-specific workflow instructions for Cursor bundle launches', () => {
    const prompt = buildTicketPromptMarkdown({
      ticket: baseTicket,
      platformUrl: 'http://localhost:3000',
      context: 'cli',
      options: {
        agent: 'cursor',
        instructionMode: 'bundle'
      }
    });

    expect(prompt).toContain('Overlord Cursor plugin');
    expect(prompt).not.toContain('Overlord Claude plugin');
    expect(prompt).not.toContain('overlord:overlord-ticket');
  });
});

describe('Antigravity bundled prompt routing', () => {
  it('uses Antigravity-specific workflow instructions for Antigravity bundle launches', () => {
    const prompt = buildTicketPromptMarkdown({
      ticket: {
        id: 'ticket-ag-1',
        title: 'Antigravity bundle',
        objective: 'Verify bundled prompt text',
        acceptance_criteria: null,
        available_tools: null,
        constraints: null,
        output_format: null,
        execution_target: 'agent',
        project_id: 'project-123',
        status: 'draft',
        priority: 'medium'
      },
      platformUrl: 'http://localhost:3000',
      context: 'cli',
      options: {
        agent: 'antigravity',
        instructionMode: 'bundle'
      }
    });

    expect(prompt).toContain('Overlord Antigravity plugin');
    expect(prompt).toContain('`overlord-ticket` skill');
    expect(prompt).toContain('UserPromptSubmit');
    expect(prompt).not.toContain('### 1 — Attach (always first)');
    expect(prompt).not.toContain('Overlord Claude plugin');
  });

  it('requires explicit user_follow_up in legacy Antigravity launches when hooks are absent', () => {
    const prompt = buildTicketPromptMarkdown({
      ticket: {
        id: 'ticket-ag-2',
        title: 'Antigravity legacy',
        objective: 'Verify legacy prompt text',
        acceptance_criteria: null,
        available_tools: null,
        constraints: null,
        output_format: null,
        execution_target: 'agent',
        project_id: 'project-123',
        status: 'draft',
        priority: 'medium'
      },
      platformUrl: 'http://localhost:3000',
      context: 'cli',
      options: {
        agent: 'antigravity',
        instructionMode: 'legacy'
      }
    });

    expect(prompt).toContain('### 1 — Attach (always first)');
    expect(prompt).toContain('user_follow_up');
    expect(prompt).toContain('ovld restart antigravity');
  });
});

describe('OpenCode bundled prompt routing', () => {
  it('uses OpenCode-specific workflow instructions for OpenCode bundle launches', () => {
    const prompt = buildTicketPromptMarkdown({
      ticket: {
        id: 'ticket-oc-1',
        title: 'OpenCode bundle',
        objective: 'Verify bundled prompt text',
        acceptance_criteria: null,
        available_tools: null,
        constraints: null,
        output_format: null,
        execution_target: 'agent',
        project_id: 'project-123',
        status: 'draft',
        priority: 'medium'
      },
      platformUrl: 'http://localhost:3000',
      context: 'cli',
      options: {
        agent: 'opencode',
        instructionMode: 'bundle'
      }
    });

    expect(prompt).toContain('OpenCode bundle');
    expect(prompt).not.toContain('Overlord Claude plugin');
    expect(prompt).not.toContain('overlord:overlord-ticket');
  });
});
