import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";
import { taskMatchesDate } from "@/lib/recurrence";
import type { RecurringTask } from "@/lib/recurrence";

function toIsoDate(label?: string | null) {
  if (!label) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  const [month, day, year] = label.split("/");
  if (!month || !day || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

async function fetchActiveVolunteers(): Promise<Set<string>> {
  type UserRow = { display_name: string; active: boolean; user_role?: { name?: string | null } };
  const users = await supabaseRequest<UserRow[]>("users", {
    query: { select: "display_name,active,user_role:user_roles(name)", order: "display_name.asc" },
  });
  const names = (users ?? [])
    .filter(u => u.active && (u.user_role?.name ?? "").toLowerCase().includes("volunteer"))
    .map(u => u.display_name);
  return new Set(names);
}

function getTodayIso(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const d = parts.find(p => p.type === "day")?.value;
  return y && m && d ? `${y}-${m}-${d}` : new Date().toISOString().slice(0, 10);
}

// Past dates: prefer the published (live) record. Today/future: prefer staging.
async function findSourceScheduleId(isoDate: string): Promise<string | null> {
  const preferred = isoDate < getTodayIso() ? "live" : "staging";
  const fallback  = preferred === "live" ? "staging" : "live";
  for (const state of [preferred, fallback]) {
    const rows = await supabaseRequest<{ id: string }[]>("schedules", {
      query: { select: "id", schedule_date: `eq.${isoDate}`, state: `eq.${state}`, limit: "1" },
    });
    if (rows?.[0]?.id) return rows[0].id;
  }
  return null;
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
  // Match by (task_id + shift_id) so each shift gets its own row.
  // A one-off task in Morning and the same task in Afternoon are two independent
  // schedule_tasks rows — never collapse them by patching the shift on an existing row.
  const query: Record<string, string> = {
    select: "id",
    schedule_id: `eq.${scheduleId}`,
    task_id: `eq.${taskId}`,
    limit: "1",
  };
  if (shiftId !== null) {
    query.shift_id = `eq.${shiftId}`;
  } else {
    query.shift_id = "is.null";
  }

  const existing = await supabaseRequest<{ id: string }[]>("schedule_tasks", { query });
  if (existing?.[0]) return existing[0].id;

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

      // ── Copy all tasks + matched assignments from another day ─────────────
      case "copy_day": {
        const { sourceDate, targetDate } = body;
        if (!sourceDate || !targetDate) {
          return NextResponse.json({ error: "Missing sourceDate or targetDate." }, { status: 400 });
        }
        const sourceIso = toIsoDate(sourceDate);
        const targetIso = toIsoDate(targetDate);
        if (!sourceIso || !targetIso) {
          return NextResponse.json({ error: "Invalid date format." }, { status: 400 });
        }

        const sourceScheduleId = await findSourceScheduleId(sourceIso);
        if (!sourceScheduleId) {
          return NextResponse.json({ error: "No schedule found for the selected source date." }, { status: 404 });
        }

        const targetScheduleId = await getOrCreateSchedule(targetIso);
        if (!targetScheduleId) {
          return NextResponse.json({ error: "Unable to create target schedule." }, { status: 500 });
        }

        // Wipe everything on the target day — assignments cascade-delete
        await supabaseRequest("schedule_tasks", {
          method: "DELETE",
          query: { schedule_id: `eq.${targetScheduleId}` },
        });

        type SourceTaskRow = {
          id: string;
          task_id: string;
          shift_id: string | null;
          slots_needed: number;
          override_notes: string | null;
          task: (RecurringTask & { id: string }) | null;
        };
        const sourceTasks = await supabaseRequest<SourceTaskRow[]>("schedule_tasks", {
          query: {
            select: "id,task_id,shift_id,slots_needed,override_notes," +
                    "task:tasks(id,recurring,recurrence_interval,recurrence_unit," +
                    "recurrence_days,recurrence_end_type,recurrence_until,recurrence_count,created_at)",
            schedule_id: `eq.${sourceScheduleId}`,
          },
        });
        if (!sourceTasks?.length) return NextResponse.json({ ok: true });

        // Skip recurring tasks that don't match the target date — they were placed on
        // the source day correctly but would be wrong-day noise on the target.
        // One-off tasks (recurring = false) always copy through.
        const filteredTasks = sourceTasks.filter(st => {
          if (!st.task?.recurring) return true;
          return taskMatchesDate({ ...st.task, id: st.task_id }, targetIso);
        });

        if (!filteredTasks.length) return NextResponse.json({ ok: true });

        const sourceTaskIds = filteredTasks.map(t => t.id);
        type AssignRow = { schedule_task_id: string; user_name: string };
        const sourceAssignments = await supabaseRequest<AssignRow[]>("schedule_assignments", {
          query: {
            select: "schedule_task_id,user_name",
            schedule_task_id: `in.(${sourceTaskIds.join(",")})`,
          },
        });

        const assignMap = new Map<string, string[]>();
        for (const a of (sourceAssignments ?? [])) {
          if (!assignMap.has(a.schedule_task_id)) assignMap.set(a.schedule_task_id, []);
          assignMap.get(a.schedule_task_id)!.push(a.user_name);
        }

        const activeVols = await fetchActiveVolunteers();

        for (const st of filteredTasks) {
          const created = await supabaseRequest<{ id: string }[]>("schedule_tasks", {
            method: "POST",
            prefer: "return=representation",
            body: {
              schedule_id: targetScheduleId,
              task_id: st.task_id,
              shift_id: st.shift_id ?? null,
              slots_needed: st.slots_needed,
              override_notes: st.override_notes ?? null,
            },
          });
          const newStId = created?.[0]?.id;
          if (!newStId) continue;

          // Assign people from the source who are still active on the target day.
          // Anyone missing just leaves slots_needed > assignments count → unassigned row.
          const assignees = (assignMap.get(st.id) ?? []).filter(n => activeVols.has(n));
          if (!assignees.length) continue;

          await supabaseRequest("schedule_assignments", {
            method: "POST",
            body: assignees.map(n => ({
              schedule_task_id: newStId,
              user_name: n,
              status: "Not Started",
            })),
          });
        }

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
