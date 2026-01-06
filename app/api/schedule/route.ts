import { NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabase";

type SlotRow = {
  id: string;
  label: string;
  time_range: string | null;
};

type ScheduleRow = {
  id: string;
};

type SchedulePersonRow = {
  id: string;
  name: string;
  order_index: number;
};

type ScheduleCellRow = {
  id: string;
  person_id: string;
  shift_id: string;
  tasks: string[];
  note: string | null;
};

type TaskRow = {
  id: string;
  name: string;
};

type UserRow = {
  display_name: string;
  active: boolean;
  user_role?: { name?: string | null };
};

type Slot = { id: string; label: string; timeRange?: string; isMeal?: boolean };

function toIsoDate(label?: string | null) {
  if (!label) return null;
  if (label.includes("-")) return label;
  const [month, day, year] = label.split("/");
  if (!month || !day || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function toLabel(date: string) {
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;
  return `${month}/${day}/${year}`;
}

function isMealShift(label: string) {
  const lower = label.toLowerCase();
  return ["breakfast", "lunch", "dinner"].some((item) => lower.includes(item));
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

async function fetchSlots(): Promise<Slot[]> {
  const rows = await supabaseRequest<SlotRow[]>("shifts", {
    query: {
      select: "id,label,time_range,order_index",
      order: "order_index.asc",
    },
  });

  if (!rows.length) {
    await supabaseRequest("shifts", {
      method: "POST",
      body: [
        { label: "Breakfast", time_range: "10:30-11:30", order_index: 1 },
        { label: "Lunch", time_range: "2:30-3:30", order_index: 2 },
        { label: "Dinner", time_range: null, order_index: 3 },
        { label: "Morning Shift 1", time_range: "7:30-9:00", order_index: 4 },
        { label: "Morning Shift 2", time_range: "9:00-10:30", order_index: 5 },
        { label: "Noon Shift 1", time_range: "11:30-1:00", order_index: 6 },
        { label: "Noon Shift 2", time_range: "1:00-2:30", order_index: 7 },
        { label: "Afternoon Shift 1", time_range: "3:30-4:00", order_index: 8 },
        { label: "Afternoon Shift 2", time_range: "4:00-6:30", order_index: 9 },
        { label: "Evening Shift", time_range: null, order_index: 10 },
        { label: "Weekend Saturday Morning", time_range: null, order_index: 11 },
        { label: "Weekend Saturday Evening", time_range: null, order_index: 12 },
        { label: "Weekend Sunday Morning", time_range: null, order_index: 13 },
        { label: "Weekend Sunday Evening", time_range: null, order_index: 14 },
      ],
    });
    const seeded = await supabaseRequest<SlotRow[]>("shifts", {
      query: {
        select: "id,label,time_range,order_index",
        order: "order_index.asc",
      },
    });
    return seeded.map((slot) => ({
      id: slot.id,
      label: slot.label,
      timeRange: slot.time_range || undefined,
      isMeal: isMealShift(slot.label),
    }));
  }

  return rows.map((slot) => ({
    id: slot.id,
    label: slot.label,
    timeRange: slot.time_range || undefined,
    isMeal: isMealShift(slot.label),
  }));
}

async function syncSchedulePeople(scheduleId: string, volunteers: string[]) {
  const people = await supabaseRequest<SchedulePersonRow[]>("schedule_people", {
    query: {
      select: "id,name,order_index",
      schedule_id: `eq.${scheduleId}`,
      order: "order_index.asc",
    },
  });

  const normalizedVolunteers = volunteers.map((name) => name.trim()).filter(Boolean);
  const existingNames = new Map(
    people.map((person) => [person.name.trim(), person])
  );
  const desiredSet = new Set(normalizedVolunteers);
  const missing = normalizedVolunteers.filter((name) => !existingNames.has(name));

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

  const refreshed = await supabaseRequest<SchedulePersonRow[]>("schedule_people", {
    query: {
      select: "id,name,order_index",
      schedule_id: `eq.${scheduleId}`,
      order: "order_index.asc",
    },
  });

  if (!normalizedVolunteers.length) {
    return refreshed;
  }

  const ordered = [
    ...normalizedVolunteers,
    ...refreshed
      .map((person) => person.name.trim())
      .filter((name) => !desiredSet.has(name)),
  ];

  await Promise.all(
    refreshed.map((person) => {
      const nextIndex = ordered.indexOf(person.name.trim());
      if (nextIndex < 0) return Promise.resolve(null);
      if (person.order_index === nextIndex + 1) return Promise.resolve(null);
      return supabaseRequest("schedule_people", {
        method: "PATCH",
        query: { id: `eq.${person.id}` },
        body: { order_index: nextIndex + 1 },
      });
    })
  );

  return supabaseRequest<SchedulePersonRow[]>("schedule_people", {
    query: {
      select: "id,name,order_index",
      schedule_id: `eq.${scheduleId}`,
      order: "order_index.asc",
    },
  });
}

async function ensureScheduleCells(scheduleId: string, people: SchedulePersonRow[], slots: Slot[]) {
  const existing = await supabaseRequest<ScheduleCellRow[]>("schedule_cells", {
    query: {
      select: "id,person_id,shift_id",
      schedule_id: `eq.${scheduleId}`,
    },
  });

  const existingKeys = new Set(
    existing.map((cell) => `${cell.person_id}-${cell.shift_id}`)
  );

  const missing: { schedule_id: string; person_id: string; shift_id: string }[] = [];
  people.forEach((person) => {
    slots.forEach((slot) => {
      const key = `${person.id}-${slot.id}`;
      if (!existingKeys.has(key)) {
        missing.push({
          schedule_id: scheduleId,
          person_id: person.id,
          shift_id: slot.id,
        });
      }
    });
  });

  if (missing.length) {
    await supabaseRequest("schedule_cells", {
      method: "POST",
      body: missing.map((cell) => ({ ...cell, tasks: [], note: null })),
    });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const dateLabel = url.searchParams.get("date") || "";
    const isoDate = toIsoDate(dateLabel);
    if (!isoDate) {
      return NextResponse.json(
        { error: "Missing or invalid date." },
        { status: 400 }
      );
    }

    const [slots, volunteers] = await Promise.all([
      fetchSlots(),
      fetchVolunteers(),
    ]);

    const scheduleRows = await supabaseRequest<ScheduleRow[]>("schedules", {
      query: {
        select: "id",
        schedule_date: `eq.${isoDate}`,
        state: "eq.staging",
        limit: 1,
      },
    });

    const scheduleId = scheduleRows?.[0]?.id || null;

    if (!scheduleId) {
      const emptyCells = volunteers.map(() =>
        slots.map(() => ({ tasks: [], note: "" }))
      );
      return NextResponse.json({
        people: volunteers,
        slots,
        cells: emptyCells,
        scheduleDate: toLabel(isoDate),
      });
    }

    const schedulePeople = await syncSchedulePeople(scheduleId, volunteers);
    await ensureScheduleCells(scheduleId, schedulePeople, slots);
    const cells = await supabaseRequest<ScheduleCellRow[]>("schedule_cells", {
      query: {
        select: "id,person_id,shift_id,tasks,note",
        schedule_id: `eq.${scheduleId}`,
      },
    });

    const cellMap = new Map<string, ScheduleCellRow>();
    cells.forEach((cell) => {
      cellMap.set(`${cell.person_id}-${cell.shift_id}`, cell);
    });

    const taskIds = Array.from(
      new Set(cells.flatMap((cell) => cell.tasks || []))
    );
    const taskRows = taskIds.length
      ? await supabaseRequest<TaskRow[]>("tasks", {
          query: {
            select: "id,name",
            id: `in.(${taskIds.join(",")})`,
          },
        })
      : [];
    const taskMap = new Map(taskRows.map((task) => [task.id, task.name]));

    const matrix = schedulePeople.map((person) =>
      slots.map((slot) => {
        const cell = cellMap.get(`${person.id}-${slot.id}`);
        if (!cell) return { tasks: [], note: "" };
        const tasks = (cell.tasks || [])
          .map((taskId) => {
            const name = taskMap.get(taskId);
            if (!name) return null;
            return { id: taskId, name };
          })
          .filter(Boolean) as { id: string; name: string }[];
        return {
          tasks,
          note: (cell.note || "").trim(),
        };
      })
    );
    const existsMatrix = schedulePeople.map((person) =>
      slots.map((slot) => cellMap.has(`${person.id}-${slot.id}`))
    );

    return NextResponse.json({
      people: schedulePeople.map((person) => person.name),
      slots,
      cells: matrix,
      cellExists: existsMatrix,
      scheduleDate: toLabel(isoDate),
    });
  } catch (err) {
    console.error("Failed to load schedule", err);
    return NextResponse.json(
      { error: "Unable to load schedule" },
      { status: 500 }
    );
  }
}
