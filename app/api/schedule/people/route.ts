import { NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabase";

type ScheduleRow = { id: string };
type SchedulePersonRow = { id: string; name: string; order_index: number };
type ShiftRow = { id: string };

function toIsoDate(label?: string | null) {
  if (!label) return null;
  if (label.includes("-")) return label;
  const [month, day, year] = label.split("/");
  if (!month || !day || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export async function GET() {
  return NextResponse.json({ people: [] });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const personName = String(body?.name || "").trim();
  const isoDate = toIsoDate(body?.dateLabel);

  if (!personName) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  if (!isoDate) {
    return NextResponse.json({ error: "Schedule date is required." }, { status: 400 });
  }

  try {
    let scheduleRows = await supabaseRequest<ScheduleRow[]>("schedules", {
      query: {
        select: "id",
        schedule_date: `eq.${isoDate}`,
        state: "eq.staging",
        limit: 1,
      },
    });

    let scheduleId = scheduleRows?.[0]?.id ?? null;
    if (!scheduleId) {
      const created = await supabaseRequest<ScheduleRow[]>("schedules", {
        method: "POST",
        prefer: "return=representation",
        body: {
          schedule_date: isoDate,
          state: "staging",
        },
      });
      scheduleId = created?.[0]?.id ?? null;
    }

    if (!scheduleId) {
      return NextResponse.json({ error: "Unable to create schedule." }, { status: 500 });
    }

    const [people, shifts] = await Promise.all([
      supabaseRequest<SchedulePersonRow[]>("schedule_people", {
        query: {
          select: "id,name,order_index",
          schedule_id: `eq.${scheduleId}`,
          order: "order_index.asc",
        },
      }),
      supabaseRequest<ShiftRow[]>("shifts", {
        query: {
          select: "id",
          order: "order_index.asc",
        },
      }),
    ]);

    const existing = people.find(
      (person) => person.name.trim().toLowerCase() === personName.toLowerCase()
    );

    let personId = existing?.id ?? null;

    if (!personId) {
      const maxOrder = people.reduce((max, person) => Math.max(max, person.order_index || 0), 0);
      const inserted = await supabaseRequest<SchedulePersonRow[]>("schedule_people", {
        method: "POST",
        prefer: "return=representation",
        body: {
          schedule_id: scheduleId,
          name: personName,
          order_index: maxOrder + 1,
        },
      });
      personId = inserted?.[0]?.id ?? null;
    }

    if (!personId) {
      return NextResponse.json({ error: "Unable to add person." }, { status: 500 });
    }

    if (shifts.length) {
      const existingCells = await supabaseRequest<{ shift_id: string }[]>("schedule_cells", {
        query: {
          select: "shift_id",
          schedule_id: `eq.${scheduleId}`,
          person_id: `eq.${personId}`,
        },
      });
      const existingShiftIds = new Set(existingCells.map((cell) => cell.shift_id));
      const missingCells = shifts
        .filter((shift) => !existingShiftIds.has(shift.id))
        .map((shift) => ({
          schedule_id: scheduleId,
          person_id: personId,
          shift_id: shift.id,
          tasks: [],
          note: null,
          blocked: false,
        }));

      if (missingCells.length) {
        await supabaseRequest("schedule_cells", {
          method: "POST",
          body: missingCells,
        });
      }
    }

    return NextResponse.json({ ok: true, person: personName });
  } catch (err) {
    console.error("Failed to add schedule person", err);
    return NextResponse.json({ error: "Unable to add person." }, { status: 500 });
  }
}
