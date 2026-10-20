/** Main-process recording policy, independent of Electron for lifecycle tests. */
export const CAPTURE_DURATION_MS = 15_000;

export interface PerformanceCaptureStatus {
  state: 'idle' | 'recording' | 'ready' | 'error';
  endsAt: string | null;
  message: string | null;
}

export interface CaptureEffects {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  sample: () => unknown;
  save: (report: { startedAt: string; finishedAt: string; samples: unknown[] }) => Promise<void>;
  wait: (ms: number) => Promise<void>;
  everySecond: (tick: () => void) => () => void;
  now: () => number;
}

export function createPerformanceCapture(effects: CaptureEffects) {
  let status: PerformanceCaptureStatus = { state: 'idle', endsAt: null, message: null };
  let completion: Promise<void> = Promise.resolve();

  async function run(): Promise<void> {
    let tracing = false;
    let failed = false;
    let stopSampling = () => {};
    try {
      await effects.start();
      tracing = true;
      const startedAt = effects.now();
      status = { ...status, endsAt: new Date(startedAt + CAPTURE_DURATION_MS).toISOString() };
      const samples: unknown[] = [];
      const sample = () => {
        try {
          samples.push(effects.sample());
        } catch {
          // A disappearing renderer must not strand the global trace session.
          samples.push({ at: new Date(effects.now()).toISOString(), unavailable: true });
        }
      };
      sample();
      stopSampling = effects.everySecond(sample);
      await effects.wait(CAPTURE_DURATION_MS);
      stopSampling();
      sample();
      await effects.stop();
      tracing = false;
      await effects.save({
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(effects.now()).toISOString(),
        samples
      });
    } catch {
      failed = true;
    } finally {
      stopSampling();
      if (tracing)
        await effects.stop().catch(() => {
          failed = true;
        });
      status = failed
        ? { state: 'error', endsAt: null, message: 'Capture failed. Close DevTools and try again.' }
        : { state: 'ready', endsAt: null, message: 'Capture saved on this computer.' };
    }
  }

  return {
    getStatus: (): PerformanceCaptureStatus => ({ ...status }),
    record: (): PerformanceCaptureStatus => {
      if (status.state === 'recording') return { ...status };
      status = { state: 'recording', endsAt: null, message: 'Recording for 15 seconds…' };
      completion = run();
      return { ...status };
    },
    // Also lets shutdown/integration harnesses wait for cleanup.
    whenFinished: () => completion
  };
}
