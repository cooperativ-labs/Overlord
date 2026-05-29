import {
  buildTicketTitleObjectiveInput,
  deriveTitleFromObjective,
  getDisplayTitle,
  hasNonEmptyObjectiveText,
  isDraftObjectiveWithText
} from '@/lib/helpers/tickets';

describe('ticket title helpers', () => {
  it('collapses file mentions to filenames when deriving a title', () => {
    expect(
      deriveTitleFromObjective(
        'Update @apps/web/app/(app)/tickets/(components)/BlankTicketCard.tsx to improve title generation'
      )
    ).toBe('Update @BlankTicketCard.tsx to improve title generation');
  });

  it('keeps the full filename when route segments contain brackets', () => {
    expect(
      deriveTitleFromObjective(
        'Fix @apps/web/app/[organizationId]/tickets/[ticketId]/page.tsx loading'
      )
    ).toBe('Fix @page.tsx loading');
  });

  it('returns the title when set', () => {
    expect(getDisplayTitle({ title: 'Fix edge cases' })).toBe('Fix edge cases');
  });

  it('returns Untitled when no title is set', () => {
    expect(getDisplayTitle({})).toBe('Untitled');
  });

  it('keeps non-file mentions unchanged', () => {
    expect(deriveTitleFromObjective('Follow up with @jake about ticket sequencing')).toBe(
      'Follow up with @jake about ticket sequencing'
    );
  });

  it('builds title context from every objective regardless of state', () => {
    expect(
      buildTicketTitleObjectiveInput([
        {
          objective: 'Final polish after implementation',
          position: 2,
          created_at: '2026-01-03T00:00:00Z'
        },
        {
          objective: 'Plan the ticket title generation flow',
          position: 0,
          created_at: '2026-01-01T00:00:00Z'
        },
        {
          objective: 'Implement multi-objective title summaries',
          position: 1,
          created_at: '2026-01-02T00:00:00Z'
        }
      ])
    ).toBe(
      [
        '1. Plan the ticket title generation flow',
        '2. Implement multi-objective title summaries',
        '3. Final polish after implementation'
      ].join('\n')
    );
  });

  it('falls back to context only when no objective text exists', () => {
    expect(buildTicketTitleObjectiveInput([{ objective: '   ', position: 0 }], 'Fallback')).toBe(
      'Fallback'
    );
  });
});

describe('draft objective helpers', () => {
  it('treats whitespace-only objective text as empty', () => {
    expect(hasNonEmptyObjectiveText('   ')).toBe(false);
    expect(hasNonEmptyObjectiveText(null)).toBe(false);
    expect(hasNonEmptyObjectiveText('Ship it')).toBe(true);
  });

  it('detects draft objectives with non-empty text', () => {
    expect(isDraftObjectiveWithText({ state: 'draft', objective: 'Next step' })).toBe(true);
    expect(isDraftObjectiveWithText({ state: 'draft', objective: '   ' })).toBe(false);
    expect(isDraftObjectiveWithText({ state: 'submitted', objective: 'Next step' })).toBe(false);
  });
});
