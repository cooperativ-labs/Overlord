import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CAPTURE_DURATION_MS,
  type CaptureEffects,
  createPerformanceCapture
} from './performance-capture.js';

function fixture(overrides: Partial<CaptureEffects> = {}) {
  let finish!: () => void;
  let tick = () => {};
  let sampling = false;
  let starts = 0;
  let stops = 0;
  let saved: Parameters<CaptureEffects['save']>[0] | undefined;
  const capture = createPerformanceCapture({
    start: async () => {
      starts++;
    },
    stop: async () => {
      stops++;
    },
    sample: () => ({ cpuPercent: 40 }),
    save: async report => {
      saved = report;
    },
    wait: ms => {
      assert.equal(ms, CAPTURE_DURATION_MS);
      return new Promise(resolve => {
        finish = resolve;
      });
    },
    everySecond: callback => {
      tick = callback;
      sampling = true;
      return () => {
        sampling = false;
      };
    },
    now: () => 1000,
    ...overrides
  });
  return {
    capture,
    tick: () => tick(),
    finish: () => finish(),
    values: () => ({ sampling, starts, stops, saved })
  };
}

test('one bounded recording survives caller departure, rejects overlap, and can repeat', async () => {
  const f = fixture();
  assert.equal(f.capture.record().state, 'recording');
  f.capture.record();
  await Promise.resolve();
  assert.equal(f.values().starts, 1);
  assert.equal(f.capture.getStatus().endsAt, new Date(16_000).toISOString());
  f.tick();
  f.finish();
  await f.capture.whenFinished();
  assert.equal(f.capture.getStatus().state, 'ready');
  assert.equal(f.values().sampling, false);
  assert.equal(f.values().stops, 1);
  assert.equal(f.values().saved?.samples.length, 3);
  f.capture.record();
  await Promise.resolve();
  f.finish();
  await f.capture.whenFinished();
  assert.equal(f.values().starts, 2);
});

test('failed start does not stop a trace it did not start', async () => {
  const f = fixture({
    start: async () => {
      throw new Error('DevTools open');
    }
  });
  f.capture.record();
  await f.capture.whenFinished();
  assert.equal(f.capture.getStatus().state, 'error');
  assert.equal(f.values().stops, 0);
  assert.equal(f.values().sampling, false);
});

test('a disappearing renderer does not strand sampling or the trace', async () => {
  const f = fixture({
    sample: () => {
      throw new Error('renderer gone');
    }
  });
  f.capture.record();
  await Promise.resolve();
  f.tick();
  f.finish();
  await f.capture.whenFinished();
  assert.equal(f.capture.getStatus().state, 'ready');
  assert.equal(f.values().sampling, false);
  assert.equal(f.values().stops, 1);
  assert.deepEqual(f.values().saved?.samples[0], {
    at: new Date(1000).toISOString(),
    unavailable: true
  });
});

test('a failed stop retries cleanup and reports failure without leaking the timer', async () => {
  let stops = 0;
  const f = fixture({
    stop: async () => {
      if (++stops === 1) throw new Error('stop failed');
    }
  });
  f.capture.record();
  await Promise.resolve();
  f.finish();
  await f.capture.whenFinished();
  assert.equal(stops, 2);
  assert.equal(f.capture.getStatus().state, 'error');
  assert.equal(f.values().sampling, false);
});

test('failed disk write reports failure after the trace and timers have stopped', async () => {
  const f = fixture({
    save: async () => {
      throw new Error('disk full');
    }
  });
  f.capture.record();
  await Promise.resolve();
  f.finish();
  await f.capture.whenFinished();
  assert.equal(f.capture.getStatus().state, 'error');
  assert.equal(f.values().stops, 1);
  assert.equal(f.values().sampling, false);
});
