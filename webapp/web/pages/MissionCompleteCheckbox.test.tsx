import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MissionCompleteCheckbox } from './MissionCardPrimitives.tsx';

afterEach(cleanup);

test('checkbox completes and restores without opening its parent row', () => {
  let completed = 0;
  let reopened = 0;
  let opened = 0;
  const view = render(
    <div onClick={() => opened++}>
      <MissionCompleteCheckbox color={null} completed={false} onComplete={() => completed++} />
    </div>
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Mark mission complete' }));
  assert.equal(completed, 1);
  assert.equal(opened, 0);
  view.rerender(
    <div onClick={() => opened++}>
      <MissionCompleteCheckbox color={null} completed onReopen={() => reopened++} />
    </div>
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Restore previous status' }));
  assert.equal(reopened, 1);
  assert.equal(opened, 0);
});
