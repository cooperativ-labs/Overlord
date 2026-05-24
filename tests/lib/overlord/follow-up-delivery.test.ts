import { hasMeaningfulFollowUpWorkSignal } from '@/lib/overlord/follow-up-delivery';

describe('hasMeaningfulFollowUpWorkSignal', () => {
  it('does not treat the explicit reopen transition as deliverable work', () => {
    expect(
      hasMeaningfulFollowUpWorkSignal({
        beginFollowUpWork: true,
        eventType: 'update',
        followUpIntent: 'execution',
        phase: 'execute'
      })
    ).toBe(false);
  });

  it('treats rationale rows and git snapshots as deliverable follow-up work', () => {
    expect(
      hasMeaningfulFollowUpWorkSignal({
        changeRationales: [{ file_path: 'app.ts' }],
        phase: 'execute'
      })
    ).toBe(true);
    expect(
      hasMeaningfulFollowUpWorkSignal({
        snapshot: { gitCommitId: 'abc123' },
        phase: 'execute'
      })
    ).toBe(true);
  });

  it('keeps discussion and decision events out of the redelivery lifecycle', () => {
    expect(
      hasMeaningfulFollowUpWorkSignal({
        eventType: 'decision',
        followUpIntent: 'discussion',
        phase: 'review'
      })
    ).toBe(false);
  });

  it('treats execution progress and explicit pending intent as work signals', () => {
    expect(
      hasMeaningfulFollowUpWorkSignal({
        eventType: 'update',
        followUpIntent: 'execution',
        phase: 'execute'
      })
    ).toBe(true);
    expect(hasMeaningfulFollowUpWorkSignal({ followUpIntent: 'pending_delivery' })).toBe(true);
  });
});
