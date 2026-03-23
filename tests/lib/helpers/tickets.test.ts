import { deriveTitleFromObjective, getDisplayTitle } from '@/lib/helpers/tickets';

describe('ticket title helpers', () => {
  it('collapses file mentions to filenames when deriving a title', () => {
    expect(
      deriveTitleFromObjective(
        'Update @app/(app)/tickets/(components)/BlankTicketCard.tsx to improve title generation'
      )
    ).toBe('Update @BlankTicketCard.tsx to improve title generation');
  });

  it('collapses file mentions when falling back to the objective for display', () => {
    expect(
      getDisplayTitle({
        objective: 'Fix @components/features/TicketPanelLive.tsx and review edge cases'
      })
    ).toBe('Fix @TicketPanelLive.tsx and review edge cases');
  });

  it('keeps non-file mentions unchanged', () => {
    expect(deriveTitleFromObjective('Follow up with @jake about ticket sequencing')).toBe(
      'Follow up with @jake about ticket sequencing'
    );
  });
});
