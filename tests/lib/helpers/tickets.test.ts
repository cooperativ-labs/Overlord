import {
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
