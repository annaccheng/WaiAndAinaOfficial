import { NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabase";

type ScheduleRow = { id: string };
type SchedulePersonRow = { id: string; name: string; order_index: number };
type ScheduleCellRow = {
  person_id: string;
  shift_id: string;
  tasks: string[];
  note: string | null;
};

function toIsoDate(label?: string | null) {
  if (!label) return null;
  if (label.includes("-")) return label;
  const [month, day, year] = label.split("/");
  if (!month || !day || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { dateLabel } = body || {};
  const isoDate = toIsoDate(dateLabel);

  if (!isoDate) {
    return NextResponse.json(
      { error: "Missing schedule date." },
      { status: 400 }
    );
  }

  try {
    const stagingRows = await supabaseRequest<ScheduleRow[]>("schedules", {
      query: {
        select: "id",
        schedule_date: `eq.${isoDate}`,
        state: "eq.staging",
        limit: 1,
      },
    });
    const stagingId = stagingRows?.[0]?.id;

    if (!stagingId) {
      return NextResponse.json(
        { error: "No staging schedule to publish." },
        { status: 400 }
      );
    }

    await supabaseRequest("schedules", {
      method: "DELETE",
      query: {
        schedule_date: `eq.${isoDate}`,
        state: "eq.live",
      },
    });

    const [people, cells] = await Promise.all([
      supabaseRequest<SchedulePersonRow[]>("schedule_people", {
        query: {
          select: "id,name,order_index",
          schedule_id: `eq.${stagingId}`,
          order: "order_index.asc",
        },
      }),
      supabaseRequest<ScheduleCellRow[]>("schedule_cells", {
        query: {
          select: "person_id,shift_id,tasks,note",
          schedule_id: `eq.${stagingId}`,
        },
      }),
    ]);

    const created = await supabaseRequest<ScheduleRow[]>("schedules", {
      method: "POST",
      prefer: "return=representation",
      body: {
        schedule_date: isoDate,
        state: "live",
      },
    });

    const liveId = created?.[0]?.id;
    if (!liveId) {
      return NextResponse.json(
        { error: "Unable to publish schedule." },
        { status: 500 }
      );
    }

    const personIdMap = new Map<string, string>();
    if (people.length) {
      const inserted = await supabaseRequest<SchedulePersonRow[]>(
        "schedule_people",
        {
          method: "POST",
          prefer: "return=representation",
          body: people.map((person) => ({
            schedule_id: liveId,
            name: person.name,
            order_index: person.order_index,
          })),
        }
      );

      inserted.forEach((person) => {
        personIdMap.set(person.name, person.id);
      });
    }

    if (cells.length) {
      const rows = cells
        .map((cell) => {
          const personName =
            people.find((person) => person.id === cell.person_id)?.name || "";
          const livePersonId = personIdMap.get(personName);
          if (!livePersonId) return null;
          return {
            schedule_id: liveId,
            person_id: livePersonId,
            shift_id: cell.shift_id,
            tasks: cell.tasks,
            note: cell.note,
          };
        })
        .filter(Boolean);

      if (rows.length) {
        await supabaseRequest("schedule_cells", {
          method: "POST",
          body: rows,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to publish schedule", err);
    return NextResponse.json(
      { error: "Unable to publish schedule." },
      { status: 500 }
    );
  }
}
