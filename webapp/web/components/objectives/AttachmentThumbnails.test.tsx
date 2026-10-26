import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { ObjectiveAttachmentDto } from '../../../shared/contract.ts';

import { AttachmentThumbnails } from './AttachmentThumbnails.tsx';

afterEach(cleanup);

function attachment(
  overrides: Partial<ObjectiveAttachmentDto> & { id: string; filename: string }
): ObjectiveAttachmentDto {
  return {
    workspaceId: 'workspace-1',
    projectId: null,
    missionId: null,
    objectiveId: null,
    inboxItemId: 'item-1',
    bucketKey: 'attachments',
    storageKey: `key-${overrides.id}`,
    contentType: null,
    sizeBytes: 2048,
    uploadStatus: 'uploaded',
    url: `/api/storage/attachments/key-${overrides.id}`,
    createdAt: '2026-10-26T00:00:00.000Z',
    ...overrides
  };
}

describe('AttachmentThumbnails', () => {
  it('renders nothing when there are no files and no upload in flight', () => {
    const { container } = render(<AttachmentThumbnails attachments={[]} files={[]} />);
    assert.equal(container.innerHTML, '');
  });

  it('shows stored images as thumbnails and other files by name', () => {
    render(
      <AttachmentThumbnails
        attachments={[
          attachment({ id: 'a1', filename: 'screenshot.png', contentType: 'image/png' }),
          attachment({ id: 'a2', filename: 'spec.pdf', contentType: 'application/pdf' })
        ]}
      />
    );

    const image = screen.getByRole('img', { name: 'screenshot.png' });
    assert.equal(image.getAttribute('src'), '/api/storage/attachments/key-a1');
    assert.ok(screen.getByText('spec.pdf'));
    assert.ok(screen.getByText('2.0 KB'));
    // Without a remove handler the tiles are read-only.
    assert.equal(screen.queryByRole('button', { name: /Remove/ }), null);
  });

  it('removes stored and pending files through their X badges', () => {
    const removedIds: string[] = [];
    const removedIndexes: number[] = [];
    render(
      <AttachmentThumbnails
        attachments={[attachment({ id: 'a1', filename: 'notes.txt', contentType: 'text/plain' })]}
        files={[
          new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
          new File(['y'], 'log.txt', { type: 'text/plain' })
        ]}
        onRemoveAttachment={id => removedIds.push(id)}
        onRemoveFile={index => removedIndexes.push(index)}
      />
    );

    assert.ok(screen.getByRole('img', { name: 'photo.jpg' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove notes.txt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove log.txt' }));

    assert.deepEqual(removedIds, ['a1']);
    assert.deepEqual(removedIndexes, [1]);
  });

  it('marks the attachment being removed and shows an upload spinner', () => {
    render(
      <AttachmentThumbnails
        attachments={[attachment({ id: 'a1', filename: 'notes.txt' })]}
        removingId="a1"
        onRemoveAttachment={() => {}}
        isUploading
      />
    );

    const remove = screen.getByRole('button', { name: 'Remove notes.txt' }) as HTMLButtonElement;
    assert.equal(remove.disabled, true);
    assert.ok(screen.getByRole('status', { name: 'Uploading attachment' }));
  });
});
