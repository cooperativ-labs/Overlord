declare module 'date-fns' {
  export type DateArg = Date | number | string;

  export type Day = 0 | 1 | 2 | 3 | 4 | 5 | 6;

  export type WeekOptions = {
    weekStartsOn?: Day;
  };

  export type Interval = {
    start: DateArg;
    end: DateArg;
  };

  export function addDays(date: DateArg, amount: number): Date;
  export function addMonths(date: DateArg, amount: number): Date;
  export function eachDayOfInterval(interval: Interval): Date[];
  export function endOfMonth(date: DateArg): Date;
  export function endOfWeek(date: DateArg, options?: WeekOptions): Date;
  export function format(date: DateArg, formatString: string): string;
  export function isSameDay(leftDate: DateArg, rightDate: DateArg): boolean;
  export function isSameMonth(leftDate: DateArg, rightDate: DateArg): boolean;
  export function isToday(date: DateArg): boolean;
  export function parseISO(argument: string): Date;
  export function startOfDay(date: DateArg): Date;
  export function startOfMonth(date: DateArg): Date;
  export function startOfWeek(date: DateArg, options?: WeekOptions): Date;
  export function subDays(date: DateArg, amount: number): Date;
  export function subMonths(date: DateArg, amount: number): Date;
}
