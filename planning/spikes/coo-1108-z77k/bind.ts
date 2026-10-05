/* eslint-disable no-console -- acceptance harness */
// coo:1108.z77k — records the registered targets and binds resources to directories.
// Usage: ACCEPTANCE_WORK_DIR=<scratch> node --import tsx planning/spikes/coo-1108-z77k/bind.ts <t1 id> <t2 id>
import { bindResource, CHECKOUTS } from './bootstrap.ts';
import { closeDb, loadState, rows, saveState } from './lib.ts';

const state = loadState();
const [t1, t2] = process.argv.slice(2);
if (!t1 || !t2) throw new Error('usage: bind.ts <target-1 id> <target-2 id>');
state.targets = { t1, t2 };
saveState(state);
const workspaceId = state.workspaces!.engineering!;
const bindings = [
  ['overlord', 'primary', 'Overlord (control plane)', true, t1, CHECKOUTS.overlord],
  ['overlord', 'mobile', 'OverlordMobile (iOS app)', false, t1, CHECKOUTS.mobile],
  ['sandbox', 'primary', 'Sandbox Service', true, t1, CHECKOUTS.sandboxA],
  ['sandbox', 'primary', 'Sandbox Service', true, t2, CHECKOUTS.sandboxB]
] as const;
for (const [project, resourceKey, label, isPrimary, executionTargetId, directory] of bindings)
  await bindResource({
    workspaceId,
    projectId: state.projects![project]!,
    resourceKey,
    label,
    isPrimary,
    executionTargetId,
    directory
  });
console.log(
  await rows(
    `SELECT p.name, r.resource_key, r.is_primary, t.label AS target, s.descriptor_json FROM project_resource_sources s JOIN project_resources r ON r.id = s.resource_id JOIN projects p ON p.id = r.project_id JOIN execution_targets t ON t.id = s.execution_target_id ORDER BY p.name, r.resource_key, t.label`
  )
);
console.log(
  await rows(
    'SELECT execution_target_id, workspace_user_id, access_status FROM workspace_user_execution_targets'
  )
);
await closeDb();
