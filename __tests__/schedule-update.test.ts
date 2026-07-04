import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabaseRequest: vi.fn(),
}));

import { POST } from "@/app/api/schedule/update/route";
import { supabaseRequest } from "@/lib/supabase";

const mockRequest = vi.mocked(supabaseRequest);

function makeReq(body: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/schedule/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/schedule/update", () => {
  it("returns 400 when action is missing", async () => {
    const res = await POST(makeReq({ dateLabel: "07/07/2026" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown action", async () => {
    const res = await POST(makeReq({ action: "teleport", dateLabel: "07/07/2026" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/unknown action/i);
  });

  describe("assign", () => {
    it("creates a schedule_assignment", async () => {
      mockRequest.mockResolvedValueOnce([]);

      const res = await POST(makeReq({
        action: "assign",
        scheduleTaskId: "st-1",
        userName: "Alice",
      }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(mockRequest).toHaveBeenCalledWith("schedule_assignments", expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ schedule_task_id: "st-1", user_name: "Alice", status: "Not Started" }),
      }));
    });

    it("returns 400 when scheduleTaskId is missing", async () => {
      const res = await POST(makeReq({ action: "assign", userName: "Alice" }));
      expect(res.status).toBe(400);
    });
  });

  describe("unassign", () => {
    it("deletes the schedule_assignment", async () => {
      mockRequest.mockResolvedValueOnce([]);

      const res = await POST(makeReq({
        action: "unassign",
        scheduleTaskId: "st-1",
        userName: "Bob",
      }));

      expect(res.status).toBe(200);
      expect(mockRequest).toHaveBeenCalledWith("schedule_assignments", expect.objectContaining({
        method: "DELETE",
        query: { schedule_task_id: "eq.st-1", user_name: "eq.Bob" },
      }));
    });
  });

  describe("status", () => {
    it("updates status to In Progress", async () => {
      mockRequest.mockResolvedValueOnce([]);

      const res = await POST(makeReq({
        action: "status",
        scheduleTaskId: "st-1",
        userName: "Alice",
        status: "In Progress",
      }));

      expect(res.status).toBe(200);
      expect(mockRequest).toHaveBeenCalledWith("schedule_assignments", expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({ status: "In Progress" }),
      }));
    });

    it("sets completed_at when status is Completed", async () => {
      mockRequest.mockResolvedValueOnce([]);

      const res = await POST(makeReq({
        action: "status",
        scheduleTaskId: "st-1",
        userName: "Alice",
        status: "Completed",
      }));

      expect(res.status).toBe(200);
      const call = mockRequest.mock.calls[0];
      const body = (call[1] as { body: Record<string, unknown> }).body;
      expect(body.status).toBe("Completed");
      expect(typeof body.completed_at).toBe("string"); // ISO timestamp set
    });

    it("returns 400 when status is missing", async () => {
      const res = await POST(makeReq({
        action: "status",
        scheduleTaskId: "st-1",
        userName: "Alice",
      }));
      expect(res.status).toBe(400);
    });
  });

  describe("add_task", () => {
    it("creates schedule row, schedule_task, and assignment", async () => {
      mockRequest
        .mockResolvedValueOnce([{ id: "task-1", person_count: 2 }])  // tasks lookup
        .mockResolvedValueOnce([{ id: "sched-1" }])                  // find existing schedule
        .mockResolvedValueOnce([])                                    // find existing schedule_task (none)
        .mockResolvedValueOnce([{ id: "st-new" }])                   // create schedule_task
        .mockResolvedValueOnce([])                                    // find existing assignment (none)
        .mockResolvedValueOnce([]);                                   // create assignment

      const res = await POST(makeReq({
        action: "add_task",
        dateLabel: "07/07/2026",
        taskId: "task-1",
        shiftId: "shift-1",
        userName: "Alice",
      }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.scheduleTaskId).toBe("st-new");

      // Verify schedule_task was created with correct slots_needed
      const stInsert = mockRequest.mock.calls.find(
        c => c[0] === "schedule_tasks" && (c[1] as { method?: string }).method === "POST"
      );
      expect(stInsert).toBeDefined();
      const stBody = (stInsert![1] as { body: Record<string, unknown> }).body;
      expect(stBody.task_id).toBe("task-1");
      expect(stBody.slots_needed).toBe(2);
      expect(stBody.shift_id).toBe("shift-1");
    });

    it("reuses existing schedule_task when task already added today", async () => {
      mockRequest
        .mockResolvedValueOnce([{ id: "task-1", person_count: 1 }])
        .mockResolvedValueOnce([{ id: "sched-1" }])
        .mockResolvedValueOnce([{ id: "st-existing" }])  // schedule_task already exists
        .mockResolvedValueOnce([])                        // existing assignment check
        .mockResolvedValueOnce([]);                       // create assignment

      const res = await POST(makeReq({
        action: "add_task",
        dateLabel: "07/07/2026",
        taskId: "task-1",
        shiftId: "shift-1",
        userName: "Bob",
      }));

      expect(res.status).toBe(200);

      // No POST to schedule_tasks
      const stInserts = mockRequest.mock.calls.filter(
        c => c[0] === "schedule_tasks" && (c[1] as { method?: string }).method === "POST"
      );
      expect(stInserts).toHaveLength(0);
    });

    it("returns 400 when taskId is missing", async () => {
      const res = await POST(makeReq({ action: "add_task", dateLabel: "07/07/2026" }));
      expect(res.status).toBe(400);
    });
  });

  describe("remove_task", () => {
    it("deletes the schedule_task row", async () => {
      mockRequest.mockResolvedValueOnce([]);

      const res = await POST(makeReq({ action: "remove_task", scheduleTaskId: "st-1" }));

      expect(res.status).toBe(200);
      expect(mockRequest).toHaveBeenCalledWith("schedule_tasks", expect.objectContaining({
        method: "DELETE",
        query: { id: "eq.st-1" },
      }));
    });
  });

  describe("override_notes", () => {
    it("patches override_notes on schedule_task", async () => {
      mockRequest.mockResolvedValueOnce([]);

      const res = await POST(makeReq({
        action: "override_notes",
        scheduleTaskId: "st-1",
        notes: "Use the red bucket today",
      }));

      expect(res.status).toBe(200);
      expect(mockRequest).toHaveBeenCalledWith("schedule_tasks", expect.objectContaining({
        method: "PATCH",
        body: { override_notes: "Use the red bucket today" },
      }));
    });

    it("sets override_notes to null when notes is not provided", async () => {
      mockRequest.mockResolvedValueOnce([]);

      await POST(makeReq({ action: "override_notes", scheduleTaskId: "st-1" }));

      const call = mockRequest.mock.calls[0];
      expect((call[1] as { body: Record<string, unknown> }).body.override_notes).toBeNull();
    });
  });

  describe("set_shift", () => {
    it("patches shift_id on schedule_task", async () => {
      mockRequest.mockResolvedValueOnce([]);

      const res = await POST(makeReq({
        action: "set_shift",
        scheduleTaskId: "st-1",
        shiftId: "shift-3",
      }));

      expect(res.status).toBe(200);
      expect(mockRequest).toHaveBeenCalledWith("schedule_tasks", expect.objectContaining({
        method: "PATCH",
        body: { shift_id: "shift-3" },
      }));
    });
  });
});
