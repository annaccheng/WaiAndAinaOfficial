export type RecurringTask = {
  id: string;
  recurring: boolean;
  recurrence_interval: number | null;
  recurrence_unit: string | null;   // 'day' | 'week' | 'month' | 'year'
  recurrence_days: number[] | null; // 0=Sun … 6=Sat, used when unit='week'
  recurrence_end_type: string | null;
  recurrence_until: string | null;
  recurrence_count: number | null;
  created_at: string;
};

// Monday (UTC) of the ISO week containing `date`
export function mondayOf(date: Date): Date {
  const d = new Date(date);
  const dow = d.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

/**
 * Returns true if a recurring task should appear on `isoDate`.
 * Does NOT check after_count — that requires a DB count and is handled by the caller.
 */
export function taskMatchesDate(task: RecurringTask, isoDate: string): boolean {
  if (!task.recurring || !task.recurrence_unit) return false;

  if (task.recurrence_end_type === "on_date" && task.recurrence_until) {
    if (isoDate > task.recurrence_until) return false;
  }

  const date       = new Date(isoDate + "T12:00:00Z");
  const dow        = date.getUTCDay();
  const n          = task.recurrence_interval ?? 1;
  // Supabase returns created_at as a full ISO timestamp; slice to date-only before
  // appending the noon anchor, otherwise new Date() gets an invalid string.
  const refDateStr = (task.created_at ?? isoDate).slice(0, 10);
  const ref        = new Date(refDateStr + "T12:00:00Z");

  switch (task.recurrence_unit) {
    case "day": {
      if (n === 1) return true;
      const days = Math.round((date.getTime() - ref.getTime()) / 86_400_000);
      return days >= 0 && days % n === 0;
    }
    case "week": {
      const days = task.recurrence_days ?? [];
      if (!days.includes(dow)) return false;
      if (n === 1) return true;
      const refMon = mondayOf(ref);
      const curMon = mondayOf(date);
      const weeks  = Math.round((curMon.getTime() - refMon.getTime()) / 604_800_000);
      return weeks >= 0 && weeks % n === 0;
    }
    case "month": {
      if (date.getUTCDate() !== ref.getUTCDate()) return false;
      if (n === 1) return true;
      const months =
        (date.getUTCFullYear() - ref.getUTCFullYear()) * 12 +
        (date.getUTCMonth() - ref.getUTCMonth());
      return months >= 0 && months % n === 0;
    }
    case "year": {
      if (date.getUTCMonth() !== ref.getUTCMonth()) return false;
      if (date.getUTCDate()  !== ref.getUTCDate())  return false;
      if (n === 1) return true;
      const years = date.getUTCFullYear() - ref.getUTCFullYear();
      return years >= 0 && years % n === 0;
    }
    default:
      return false;
  }
}
