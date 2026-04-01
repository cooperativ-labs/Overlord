import { deriveTitleFromObjective, getDisplayTitle } from '@/lib/helpers/tickets';

describe('ticket title helpers', () => {
  it('collapses file mentions to filenames when deriving a title', () => {
    expect(
      deriveTitleFromObjective(
        'Update @apps/web/app/(app)/tickets/(components)/BlankTicketCard.tsx to improve title generation'
      )
    ).toBe('Update @BlankTicketCard.tsx to improve title generation');
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
