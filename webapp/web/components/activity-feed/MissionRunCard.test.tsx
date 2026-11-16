import type { ActivityFeedMissionItemDto } from '@overlord/contract';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { MissionRunCard } from './MissionRunCard.tsx';

afterEach(() => cleanup());

const item = {
  kind: 'mission',
  missionId: 'mission-1',
  missionTitle: 'Mission one',
  missionDisplayId: 'coo:1',
  objectiveDisplayId: 'coo:1.bbbb',
  projectId: 'project-1',
  projectName: 'Project',
  projectColor: null,
  runState: 'running',
  startedAt: '2026-11-15T10:00:00.000Z',
  occurredAt: '2026-11-15T10:00:00.000Z',
  latestEventSummary: 'Working',
  descriptionPreview: null,
  instructionPreview: 'Do it',
  agentIdentifier: 'claude',
  modelIdentifier: null,
  resourceKey: null,
  branch: null,
  createdByKind: 'human',
  createdByAgent: null,
  objectives: [
    {
      objectiveId: 'o-a',
      displayId: 'coo:1.aaaa',
      title: 'First step',
      state: 'complete',
      position: 0,
      assignedAgent: null,
      autoAdvance: false,
      blocked: false
    },
    {
      objectiveId: 'o-b',
      displayId: 'coo:1.bbbb',
      title: 'Second step',
      state: 'executing',
      position: 1,
      assignedAgent: null,
      autoAdvance: false,
      blocked: true
    }
  ]
} as unknown as ActivityFeedMissionItemDto;

describe('MissionRunCard navigation (plan §9.1)', () => {
  it('the card body opens the mission only; each objective row opens that objective', () => {
    const opened: Array<{ missionId: string; objectiveDisplayId?: string | null }> = [];
    render(
      <MissionRunCard
        item={item}
        nowIso="2026-11-15T11:00:00.000Z"
        onOpenMission={args => opened.push(args)}
      />
    );
    fireEvent.click(screen.getByRole('heading', { name: 'Mission one' }));
    assert.deepEqual(opened.at(-1), { missionId: 'mission-1' });
    fireEvent.click(screen.getByRole('button', { name: 'First step' }));
    assert.deepEqual(opened.at(-1), { missionId: 'mission-1', objectiveDisplayId: 'coo:1.aaaa' });
    fireEvent.click(screen.getByRole('button', { name: /Second step \(blocked/ }));
    assert.deepEqual(opened.at(-1), { missionId: 'mission-1', objectiveDisplayId: 'coo:1.bbbb' });
  });
});
