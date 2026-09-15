import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { MissionDetailDto } from '../../../shared/contract.ts';

import {
  type InboxCardLaunchGate,
  type InboxCardMutations,
  submitPromotedInboxObjective,
  submitUnassignedInboxItem
} from './inbox-card-actions.ts';
import { InboxCardShell, type InboxCardShellProps } from './InboxCardShell.tsx';

afterEach(cleanup);

const selection = { agent: 'claude', model: 'opus', reasoningEffort: 'high' };
const readyGate = {
  isManual: false,
  primaryConnection: { connected: true, message: null },
  targetAvailability: { available: true, message: null }
} as InboxCardLaunchGate;
const promotedMission = {
  id: 'mission-1',
  objectives: [{ id: 'objective-1' }]
} as unknown as MissionDetailDto;

function recordingMutations(mission: MissionDetailDto = promotedMission) {
  const calls: Array<[string, unknown]> = [];
  const mutations: InboxCardMutations = {
    updateInbox: async variables => void calls.push(['updateInbox', variables]),
    promote: async variables => {
      calls.push(['promote', variables]);
      return mission;
    },
    updateObjective: async variables => void calls.push(['updateObjective', variables]),
    launchObjective: async variables => void calls.push(['launchObjective', variables]),
    persistSelectionPreference: next => void calls.push(['persistSelectionPreference', next])
  };
  return { calls, mutations };
}

describe('unassigned Inbox card actions', () => {
  it('saves text in place without promoting when no project is chosen', async () => {
    const { calls, mutations } = recordingMutations();
    const result = await submitUnassignedInboxItem(
      {
        itemId: 'item-1',
        text: 'Fix the login bug\nwith details',
        projectId: '',
        resourceKey: null,
        shouldLaunch: false,
        gate: { ...readyGate, isManual: true },
        selection,
        explicitLaunchConfigs: {}
      },
      mutations
    );

    assert.equal(result, null);
    assert.deepEqual(calls, [
      [
        'updateInbox',
        {
          id: 'item-1',
          body: { title: 'Fix the login bug', objectives: ['Fix the login bug\nwith details'] }
        }
      ]
    ]);
  });

  it('promotes, binds the resource, and records the agent choice on save', async () => {
    const { calls, mutations } = recordingMutations();
    const config = { flags: ['--verbose'] } as never;
    const result = await submitUnassignedInboxItem(
      {
        itemId: 'item-1',
        text: 'Ship it',
        projectId: 'project-1',
        resourceKey: 'web',
        shouldLaunch: false,
        gate: readyGate,
        selection,
        explicitLaunchConfigs: { claude: config }
      },
      mutations
    );

    assert.equal(result, promotedMission);
    assert.deepEqual(calls, [
      ['updateInbox', { id: 'item-1', body: { title: 'Ship it', objectives: ['Ship it'] } }],
      ['promote', { id: 'item-1', projectId: 'project-1' }],
      ['updateObjective', { id: 'objective-1', body: { resourceKey: 'web' } }],
      [
        'updateObjective',
        {
          id: 'objective-1',
          body: {
            assignedAgent: 'claude',
            model: 'opus',
            reasoningEffort: 'high',
            launchConfigAgent: 'claude',
            launchConfigOverride: config
          }
        }
      ],
      ['persistSelectionPreference', selection]
    ]);
  });

  it('promotes and launches on run without persisting the preference', async () => {
    const { calls, mutations } = recordingMutations();
    await submitUnassignedInboxItem(
      {
        itemId: 'item-1',
        text: 'Ship it',
        projectId: 'project-1',
        resourceKey: null,
        shouldLaunch: true,
        gate: readyGate,
        selection,
        explicitLaunchConfigs: {}
      },
      mutations
    );

    assert.deepEqual(
      calls.map(([name]) => name),
      ['updateInbox', 'promote', 'launchObjective']
    );
    assert.deepEqual(calls[2]?.[1], {
      id: 'objective-1',
      body: {
        agent: 'claude',
        model: 'opus',
        reasoningEffort: 'high',
        launchConfigOverride: undefined
      }
    });
  });

  it('refuses a run before any mutation when the primary resource is disconnected', async () => {
    const { calls, mutations } = recordingMutations();
    await assert.rejects(
      submitUnassignedInboxItem(
        {
          itemId: 'item-1',
          text: 'Ship it',
          projectId: 'project-1',
          resourceKey: null,
          shouldLaunch: true,
          gate: {
            ...readyGate,
            primaryConnection: { connected: false, message: 'Link a resource.' }
          } as InboxCardLaunchGate,
          selection,
          explicitLaunchConfigs: {}
        },
        mutations
      ),
      { message: 'Link a resource.' }
    );
    assert.deepEqual(calls, []);
  });

  it('fails when promotion yields a mission without an objective', async () => {
    const { mutations } = recordingMutations({
      id: 'mission-2',
      objectives: []
    } as unknown as MissionDetailDto);
    await assert.rejects(
      submitUnassignedInboxItem(
        {
          itemId: 'item-1',
          text: 'Ship it',
          projectId: 'project-1',
          resourceKey: null,
          shouldLaunch: false,
          gate: readyGate,
          selection,
          explicitLaunchConfigs: {}
        },
        mutations
      ),
      { message: 'Mission was created without an objective.' }
    );
  });
});

describe('promoted Inbox card actions', () => {
  it('saves instruction, resource, and agent choice then persists the preference', async () => {
    const { calls, mutations } = recordingMutations();
    await submitPromotedInboxObjective(
      {
        objectiveId: 'objective-1',
        text: 'Updated',
        resourceKey: 'web',
        shouldLaunch: false,
        gate: readyGate,
        selection,
        explicitLaunchConfigs: {}
      },
      mutations
    );

    assert.deepEqual(calls, [
      [
        'updateObjective',
        {
          id: 'objective-1',
          body: {
            instructionText: 'Updated',
            resourceKey: 'web',
            assignedAgent: 'claude',
            model: 'opus',
            reasoningEffort: 'high'
          }
        }
      ],
      ['persistSelectionPreference', selection]
    ]);
  });

  it('saves instruction without assignment and launches on run', async () => {
    const { calls, mutations } = recordingMutations();
    await submitPromotedInboxObjective(
      {
        objectiveId: 'objective-1',
        text: 'Updated',
        resourceKey: null,
        shouldLaunch: true,
        gate: readyGate,
        selection,
        explicitLaunchConfigs: {}
      },
      mutations
    );

    assert.deepEqual(calls, [
      [
        'updateObjective',
        { id: 'objective-1', body: { instructionText: 'Updated', resourceKey: null } }
      ],
      [
        'launchObjective',
        {
          id: 'objective-1',
          body: {
            agent: 'claude',
            model: 'opus',
            reasoningEffort: 'high',
            launchConfigOverride: undefined
          }
        }
      ]
    ]);
  });
});

describe('InboxCardShell rendering', () => {
  function renderShell(overrides: Partial<InboxCardShellProps>) {
    const counts = { save: 0, run: 0, delete: 0 };
    const props: InboxCardShellProps = {
      instruction: 'Ship it',
      onInstructionChange: () => {},
      projectId: '',
      resourceKey: null,
      projects: [],
      projectGroups: [],
      showWorkspaceGroups: false,
      selectedProject: null,
      onSelectProject: () => {},
      onSelectInbox: () => {},
      onResourceChange: () => {},
      dueDatetime: null,
      onDueDatetimeChange: () => {},
      resources: [],
      selection,
      onSelectionChange: () => {},
      catalog: null,
      agentConfigs: {},
      onLaunchConfigCommit: () => {},
      selectionLoaded: true,
      primaryConnection: readyGate.primaryConnection,
      targetAvailability: readyGate.targetAvailability,
      isBusy: false,
      canSubmit: true,
      canRun: true,
      isManual: false,
      pendingAction: null,
      submitError: null,
      onSave: () => void (counts.save += 1),
      onRun: () => void (counts.run += 1),
      onDelete: () => void (counts.delete += 1),
      showDelete: true,
      assignedBanner: null,
      ...overrides
    };
    // Queries stay idle so the mention textarea never reaches for the network.
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
    render(
      <QueryClientProvider client={client}>
        <InboxCardShell {...props} />
      </QueryClientProvider>
    );
    return counts;
  }

  it('offers Save and Delete but not Run for an unassigned capture', () => {
    const counts = renderShell({});

    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete inbox item' }));

    assert.equal(screen.queryByRole('button', { name: /Run/ }), null);
    assert.deepEqual(counts, { save: 1, run: 0, delete: 1 });
  });

  it('offers Run without Delete for a promoted mission and surfaces submit errors', () => {
    const counts = renderShell({
      projectId: 'project-1',
      projectLocked: true,
      showDelete: false,
      submitError: 'Failed to update mission.'
    });

    fireEvent.click(screen.getByRole('button', { name: /Run/ }));

    assert.equal(screen.queryByRole('button', { name: 'Delete inbox item' }), null);
    assert.ok(screen.getByText('Failed to update mission.'));
    assert.deepEqual(counts, { save: 0, run: 1, delete: 0 });
  });
});
