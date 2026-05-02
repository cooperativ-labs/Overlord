import { createSeedClient } from '@snaplet/seed';

const PRECOMPUTED_BCRYPT: Record<string, string> = {
  'bqz2bme.edk5dtz8JBW': '$2a$10$Ak5xAbjO2ZkpsgwBqKwsxOWQcnc2XDyCVZ4WN9Dh0GukXjO5PmAm6'
};

const hash = async (password: string, _rounds: number): Promise<string> => {
  const hashed = PRECOMPUTED_BCRYPT[password];
  if (!hashed) {
    throw new Error(`Missing precomputed bcrypt hash for password: ${password}`);
  }

  return hashed;
};

async function main() {
  const seed = await createSeedClient({ dryRun: true });

  // Clear existing data
  await seed.$resetDatabase();

  const jakePassword = 'bqz2bme.edk5dtz8JBW';
  const jakeHashedPassword = await hash(jakePassword, 10);

  const jakeId = '11111111-1111-4111-8111-111111111111';
  const aliceId = '22222222-2222-4222-8222-222222222222';
  const orgId = 1;
  const projectAlphaId = 'aaaaaaaa-0000-4000-8000-000000000001';
  const projectBetaId = 'aaaaaaaa-0000-4000-8000-000000000002';
  const reviewSessionId = 'cccccccc-0000-4000-8000-000000000001';
  const reviewEventId = 'dddddddd-0000-4000-8000-000000000001';
  const reviewFileChangeIds = [
    'eeeeeeee-0000-4000-8000-000000000001',
    'eeeeeeee-0000-4000-8000-000000000002'
  ];

  // Register OAuth clients for CLI, Electron, and browser-based device approval.
  // Explicitly control nullable fields to prevent Snaplet from auto-generating
  // random values that break things (e.g. a non-null deleted_at soft-deletes
  // the client). Keep client_secret_hash as empty string for public clients,
  // because some GoTrue versions scan this column into a non-nullable string.
  await seed.oauth_clients([
    {
      id: '577e4468-a806-489e-8b99-206471e7442c',
      client_name: 'Overlord CLI',
      client_type: 'public',
      registration_type: 'manual',
      redirect_uris: 'http://127.0.0.1:45619/callback',
      grant_types: 'authorization_code',
      token_endpoint_auth_method: 'none',
      client_secret_hash: '',
      client_uri: null,
      logo_uri: null,
      deleted_at: null
    },
    {
      id: 'f9a4c58c-68c7-4a20-88f9-2a2dc3eed88e',
      client_name: 'Overlord Electron',
      client_type: 'public',
      registration_type: 'manual',
      redirect_uris: 'http://127.0.0.1:45620/callback',
      grant_types: 'authorization_code',
      token_endpoint_auth_method: 'none',
      client_secret_hash: '',
      client_uri: null,
      logo_uri: null,
      deleted_at: null
    },
    {
      id: 'c90772e6-6f54-4a14-964f-198c72821a45',
      client_name: 'Overlord Device',
      client_type: 'public',
      registration_type: 'manual',
      redirect_uris: 'http://localhost:3000/auth/device/oauth-callback',
      grant_types: 'authorization_code',
      token_endpoint_auth_method: 'none',
      client_secret_hash: '',
      client_uri: null,
      logo_uri: null,
      deleted_at: null
    }
  ]);

  // Insert Jake (primary user / admin) and Alice (delegate user)
  await seed.users([
    {
      instance_id: '00000000-0000-0000-0000-000000000000',
      id: jakeId,
      email: 'jake@c.com',
      encrypted_password: jakeHashedPassword,
      role: 'authenticated',
      aud: 'authenticated',
      is_super_admin: false,
      raw_app_meta_data: { provider: 'email', providers: ['email'] },
      raw_user_meta_data: {
        name: 'Jake',
        email: 'jake@c.com',
        username: 'jchaselubitz'
      }
    },
    {
      instance_id: '00000000-0000-0000-0000-000000000000',
      id: aliceId,
      email: 'alice@c.com',
      encrypted_password: jakeHashedPassword,
      role: 'authenticated',
      aud: 'authenticated',
      is_super_admin: false,
      raw_app_meta_data: { provider: 'email', providers: ['email'] },
      raw_user_meta_data: {
        name: 'Alice',
        email: 'alice@c.com',
        username: 'alicecooper'
      }
    }
  ]);

  // Organization
  await seed.organizations([
    {
      id: orgId,
      name: 'Cooperativ',
      feed_retention_days: 30,
      git_provider: null
    }
  ]);

  // Members: Jake as ADMIN, Alice as MANAGER
  await seed.members([
    { organization_id: orgId, user_id: jakeId, role: 'ADMIN' },
    { organization_id: orgId, user_id: aliceId, role: 'MANAGER' }
  ]);

  // Seed canonical default statuses (one per status_type) so it is
  // compatible with Snaplet plan-time uniqueness checks.
  await seed.ticket_statuses([
    { organization_id: orgId, name: 'draft', status_type: 'draft', position: 0, is_default: true },
    {
      organization_id: orgId,
      name: 'execute',
      status_type: 'execute',
      position: 1,
      is_default: true
    },
    { organization_id: orgId, name: 'review', status_type: 'review', position: 2, is_default: true },
    {
      organization_id: orgId,
      name: 'complete',
      status_type: 'complete',
      position: 3,
      is_default: true
    }
  ]);

  // Two projects
  await seed.projects([
    {
      id: projectAlphaId,
      organization_id: orgId,
      name: 'Alpha',
      color: '#6366f1',
      operations_profile: null,
      operations_profile_fingerprint: null,
      operations_profile_generated_at: null
    },
    {
      id: projectBetaId,
      organization_id: orgId,
      name: 'Beta',
      color: '#10b981',
      operations_profile: null,
      operations_profile_fingerprint: null,
      operations_profile_generated_at: null
    }
  ]);

  const defaultProjectTags = [
    { key: 'webapp', label: 'webapp' },
    { key: 'desktop', label: 'desktop' },
    { key: 'mobile-app', label: 'mobile app' },
    { key: 'edge', label: 'edge' },
    { key: 'database', label: 'database' }
  ];

  await seed.project_tag_definitions(
    [projectAlphaId, projectBetaId].flatMap(projectId =>
      defaultProjectTags.map(tag => ({
        project_id: projectId,
        key: tag.key,
        label: tag.label,
        description: null,
        color: null,
        is_active: true
      }))
    )
  );

  // Tickets in draft plus one review card with completed objective history
  const ticketIds = [
    'bbbbbbbb-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000002',
    'bbbbbbbb-0000-4000-8000-000000000003',
    'bbbbbbbb-0000-4000-8000-000000000004',
    'bbbbbbbb-0000-4000-8000-000000000005',
    'bbbbbbbb-0000-4000-8000-000000000006'
  ];

  await seed.tickets([
    {
      id: ticketIds[0],
      organization_id: orgId,
      project_id: projectAlphaId,
      created_by: jakeId,
      title: 'Set up CI/CD pipeline',
      status: 'review',
      priority: 'high',
      board_position: 1,
      acceptance_criteria: null,
      assigned_agent: null,
      everhour_task_id: null,
      delegate: null
    },
    {
      id: ticketIds[1],
      organization_id: orgId,
      project_id: projectAlphaId,
      created_by: jakeId,
      title: 'Design system tokens',
      status: 'draft',
      priority: 'medium',
      board_position: 2,
      acceptance_criteria: null,
      assigned_agent: null,
      everhour_task_id: null,
      delegate: null
    },
    {
      id: ticketIds[2],
      organization_id: orgId,
      project_id: projectAlphaId,
      created_by: jakeId,
      title: 'Write API documentation',
      status: 'draft',
      priority: 'low',
      board_position: 3,
      acceptance_criteria: null,
      assigned_agent: null,
      everhour_task_id: null,
      delegate: null
    },
    // Delegate tickets — created by Alice on behalf of the org
    {
      id: ticketIds[3],
      organization_id: orgId,
      project_id: projectBetaId,
      created_by: jakeId,
      delegate: 'Claude',
      title: 'Integrate analytics SDK',
      status: 'draft',
      priority: 'medium',
      board_position: 1,
      assigned_agent: null,
      acceptance_criteria: null,
      everhour_task_id: null
    },
    {
      id: ticketIds[4],
      organization_id: orgId,
      project_id: projectBetaId,
      created_by: jakeId,
      delegate: 'Claude',
      title: 'Audit accessibility issues',
      status: 'draft',
      priority: 'high',
      board_position: 2,
      acceptance_criteria: 'The script runs without errors and resolves all WCAG AA violations.',
      assigned_agent: null,
      everhour_task_id: null
    },
    {
      id: ticketIds[5],
      organization_id: orgId,
      project_id: projectBetaId,
      created_by: jakeId,
      title: 'Migrate legacy data',
      status: 'draft',
      priority: 'medium',
      board_position: 3,
      acceptance_criteria:
        'The script runs without errors and migrates all records from the old schema to the new one.',
      everhour_task_id: null,
      assigned_agent: null,
      delegate: null
    }
  ]);

  // Create objectives for each ticket
  await seed.objectives([
    {
      ticket_id: ticketIds[0],
      title: 'CI workflow setup',
      objective: 'Configure GitHub Actions workflows for lint and test jobs.',
      state: 'complete',
      agent_identifier: 'Claude'
    },
    {
      ticket_id: ticketIds[0],
      title: 'Deployment wiring',
      objective: 'Add the deploy job and wire in production secrets.',
      state: 'complete',
      agent_identifier: 'Claude'
    },
    {
      ticket_id: ticketIds[1],
      objective: 'Define color, spacing, and typography tokens for the Alpha project.',
      state: 'draft'
    },
    {
      ticket_id: ticketIds[2],
      objective: 'Document all public REST endpoints with examples and error codes.',
      state: 'draft'
    },
    {
      ticket_id: ticketIds[3],
      objective: 'Add PostHog analytics to the Beta project and instrument key user flows.',
      state: 'draft'
    },
    {
      ticket_id: ticketIds[4],
      objective: 'Run axe-core across all pages and resolve WCAG AA violations.',
      state: 'draft',
      agent_identifier: 'Codex'
    },
    {
      ticket_id: ticketIds[5],
      objective: 'Write a one-time script to migrate records from the old schema to the new one.',
      state: 'draft'
    }
  ]);

  // Review ticket change history with linked session, event, and file diffs
  await seed.agent_sessions([
    {
      id: reviewSessionId,
      ticket_id: ticketIds[0],
      agent_identifier: 'Claude',
      connection_method: 'claude_code',
      session_state: 'completed',
      session_key: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      metadata: {
        source: 'seed',
        purpose: 'review-ticket-file-changes'
      },
      heartbeat_at: '2026-03-26T10:00:00.000Z',
      attached_at: '2026-03-26T09:45:00.000Z',
      detached_at: '2026-03-26T10:05:00.000Z',
      external_url: null,
      external_session_id: null
    }
  ]);

  await seed.ticket_events([
    {
      id: reviewEventId,
      ticket_id: ticketIds[0],
      session_id: reviewSessionId,
      event_type: 'deliver',
      phase: 'review',
      summary: 'Delivered the CI/CD workflow update for review.',
      payload: {
        files_changed: 2,
        objective_titles: ['CI workflow setup', 'Deployment wiring']
      },
      is_blocking: false
    }
  ]);

  await seed.file_changes([
    {
      id: reviewFileChangeIds[0],
      ticket_id: ticketIds[0],
      session_id: reviewSessionId,
      event_id: reviewEventId,
      file_name: 'ci.yml',
      file_path: '.github/workflows/ci.yml',
      label: 'CI workflow updates',
      summary: 'Added lint and test jobs with cached dependencies and fail-fast behavior.',
      why: 'This mirrors the first completed objective and gives the review card a concrete diff to inspect.',
      impact:
        'Improves pipeline feedback time and makes the review state feel like an in-progress deliverable.',
      change_kind: 'modify',
      attribution_source: 'explicit',
      confidence: 'explicit',
      hunks: [{ header: '@@ -1,8 +1,34 @@' }]
    },
    {
      id: reviewFileChangeIds[1],
      ticket_id: ticketIds[0],
      session_id: reviewSessionId,
      event_id: reviewEventId,
      file_name: 'deploy.yml',
      file_path: '.github/workflows/deploy.yml',
      label: 'Deploy workflow updates',
      summary:
        'Wired production secrets into the deploy job and gated releases on the main branch.',
      why: 'This mirrors the second completed objective and shows a second file in the same review batch.',
      impact: 'Shows how the review ticket can carry multiple related file changes before merge.',
      change_kind: 'modify',
      attribution_source: 'explicit',
      confidence: 'explicit',
      hunks: [{ header: '@@ -0,0 +1,28 @@' }]
    }
  ]);

  // Feed posts
  await seed.feed_posts([
    {
      organization_id: orgId,
      project_id: projectAlphaId,
      ticket_id: ticketIds[0],
      title: 'CI/CD pipeline scaffolded',
      body: 'Created the initial GitHub Actions workflows for linting and testing. Deployment step is stubbed pending secrets setup.',
      impact_level: 'medium',
      files_touched: ['.github/workflows/ci.yml', '.github/workflows/deploy.yml'],
      human_actions: ['Reviewed workflow config', 'Approved secrets plan'],
      tags: ['ci', 'devops'],
      tickets_created: [],
      tradeoffs: { notes: 'Used matrix builds for speed; increases parallel job costs.' }
    },
    {
      organization_id: orgId,
      project_id: projectAlphaId,
      ticket_id: ticketIds[1],
      title: 'Design tokens defined',
      body: 'Established the initial color palette and spacing scale. Typography tokens are pending font licensing confirmation.',
      impact_level: 'low',
      files_touched: ['tokens/colors.ts', 'tokens/spacing.ts'],
      human_actions: ['Reviewed palette with design team'],
      tags: ['design', 'frontend'],
      tickets_created: [],
      tradeoffs: {
        notes: 'Opted for CSS custom properties over JS-in-CSS for broader tooling compatibility.'
      }
    },
    {
      organization_id: orgId,
      project_id: projectBetaId,
      ticket_id: ticketIds[3],
      title: 'PostHog SDK integrated',
      body: 'Installed and initialized PostHog in the Beta app. Key flows (signup, onboarding, checkout) are now instrumented.',
      impact_level: 'medium',
      files_touched: ['lib/analytics.ts', 'app/layout.tsx'],
      human_actions: ['Verified events in PostHog dashboard'],
      tags: ['analytics', 'tracking'],
      tickets_created: [],
      tradeoffs: { notes: 'Lazy-loaded the SDK to avoid blocking initial render.' }
    },
    {
      organization_id: orgId,
      project_id: projectBetaId,
      ticket_id: ticketIds[4],
      title: 'Accessibility audit complete',
      body: 'Ran axe-core on all pages. Found 12 WCAG AA violations — 8 resolved, 4 deferred to next sprint pending design input.',
      impact_level: 'high',
      files_touched: ['components/Button.tsx', 'components/Modal.tsx', 'app/page.tsx'],
      human_actions: ['Triaged violations with design', 'Merged accessibility fixes'],
      tags: ['a11y', 'quality'],
      tickets_created: [],
      tradeoffs: { notes: 'Deferred colour-contrast changes until brand refresh is finalised.' }
    }
  ]);

  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
