import { describe, it, expect, vi, beforeEach } from "vitest";

// Must be hoisted before any imports that trigger the module
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabaseRequest: vi.fn(),
}));

import { GET } from "@/app/api/schedule/route";
import { supabaseRequest } from "@/lib/supabase";

const mockRequest = vi.mocked(supabaseRequest);

const SHIFTS = [
  { id: "shift-1", label: "Morning Shift 1", time_range: "7:30-9:00", order_index: 1 },
  { id: "shift-2", label: "Lunch", time_range: "12:00-13:00", order_index: 2 },
];

const VOLUNTEERS = [
  { display_name: "Alice", active: true, user_role: { name: "Volunteer" } },
  { display_name: "Bob",   active: true, user_role: { name: "Volunteer" } },
];

function makeReq(date = "2026-07-07", staging = "1") {
  return new Request(`http://localhost:3000/api/schedule?date=${date}&staging=${staging}`);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/schedule", () => {
  it("returns shifts and people when no existing schedule", async () => {
    mockRequest
      .mockResolvedValueOnce(SHIFTS)                 // fetchShifts
      .mockResolvedValueOnce(VOLUNTEERS)             // fetchVolunteers
      .mockResolvedValueOnce([])                     // findScheduleId → no staging schedule
      .mockResolvedValueOnce([{ id: "sched-new" }]) // createSchedule
      .mockResolvedValueOnce([])                     // autoPopulate: fetch recurring tasks → early exit
      .mockResolvedValueOnce([]);                    // fetchScheduleTasks: schedule_tasks → early exit

    const res = await GET(makeReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.shifts).toHaveLength(2);
    expect(json.people).toEqual(["Alice", "Bob"]);
    expect(json.scheduleTasks).toEqual([]);
    expect(json.scheduleDate).toBe("07/07/2026");
  });

  it("returns existing schedule tasks with assignments", async () => {
    const scheduleTasks = [
      {
        id: "st-1",
        task_id: "task-1",
        shift_id: "shift-1",
        slots_needed: 2,
        override_notes: null,
        task: { name: "Morning feed", description: "Feed the animals", recurring: true },
      },
    ];
    const assignments = [
      { id: "a-1", schedule_task_id: "st-1", user_name: "Alice", status: "Not Started", completed_at: null, completion_notes: null },
    ];

    mockRequest
      .mockResolvedValueOnce(SHIFTS)
      .mockResolvedValueOnce(VOLUNTEERS)
      .mockResolvedValueOnce([{ id: "sched-1" }])   // findScheduleId → existing
      .mockResolvedValueOnce(scheduleTasks)           // fetchScheduleTasks
      .mockResolvedValueOnce(assignments);            // schedule_assignments

    const res = await GET(makeReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.scheduleTasks).toHaveLength(1);
    const st = json.scheduleTasks[0];
    expect(st.taskName).toBe("Morning feed");
    expect(st.shiftId).toBe("shift-1");
    expect(st.slotsNeeded).toBe(2);
    expect(st.isRecurring).toBe(true);
    expect(st.assignments).toHaveLength(1);
    expect(st.assignments[0].userName).toBe("Alice");
    expect(st.assignments[0].status).toBe("Not Started");
  });

  it("returns message when no live schedule exists", async () => {
    mockRequest
      .mockResolvedValueOnce(SHIFTS)
      .mockResolvedValueOnce(VOLUNTEERS)
      .mockResolvedValueOnce([]); // findScheduleId → no live schedule

    const res = await GET(makeReq("2026-07-07", "0")); // live
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toMatch(/No live schedule/);
    expect(json.scheduleTasks).toEqual([]);
  });

  it("auto-populates a daily recurring task on a new staging day", async () => {
    const recurringTask = {
      id: "task-daily",
      name: "Daily cleanup",
      description: null,
      person_count: 1,
      recurring: true,
      recurrence_interval: 1,
      recurrence_unit: "day",
      recurrence_days: [],
      recurrence_end_type: "never",
      recurrence_until: null,
      recurrence_count: null,
      created_at: "2026-01-01",
    };

    const newStId = "st-new-1";

    mockRequest
      .mockResolvedValueOnce(SHIFTS)
      .mockResolvedValueOnce(VOLUNTEERS)
      .mockResolvedValueOnce([])                       // findScheduleId → no existing
      .mockResolvedValueOnce([{ id: "sched-new" }])   // createSchedule
      // autoPopulate:
      .mockResolvedValueOnce([recurringTask])          // fetch recurring tasks
      .mockResolvedValueOnce([])                       // existing schedule_tasks (none)
      .mockResolvedValueOnce([{ id: newStId }])        // create schedule_tasks row
      .mockResolvedValueOnce([])                       // find previous schedule_task (none)
      // fetchScheduleTasks:
      .mockResolvedValueOnce([{
        id: newStId,
        task_id: "task-daily",
        shift_id: null,
        slots_needed: 1,
        override_notes: null,
        task: { name: "Daily cleanup", description: null, recurring: true },
      }])
      .mockResolvedValueOnce([]);                      // assignments

    const res = await GET(makeReq("2026-07-07"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.scheduleTasks).toHaveLength(1);
    expect(json.scheduleTasks[0].taskName).toBe("Daily cleanup");
  });

  it("does not auto-populate a task whose end date has passed", async () => {
    const expiredTask = {
      id: "task-expired",
      name: "Old task",
      description: null,
      person_count: 1,
      recurring: true,
      recurrence_interval: 1,
      recurrence_unit: "day",
      recurrence_days: [],
      recurrence_end_type: "on_date",
      recurrence_until: "2026-06-01", // ended before 2026-07-07
      recurrence_count: null,
      created_at: "2026-01-01",
    };

    mockRequest
      .mockResolvedValueOnce(SHIFTS)
      .mockResolvedValueOnce(VOLUNTEERS)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "sched-new" }])
      .mockResolvedValueOnce([expiredTask])   // autoPopulate: one expired recurring task
      .mockResolvedValueOnce([])              // existing schedule_tasks
      // no schedule_tasks insert — task should be skipped
      .mockResolvedValueOnce([])              // fetchScheduleTasks: empty
      .mockResolvedValueOnce([]);             // assignments

    const res = await GET(makeReq("2026-07-07"));
    const json = await res.json();

    expect(json.scheduleTasks).toHaveLength(0);

    // Verify we never called POST on schedule_tasks
    const postCalls = mockRequest.mock.calls.filter(
      call => call[0] === "schedule_tasks" && (call[1] as { method?: string }).method === "POST"
    );
    expect(postCalls).toHaveLength(0);
  });
});
