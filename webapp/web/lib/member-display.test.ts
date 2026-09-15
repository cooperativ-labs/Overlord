import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { WorkspaceMemberDto } from '../../shared/contract.ts';

import { memberInitials, memberLabel } from './member-display.ts';

function member(fields: Partial<WorkspaceMemberDto>): WorkspaceMemberDto {
  return fields as WorkspaceMemberDto;
}

test('memberLabel follows the shared display name, handle, email, member fallback order', () => {
  assert.equal(
    memberLabel(
      member({ displayName: '  Ada Lovelace  ', handle: 'ada', email: 'ada@example.com' })
    ),
    'Ada Lovelace'
  );
  assert.equal(
    memberLabel(member({ displayName: ' ', handle: 'ada', email: 'ada@example.com' })),
    'ada'
  );
  assert.equal(memberLabel(member({ handle: null, email: 'ada@example.com' })), 'ada@example.com');
  assert.equal(memberLabel(member({ handle: null, email: null })), 'Member');
});

test('memberInitials derive from the shared member label', () => {
  assert.equal(memberInitials(member({ handle: 'ada', email: 'ada@example.com' })), 'AD');
});
