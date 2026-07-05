import { describe, it, expect } from "vitest";
import { taskMatchesDate } from "@/lib/recurrence";
import type { RecurringTask } from "@/lib/recurrence";

function makeTask(overrides: Partial<RecurringTask> = {}): RecurringTask {
  return {
    id: "task-1",
    recurring: true,
    recurrence_interval: 1,
    recurrence_unit: "week",
    recurrence_days: [1], // Monday
    recurrence_end_type: "never",
    recurrence_until: null,
    recurrence_count: null,
    created_at: "2026-01-05", // a Monday
    ...overrides,
  };
}

describe("taskMatchesDate", () => {
  describe("non-recurring tasks", () => {
    it("returns false when recurring is false", () => {
      expect(taskMatchesDate(makeTask({ recurring: false }), "2026-07-07")).toBe(false);
    });

    it("returns false when recurrence_unit is null", () => {
      expect(taskMatchesDate(makeTask({ recurrence_unit: null }), "2026-07-07")).toBe(false);
    });
  });

  describe("daily tasks", () => {
    it("matches every day when interval is 1", () => {
      const task = makeTask({ recurrence_unit: "day", recurrence_days: [], recurrence_interval: 1 });
      expect(taskMatchesDate(task, "2026-07-01")).toBe(true);
      expect(taskMatchesDate(task, "2026-07-04")).toBe(true);
      expect(taskMatchesDate(task, "2026-12-31")).toBe(true);
    });

    it("matches every 2 days starting from created_at", () => {
      const task = makeTask({
        recurrence_unit: "day",
        recurrence_days: [],
        recurrence_interval: 2,
        created_at: "2026-07-01",
      });
      expect(taskMatchesDate(task, "2026-07-01")).toBe(true);  // day 0
      expect(taskMatchesDate(task, "2026-07-02")).toBe(false); // day 1
      expect(taskMatchesDate(task, "2026-07-03")).toBe(true);  // day 2
      expect(taskMatchesDate(task, "2026-07-04")).toBe(false); // day 3
      expect(taskMatchesDate(task, "2026-07-05")).toBe(true);  // day 4
    });

    it("handles full ISO timestamp in created_at (as returned by Supabase)", () => {
      // Supabase returns e.g. "2026-07-01T08:30:00.000000+00:00" — appending
      // "T12:00:00Z" to that would produce an invalid date string without the slice fix.
      const task = makeTask({
        recurrence_unit: "day",
        recurrence_days: [],
        recurrence_interval: 2,
        created_at: "2026-07-01T08:30:00.000000+00:00",
      });
      expect(taskMatchesDate(task, "2026-07-01")).toBe(true);
      expect(taskMatchesDate(task, "2026-07-02")).toBe(false);
      expect(taskMatchesDate(task, "2026-07-03")).toBe(true);
    });

    it("handles full timestamp for monthly tasks", () => {
      const task = makeTask({
        recurrence_unit: "month",
        recurrence_days: [],
        recurrence_interval: 1,
        created_at: "2026-03-15T10:00:00.000000+00:00",
      });
      expect(taskMatchesDate(task, "2026-04-15")).toBe(true);
      expect(taskMatchesDate(task, "2026-04-14")).toBe(false);
    });
  });

  describe("weekly tasks", () => {
    it("matches only the specified day of week", () => {
      // Monday = 1
      const task = makeTask({ recurrence_days: [1], recurrence_interval: 1 });
      expect(taskMatchesDate(task, "2026-07-06")).toBe(true);  // Monday
      expect(taskMatchesDate(task, "2026-07-07")).toBe(false); // Tuesday
      expect(taskMatchesDate(task, "2026-07-13")).toBe(true);  // next Monday
    });

    it("matches multiple days per week", () => {
      // Mon/Wed/Fri = [1, 3, 5]
      const task = makeTask({ recurrence_days: [1, 3, 5], recurrence_interval: 1 });
      expect(taskMatchesDate(task, "2026-07-06")).toBe(true);  // Monday
      expect(taskMatchesDate(task, "2026-07-07")).toBe(false); // Tuesday
      expect(taskMatchesDate(task, "2026-07-08")).toBe(true);  // Wednesday
      expect(taskMatchesDate(task, "2026-07-09")).toBe(false); // Thursday
      expect(taskMatchesDate(task, "2026-07-10")).toBe(true);  // Friday
      expect(taskMatchesDate(task, "2026-07-11")).toBe(false); // Saturday
    });

    it("every-other-week only matches alternating weeks", () => {
      // created on 2026-07-06 (Monday), every 2 weeks on Monday
      const task = makeTask({
        recurrence_days: [1],
        recurrence_interval: 2,
        created_at: "2026-07-06",
      });
      expect(taskMatchesDate(task, "2026-07-06")).toBe(true);  // week 0 (reference)
      expect(taskMatchesDate(task, "2026-07-13")).toBe(false); // week 1
      expect(taskMatchesDate(task, "2026-07-20")).toBe(true);  // week 2
      expect(taskMatchesDate(task, "2026-07-27")).toBe(false); // week 3
      expect(taskMatchesDate(task, "2026-08-03")).toBe(true);  // week 4
    });

    it("returns false when day doesn't match even with correct interval", () => {
      const task = makeTask({ recurrence_days: [1], recurrence_interval: 2, created_at: "2026-07-06" });
      expect(taskMatchesDate(task, "2026-07-21")).toBe(false); // Tuesday in week 2
    });
  });

  describe("monthly tasks", () => {
    it("matches the same date each month", () => {
      const task = makeTask({
        recurrence_unit: "month",
        recurrence_days: [],
        recurrence_interval: 1,
        created_at: "2026-03-15",
      });
      expect(taskMatchesDate(task, "2026-04-15")).toBe(true);
      expect(taskMatchesDate(task, "2026-05-15")).toBe(true);
      expect(taskMatchesDate(task, "2026-04-14")).toBe(false);
      expect(taskMatchesDate(task, "2026-04-16")).toBe(false);
    });

    it("every 3 months only matches quarterly", () => {
      const task = makeTask({
        recurrence_unit: "month",
        recurrence_days: [],
        recurrence_interval: 3,
        created_at: "2026-01-10",
      });
      expect(taskMatchesDate(task, "2026-01-10")).toBe(true);  // month 0
      expect(taskMatchesDate(task, "2026-02-10")).toBe(false); // month 1
      expect(taskMatchesDate(task, "2026-03-10")).toBe(false); // month 2
      expect(taskMatchesDate(task, "2026-04-10")).toBe(true);  // month 3
      expect(taskMatchesDate(task, "2026-07-10")).toBe(true);  // month 6
    });
  });

  describe("yearly tasks", () => {
    it("matches the same month and day each year", () => {
      const task = makeTask({
        recurrence_unit: "year",
        recurrence_days: [],
        recurrence_interval: 1,
        created_at: "2025-06-21",
      });
      expect(taskMatchesDate(task, "2026-06-21")).toBe(true);
      expect(taskMatchesDate(task, "2027-06-21")).toBe(true);
      expect(taskMatchesDate(task, "2026-06-20")).toBe(false);
      expect(taskMatchesDate(task, "2026-07-21")).toBe(false);
    });
  });

  describe("end conditions", () => {
    it("on_date: stops matching after recurrence_until", () => {
      const task = makeTask({
        recurrence_unit: "day",
        recurrence_days: [],
        recurrence_interval: 1,
        recurrence_end_type: "on_date",
        recurrence_until: "2026-07-10",
      });
      expect(taskMatchesDate(task, "2026-07-09")).toBe(true);
      expect(taskMatchesDate(task, "2026-07-10")).toBe(true);
      expect(taskMatchesDate(task, "2026-07-11")).toBe(false);
    });

    it("never: always matches (ignores recurrence_until if end_type is never)", () => {
      const task = makeTask({
        recurrence_unit: "day",
        recurrence_days: [],
        recurrence_interval: 1,
        recurrence_end_type: "never",
        recurrence_until: "2020-01-01", // old date, but end_type is never so ignored
      });
      expect(taskMatchesDate(task, "2026-07-10")).toBe(true);
    });

    it("after_count end type does not block matching here (caller handles it)", () => {
      // taskMatchesDate itself does not check after_count — the route does via DB count
      const task = makeTask({
        recurrence_unit: "day",
        recurrence_days: [],
        recurrence_interval: 1,
        recurrence_end_type: "after_count",
        recurrence_count: 1, // already maxed out — but this fn doesn't know that
      });
      expect(taskMatchesDate(task, "2026-07-10")).toBe(true); // fn says yes; route layer will block it
    });
  });
});
