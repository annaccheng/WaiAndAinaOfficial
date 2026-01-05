import { NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabase";

type ScheduleRow = { id: string };

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
    const existing = await supabaseRequest<ScheduleRow[]>("schedules", {
      query: {
        select: "id",
        schedule_date: `eq.${isoDate}`,
        state: "eq.staging",
        limit: 1,
      },
    });

    if (existing.length) {
      return NextResponse.json({ ok: true, id: existing[0].id });
    }

    return NextResponse.json({
      ok: true,
      message: "Schedule will be created when tasks are added.",
    });
  } catch (err) {
    console.error("Failed to check schedule", err);
    return NextResponse.json(
      { error: "Unable to create schedule." },
      { status: 500 }
    );
  }
}
