import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabaseRequest: vi.fn(),
}));

vi.mock("@/lib/push", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(undefined),
}));

import { POST, DELETE } from "@/app/api/schedule/publish/route";
import { supabaseRequest } from "@/lib/supabase";
import { sendPushNotifications } from "@/lib/push";

const mockRequest = vi.mocked(supabaseRequest);
const mockPush    = vi.mocked(sendPushNotifications);

function makeReq(body: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/schedule/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPush.mockResolvedValue(undefined);
});

const STAGING_TASKS = [
  { id: "st-1", task_id: "task-1", shift_id: "shift-1", slots_needed: 1, override_notes: null },
  { id: "st-2", task_id: "task-2", shift_id: "shift-2", slots_needed: 2, override_notes: null },
];

const STAGING_ASSIGNMENTS = [
  { schedule_task_id: "st-1", user_name: "Alice", status: "Not Started", completed_at: null, completion_notes: null },
  { schedule_task_id: "st-2", user_name: "Bob",   status: "Not Started", completed_at: null, completion_notes: null },
];

describe("POST /api/schedule/publish", () => {
  it("returns 400 when dateLabel is missing", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when no staging schedule exists", async () => {
    mockRequest.mockResolvedValueOnce([]); // no staging schedule

    const res = await POST(makeReq({ dateLabel: "07/07/2026" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/No staging/i);
  });

  it("copies staging tasks and assignments to a new live row", async () => {
    mockRequest
      .mockResolvedValueOnce([{ id: "staging-1" }])   // find staging schedule
      .mockResolvedValueOnce(STAGING_TASKS)             // fetch staging tasks
      .mockResolvedValueOnce(STAGING_ASSIGNMENTS)       // fetch staging assignments
      .mockResolvedValueOnce([])                        // find existing live schedule (none)
      // no DELETE old live
      .mockResolvedValueOnce([{ id: "live-new" }])      // create new live schedule
      .mockResolvedValueOnce([{ id: "live-st-1" }])     // copy task st-1
      .mockResolvedValueOnce([{ id: "live-st-2" }])     // copy task st-2
      .mockResolvedValueOnce([]);                        // insert assignments

    const res = await POST(makeReq({ dateLabel: "07/07/2026" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);

    // Verify live schedule was created
    const liveCreate = mockRequest.mock.calls.find(
      c => c[0] === "schedules" && (c[1] as { method?: string }).method === "POST"
    );
    expect(liveCreate).toBeDefined();
    expect((liveCreate![1] as { body: Record<string, unknown> }).body).toMatchObject({
      schedule_date: "2026-07-07",
      state: "live",
    });

    // Verify two schedule_tasks were copied
    const taskCopies = mockRequest.mock.calls.filter(
      c => c[0] === "schedule_tasks" && (c[1] as { method?: string }).method === "POST"
    );
    expect(taskCopies).toHaveLength(2);
  });

  it("deletes old live schedule before creating new one", async () => {
    mockRequest
      .mockResolvedValueOnce([{ id: "staging-1" }])
      .mockResolvedValueOnce(STAGING_TASKS)
      .mockResolvedValueOnce(STAGING_ASSIGNMENTS)
      .mockResolvedValueOnce([{ id: "live-old" }])     // existing live schedule
      // load live data for diff:
      .mockResolvedValueOnce([{ id: "old-st-1" }])     // live task ids
      .mockResolvedValueOnce([{ id: "old-st-1", task_id: "task-1", shift_id: "shift-1", slots_needed: 1, override_notes: null }])
      .mockResolvedValueOnce([{ schedule_task_id: "old-st-1", user_name: "Alice", status: "Not Started", completed_at: null, completion_notes: null }])
      .mockResolvedValueOnce([])                        // DELETE old live
      .mockResolvedValueOnce([{ id: "live-new" }])
      .mockResolvedValueOnce([{ id: "live-st-1" }])
      .mockResolvedValueOnce([{ id: "live-st-2" }])
      .mockResolvedValueOnce([]);

    await POST(makeReq({ dateLabel: "07/07/2026" }));

    const deleteCall = mockRequest.mock.calls.find(
      c => c[0] === "schedules" && (c[1] as { method?: string }).method === "DELETE"
    );
    expect(deleteCall).toBeDefined();
    expect((deleteCall![1] as { query: Record<string, string> }).query).toMatchObject({
      state: "eq.live",
    });
  });

  it("sends push notifications to users whose schedule changed", async () => {
    // Old live has Alice on task-1/shift-1; new staging adds Bob on task-2/shift-2
    const oldLiveTasks = [{ id: "old-st-1", task_id: "task-1", shift_id: "shift-1", slots_needed: 1, override_notes: null }];
    const oldLiveAssignments = [{ schedule_task_id: "old-st-1", user_name: "Alice", status: "Not Started", completed_at: null, completion_notes: null }];

    mockRequest
      .mockResolvedValueOnce([{ id: "staging-1" }])
      .mockResolvedValueOnce(STAGING_TASKS)
      .mockResolvedValueOnce(STAGING_ASSIGNMENTS)
      .mockResolvedValueOnce([{ id: "live-old" }])
      .mockResolvedValueOnce([{ id: "old-st-1" }])   // live task ids for diff
      .mockResolvedValueOnce(oldLiveTasks)
      .mockResolvedValueOnce(oldLiveAssignments)
      .mockResolvedValueOnce([])                       // DELETE old live
      .mockResolvedValueOnce([{ id: "live-new" }])
      .mockResolvedValueOnce([{ id: "live-st-1" }])
      .mockResolvedValueOnce([{ id: "live-st-2" }])
      .mockResolvedValueOnce([]);

    await POST(makeReq({ dateLabel: "07/07/2026" }));

    expect(mockPush).toHaveBeenCalledOnce();
    const { userNames } = mockPush.mock.calls[0][0];
    // Alice's schedule didn't change (same task-1/shift-1), Bob is new → notify Bob
    expect(userNames).toContain("Bob");
    expect(userNames).not.toContain("Alice");
  });

  it("sends notifications to everyone on first publish (no prior live)", async () => {
    mockRequest
      .mockResolvedValueOnce([{ id: "staging-1" }])
      .mockResolvedValueOnce(STAGING_TASKS)
      .mockResolvedValueOnce(STAGING_ASSIGNMENTS)
      .mockResolvedValueOnce([])                       // no existing live
      .mockResolvedValueOnce([{ id: "live-new" }])
      .mockResolvedValueOnce([{ id: "live-st-1" }])
      .mockResolvedValueOnce([{ id: "live-st-2" }])
      .mockResolvedValueOnce([]);

    await POST(makeReq({ dateLabel: "07/07/2026" }));

    expect(mockPush).toHaveBeenCalledOnce();
    const { userNames } = mockPush.mock.calls[0][0];
    expect(userNames).toContain("Alice");
    expect(userNames).toContain("Bob");
  });
});

describe("DELETE /api/schedule/publish", () => {
  it("deletes the live schedule for the given date", async () => {
    mockRequest.mockResolvedValueOnce([]);

    const req = new Request("http://localhost:3000/api/schedule/publish", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dateLabel: "07/07/2026" }),
    });
    const res = await DELETE(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(mockRequest).toHaveBeenCalledWith("schedules", expect.objectContaining({
      method: "DELETE",
      query: { schedule_date: "eq.2026-07-07", state: "eq.live" },
    }));
  });

  it("returns 400 when dateLabel is missing", async () => {
    const req = new Request("http://localhost:3000/api/schedule/publish", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });
});
