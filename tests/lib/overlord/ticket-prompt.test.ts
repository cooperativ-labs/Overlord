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
    expect(prompt).toContain('`overlord-ticket-workflow` skill');
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
