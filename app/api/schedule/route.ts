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

  const existing = await supabaseRequest<{ task_id: string }[]>("schedule_tasks", {
    query: { select: "task_id", schedule_id: `eq.${scheduleId}` },
  });
  const existingIds = new Set((existing ?? []).map(r => r.task_id));

  for (const task of tasks) {
    if (existingIds.has(task.id)) continue;
    if (!taskMatchesDate(task, isoDate)) continue;

    // after_count guard: count existing occurrences across all schedules
    if (task.recurrence_end_type === "after_count" && task.recurrence_count != null) {
      const countRows = await supabaseRequest<{ id: string }[]>("schedule_tasks", {
        query: { select: "id", task_id: `eq.${task.id}` },
      });
      if ((countRows?.length ?? 0) >= task.recurrence_count) continue;
    }

    // Create schedule_tasks row
    const created = await supabaseRequest<{ id: string }[]>("schedule_tasks", {
      method: "POST",
      prefer: "return=representation",
      body: {
        schedule_id: scheduleId,
        task_id: task.id,
        slots_needed: task.person_count ?? 1,
      },
    });
    const newStId = created?.[0]?.id;
    if (!newStId) continue;

    // Find most recent previous occurrence and copy its assignments
    const prevTasks = await supabaseRequest<{ id: string; schedule: { schedule_date: string } | null }[]>(
      "schedule_tasks",
      {
        query: {
          select: "id,schedule:schedules(schedule_date)",
          task_id: `eq.${task.id}`,
          id: `neq.${newStId}`,
          order: "created_at.desc",
          limit: "1",
        },
      }
    );
    const prevStId = prevTasks?.[0]?.id;
    if (!prevStId) continue;

    const prevAssignments = await supabaseRequest<{ user_name: string }[]>("schedule_assignments", {
      query: { select: "user_name", schedule_task_id: `eq.${prevStId}` },
    });
    if (!prevAssignments?.length) continue;

    // Only copy active users
    const activeVolunteers = new Set(await fetchVolunteers());
    const toAdd = (prevAssignments).filter(a => activeVolunteers.has(a.user_name));
    if (!toAdd.length) continue;

    await supabaseRequest("schedule_assignments", {
      method: "POST",
      body: toAdd.map(a => ({
        schedule_task_id: newStId,
        user_name: a.user_name,
        status: "Not Started",
      })),
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
    const scheduleState = isStaging ? "staging" : "live";

    const [shifts, volunteers] = await Promise.all([fetchShifts(), fetchVolunteers()]);

    let scheduleId = await findScheduleId(isoDate, scheduleState);

    if (isStaging && !scheduleId) {
      scheduleId = await createSchedule(isoDate);
      if (scheduleId) await autoPopulate(scheduleId, isoDate);
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

    return NextResponse.json({
      shifts,
      people: volunteers,
      scheduleTasks,
      scheduleId,
      scheduleDate: toLabel(isoDate),
    });
  } catch (err) {
    console.error("Failed to load schedule:", err);
    return NextResponse.json({ error: "Unable to load schedule." }, { status: 500 });
  }
}
