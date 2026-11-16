import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  beginObjectiveEdit,
  flushObjectiveEdits,
  getObjectiveEditBuffer,
  isEscapeConsumed,
  markEscapeConsumed,
  registerObjectiveEditSaver,
  resetObjectiveEditBuffers,
  saveObjectiveEdit,
  updateObjectiveEditText
} from './objective-edit-buffers.ts';

describe('objective edit buffers (plan §9.8)', () => {
  afterEach(() => resetObjectiveEditBuffers());

  it('keys buffers by objective and field, never sharing text across objectives', () => {
    beginObjectiveEdit('o-1', 'title', 'One');
    beginObjectiveEdit('o-2', 'title', 'Two');
    updateObjectiveEditText('o-1', 'title', 'One edited');
    assert.equal(getObjectiveEditBuffer('o-1', 'title')?.text, 'One edited');
    assert.equal(getObjectiveEditBuffer('o-2', 'title')?.text, 'Two');
  });

  it('flush awaits the save and finishes the edit on success', async () => {
    const saved: string[] = [];
    registerObjectiveEditSaver('o-1', 'instruction', async text => {
      await new Promise(resolve => setTimeout(resolve, 5));
      saved.push(text);
    });
    beginObjectiveEdit('o-1', 'instruction', 'old');
    updateObjectiveEditText('o-1', 'instruction', 'new text');
    assert.equal(await flushObjectiveEdits('o-1'), true);
    assert.deepEqual(saved, ['new text']);
    assert.equal(getObjectiveEditBuffer('o-1', 'instruction'), undefined);
  });

  it('a failed save keeps the text with the error, and a retry succeeds', async () => {
    let fail = true;
    registerObjectiveEditSaver('o-1', 'title', async () => {
      if (fail) throw new Error('Server said no');
    });
    beginObjectiveEdit('o-1', 'title', 'old');
    updateObjectiveEditText('o-1', 'title', 'kept');
    assert.equal(await flushObjectiveEdits(), false);
    const buffer = getObjectiveEditBuffer('o-1', 'title');
    assert.equal(buffer?.text, 'kept');
    assert.equal(buffer?.status, 'error');
    assert.equal(buffer?.error, 'Server said no');
    fail = false;
    assert.equal(await saveObjectiveEdit('o-1', 'title', { finish: true }), true);
    assert.equal(getObjectiveEditBuffer('o-1', 'title'), undefined);
  });

  it('an autosave keeps the edit open and a later flush does not resend unchanged text', async () => {
    const saved: string[] = [];
    registerObjectiveEditSaver('o-1', 'title', async text => {
      saved.push(text);
    });
    beginObjectiveEdit('o-1', 'title', 'old');
    updateObjectiveEditText('o-1', 'title', 'new');
    await saveObjectiveEdit('o-1', 'title', { finish: false });
    assert.equal(getObjectiveEditBuffer('o-1', 'title')?.status, 'editing');
    await flushObjectiveEdits('o-1');
    assert.deepEqual(saved, ['new']);
  });

  it('flush waits for a save already in flight before saving newer text', async () => {
    const saved: string[] = [];
    registerObjectiveEditSaver('o-1', 'title', async text => {
      await new Promise(resolve => setTimeout(resolve, 5));
      saved.push(text);
    });
    beginObjectiveEdit('o-1', 'title', 'a');
    updateObjectiveEditText('o-1', 'title', 'b');
    const first = saveObjectiveEdit('o-1', 'title', { finish: false });
    updateObjectiveEditText('o-1', 'title', 'c');
    assert.equal(await flushObjectiveEdits('o-1'), true);
    await first;
    assert.deepEqual(saved, ['b', 'c']);
  });

  it('without a mounted editor the buffer is retained, not dropped', async () => {
    beginObjectiveEdit('o-1', 'title', 'old');
    updateObjectiveEditText('o-1', 'title', 'unsaved');
    assert.equal(await flushObjectiveEdits('o-1'), false);
    assert.equal(getObjectiveEditBuffer('o-1', 'title')?.text, 'unsaved');
  });

  it('flush also saves keystrokes entered while its own save is pending', async () => {
    const saved: string[] = [];
    let release!: () => void;
    registerObjectiveEditSaver('o-1', 'instruction', async text => {
      saved.push(text);
      if (saved.length === 1)
        await new Promise<void>(resolve => {
          release = resolve;
        });
    });
    beginObjectiveEdit('o-1', 'instruction', 'a');
    updateObjectiveEditText('o-1', 'instruction', 'b');
    const flushed = flushObjectiveEdits('o-1');
    updateObjectiveEditText('o-1', 'instruction', 'c');
    release();
    assert.equal(await flushed, true);
    assert.deepEqual(saved, ['b', 'c']);
    assert.equal(getObjectiveEditBuffer('o-1', 'instruction'), undefined);
  });

  it('marks Escape events an editor consumed', () => {
    const event = new window.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as Event;
    assert.equal(isEscapeConsumed(event), false);
    markEscapeConsumed(event);
    assert.equal(isEscapeConsumed(event), true);
  });
});
