import { NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabase";

type ScheduleRow = { id: string };
type SchedulePersonRow = { id: string; name: string };
type ScheduleCellRow = { id: string };
type TaskRow = { id: string; name: string; occurrence_date?: string | null };
type UserRow = {
  display_name: string;
  active: boolean;
  user_role?: { name?: string | null };
};

function toIsoDate(label?: string | null) {
  if (!label) return null;
  if (label.includes("-")) return label;
  const [month, day, year] = label.split("/");
  if (!month || !day || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseCell(value?: string | null) {
  if (!value?.trim()) return { tasks: [] as string[], note: "" };
  const [firstLine, ...rest] = value.split("\n");
  const tasks = firstLine
    .split(",")
    .map((task) => task.trim())
    .filter(Boolean);
  const note = rest.join("\n").trim();
  return { tasks, note };
}

async function resolveTaskIds(
  names: string[],
  occurrenceDate: string
): Promise<string[]> {
  const resolved: string[] = [];
  for (const name of names) {
    if (!name.trim()) continue;
    const byDate = await supabaseRequest<TaskRow[]>("tasks", {
      query: {
        select: "id,name,occurrence_date",
        name: `eq.${name}`,
        occurrence_date: `eq.${occurrenceDate}`,
        limit: 1,
        order: "created_at.desc",
      },
    });

    if (byDate?.[0]?.id) {
      resolved.push(byDate[0].id);
      continue;
    }

    const fallback = await supabaseRequest<TaskRow[]>("tasks", {
      query: {
        select: "id,name,occurrence_date",
        name: `eq.${name}`,
        limit: 1,
        order: "created_at.desc",
      },
    });

    if (fallback?.[0]?.id) {
      resolved.push(fallback[0].id);
      continue;
    }

    const created = await supabaseRequest<TaskRow[]>("tasks", {
      method: "POST",
      prefer: "return=representation",
      query: { select: "id,name,occurrence_date" },
      body: {
        name,
        status: "Not Started",
        priority: "Medium",
        recurring: false,
        origin_date: occurrenceDate,
        occurrence_date: occurrenceDate,
      },
    });

    if (created?.[0]?.id) {
      resolved.push(created[0].id);
    }
  }
  return resolved;
}

async function fetchVolunteers() {
  const users = await supabaseRequest<UserRow[]>("users", {
    query: {
      select: "display_name,active,user_role:user_roles(name)",
      order: "display_name.asc",
    },
  });

  return (
    users
      ?.filter(
        (user) =>
          user.active &&
          (user.user_role?.name || "")
            .toLowerCase()
            .includes("volunteer")
      )
      .map((user) => user.display_name) || []
  );
}

async function ensureSchedulePeople(scheduleId: string, volunteers: string[]) {
  const normalizedVolunteers = volunteers
    .map((name) => name.trim())
    .filter(Boolean);
  const people = await supabaseRequest<SchedulePersonRow[]>("schedule_people", {
    query: {
      select: "id,name",
      schedule_id: `eq.${scheduleId}`,
      order: "order_index.asc",
    },
  });
  const existing = new Map(
    people.map((person) => [person.name.trim(), person.id])
  );
  const missing = normalizedVolunteers.filter(
    (name) => !existing.has(name)
  );

  if (missing.length) {
    await supabaseRequest("schedule_people", {
      method: "POST",
      body: missing.map((name) => ({
        schedule_id: scheduleId,
        name: name.trim(),
        order_index: normalizedVolunteers.indexOf(name) + 1,
      })),
    });
  }

  const refreshed = await supabaseRequest<SchedulePersonRow[]>(
    "schedule_people",
    {
      query: {
        select: "id,name",
        schedule_id: `eq.${scheduleId}`,
        order: "order_index.asc",
      },
    }
  );

  return refreshed;
}

async function upsertScheduleCell(params: {
  scheduleId: string;
  personId: string;
  slotId: string;
  tasks: string[];
  note: string | null;
  blocked: boolean;
}) {
  const existing = await supabaseRequest<ScheduleCellRow[]>("schedule_cells", {
    query: {
      select: "id",
      schedule_id: `eq.${params.scheduleId}`,
      person_id: `eq.${params.personId}`,
      shift_id: `eq.${params.slotId}`,
      limit: 1,
    },
  });

  if (existing.length) {
    await supabaseRequest("schedule_cells", {
      method: "PATCH",
      query: { id: `eq.${existing[0].id}` },
      body: {
        tasks: params.tasks,
        note: params.note,
        blocked: params.blocked,
      },
    });
    return;
  }

  await supabaseRequest("schedule_cells", {
    method: "POST",
    body: {
      schedule_id: params.scheduleId,
      person_id: params.personId,
      shift_id: params.slotId,
      tasks: params.tasks,
      note: params.note,
      blocked: params.blocked,
    },
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { person, slotId, replaceValue, dateLabel, tasks, note, blocked } = body || {};

  if (!person || !slotId) {
    return NextResponse.json(
      { error: "Missing person or slot." },
      { status: 400 }
    );
  }

  const isoDate = toIsoDate(dateLabel);
  if (!isoDate) {
    return NextResponse.json(
      { error: "Missing schedule date." },
      { status: 400 }
    );
  }

  try {
    let resolvedTasks: string[] = [];
    let resolvedNote = typeof note === "string" ? note : "";
    const isBlocked = Boolean(blocked);

    if (Array.isArray(tasks)) {
      resolvedTasks = tasks
        .map((task) => {
          if (typeof task === "string") return task;
          if (task && typeof task.id === "string") return task.id;
          return "";
        })
        .filter(Boolean);
    } else if (typeof replaceValue === "string") {
      const parsed = parseCell(replaceValue);
      resolvedTasks = await resolveTaskIds(parsed.tasks, isoDate);
      resolvedNote = parsed.note;
    }

    if (isBlocked) {
      resolvedTasks = [];
      resolvedNote = "";
    }

    const hasContent =
      isBlocked || resolvedTasks.length > 0 || resolvedNote.trim().length > 0;
    console.log("schedule.update payload", {
      isoDate,
      person: String(person).trim(),
      slotId,
      taskCount: resolvedTasks.length,
      hasNote: Boolean(resolvedNote.trim()),
    });

    let scheduleRows = await supabaseRequest<ScheduleRow[]>("schedules", {
      query: {
        select: "id",
        schedule_date: `eq.${isoDate}`,
        state: "eq.staging",
        limit: 1,
      },
    });

    let scheduleId = scheduleRows?.[0]?.id || null;
    console.log("schedule.update schedule lookup", { scheduleId });

    if (!scheduleId && !hasContent) {
      return NextResponse.json({ ok: true });
    }

    if (!scheduleId) {
      const created = await supabaseRequest<ScheduleRow[]>("schedules", {
        method: "POST",
        prefer: "return=representation",
        body: {
          schedule_date: isoDate,
          state: "staging",
        },
      });
      scheduleId = created?.[0]?.id || null;
    }

    if (!scheduleId) {
      const refreshed = await supabaseRequest<ScheduleRow[]>("schedules", {
        query: {
          select: "id",
          schedule_date: `eq.${isoDate}`,
          state: "eq.staging",
          limit: 1,
        },
      });
      scheduleId = refreshed?.[0]?.id || null;
      console.log("schedule.update schedule refresh", { scheduleId });
    }

    if (!scheduleId) {
      return NextResponse.json(
        { error: "Unable to create schedule." },
        { status: 500 }
      );
    }

    const volunteers = await fetchVolunteers();
    const people = await ensureSchedulePeople(scheduleId, volunteers);
    const activeVolunteerSet = new Set(
      volunteers.map((name) => name.trim().toLowerCase())
    );
    const activePeople = people.filter((entry) =>
      activeVolunteerSet.has(entry.name.trim().toLowerCase())
    );
    const normalizedPerson = String(person).trim();
    const personEntry = activePeople.find(
      (entry) => entry.name.trim() === normalizedPerson
    );
    console.log("schedule.update people lookup", {
      normalizedPerson,
      peopleCount: activePeople.length,
      personFound: Boolean(personEntry),
    });

    let resolvedPerson = personEntry;
    if (!resolvedPerson) {
      if (!activeVolunteerSet.has(normalizedPerson.toLowerCase())) {
        return NextResponse.json(
          { error: "Inactive users cannot be scheduled." },
          { status: 400 }
        );
      }
      const created = await supabaseRequest<SchedulePersonRow[]>(
        "schedule_people",
        {
          method: "POST",
          prefer: "return=representation",
          body: {
            schedule_id: scheduleId,
            name: normalizedPerson,
            order_index: activePeople.length + 1,
          },
        }
      );
      resolvedPerson = created?.[0] ?? null;
      console.log("schedule.update person created", {
        personId: resolvedPerson?.id,
      });
    }

    if (!resolvedPerson) {
      return NextResponse.json(
        { error: "Person not found in schedule." },
        { status: 400 }
      );
    }

    if (!hasContent && !isBlocked) {
      await supabaseRequest("schedule_cells", {
        method: "DELETE",
        query: {
          schedule_id: `eq.${scheduleId}`,
          person_id: `eq.${resolvedPerson.id}`,
          shift_id: `eq.${slotId}`,
        },
      });

      const remaining = await supabaseRequest<ScheduleCellRow[]>(
        "schedule_cells",
        {
          query: {
            select: "id",
            schedule_id: `eq.${scheduleId}`,
            limit: 1,
          },
        }
      );

      if (!remaining.length) {
        await supabaseRequest("schedules", {
          method: "DELETE",
          query: { id: `eq.${scheduleId}` },
        });
      }

      return NextResponse.json({ ok: true });
    }

    await upsertScheduleCell({
      scheduleId,
      personId: resolvedPerson.id,
      slotId,
      tasks: resolvedTasks,
      note: resolvedNote.trim() || null,
      blocked: isBlocked,
    });
    console.log("schedule.update cell upserted", {
      scheduleId,
      personId: resolvedPerson.id,
      slotId,
    });

    const verify = await supabaseRequest<ScheduleCellRow[]>(
      "schedule_cells",
      {
        query: {
          select: "id",
          schedule_id: `eq.${scheduleId}`,
          person_id: `eq.${resolvedPerson.id}`,
          shift_id: `eq.${slotId}`,
          limit: 1,
        },
      }
    );
    console.log("schedule.update cell verify", {
      found: verify.length,
    });
    if (!verify.length) {
      return NextResponse.json(
        { error: "Schedule cell failed to persist." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update schedule", err);
    const message = err instanceof Error ? err.message : "Unable to update schedule.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
