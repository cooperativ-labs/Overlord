import { z } from 'zod';

const timeStringSchema = z
  .string({ error: 'Time is required.' })
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    error: 'Times must use HH:mm or HH:mm:ss.'
  });

const weekdayTimeSchema = z.object({
  dayNum: z.number({ error: 'Day number is required.' }).int().min(0).max(6),
  times: z
    .array(timeStringSchema, { error: 'Times are required.' })
    .min(1, { error: 'Add at least one time.' })
});

export const schedulePeriodTypeSchema = z.enum(['d', 'w', 'm'], {
  error: 'Schedule period type must be daily, weekly, or monthly.'
});

export const scheduleInputSchema = z
  .object({
    name: z.string().trim().max(240).optional(),
    periodType: schedulePeriodTypeSchema,
    periodInterval: z.number({ error: 'Interval is required.' }).int().min(1).max(365),
    weeksOfMonth: z.array(z.number().int().min(1).max(5)).max(5).optional(),
    daysOfMonth: z.array(z.number().int().min(1).max(32)).max(31).optional(),
    daysOfWeek: z.array(weekdayTimeSchema).max(7).optional(),
    timezone: z.string({ error: 'Timezone is required.' }).trim().min(1).max(120),
    startDate: z.union([z.string().datetime(), z.date()]).nullable().optional()
  })
  .superRefine((input, ctx) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: input.timezone });
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'Timezone is invalid.',
        path: ['timezone']
      });
    }

    const hasDaysOfWeek = (input.daysOfWeek?.length ?? 0) > 0;
    const hasDaysOfMonth = (input.daysOfMonth?.length ?? 0) > 0;
    const hasWeeksOfMonth = (input.weeksOfMonth?.length ?? 0) > 0;

    if ((input.periodType === 'd' || input.periodType === 'w') && !hasDaysOfWeek) {
      ctx.addIssue({
        code: 'custom',
        message: 'Daily and weekly schedules require days of week with times.',
        path: ['daysOfWeek']
      });
    }

    if (input.periodType === 'm' && !hasDaysOfMonth && !(hasWeeksOfMonth && hasDaysOfWeek)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Monthly schedules require days of month or week/day rules.',
        path: ['daysOfMonth']
      });
    }

    if (input.periodType === 'm' && hasWeeksOfMonth && !hasDaysOfWeek) {
      ctx.addIssue({
        code: 'custom',
        message: 'Monthly week-based schedules require days of week.',
        path: ['daysOfWeek']
      });
    }
  });

export type ScheduleInput = z.infer<typeof scheduleInputSchema>;
