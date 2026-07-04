import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

const TASK_SELECT =
  "id,name,description,status,priority,estimated_time,recurring," +
  "recurrence_interval,recurrence_unit,recurrence_until,recurrence_days,recurrence_end_type,recurrence_count," +
  "origin_date,occurrence_date,parent_task_id,person_count," +
  "links,comments,photos,time_slots,extra_notes,created_by_name,task_help_references," +
  "task_type:task_types(id,name,color)," +
  "task_capabilities:task_capabilities(capability:capabilities(id,name))";

function normalizePersonCount(input: unknown) {
  if (input === null || input === undefined || input === "") return 1;
  const n = Number(input);
  return Number.isNaN(n) ? 1 : Math.max(1, Math.round(n));
}

function normalizeCapabilityIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map(String).filter(Boolean);
}

function normalizeLinks(input: unknown) {
  if (!Array.isArray(input)) return input;
  return input
    .map(link => {
      if (typeof link === "string") return link.trim();
      if (link && typeof link === "object") {
        const l = link as { label?: unknown; url?: unknown };
        return String(l.url || l.label || "").trim();
      }
      return "";
    })
    .filter(Boolean);
}

async function syncCapabilities(taskId: string, capabilityIds: string[]) {
  await supabaseRequest("task_capabilities", {
    method: "DELETE",
    query: { task_id: `eq.${taskId}` },
  });
  if (!capabilityIds.length) return;
  await supabaseRequest("task_capabilities", {
    method: "POST",
    body: capabilityIds.map(cid => ({ task_id: taskId, capability_id: cid })),
  });
}

function shapeTask(raw: Record<string, unknown>) {
  return {
    ...raw,
    capabilities: ((raw.task_capabilities as { capability: unknown }[]) ?? [])
      .map(e => e.capability)
      .filter(Boolean),
  };
}

export async function GET(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ tasks: [] }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const search             = searchParams.get("search") || "";
  const status             = searchParams.get("status") || "";
  const type               = searchParams.get("type") || "";
  const priority           = searchParams.get("priority") || "";
  const recurring          = searchParams.get("recurring") || "";
  const start              = searchParams.get("start") || "";
  const end                = searchParams.get("end") || "";
  // Default: only library root tasks. Pass includeOccurrences=true to get child rows too.
  const includeOccurrences = searchParams.get("includeOccurrences") === "true";

  const query: Record<string, string> = {
    select: TASK_SELECT,
    order: "created_at.desc",
  };

  if (!includeOccurrences) query.parent_task_id = "is.null";
  if (search)   query.name           = `ilike.%${search}%`;
  if (status)   query.status         = `eq.${status}`;
  if (type)     query.task_type_id   = `eq.${type}`;
  if (priority) query.priority       = `eq.${priority}`;
  if (recurring) query.recurring     = `eq.${recurring === "true"}`;
  if (start)    query.occurrence_date = `gte.${start}`;
  if (end)      query.occurrence_date = end ? `lte.${end}` : query.occurrence_date;

  try {
    const data = await supabaseRequest<Record<string, unknown>[]>("tasks", { query });
    return NextResponse.json({ tasks: (data ?? []).map(shapeTask) });
  } catch (err) {
    console.error("Failed to load tasks:", err);
    return NextResponse.json({ tasks: [] });
  }
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  const capabilityIds = normalizeCapabilityIds(body.capabilityIds);

  const payload: Record<string, unknown> = {
    name:                   body.name.trim(),
    description:            body.description || null,
    status:                 body.status || "Not Started",
    priority:               body.priority || "Medium",
    task_type_id:           body.task_type_id || null,
    estimated_time:         body.estimated_time || null,
    person_count:           normalizePersonCount(body.person_count),
    time_slots:             body.time_slots ?? [],
    extra_notes:            body.extra_notes ?? [],
    links:                  normalizeLinks(body.links) ?? [],
    photos:                 body.photos ?? [],
    task_help_references:   body.task_help_references ?? [],
    created_by_name:        body.created_by_name || null,
    // recurrence
    recurring:              Boolean(body.recurring),
    recurrence_interval:    body.recurring ? Number(body.recurrence_interval || 1) : null,
    recurrence_unit:        body.recurring ? (body.recurrence_unit || "day") : null,
    recurrence_days:        body.recurring ? (body.recurrence_days ?? []) : null,
    recurrence_end_type:    body.recurring ? (body.recurrence_end_type || "never") : null,
    recurrence_until:       body.recurring && body.recurrence_end_type === "on_date" ? (body.recurrence_until || null) : null,
    recurrence_count:       body.recurring && body.recurrence_end_type === "after_count" ? (body.recurrence_count || null) : null,
    // no origin_date / occurrence_date / parent_task_id — library tasks don't have these
  };

  try {
    const [task] = await supabaseRequest<Record<string, unknown>[]>("tasks", {
      method: "POST",
      prefer: "return=representation",
      query: { select: TASK_SELECT },
      body: payload,
    });

    if (task?.id && capabilityIds.length) {
      await syncCapabilities(String(task.id), capabilityIds);
    }

    return NextResponse.json({ task: task ? shapeTask(task) : null });
  } catch (err) {
    console.error("Failed to create task:", err);
    return NextResponse.json({ error: "Unable to create task" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const { id, capabilityIds } = body || {};

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  const fields = [
    "name", "description", "status", "priority", "task_type_id",
    "estimated_time", "person_count", "time_slots", "extra_notes",
    "links", "photos", "task_help_references", "created_by_name",
    "recurring", "recurrence_interval", "recurrence_unit",
    "recurrence_days", "recurrence_end_type", "recurrence_until", "recurrence_count",
  ];
  for (const key of fields) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      updates[key] = body[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(updates, "links")) {
    updates.links = normalizeLinks(updates.links);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "person_count")) {
    updates.person_count = normalizePersonCount(updates.person_count);
  }
  // Clear recurrence fields when switching to one-off
  if (updates.recurring === false) {
    Object.assign(updates, {
      recurrence_interval: null,
      recurrence_unit: null,
      recurrence_days: null,
      recurrence_end_type: null,
      recurrence_until: null,
      recurrence_count: null,
    });
  }

  try {
    await supabaseRequest("tasks", {
      method: "PATCH",
      query: { id: `eq.${id}` },
      body: updates,
    });

    if (Array.isArray(capabilityIds)) {
      await syncCapabilities(id, normalizeCapabilityIds(capabilityIds));
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update task:", err);
    return NextResponse.json({ error: "Unable to update task" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const id = body?.id;

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    await supabaseRequest("tasks", {
      method: "DELETE",
      query: { id: `eq.${id}` },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete task:", err);
    return NextResponse.json({ error: "Unable to delete task" }, { status: 500 });
  }
}
