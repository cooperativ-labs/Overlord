/* eslint-disable no-console -- acceptance harness */
// coo:1108.z77k — seeds the scratch cloud-mode backend for the live acceptance run.
// NOT production code. Idempotent: re-running reuses what `state.json` already names.
//
// Accounts
//   a  owner of organization "Cooperativ (acceptance)": workspaces Engineering and Labs
//   b  owner of an unrelated organization (cross-organization isolation)
//   c  member of Labs only (project isolation inside one organization)
//
// Usage: ACCEPTANCE_WORK_DIR=<scratch> node --import tsx planning/spikes/coo-1108-z77k/bootstrap.ts

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { api, closeDb, loadState, ROOT, rows, saveState, WORK } from './lib.ts';

const PASSWORD = 'Acceptance-Passw0rd!';

async function account(key: string, name: string) {
  const state = loadState();
  const email = `owner-${key}@acceptance.invalid`;
  let result = await api(null, 'POST', '/api/auth/sign-in/email', { email, password: PASSWORD });
  if (result.status !== 200)
    result = await api(null, 'POST', '/api/auth/sign-up/email', {
      email,
      password: PASSWORD,
      name
    });
  if (result.status !== 200) throw new Error(`auth ${key}: ${result.status}`);
  const token = result.headers.get('set-auth-token') ?? result.body.token;
  state.users[key] = { email, token, profileId: result.body.user.id };
  saveState(state);
  return state.users[key]!;
}

async function must<T = any>(label: string, promise: ReturnType<typeof api<T>>) {
  const result = await promise;
  if (result.status < 200 || result.status >= 300)
    throw new Error(`${label}: ${result.status} ${JSON.stringify(result.body).slice(0, 400)}`);
  return result.body;
}

async function main() {
  const a = await account('a', 'Owner A');
  const b = await account('b', 'Owner B');
  const c = await account('c', 'Member C');
  let state = loadState();

  // Organizations and workspaces.
  const discover = async (token: string) =>
    must('authorized-workspaces', api(token, 'GET', '/api/authorized-workspaces'));
  let mine = await discover(a.token);
  if (!mine.workspaces?.length) {
    await must(
      'onboarding a',
      api(a.token, 'POST', '/api/onboarding', {
        organizationName: 'Cooperativ (acceptance)',
        workspaceName: 'Engineering'
      })
    );
    mine = await discover(a.token);
  }
  let theirs = await discover(b.token);
  if (!theirs.workspaces?.length) {
    await must(
      'onboarding b',
      api(b.token, 'POST', '/api/onboarding', {
        organizationName: 'Other Org',
        workspaceName: 'General'
      })
    );
    theirs = await discover(b.token);
  }
  const organizationId: string = mine.organizationId ?? mine.organizations[0].id;
  state.organizationId = organizationId;
  state.otherOrganizationId = theirs.organizationId ?? theirs.organizations[0].id;
  const ws = (name: string) =>
    mine.workspaces.find((w: any) => (w.name ?? w.workspaceName) === name);
  if (!ws('Labs')) {
    await must(
      'create Labs',
      api(a.token, 'POST', '/api/workspaces', { organizationId, name: 'Labs' })
    );
    mine = await discover(a.token);
  }
  const idOf = (w: any) => w.id ?? w.workspaceId;
  state.workspaces = { engineering: idOf(ws('Engineering')), labs: idOf(ws('Labs')) };
  saveState(state);

  // Member C joins Labs only.
  const cWorkspaces = await discover(c.token);
  if (!cWorkspaces.workspaces?.length) {
    const invite = await must(
      'invite c',
      api(a.token, 'POST', `/api/workspaces/${state.workspaces.labs}/invitations`, {
        email: c.email,
        roleKey: 'MEMBER'
      })
    );
    const accept = new URL(String(invite.acceptUrl), 'http://placeholder.invalid');
    const token =
      accept.searchParams.get('token') ?? accept.pathname.split('/').filter(Boolean).at(-1);
    if (!token) throw new Error(`invitation carried no token: ${Object.keys(invite).join(',')}`);
    await must('accept c', api(c.token, 'POST', '/api/invitations/accept', { token }));
  }

  // Runner credentials (USER_TOKEN) for the two execution targets.
  state.runnerTokens ??= {};
  for (const key of ['t1', 't2'])
    if (typeof state.runnerTokens[key] !== 'string') {
      const created = await must(
        `token ${key}`,
        api(a.token, 'POST', '/api/user-tokens', { label: `acceptance-runner-${key}` })
      );
      // The raw secret is returned once, next to the token's metadata.
      const secret = Object.values(created).find(
        (value): value is string => typeof value === 'string' && value.startsWith('out_')
      );
      if (!secret) throw new Error(`user token missing in ${Object.keys(created).join(',')}`);
      state.runnerTokens[key] = secret;
    }
  saveState(state);

  // Projects.
  state.projects ??= {};
  const project = async (key: string, workspace: string, name: string, description: string) => {
    if (state.projects![key]) return;
    const created = await must(
      `project ${name}`,
      api(a.token, 'POST', '/api/projects', {
        name,
        description,
        workspaceId: state.workspaces![workspace]
      })
    );
    state.projects![key] = created.id;
    saveState(state);
  };
  await project(
    'overlord',
    'engineering',
    'Overlord',
    'Control plane for coding agents: TypeScript monorepo with the backend (Express), shared web app, Electron desktop shell, CLI and runner, and the contract. The native iOS app lives in the mobile resource.'
  );
  await project(
    'sandbox',
    'engineering',
    'Sandbox Service',
    'Small Node HTTP service (health and orders endpoints) used as a test bed. Checked out on two machines.'
  );
  await project(
    'scribe',
    'engineering',
    'Scribe',
    'macOS dictation and voice assistant app written in Swift: menu bar UI, on-device transcription, meeting transcripts.'
  );
  await project(
    'scribeServer',
    'engineering',
    'Scribe Server',
    'Node API that syncs and searches Scribe meeting transcripts across devices.'
  );
  await project(
    'refinery',
    'labs',
    'Refinery',
    'Standalone product that refines rough objectives into well-specified work before it is filed.'
  );

  console.log(
    JSON.stringify(
      {
        organizationId: state.organizationId,
        otherOrganizationId: state.otherOrganizationId,
        workspaces: state.workspaces,
        projects: state.projects,
        users: Object.fromEntries(Object.entries(state.users).map(([k, u]) => [k, u.profileId])),
        runnerTokens: Object.keys(state.runnerTokens)
      },
      null,
      2
    )
  );
  await closeDb();
}

/**
 * Binds a registered resource to a directory on an execution target by inserting the rows
 * directly, so no checkout's `.overlord/project.json` is written (the REST path is for real
 * setup). Called by `bind.ts` once the targets are registered.
 */
export async function bindResource(input: {
  workspaceId: string;
  projectId: string;
  resourceKey: string;
  label: string;
  isPrimary: boolean;
  executionTargetId: string;
  directory: string;
}) {
  if (!existsSync(input.directory)) throw new Error(`missing directory ${input.directory}`);
  const now = new Date().toISOString();
  let resource = (
    await rows<{ id: string }>(
      'SELECT id FROM project_resources WHERE project_id = $1 AND resource_key = $2 AND deleted_at IS NULL',
      [input.projectId, input.resourceKey]
    )
  )[0];
  if (!resource) {
    resource = { id: randomUUID() };
    await rows(
      `INSERT INTO project_resources (id, workspace_id, project_id, resource_key, label, is_primary, status, metadata_json, created_at, updated_at, revision) VALUES ($1, $2, $3, $4, $5, $6, 'active', '{}', $7, $7, 1)`,
      [
        resource.id,
        input.workspaceId,
        input.projectId,
        input.resourceKey,
        input.label,
        input.isPrimary,
        now
      ]
    );
  }
  const existing = await rows(
    'SELECT id FROM project_resource_sources WHERE resource_id = $1 AND execution_target_id = $2',
    [resource.id, input.executionTargetId]
  );
  if (!existing.length)
    await rows(
      `INSERT INTO project_resource_sources (id, workspace_id, project_id, resource_id, execution_target_id, source_kind, descriptor_json, created_at, updated_at, revision) VALUES ($1, $2, $3, $4, $5, 'local_checkout', $6, $7, $7, 1)`,
      [
        randomUUID(),
        input.workspaceId,
        input.projectId,
        resource.id,
        input.executionTargetId,
        JSON.stringify({ path: input.directory }),
        now
      ]
    );
  return resource.id;
}

export const CHECKOUTS = {
  overlord: ROOT,
  mobile: path.resolve(ROOT, '../OverlordMobile'),
  sandboxA: path.join(WORK, 'repo-a'),
  sandboxB: path.join(WORK, 'repo-b')
};

if (import.meta.url === `file://${process.argv[1]}`)
  void main().catch(error => {
    console.error('bootstrap failed:', error?.message ?? error);
    process.exit(1);
  });
