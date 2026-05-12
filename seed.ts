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

  /** Stable objective UUIDs so feed_posts.objective_sections and objective_id can reference them. */
  const objectiveIds = {
    ciWorkflow: 'ffffffff-1001-4000-8000-000000000001',
    deployment: 'ffffffff-1002-4000-8000-000000000002',
    designTokens: 'ffffffff-1003-4000-8000-000000000003',
    apiDocs: 'ffffffff-1004-4000-8000-000000000004',
    posthog: 'ffffffff-1005-4000-8000-000000000005',
    a11y: 'ffffffff-1006-4000-8000-000000000006',
    migrate: 'ffffffff-1007-4000-8000-000000000007'
  } as const;

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
      ticket_id: '1:1',
      created_by: jakeId,
      title: 'Set up CI/CD pipeline',
      status: 'review',
      priority: 'high',
      board_position: 1,
      acceptance_criteria: null,
      everhour_task_id: null,
      delegate: null
    },
    {
      id: ticketIds[1],
      organization_id: orgId,
      project_id: projectAlphaId,
      ticket_id: '1:2',
      created_by: jakeId,
      title: 'Design system tokens',
      status: 'draft',
      priority: 'medium',
      board_position: 2,
      acceptance_criteria: null,
      everhour_task_id: null,
      delegate: null
    },
    {
      id: ticketIds[2],
      organization_id: orgId,
      project_id: projectAlphaId,
      ticket_id: '1:3',
      created_by: jakeId,
      title: 'Write API documentation',
      status: 'draft',
      priority: 'low',
      board_position: 3,
      acceptance_criteria: null,
      everhour_task_id: null,
      delegate: null
    },
    // Delegate tickets — created by Alice on behalf of the org
    {
      id: ticketIds[3],
      organization_id: orgId,
      project_id: projectBetaId,
      ticket_id: '1:4',
      created_by: jakeId,
      delegate: 'Claude',
      title: 'Integrate analytics SDK',
      status: 'draft',
      priority: 'medium',
      board_position: 1,
      acceptance_criteria: null,
      everhour_task_id: null
    },
    {
      id: ticketIds[4],
      organization_id: orgId,
      project_id: projectBetaId,
      ticket_id: '1:5',
      created_by: jakeId,
      delegate: 'Claude',
      title: 'Audit accessibility issues',
      status: 'draft',
      priority: 'high',
      board_position: 2,
      acceptance_criteria: 'The script runs without errors and resolves all WCAG AA violations.',
      everhour_task_id: null
    },
    {
      id: ticketIds[5],
      organization_id: orgId,
      project_id: projectBetaId,
      ticket_id: '1:6',
      created_by: jakeId,
      title: 'Migrate legacy data',
      status: 'draft',
      priority: 'medium',
      board_position: 3,
      acceptance_criteria:
        'The script runs without errors and migrates all records from the old schema to the new one.',
      everhour_task_id: null,
      delegate: null
    }
  ]);

  await seed.ticket_identifier_counters([
    {
      organization_id: orgId,
      next_sequence: 7
    }
  ]);

  // Create objectives for each ticket
  await seed.objectives([
    {
      id: objectiveIds.ciWorkflow,
      ticket_id: ticketIds[0],
      title: 'CI workflow setup',
      objective: 'Configure GitHub Actions workflows for lint and test jobs.',
      state: 'complete',
      agent_identifier: 'Claude',
      model_identifier: null,
      assigned_agent: null
    },
    {
      id: objectiveIds.deployment,
      ticket_id: ticketIds[0],
      title: 'Deployment wiring',
      objective: 'Add the deploy job and wire in production secrets.',
      state: 'complete',
      agent_identifier: 'Claude',
      model_identifier: null,
      assigned_agent: null
    },
    {
      id: objectiveIds.designTokens,
      ticket_id: ticketIds[1],
      title: 'Design system tokens',
      objective: 'Define color, spacing, and typography tokens for the Alpha project.',
      state: 'draft',
      agent_identifier: null,
      model_identifier: null,
      assigned_agent: null
    },
    {
      id: objectiveIds.apiDocs,
      ticket_id: ticketIds[2],
      title: 'API documentation',
      objective: 'Document all public REST endpoints with examples and error codes.',
      state: 'draft',
      agent_identifier: null,
      model_identifier: null,
      assigned_agent: null
    },
    {
      id: objectiveIds.posthog,
      ticket_id: ticketIds[3],
      title: 'Integrate analytics SDK',
      objective: 'Add PostHog analytics to the Beta project and instrument key user flows.',
      state: 'draft',
      agent_identifier: null,
      model_identifier: null,
      assigned_agent: null
    },
    {
      id: objectiveIds.a11y,
      ticket_id: ticketIds[4],
      title: 'Audit accessibility issues',
      objective: 'Run axe-core across all pages and resolve WCAG AA violations.',
      state: 'draft',
      agent_identifier: 'Codex',
      model_identifier: null,
      assigned_agent: null
    },
    {
      id: objectiveIds.migrate,
      ticket_id: ticketIds[5],
      title: 'Migrate legacy data',
      objective: 'Write a one-time script to migrate records from the old schema to the new one.',
      state: 'draft',
      agent_identifier: null,
      model_identifier: null,
      assigned_agent: null
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

  // Feed posts (ticket-level rollups; columns align with generate-feed-post + feed-post-rollup)
  await seed.feed_posts([
    {
      organization_id: orgId,
      project_id: projectAlphaId,
      ticket_id: ticketIds[0],
      session_id: reviewSessionId,
      objective_id: objectiveIds.deployment,
      created_by: jakeId,
      agent_type: null,
      title: 'CI/CD pipeline scaffolded',
      summary:
        'Lint and test workflows run on every PR; production deploy is wired but awaits finalized secrets.',
      body: 'Created the initial GitHub Actions workflows for linting and testing. Deployment step is stubbed pending secrets setup.',
      impact_level: 'medium',
      files_touched: ['.github/workflows/ci.yml', '.github/workflows/deploy.yml'],
      human_actions: ['Reviewed workflow config', 'Approved secrets plan'],
      tags: ['ci', 'devops'],
      tickets_created: [],
      tradeoffs: [
        {
          decision: 'Matrix builds for CI',
          alternatives_considered: 'Single-runner sequential jobs',
          rationale: 'Cuts PR feedback time at the cost of higher parallel GitHub Actions minutes.'
        }
      ],
      objective_sections: [
        {
          id: objectiveIds.ciWorkflow,
          objective_id: objectiveIds.ciWorkflow,
          index: 0,
          title: 'CI workflow setup',
          state: 'complete',
          position: 0,
          time: '2026-03-26T09:50:00.000Z',
          duration: '12m',
          events: 1,
          takeaway: 'Lint and test jobs run on every pull request with cached dependencies.',
          body:
            'Configured GitHub Actions workflows for lint and test jobs mirroring what reviewers now see in file changes.',
          file_changes: [
            {
              path: '.github/workflows/ci.yml',
              status: 'modified',
              additions: 34,
              deletions: 8,
              note: 'Added cached install steps and a Node 20/22 matrix with fail-fast enabled.'
            }
          ],
          action_required: [],
          tradeoffs: [
            {
              decision: 'Cache node_modules between jobs',
              alternatives_considered: 'Fresh install each job',
              rationale: 'Speeds up CI significantly while accepting occasional cache staleness risk.'
            }
          ],
          event_ids: [reviewEventId],
          updated_at: '2026-03-26T09:55:00.000Z',
          agent_identifier: 'Claude',
          model_identifier: null
        },
        {
          id: objectiveIds.deployment,
          objective_id: objectiveIds.deployment,
          index: 1,
          title: 'Deployment wiring',
          state: 'complete',
          position: 1,
          time: '2026-03-26T09:58:00.000Z',
          duration: '7m',
          events: 0,
          takeaway: 'Deploy job exists; production credentials remain gated behind security review.',
          body:
            'Added the deploy job structure and placeholders for secrets; wiring completes once credentials land.',
          file_changes: [
            {
              path: '.github/workflows/deploy.yml',
              status: 'modified',
              additions: 28,
              deletions: 0,
              note: 'Stubbed production deploy with branch guard on main only.'
            }
          ],
          action_required: ['Confirm production secret names with security'],
          tradeoffs: [
            {
              decision: 'Gate deploy on main only',
              alternatives_considered: 'Allow deploy from long-lived release branches',
              rationale: 'Shrinks blast radius while agents iterate on feature branches.'
            }
          ],
          event_ids: [reviewEventId],
          updated_at: '2026-03-26T10:04:00.000Z',
          agent_identifier: 'Claude',
          model_identifier: null
        }
      ],
      orphan_file_changes: [],
      total_events: 1,
      total_files: 2,
      pending_actions: 3,
      source_event_ids: [reviewEventId],
      source_session_ids: [reviewSessionId]
    },
    {
      organization_id: orgId,
      project_id: projectAlphaId,
      ticket_id: ticketIds[1],
      session_id: null,
      objective_id: objectiveIds.designTokens,
      created_by: jakeId,
      agent_type: null,
      title: 'Design tokens defined',
      summary:
        'Color and spacing scales are drafted in code; typography tokens wait on font licensing.',
      body: 'Established the initial color palette and spacing scale. Typography tokens are pending font licensing confirmation.',
      impact_level: 'low',
      files_touched: ['tokens/colors.ts', 'tokens/spacing.ts'],
      human_actions: ['Reviewed palette with design team'],
      tags: ['design', 'frontend'],
      tickets_created: [],
      tradeoffs: [
        {
          decision: 'CSS custom properties for runtime theming',
          alternatives_considered: 'JS-in-CSS token objects compiled at build time',
          rationale: 'Keeps tokens consumable from plain CSS and Storybook without extra bundler plugins.'
        }
      ],
      objective_sections: [
        {
          id: objectiveIds.designTokens,
          objective_id: objectiveIds.designTokens,
          index: 0,
          title: 'Design system tokens',
          state: 'draft',
          position: 0,
          time: null,
          duration: null,
          events: 0,
          takeaway: 'Foundational palette and spacing are ready for component refactors.',
          body:
            'Define color, spacing, and typography tokens for the Alpha project so downstream components share one source of truth.',
          file_changes: [
            {
              path: 'tokens/colors.ts',
              status: 'modified',
              additions: 42,
              deletions: 6,
              note: 'Introduced semantic color roles mapped to brand primaries.'
            },
            {
              path: 'tokens/spacing.ts',
              status: 'modified',
              additions: 18,
              deletions: 2,
              note: 'Added an 8px-based spacing ladder for layout primitives.'
            }
          ],
          action_required: ['Confirm font licensing before publishing typography tokens'],
          tradeoffs: [],
          event_ids: [],
          updated_at: null,
          agent_identifier: null,
          model_identifier: null
        }
      ],
      orphan_file_changes: [],
      total_events: 0,
      total_files: 2,
      pending_actions: 2,
      source_event_ids: [],
      source_session_ids: []
    },
    {
      organization_id: orgId,
      project_id: projectBetaId,
      ticket_id: ticketIds[3],
      session_id: null,
      objective_id: objectiveIds.posthog,
      created_by: jakeId,
      agent_type: null,
      title: 'PostHog SDK integrated',
      summary: 'Analytics client loads after first paint; primary funnels emit events in staging.',
      body: 'Installed and initialized PostHog in the Beta app. Key flows (signup, onboarding, checkout) are now instrumented.',
      impact_level: 'medium',
      files_touched: ['lib/analytics.ts', 'app/layout.tsx'],
      human_actions: ['Verified events in PostHog dashboard'],
      tags: ['analytics', 'tracking'],
      tickets_created: [],
      tradeoffs: [
        {
          decision: 'Lazy-load PostHog on interaction',
          alternatives_considered: 'Bundle SDK with the main layout chunk',
          rationale: 'Avoids blocking first paint while still capturing high-intent flows early enough.'
        }
      ],
      objective_sections: [
        {
          id: objectiveIds.posthog,
          objective_id: objectiveIds.posthog,
          index: 0,
          title: 'Integrate analytics SDK',
          state: 'draft',
          position: 0,
          time: null,
          duration: null,
          events: 0,
          takeaway: 'Core acquisition and monetization funnels now emit structured analytics events.',
          body:
            'Add PostHog analytics to the Beta project and instrument key user flows so product can measure activation.',
          file_changes: [
            {
              path: 'lib/analytics.ts',
              status: 'modified',
              additions: 120,
              deletions: 4,
              note: 'Wrapped PostHog init with lazy import and safe no-op when key missing.'
            },
            {
              path: 'app/layout.tsx',
              status: 'modified',
              additions: 22,
              deletions: 0,
              note: 'Mounted provider boundary without blocking SSR.'
            }
          ],
          action_required: [],
          tradeoffs: [],
          event_ids: [],
          updated_at: null,
          agent_identifier: 'Claude',
          model_identifier: null
        }
      ],
      orphan_file_changes: [],
      total_events: 0,
      total_files: 2,
      pending_actions: 1,
      source_event_ids: [],
      source_session_ids: []
    },
    {
      organization_id: orgId,
      project_id: projectBetaId,
      ticket_id: ticketIds[4],
      session_id: null,
      objective_id: objectiveIds.a11y,
      created_by: jakeId,
      agent_type: null,
      title: 'Accessibility audit complete',
      summary:
        'Automated axe pass found twelve AA issues; most are fixed in UI primitives, a few wait on brand color decisions.',
      body: 'Ran axe-core on all pages. Found 12 WCAG AA violations — 8 resolved, 4 deferred to next sprint pending design input.',
      impact_level: 'high',
      files_touched: ['components/Button.tsx', 'components/Modal.tsx', 'app/page.tsx'],
      human_actions: ['Triaged violations with design', 'Merged accessibility fixes'],
      tags: ['a11y', 'quality'],
      tickets_created: [],
      tradeoffs: [
        {
          decision: 'Defer strict color-contrast fixes',
          alternatives_considered: 'Ship temporary high-contrast theme overrides now',
          rationale: 'Brand palette refresh lands next sprint; avoids thrashing components twice.'
        }
      ],
      objective_sections: [
        {
          id: objectiveIds.a11y,
          objective_id: objectiveIds.a11y,
          index: 0,
          title: 'Audit accessibility issues',
          state: 'draft',
          position: 0,
          time: null,
          duration: null,
          events: 0,
          takeaway: 'Critical interactive components now meet keyboard and screen reader baselines.',
          body:
            'Run axe-core across all pages and resolve WCAG AA violations, prioritizing customer-facing flows first.',
          file_changes: [
            {
              path: 'components/Button.tsx',
              status: 'modified',
              additions: 36,
              deletions: 12,
              note: 'Added focus-visible ring and aria-busy during async actions.'
            },
            {
              path: 'components/Modal.tsx',
              status: 'modified',
              additions: 28,
              deletions: 9,
              note: 'Trap focus and restore on close; labelled dialogs with aria-modal.'
            },
            {
              path: 'app/page.tsx',
              status: 'modified',
              additions: 14,
              deletions: 3,
              note: 'Landmark roles and heading order fixes from audit report.'
            }
          ],
          action_required: ['Design sign-off on remaining contrast exceptions'],
          tradeoffs: [],
          event_ids: [],
          updated_at: null,
          agent_identifier: 'Codex',
          model_identifier: null
        }
      ],
      orphan_file_changes: [],
      total_events: 0,
      total_files: 3,
      pending_actions: 3,
      source_event_ids: [],
      source_session_ids: []
    }
  ]);

  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
