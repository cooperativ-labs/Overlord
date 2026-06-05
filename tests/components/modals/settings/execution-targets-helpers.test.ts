import { removeOrganizationFromOwnership } from '@/components/modals/settings/execution-targets/execution-targets-helpers';
import type { ExecutionTargetOwnership } from '@/lib/actions/resource-directories';

const ownership: ExecutionTargetOwnership = {
  targetId: 'target-1',
  label: 'local-target',
  hostname: 'local.test',
  organizations: [
    {
      organizationId: 1,
      organizationName: 'First organization',
      ownerUserId: null,
      isOrgOwned: true,
      isOwnedByMe: false,
      isAdmin: true,
      canClaim: true,
      canMakeOrgOwned: false
    },
    {
      organizationId: 2,
      organizationName: 'Second organization',
      ownerUserId: 'user-1',
      isOrgOwned: false,
      isOwnedByMe: true,
      isAdmin: true,
      canClaim: false,
      canMakeOrgOwned: true
    }
  ]
};

describe('removeOrganizationFromOwnership', () => {
  it('keeps a shared target with its remaining organization association', () => {
    expect(removeOrganizationFromOwnership(ownership, 1)).toEqual({
      ...ownership,
      organizations: [ownership.organizations[1]]
    });
  });

  it('returns null when the target has no organization associations left', () => {
    expect(
      removeOrganizationFromOwnership(
        { ...ownership, organizations: [ownership.organizations[0]] },
        1
      )
    ).toBeNull();
  });
});
