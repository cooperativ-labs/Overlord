import { deliverSchema } from '@/lib/overlord/validation';

describe('change rationale provenance validation', () => {
  it('preserves optional jj and workspace fields on each rationale', () => {
    const parsed = deliverSchema.parse({
      sessionKey: 'a79cdc10-8c45-489c-a627-678d089bdca7',
      ticketId: '1:991',
      summary: 'Delivered.',
      changeRationales: [
        {
          label: 'Fix',
          file_path: 'lib/x.ts',
          summary: 'Summary',
          why: 'Why',
          impact: 'Impact',
          hunks: [{ header: '@@ -1 +1 @@' }],
          jj_change_id: 'k' + 'x'.repeat(159),
          jj_commit_id: 'm' + 'y'.repeat(159),
          jj_operation_id: 'o' + 'z'.repeat(159),
          snapshot_backend: 'jj',
          workspace_name: 'ovld-test',
          workspace_path: '/tmp/ws'
        }
      ]
    });

    expect(parsed.changeRationales[0].jj_change_id?.startsWith('k')).toBe(true);
    expect(parsed.changeRationales[0].snapshot_backend).toBe('jj');
    expect(parsed.changeRationales[0].workspace_path).toBe('/tmp/ws');
  });
});
