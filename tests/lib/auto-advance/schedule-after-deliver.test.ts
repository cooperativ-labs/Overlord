import { selectQueuedObjectiveSource } from '@/lib/auto-advance/schedule-after-deliver';

describe('selectQueuedObjectiveSource', () => {
  it('prefers a non-empty draft over a future objective', () => {
    expect(
      selectQueuedObjectiveSource({
        draftObjective: 'Implement API',
        futureObjective: 'Write docs'
      })
    ).toBe('draft');
  });

  it('falls back to future when draft is empty', () => {
    expect(
      selectQueuedObjectiveSource({
        draftObjective: '   ',
        futureObjective: 'Write docs'
      })
    ).toBe('future');
  });

  it('returns null when neither queue row has content', () => {
    expect(
      selectQueuedObjectiveSource({
        draftObjective: '',
        futureObjective: null
      })
    ).toBeNull();
  });
});
