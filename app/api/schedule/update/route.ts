import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

function toIsoDate(label?: string | null) {
  if (!label) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  const [month, day, year] = label.split("/");
  if (!month || !day || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

async function getOrCreateSchedule(isoDate: string): Promise<string | null> {
  const rows = await supabaseRequest<{ id: string }[]>("schedules", {
    query: { select: "id", schedule_date: `eq.${isoDate}`, state: "eq.staging", limit: "1" },
  });
  if (rows?.[0]?.id) return rows[0].id;

  const created = await supabaseRequest<{ id: string }[]>("schedules", {
    method: "POST",
    prefer: "return=representation",
    body: { schedule_date: isoDate, state: "staging" },
  });
  return created?.[0]?.id ?? null;
}

async function getOrCreateScheduleTask(
  scheduleId: string,
  taskId: string,
  shiftId: string | null,
  slotsNeeded: number
): Promise<string | null> {
  const existing = await supabaseRequest<{ id: string }[]>("schedule_tasks", {
    query: {
      select: "id",
      schedule_id: `eq.${scheduleId}`,
      task_id: `eq.${taskId}`,
      limit: "1",
    },
  });
  if (existing?.[0]?.id) return existing[0].id;

  const created = await supabaseRequest<{ id: string }[]>("schedule_tasks", {
    method: "POST",
    prefer: "return=representation",
    body: {
      schedule_id: scheduleId,
      task_id: taskId,
      shift_id: shiftId ?? null,
      slots_needed: slotsNeeded,
    },
  });
  return created?.[0]?.id ?? null;
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const { action, dateLabel } = body ?? {};

  if (!action) {
    return NextResponse.json({ error: "Missing action." }, { status: 400 });
  }

  try {
    switch (action) {
      // ── Assign a person to an existing schedule_task ──────────────────────
      case "assign": {
        const { scheduleTaskId, userName } = body;
        if (!scheduleTaskId || !userName) {
          return NextResponse.json({ error: "Missing scheduleTaskId or userName." }, { status: 400 });
        }
        await supabaseRequest("schedule_assignments", {
          method: "POST",
          body: { schedule_task_id: scheduleTaskId, user_name: userName, status: "Not Started" },
        });
        return NextResponse.json({ ok: true });
      }

      // ── Remove a person from a schedule_task ──────────────────────────────
      case "unassign": {
        const { scheduleTaskId, userName } = body;
        if (!scheduleTaskId || !userName) {
          return NextResponse.json({ error: "Missing scheduleTaskId or userName." }, { status: 400 });
        }
        await supabaseRequest("schedule_assignments", {
          method: "DELETE",
          query: { schedule_task_id: `eq.${scheduleTaskId}`, user_name: `eq.${userName}` },
        });
        return NextResponse.json({ ok: true });
      }

      // ── Update assignment status ───────────────────────────────────────────
      case "status": {
        const { scheduleTaskId, userName, status, completionNotes } = body;
        if (!scheduleTaskId || !userName || !status) {
          return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
        }
        const updates: Record<string, unknown> = { status };
        if (status === "Completed") updates.completed_at = new Date().toISOString();
        if (completionNotes !== undefined) updates.completion_notes = completionNotes;
        await supabaseRequest("schedule_assignments", {
          method: "PATCH",
          query: { schedule_task_id: `eq.${scheduleTaskId}`, user_name: `eq.${userName}` },
          body: updates,
        });
        return NextResponse.json({ ok: true });
      }

      // ── Add a task to this day (and optionally assign one person) ─────────
      case "add_task": {
        const { taskId, shiftId, userName } = body;
        if (!taskId || !dateLabel) {
          return NextResponse.json({ error: "Missing taskId or dateLabel." }, { status: 400 });
        }
        const isoDate = toIsoDate(dateLabel);
        if (!isoDate) return NextResponse.json({ error: "Invalid date." }, { status: 400 });

        // Look up task to get person_count for slots_needed
        const tasks = await supabaseRequest<{ id: string; person_count: number }[]>("tasks", {
          query: { select: "id,person_count", id: `eq.${taskId}`, limit: "1" },
        });
        const slotsNeeded = tasks?.[0]?.person_count ?? 1;

        const scheduleId = await getOrCreateSchedule(isoDate);
        if (!scheduleId) return NextResponse.json({ error: "Unable to create schedule." }, { status: 500 });

        const scheduleTaskId = await getOrCreateScheduleTask(scheduleId, taskId, shiftId ?? null, slotsNeeded);
        if (!scheduleTaskId) return NextResponse.json({ error: "Unable to create schedule task." }, { status: 500 });

        if (userName) {
          // Upsert — ignore if assignment already exists
          const existing = await supabaseRequest<{ id: string }[]>("schedule_assignments", {
            query: {
              select: "id",
              schedule_task_id: `eq.${scheduleTaskId}`,
              user_name: `eq.${userName}`,
              limit: "1",
            },
          });
          if (!existing?.length) {
            await supabaseRequest("schedule_assignments", {
              method: "POST",
              body: { schedule_task_id: scheduleTaskId, user_name: userName, status: "Not Started" },
            });
          }
        }

        return NextResponse.json({ ok: true, scheduleTaskId });
      }

      // ── Remove a task from today (cascade deletes assignments) ────────────
      case "remove_task": {
        const { scheduleTaskId } = body;
        if (!scheduleTaskId) {
          return NextResponse.json({ error: "Missing scheduleTaskId." }, { status: 400 });
        }
        await supabaseRequest("schedule_tasks", {
          method: "DELETE",
          query: { id: `eq.${scheduleTaskId}` },
        });
        return NextResponse.json({ ok: true });
      }

      // ── Update override notes on a schedule_task ──────────────────────────
      case "override_notes": {
        const { scheduleTaskId, notes } = body;
        if (!scheduleTaskId) {
          return NextResponse.json({ error: "Missing scheduleTaskId." }, { status: 400 });
        }
        await supabaseRequest("schedule_tasks", {
          method: "PATCH",
          query: { id: `eq.${scheduleTaskId}` },
          body: { override_notes: notes ?? null },
        });
        return NextResponse.json({ ok: true });
      }

      // ── Move a task to a different shift ──────────────────────────────────
      case "set_shift": {
        const { scheduleTaskId, shiftId } = body;
        if (!scheduleTaskId) {
          return NextResponse.json({ error: "Missing scheduleTaskId." }, { status: 400 });
        }
        await supabaseRequest("schedule_tasks", {
          method: "PATCH",
          query: { id: `eq.${scheduleTaskId}` },
          body: { shift_id: shiftId ?? null },
        });
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error("schedule/update error:", err);
    const message = err instanceof Error ? err.message : "Unable to update schedule.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
