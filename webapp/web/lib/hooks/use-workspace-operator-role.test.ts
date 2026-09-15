import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { WorkspaceMemberDto } from '../../../shared/contract.ts';

import { resolveWorkspaceOperatorRole } from './use-workspace-operator-role.ts';

function member(fields: Partial<WorkspaceMemberDto>): WorkspaceMemberDto {
  return { isOperator: false, isAdmin: false, roleKeys: [], ...fields } as WorkspaceMemberDto;
}

test('resolveWorkspaceOperatorRole reports no operator and non-admin while members are unloaded', () => {
  assert.deepEqual(resolveWorkspaceOperatorRole(undefined), {
    operator: undefined,
    isAdmin: false
  });
});

test('resolveWorkspaceOperatorRole ignores admin rows that are not the operator', () => {
  const rows = [member({ isAdmin: true }), member({ isOperator: true })];
  assert.deepEqual(resolveWorkspaceOperatorRole(rows), { operator: rows[1], isAdmin: false });
});

test('resolveWorkspaceOperatorRole reports admin when the operator row is an admin', () => {
  const rows = [member({}), member({ isOperator: true, isAdmin: true })];
  assert.deepEqual(resolveWorkspaceOperatorRole(rows), { operator: rows[1], isAdmin: true });
});
