import {
  generateDateFromFailureRepeatSeconds,
  generateDateFromSchedule
} from '@/lib/schedulingEngine';

declare const afterEach: (callback: () => void) => void;
declare const beforeEach: (callback: () => void) => void;
declare const describe: (name: string, callback: () => void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
  toThrow: (expected?: string) => void;
};
declare const it: (name: string, callback: () => void) => void;
declare const jest: {
  setSystemTime: (value: Date) => void;
  useFakeTimers: () => void;
  useRealTimers: () => void;
};

describe('generateDateFromSchedule', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the next daily occurrence on the same local day when a later time exists', () => {
    jest.setSystemTime(new Date('2026-03-25T09:00:00.000Z'));

    const result = generateDateFromSchedule({
      schedule: {
        periodType: 'd',
        periodInterval: 1,
        timezone: 'UTC',
        daysOfWeek: [{ dayNum: 1, times: ['08:00:00', '11:30:00'] }]
      }
    });

    expect(result.toISOString()).toBe('2026-03-25T11:30:00.000Z');
  });

  it('normalizes legacy day_num payloads and honors weekly intervals', () => {
    jest.setSystemTime(new Date('2026-03-25T12:00:00.000Z'));

    const result = generateDateFromSchedule({
      schedule: {
        periodType: 'w',
        periodInterval: 2,
        timezone: 'UTC',
        startDate: '2026-03-23T10:00:00.000Z',
        daysOfWeek: [{ day_num: 1, times: ['10:00:00'] }]
      }
    });

    expect(result.toISOString()).toBe('2026-04-06T10:00:00.000Z');
  });

  it('uses the provided due datetime as the recurrence anchor instead of drifting to now', () => {
    jest.setSystemTime(new Date('2026-03-25T16:00:00.000Z'));

    const result = generateDateFromSchedule({
      schedule: {
        periodType: 'd',
        periodInterval: 1,
        timezone: 'UTC',
        daysOfWeek: [{ dayNum: 1, times: ['09:00:00'] }]
      },
      itemDueDatetime: new Date('2026-03-24T09:00:00.000Z')
    });

    expect(result.toISOString()).toBe('2026-03-25T09:00:00.000Z');
  });

  it('supports last-day monthly rules without mutating the configured array', () => {
    jest.setSystemTime(new Date('2026-02-20T08:00:00.000Z'));

    const daysOfMonth = [32, 15];
    const result = generateDateFromSchedule({
      schedule: {
        periodType: 'm',
        periodInterval: 1,
        timezone: 'UTC',
        daysOfMonth,
        daysOfWeek: [{ dayNum: 0, times: ['23:59:00'] }]
      }
    });

    expect(result.toISOString()).toBe('2026-02-28T23:59:00.000Z');
    expect(daysOfMonth).toEqual([32, 15]);
  });

  it('supports monthly week-based rules', () => {
    jest.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));

    const result = generateDateFromSchedule({
      schedule: {
        periodType: 'm',
        periodInterval: 1,
        timezone: 'UTC',
        weeksOfMonth: [2],
        daysOfWeek: [{ dayNum: 3, times: ['14:00:00'] }]
      }
    });

    expect(result.toISOString()).toBe('2026-03-11T14:00:00.000Z');
  });

  it('throws a validation error for invalid timezones', () => {
    expect(() =>
      generateDateFromSchedule({
        schedule: {
          periodType: 'd',
          periodInterval: 1,
          timezone: 'Mars/Base',
          daysOfWeek: [{ dayNum: 1, times: ['09:00:00'] }]
        }
      })
    ).toThrow('Timezone is invalid.');
  });
});

describe('generateDateFromFailureRepeatSeconds', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('adds retry seconds to the current time', () => {
    jest.setSystemTime(new Date('2026-03-25T10:00:00.000Z'));

    expect(generateDateFromFailureRepeatSeconds(90).toISOString()).toBe('2026-03-25T10:01:30.000Z');
  });
});
