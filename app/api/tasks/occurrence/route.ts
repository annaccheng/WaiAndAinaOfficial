import { NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabase";

type TaskRow = {
  id: string;
  name: string;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  estimated_time?: string | null;
  recurring?: boolean;
  recurrence_interval?: number | null;
  recurrence_unit?: string | null;
  recurrence_until?: string | null;
  origin_date?: string | null;
  occurrence_date?: string | null;
  parent_task_id?: string | null;
  person_count?: number | null;
  links?: string[] | null;
  comments?: string[] | null;
  photos?: string[] | null;
  time_slots?: string[] | null;
  extra_notes?: string[] | null;
  task_type_id?: string | null;
  task_type?: { id: string; name: string; color: string } | null;
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { seriesId, occurrenceDate } = body || {};

  if (!seriesId || !occurrenceDate) {
    return NextResponse.json(
      { error: "Missing seriesId or occurrenceDate" },
      { status: 400 }
    );
  }

  try {
    const existing = await supabaseRequest<TaskRow[]>("tasks", {
      query: {
        select:
          "id,name,description,status,priority,estimated_time,recurring,recurrence_interval,recurrence_unit,recurrence_until,origin_date,occurrence_date,parent_task_id,person_count,links,comments,photos,time_slots,extra_notes,task_type:task_types(id,name,color)",
        parent_task_id: `eq.${seriesId}`,
        occurrence_date: `eq.${occurrenceDate}`,
        limit: 1,
      },
    });

    if (existing?.[0]) {
      return NextResponse.json({ task: existing[0] });
    }

    const [series] = await supabaseRequest<TaskRow[]>("tasks", {
      query: {
        select:
          "id,name,description,status,priority,estimated_time,recurring,recurrence_interval,recurrence_unit,recurrence_until,origin_date,occurrence_date,parent_task_id,person_count,links,comments,photos,time_slots,extra_notes,task_type_id,task_type:task_types(id,name,color)",
        id: `eq.${seriesId}`,
        limit: 1,
      },
    });

    if (!series) {
      return NextResponse.json({ error: "Series not found" }, { status: 404 });
    }

    const [created] = await supabaseRequest<TaskRow[]>("tasks", {
      method: "POST",
      prefer: "return=representation",
      query: {
        select:
          "id,name,description,status,priority,estimated_time,recurring,recurrence_interval,recurrence_unit,recurrence_until,origin_date,occurrence_date,parent_task_id,person_count,links,comments,photos,time_slots,extra_notes,task_type:task_types(id,name,color)",
      },
      body: {
        name: series.name,
        description: series.description || null,
        status: "Not Started",
        priority: series.priority || "Medium",
        estimated_time: series.estimated_time || null,
        recurring: true,
        recurrence_interval: series.recurrence_interval,
        recurrence_unit: series.recurrence_unit,
        recurrence_until: series.recurrence_until,
        origin_date: series.origin_date || series.occurrence_date || occurrenceDate,
        occurrence_date: occurrenceDate,
        parent_task_id: series.id,
        person_count: series.person_count ?? null,
        links: series.links || [],
        comments: series.comments || [],
        photos: series.photos || [],
        time_slots: series.time_slots || [],
        extra_notes: series.extra_notes || [],
        task_type_id: series.task_type_id || null,
      },
    });

    if (!created) {
      return NextResponse.json(
        { error: "Failed to create occurrence" },
        { status: 500 }
      );
    }

    return NextResponse.json({ task: created });
  } catch (err) {
    console.error("Failed to create recurring occurrence", err);
    return NextResponse.json(
      { error: "Unable to create occurrence" },
      { status: 500 }
    );
  }
}
