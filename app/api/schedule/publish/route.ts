import { NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabase";
import { sendPushNotifications } from "@/lib/push";

function toIsoDate(label?: string | null) {
  if (!label) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  const [month, day, year] = label.split("/");
  if (!month || !day || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

type ScheduleTaskRow = {
  id: string;
  task_id: string;
  shift_id: string | null;
  slots_needed: number;
  override_notes: string | null;
};

type AssignmentRow = {
  schedule_task_id: string;
  user_name: string;
  status: string;
  completed_at: string | null;
  completion_notes: string | null;
};

// Build a per-user task signature for detecting schedule changes (for push notifications).
// signature = sorted list of "taskId|shiftId" strings joined together
function buildUserSignatures(
  tasks: ScheduleTaskRow[],
  assignments: AssignmentRow[]
): Map<string, string> {
  const stMap = new Map(tasks.map(st => [st.id, st]));
  const byUser = new Map<string, string[]>();

  for (const a of assignments) {
    const st = stMap.get(a.schedule_task_id);
    if (!st) continue;
    const sig = `${st.task_id}|${st.shift_id ?? ""}`;
    if (!byUser.has(a.user_name)) byUser.set(a.user_name, []);
    byUser.get(a.user_name)!.push(sig);
  }

  const out = new Map<string, string>();
  for (const [name, sigs] of byUser) {
    out.set(name, [...sigs].sort().join("||"));
  }
  return out;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const isoDate = toIsoDate(body?.dateLabel);
  if (!isoDate) {
    return NextResponse.json({ error: "Missing schedule date." }, { status: 400 });
  }

  try {
    // 1. Find staging schedule
    const stagingRows = await supabaseRequest<{ id: string }[]>("schedules", {
      query: { select: "id", schedule_date: `eq.${isoDate}`, state: "eq.staging", limit: "1" },
    });
    const stagingId = stagingRows?.[0]?.id;
    if (!stagingId) {
      return NextResponse.json({ error: "No staging schedule to publish." }, { status: 400 });
    }

    // 2. Read staging tasks, then assignments
    const stagingTasks = await supabaseRequest<ScheduleTaskRow[]>("schedule_tasks", {
      query: {
        select: "id,task_id,shift_id,slots_needed,override_notes",
        schedule_id: `eq.${stagingId}`,
      },
    });

    const stagingTaskIds = (stagingTasks ?? []).map(t => t.id);
    const stagingAssignments = stagingTaskIds.length
      ? await supabaseRequest<AssignmentRow[]>("schedule_assignments", {
          query: {
            select: "schedule_task_id,user_name,status,completed_at,completion_notes",
            schedule_task_id: `in.(${stagingTaskIds.join(",")})`,
          },
        })
      : [];

    const stagingSigs = buildUserSignatures(stagingTasks ?? [], stagingAssignments ?? []);

    // 3. Read existing live data (for push notification diff)
    const liveRows = await supabaseRequest<{ id: string }[]>("schedules", {
      query: { select: "id", schedule_date: `eq.${isoDate}`, state: "eq.live", limit: "1" },
    });
    const existingLiveId = liveRows?.[0]?.id;

    let liveSigs = new Map<string, string>();
    if (existingLiveId) {
      const liveTaskIds = (
        await supabaseRequest<{ id: string }[]>("schedule_tasks", {
          query: { select: "id", schedule_id: `eq.${existingLiveId}` },
        })
      ).map(r => r.id);

      if (liveTaskIds.length) {
        const [liveTasks, liveAssignments] = await Promise.all([
          supabaseRequest<ScheduleTaskRow[]>("schedule_tasks", {
            query: { select: "id,task_id,shift_id,slots_needed,override_notes", schedule_id: `eq.${existingLiveId}` },
          }),
          supabaseRequest<AssignmentRow[]>("schedule_assignments", {
            query: {
              select: "schedule_task_id,user_name,status,completed_at,completion_notes",
              schedule_task_id: `in.(${liveTaskIds.join(",")})`,
            },
          }),
        ]);
        liveSigs = buildUserSignatures(liveTasks ?? [], liveAssignments ?? []);
      }
    }

    // 4. Delete old live schedule (cascade removes its tasks + assignments)
    if (existingLiveId) {
      await supabaseRequest("schedules", {
        method: "DELETE",
        query: { schedule_date: `eq.${isoDate}`, state: "eq.live" },
      });
    }

    // 5. Create new live schedule row
    const createdLive = await supabaseRequest<{ id: string }[]>("schedules", {
      method: "POST",
      prefer: "return=representation",
      body: { schedule_date: isoDate, state: "live" },
    });
    const liveId = createdLive?.[0]?.id;
    if (!liveId) {
      return NextResponse.json({ error: "Unable to create live schedule." }, { status: 500 });
    }

    // 6. Copy schedule_tasks to live (one at a time to get new IDs for assignment mapping)
    if ((stagingTasks ?? []).length) {
      const oldToNew = new Map<string, string>();

      for (const st of stagingTasks!) {
        const newRows = await supabaseRequest<{ id: string }[]>("schedule_tasks", {
          method: "POST",
          prefer: "return=representation",
          body: {
            schedule_id: liveId,
            task_id: st.task_id,
            shift_id: st.shift_id,
            slots_needed: st.slots_needed,
            override_notes: st.override_notes,
          },
        });
        if (newRows?.[0]?.id) oldToNew.set(st.id, newRows[0].id);
      }

      // 7. Copy assignments, re-mapping schedule_task_id to new live IDs
      const assignRows = (stagingAssignments ?? [])
        .map(a => {
          const newStId = oldToNew.get(a.schedule_task_id);
          if (!newStId) return null;
          return {
            schedule_task_id: newStId,
            user_name: a.user_name,
            status: a.status,
            completed_at: a.completed_at,
            completion_notes: a.completion_notes,
          };
        })
        .filter(Boolean);

      if (assignRows.length) {
        await supabaseRequest("schedule_assignments", {
          method: "POST",
          body: assignRows,
        });
      }
    }

    // 8. Send push notifications to people whose schedule changed
    const notifyNames = Array.from(stagingSigs.entries())
      .filter(([name, sig]) => name && liveSigs.get(name) !== sig)
      .map(([name]) => name);

    // Also notify anyone who was on the live schedule but was removed
    for (const [name] of liveSigs) {
      if (!stagingSigs.has(name) && !notifyNames.includes(name)) {
        notifyNames.push(name);
      }
    }

    if (notifyNames.length) {
      await sendPushNotifications({
        userNames: notifyNames,
        payload: {
          title: "Schedule updated",
          body: "Changes have been made to your schedule. Tap to view.",
          url: "/hub",
          tag: "schedule-update",
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to publish schedule:", err);
    return NextResponse.json({ error: "Unable to publish schedule." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const isoDate = toIsoDate(body?.dateLabel);
  if (!isoDate) {
    return NextResponse.json({ error: "Missing schedule date." }, { status: 400 });
  }

  try {
    await supabaseRequest("schedules", {
      method: "DELETE",
      query: { schedule_date: `eq.${isoDate}`, state: "eq.live" },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to remove published schedule:", err);
    return NextResponse.json({ error: "Unable to remove published schedule." }, { status: 500 });
  }
}
