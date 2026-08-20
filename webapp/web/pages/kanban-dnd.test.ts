import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyKanbanDrag, findKanbanColumn } from './kanban-dnd.ts';

describe('findKanbanColumn', () => {
  const columns = { next: ['a', 'b'], execute: ['c'] };

  it('returns a column key as itself', () => {
    assert.equal(findKanbanColumn(columns, 'next'), 'next');
  });

  it('finds the column that currently holds a card', () => {
    assert.equal(findKanbanColumn(columns, 'b'), 'next');
    assert.equal(findKanbanColumn(columns, 'c'), 'execute');
  });

  it('returns undefined for an unknown id', () => {
    assert.equal(findKanbanColumn(columns, 'missing'), undefined);
  });
});

describe('applyKanbanDrag', () => {
  it('reorders within a column when dropping onto another card', () => {
    const result = applyKanbanDrag({
      columns: { next: ['a', 'b', 'c'], execute: [] },
      activeId: 'a',
      overId: 'c'
    });
    assert.deepEqual(result?.orderedMissionIds, ['b', 'c', 'a']);
    assert.equal(result?.dropColumnKey, 'next');
  });

  it('moves a card to the end when dropping onto the column droppable', () => {
    const result = applyKanbanDrag({
      columns: { next: ['a', 'b', 'c'], execute: [] },
      activeId: 'a',
      overId: 'next'
    });
    assert.deepEqual(result?.orderedMissionIds, ['b', 'c', 'a']);
  });

  it('inserts into another column when onDragOver has not moved the card yet', () => {
    const result = applyKanbanDrag({
      columns: { next: ['a', 'b'], execute: ['c'] },
      activeId: 'a',
      overId: 'c'
    });
    assert.deepEqual(result?.columns.next, ['b']);
    assert.deepEqual(result?.orderedMissionIds, ['a', 'c']);
    assert.equal(result?.dropColumnKey, 'execute');
  });

  it('keeps dest order when onDragOver already placed the card and the drop is on itself', () => {
    const result = applyKanbanDrag({
      columns: { next: ['b'], execute: ['a', 'c'] },
      activeId: 'a',
      overId: 'a'
    });
    assert.deepEqual(result?.orderedMissionIds, ['a', 'c']);
    assert.equal(result?.dropColumnKey, 'execute');
  });

  it('appends onto an empty destination column', () => {
    const result = applyKanbanDrag({
      columns: { next: ['a'], execute: [] },
      activeId: 'a',
      overId: 'execute'
    });
    assert.deepEqual(result?.columns.next, []);
    assert.deepEqual(result?.orderedMissionIds, ['a']);
  });

  it('returns null when the drop target is unknown', () => {
    assert.equal(
      applyKanbanDrag({
        columns: { next: ['a'] },
        activeId: 'a',
        overId: 'missing'
      }),
      null
    );
  });
});
