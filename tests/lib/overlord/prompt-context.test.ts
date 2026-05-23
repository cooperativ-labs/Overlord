import { buildPromptContextSections } from '@/lib/overlord/prompt-context';

describe('buildPromptContextSections', () => {
  it('includes the current objective ID in task metadata when available', () => {
    const sections = buildPromptContextSections({
      ticket: {
        id: '1:1198',
        title: 'Add objective ID to agent prompt',
        objective: 'Update the prompt header metadata.',
        objective_id: 'objective-123',
        acceptance_criteria: null,
        available_tools: null,
        execution_target: 'agent',
        project_id: 'project-456',
        status: 'next-up',
        priority: 'medium'
      }
    });

    expect(sections.task).toContain('- **Ticket ID:** 1:1198');
    expect(sections.task).toContain('- **Objective ID:** objective-123');
  });

  it('omits the objective ID metadata line when no current objective is resolved', () => {
    const sections = buildPromptContextSections({
      ticket: {
        id: '1:1198',
        title: 'Add objective ID to agent prompt',
        objective: 'Update the prompt header metadata.',
        acceptance_criteria: null,
        available_tools: null,
        execution_target: 'agent',
        project_id: 'project-456',
        status: 'next-up',
        priority: 'medium'
      }
    });

    expect(sections.task).not.toContain('**Objective ID:**');
  });
});
