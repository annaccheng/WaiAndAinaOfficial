import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";
import { taskMatchesDate } from "@/lib/recurrence";
import type { RecurringTask } from "@/lib/recurrence";

// ─── Types ────────────────────────────────────────────────────────────────────

type ShiftRow = { id: string; label: string; time_range: string | null; order_index: number };
type UserRow  = { display_name: string; active: boolean; user_role?: { name?: string | null } };

type RecurringTaskRow = RecurringTask & {
  name: string;
  description: string | null;
  person_count: number;
};

type ScheduleTaskRow = {
  id: string;
  task_id: string;
  shift_id: string | null;
  slots_needed: number;
  override_notes: string | null;
  task: { name: string; description: string | null; recurring: boolean } | null;
};

type AssignmentRow = {
  id: string;
  schedule_task_id: string;
  user_name: string;
  status: string;
  completed_at: string | null;
  completion_notes: string | null;
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toIsoDate(label?: string | null) {
  if (!label) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  const [month, day, year] = label.split("/");
  if (!month || !day || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function getTodayHst(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const d = parts.find(p => p.type === "day")?.value;
  return y && m && d ? `${y}-${m}-${d}` : new Date().toISOString().slice(0, 10);
}

function toLabel(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function isMealShift(label: string) {
  return ["breakfast", "lunch", "dinner"].some(w => label.toLowerCase().includes(w));
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function fetchShifts() {
  const rows = await supabaseRequest<ShiftRow[]>("shifts", {
    query: { select: "id,label,time_range,order_index", order: "order_index.asc" },
  });
  return (rows ?? []).map(s => ({
    id: s.id,
    label: s.label,
    timeRange: s.time_range ?? undefined,
    isMeal: isMealShift(s.label),
  }));
}

async function fetchVolunteers(): Promise<string[]> {
  const users = await supabaseRequest<UserRow[]>("users", {
    query: { select: "display_name,active,user_role:user_roles(name)", order: "display_name.asc" },
  });
  return (users ?? [])
    .filter(u => u.active && (u.user_role?.name ?? "").toLowerCase().includes("volunteer"))
    .map(u => u.display_name);
}

async function findScheduleId(isoDate: string, state: "staging" | "live"): Promise<string | null> {
  const rows = await supabaseRequest<{ id: string }[]>("schedules", {
    query: { select: "id", schedule_date: `eq.${isoDate}`, state: `eq.${state}`, limit: "1" },
  });
  return rows?.[0]?.id ?? null;
}

async function createSchedule(isoDate: string): Promise<string | null> {
  const rows = await supabaseRequest<{ id: string }[]>("schedules", {
    method: "POST",
    prefer: "return=representation",
    body: { schedule_date: isoDate, state: "staging" },
  });
  return rows?.[0]?.id ?? null;
}

// ─── Auto-populate recurring tasks ───────────────────────────────────────────

async function autoPopulate(scheduleId: string, isoDate: string) {
  const tasks = await supabaseRequest<RecurringTaskRow[]>("tasks", {
    query: {
      select: "id,name,description,person_count,recurring,recurrence_interval,recurrence_unit," +
              "recurrence_days,recurrence_end_type,recurrence_until,recurrence_count,created_at",
      recurring: "eq.true",
      parent_task_id: "is.null",
    },
  });
  if (!tasks?.length) return;

  // Existing staging schedule_tasks — need id and shift_id to support full refresh
  const existingRows = await supabaseRequest<{ id: string; task_id: string; shift_id: string | null }[]>("schedule_tasks", {
    query: { select: "id,task_id,shift_id", schedule_id: `eq.${scheduleId}` },
  });
  const existingTaskMap = new Map((existingRows ?? []).map(r => [r.task_id, { id: r.id, shiftId: r.shift_id }]));

  // All live schedules ordered by schedule_date (most recent first) — ensures we copy
  // from the latest published day rather than the most-recently-created row.
  const liveSchedules = await supabaseRequest<{ id: string; schedule_date: string }[]>("schedules", {
    query: { select: "id,schedule_date", state: "eq.live", order: "schedule_date.desc" },
  });
  const liveSchedIds      = (liveSchedules ?? []).map(s => s.id);
  const liveSchedDateMap  = new Map((liveSchedules ?? []).map(s => [s.id, s.schedule_date]));

  // Pre-fetch all live schedule_tasks in one query (replaces N per-task queries)
  type LiveStRow = { id: string; task_id: string; shift_id: string | null; schedule_id: string };
  const allLiveStRows: LiveStRow[] = liveSchedIds.length
    ? (await supabaseRequest<LiveStRow[]>("schedule_tasks", {
        query: { select: "id,task_id,shift_id,schedule_id", schedule_id: `in.(${liveSchedIds.join(",")})` },
      }) ?? [])
    : [];

  // Build: task_id → the row from the most-recently-dated live schedule
  // Only count rows from dates where the task's recurrence rule actually matches —
  // this prevents wrong-day rows (e.g. inserted via a day-copy then published) from
  // becoming the reference point and poisoning future correct-day auto-populate.
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  type BestRow = { id: string; shift_id: string | null; date: string };
  const liveBestRowMap = new Map<string, BestRow>();
  for (const row of allLiveStRows) {
    const rowDate = liveSchedDateMap.get(row.schedule_id) ?? "";
    if (!rowDate) continue;
    const t = taskMap.get(row.task_id);
    if (t && !taskMatchesDate(t, rowDate)) continue; // skip wrong-day rows
    const cur = liveBestRowMap.get(row.task_id);
    if (!cur || rowDate > cur.date) {
      liveBestRowMap.set(row.task_id, { id: row.id, shift_id: row.shift_id, date: rowDate });
    }
  }

  // Pre-fetch assignments for the best live rows (one query instead of N)
  const liveBestIds    = [...liveBestRowMap.values()].map(r => r.id);
  const liveAssignRows = liveBestIds.length
    ? (await supabaseRequest<{ schedule_task_id: string; user_name: string }[]>("schedule_assignments", {
        query: { select: "schedule_task_id,user_name", schedule_task_id: `in.(${liveBestIds.join(",")})` },
      }) ?? [])
    : [];
  const liveAssignMap = new Map<string, string[]>();
  for (const a of liveAssignRows) {
    if (!liveAssignMap.has(a.schedule_task_id)) liveAssignMap.set(a.schedule_task_id, []);
    liveAssignMap.get(a.schedule_task_id)!.push(a.user_name);
  }

  // Pre-fetch current staging assignments so we can refresh stale ones without N queries
  const existingStIds      = [...existingTaskMap.values()].map(v => v.id);
  const stagingAssignRows  = existingStIds.length
    ? (await supabaseRequest<{ schedule_task_id: string; user_name: string; status: string }[]>(
        "schedule_assignments",
        { query: { select: "schedule_task_id,user_name,status", schedule_task_id: `in.(${existingStIds.join(",")})` } }
      ) ?? [])
    : [];
  const stagingAssignMap = new Map<string, { user_name: string; status: string }[]>();
  for (const a of stagingAssignRows) {
    if (!stagingAssignMap.has(a.schedule_task_id)) stagingAssignMap.set(a.schedule_task_id, []);
    stagingAssignMap.get(a.schedule_task_id)!.push(a);
  }

  let activeVolunteersCache: Set<string> | null = null;
  async function getActiveVolunteers() {
    if (!activeVolunteersCache) activeVolunteersCache = new Set(await fetchVolunteers());
    return activeVolunteersCache;
  }

  for (const task of tasks) {
    if (!taskMatchesDate(task, isoDate)) continue;

    const prevRow = liveBestRowMap.get(task.id) ?? null;

    // ── Task already has a staging row: refresh its assignments and shift ───────
    // When the admin opens a day that was previously loaded, and a newer schedule
    // has been published since then, the pre-copied data can be stale.
    // We refresh as long as nobody has started working (all Not Started).
    if (existingTaskMap.has(task.id)) {
      if (!prevRow) continue;
      const { id: stagingStId, shiftId: currentShiftId } = existingTaskMap.get(task.id)!;
      const currentAssigns = stagingAssignMap.get(stagingStId) ?? [];
      if (!currentAssigns.every(a => a.status === "Not Started")) continue;

      // Refresh shift_id when it changed in the most recent live occurrence
      if (prevRow.shift_id !== null && prevRow.shift_id !== currentShiftId) {
        try {
          await supabaseRequest("schedule_tasks", {
            method: "PATCH",
            query: { id: `eq.${stagingStId}` },
            body: { shift_id: prevRow.shift_id },
          });
        } catch (err) {
          console.error("autoPopulate: failed to refresh shift_id for task", task.id, err);
        }
      }

      const liveAssignees = liveAssignMap.get(prevRow.id) ?? [];
      const activeVols    = await getActiveVolunteers();
      const toAdd         = liveAssignees.filter(n => activeVols.has(n));

      // Skip if the assignment set is already identical
      const currentNamesSet = new Set(currentAssigns.map(a => a.user_name));
      const alreadySame     = toAdd.length === currentAssigns.length && toAdd.every(n => currentNamesSet.has(n));
      if (alreadySame) continue;

      try {
        if (currentAssigns.length > 0) {
          await supabaseRequest("schedule_assignments", {
            method: "DELETE",
            query: { schedule_task_id: `eq.${stagingStId}` },
          });
        }
        if (toAdd.length > 0) {
          await supabaseRequest("schedule_assignments", {
            method: "POST",
            body: toAdd.map(n => ({ schedule_task_id: stagingStId, user_name: n, status: "Not Started" })),
          });
        }
      } catch (err) {
        console.error("autoPopulate: failed to refresh assignments for task", task.id, err);
      }
      continue;
    }

    // ── New task for this day ─────────────────────────────────────────────────
    if (task.recurrence_end_type === "after_count" && task.recurrence_count != null) {
      const countRows = await supabaseRequest<{ id: string }[]>("schedule_tasks", {
        query: { select: "id", task_id: `eq.${task.id}` },
      });
      if ((countRows?.length ?? 0) >= task.recurrence_count) continue;
    }

    const created = await supabaseRequest<{ id: string }[]>("schedule_tasks", {
      method: "POST",
      prefer: "return=representation",
      body: {
        schedule_id: scheduleId,
        task_id: task.id,
        slots_needed: task.person_count ?? 1,
        ...(prevRow?.shift_id ? { shift_id: prevRow.shift_id } : {}),
      },
    });
    const newStId = created?.[0]?.id;
    if (!newStId || !prevRow) continue;

    const liveAssignees = liveAssignMap.get(prevRow.id) ?? [];
    if (!liveAssignees.length) continue;

    const activeVols = await getActiveVolunteers();
    const toAdd      = liveAssignees.filter(n => activeVols.has(n));
    if (!toAdd.length) continue;

    await supabaseRequest("schedule_assignments", {
      method: "POST",
      body: toAdd.map(n => ({ schedule_task_id: newStId, user_name: n, status: "Not Started" })),
    });
  }
}

// ─── Load schedule data ───────────────────────────────────────────────────────

async function fetchScheduleTasks(scheduleId: string) {
  const tasks = await supabaseRequest<ScheduleTaskRow[]>("schedule_tasks", {
    query: {
      select: "id,task_id,shift_id,slots_needed,override_notes," +
              "task:tasks(name,description,recurring)",
      schedule_id: `eq.${scheduleId}`,
    },
  });
  if (!tasks?.length) return [];

  const taskIds = tasks.map(t => t.id);
  const assignments = taskIds.length
    ? await supabaseRequest<AssignmentRow[]>("schedule_assignments", {
        query: {
          select: "id,schedule_task_id,user_name,status,completed_at,completion_notes",
          schedule_task_id: `in.(${taskIds.join(",")})`,
        },
      })
    : [];

  const assignMap = new Map<string, AssignmentRow[]>();
  for (const a of (assignments ?? [])) {
    if (!assignMap.has(a.schedule_task_id)) assignMap.set(a.schedule_task_id, []);
    assignMap.get(a.schedule_task_id)!.push(a);
  }

  return tasks.map(st => ({
    id: st.id,
    taskId: st.task_id,
    taskName: st.task?.name ?? "",
    taskDescription: st.task?.description ?? null,
    shiftId: st.shift_id,
    slotsNeeded: st.slots_needed,
    isRecurring: st.task?.recurring ?? false,
    overrideNotes: st.override_notes,
    assignments: (assignMap.get(st.id) ?? []).map(a => ({
      id: a.id,
      userName: a.user_name,
      status: a.status,
      completedAt: a.completed_at,
      completionNotes: a.completion_notes,
    })),
  }));
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { shifts: [], people: [], scheduleTasks: [], scheduleDate: toLabel(getTodayHst()) },
      { status: 503 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const isoDate = toIsoDate(searchParams.get("date")) ?? getTodayHst();
    const isStaging = searchParams.get("staging") === "1";
    const skipAutoPopulate = searchParams.get("skipAutoPopulate") === "1";
    const scheduleState = isStaging ? "staging" : "live";

    const [shifts, volunteers] = await Promise.all([fetchShifts(), fetchVolunteers()]);

    let scheduleId = await findScheduleId(isoDate, scheduleState);

    if (isStaging && !scheduleId) {
      scheduleId = await createSchedule(isoDate);
    }

    // Auto-populate runs on every staging load for today and future dates only.
    // Past staging schedules are historical records — running auto-populate on them
    // would overwrite assignments with current data (removing deactivated members,
    // potentially adding new ones who weren't there at the time).
    if (isStaging && scheduleId && isoDate >= getTodayHst() && !skipAutoPopulate) {
      try {
        await autoPopulate(scheduleId, isoDate);
      } catch (err) {
        console.error("Auto-populate failed:", err);
      }
    }

    if (!scheduleId) {
      return NextResponse.json({
        shifts,
        people: volunteers,
        scheduleTasks: [],
        scheduleDate: toLabel(isoDate),
        ...(!isStaging ? { message: "No live schedule published yet." } : {}),
      });
    }

    const scheduleTasks = await fetchScheduleTasks(scheduleId);

    // Build the people list: active volunteers first, then anyone with an assignment
    // on this schedule who is no longer active. This keeps historical schedules intact.
    const activeSet = new Set(volunteers);
    const extraPeople = [...new Set(
      scheduleTasks.flatMap(st => st.assignments.map(a => a.userName))
    )].filter(n => !activeSet.has(n)).sort();
    const people = [...volunteers, ...extraPeople];

    // Enrich each task with the count of currently-active assignments so the
    // client can correctly flag unfilled slots even when a deactivated person is assigned.
    const enrichedTasks = scheduleTasks.map(st => ({
      ...st,
      activeAssignments: st.assignments.filter(a => activeSet.has(a.userName)).length,
    }));

    // Backward-compatible shape for the volunteer hub page (app/hub/page.tsx) which
    // still uses the old slots/cells/taskCells format. Remove once that page is rewritten.
    const slots = shifts.map(s => ({ ...s, isMeal: false }));
    const cells = people.map(person =>
      shifts.map(shift =>
        enrichedTasks
          .filter(st => st.shiftId === shift.id && st.assignments.some(a => a.userName === person))
          .map(st => st.taskName)
          .join(", ")
      )
    );
    const taskCells = people.map(person =>
      shifts.map(shift => ({
        tasks: enrichedTasks
          .filter(st => st.shiftId === shift.id && st.assignments.some(a => a.userName === person))
          .map(st => ({ id: st.taskId, name: st.taskName })),
      }))
    );

    return NextResponse.json({
      shifts,
      people,
      activeVolunteers: volunteers,
      scheduleTasks: enrichedTasks,
      scheduleId,
      scheduleDate: toLabel(isoDate),
      // Legacy fields:
      slots,
      cells,
      taskCells,
    });
  } catch (err) {
    console.error("Failed to load schedule:", err);
    return NextResponse.json({ error: "Unable to load schedule." }, { status: 500 });
  }
}
