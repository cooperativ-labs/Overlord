import type { ScheduleLike } from './helpers/types';
import { genDateFromFailureRepeatSeconds, generateDate } from './schedulingEngineFunctions';

export type {
  DayNumber,
  NormalizedSchedule,
  PeriodType,
  ScheduleLike,
  WeekDayType
} from './helpers/types';

export const generateDateFromSchedule = ({
  schedule,
  itemDueDatetime
}: {
  schedule: ScheduleLike;
  itemDueDatetime?: Date | null;
}) => {
  return generateDate({ schedule, itemDueDatetime });
};

export const generateDateFromFailureRepeatSeconds = (failureRepeatSeconds: number): Date => {
  return genDateFromFailureRepeatSeconds(failureRepeatSeconds);
};
