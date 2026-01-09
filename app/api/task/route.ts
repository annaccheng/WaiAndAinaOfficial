import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const listOnly = searchParams.get("list");
  const id = searchParams.get("id") || "";
  const name = searchParams.get("name") || "";

  if (!isSupabaseConfigured()) {
    if (listOnly) {
      return NextResponse.json({ tasks: [] });
    }
    return NextResponse.json(
      { error: "Supabase is not configured for tasks yet." },
      { status: 503 }
    );
  }

  if (listOnly) {
    try {
      const data = await supabaseRequest<any[]>("tasks", {
        query: {
          select: "id,name,status,task_type:task_types(name,color)",
          order: "name.asc",
        },
      });
      const tasks = (data || []).map((task) => ({
        id: task.id,
        name: task.name,
        status: task.status,
        type: task.task_type?.name || "",
        typeColor: task.task_type?.color || "default",
      }));
      return NextResponse.json({ tasks });
    } catch (err) {
      console.error("Failed to list tasks:", err);
      return NextResponse.json({ tasks: [] });
    }
  }

  if (!id.trim() && !name.trim()) {
    return NextResponse.json({ error: "Missing task id or name" }, { status: 400 });
  }

  try {
    const data = await supabaseRequest<any[]>("tasks", {
      query: {
        select:
          "id,name,description,status,extra_notes,links,estimated_time,recurring,occurrence_date,parent_task_id,comments,task_type:task_types(name,color)",
        ...(id.trim() ? { id: `eq.${id}` } : { name: `ilike.${name}` }),
        order: "created_at.desc",
        limit: 1,
      },
    });
    const task = data?.[0];
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    return NextResponse.json({
      id: task.id,
      name: task.name,
      description: task.description || "",
      extraNotes: task.extra_notes || [],
      status: task.status || "",
      comments: Array.isArray(task.comments) ? task.comments : [],
      media: [],
      links: task.links || [],
      taskType: task.task_type
        ? { name: task.task_type.name, color: task.task_type.color || "default" }
        : { name: "", color: "default" },
      estimatedTime: task.estimated_time || "",
      properties: [],
      recurring: Boolean(task.recurring),
      occurrenceDate: task.occurrence_date || null,
      parentTaskId: task.parent_task_id || null,
    });
  } catch (err) {
    console.error("Failed to load task:", err);
    return NextResponse.json({ error: "Failed to fetch task" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for tasks yet." },
      { status: 503 }
    );
  }
  const body = await req.json().catch(() => null);
  const { id, name, status } = body || {};
  if (!id && !name) {
    return NextResponse.json({ error: "Missing task id or name" }, { status: 400 });
  }
  if (typeof status !== "string") {
    return NextResponse.json({ error: "Missing status" }, { status: 400 });
  }

  try {
    let targetId = id as string | undefined;
    if (!targetId && name) {
      const matches = await supabaseRequest<any[]>("tasks", {
        query: {
          select: "id,name",
          name: `ilike.${name}`,
          order: "created_at.desc",
          limit: 1,
        },
      });
      targetId = matches?.[0]?.id;
    }
    if (!targetId) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    await supabaseRequest("tasks", {
      method: "PATCH",
      query: { id: `eq.${targetId}` },
      body: { status },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update task status:", err);
    return NextResponse.json({ error: "Unable to update task status" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for tasks yet." },
      { status: 503 }
    );
  }
  const body = await req.json().catch(() => null);
  const { name, comment } = body || {};
  if (!name || !comment) {
    return NextResponse.json({ error: "Missing task name or comment" }, { status: 400 });
  }
  try {
    const tasks = await supabaseRequest<any[]>("tasks", {
      query: {
        select: "id,comments",
        name: `ilike.${name}`,
        order: "created_at.desc",
        limit: 1,
      },
    });
    const target = tasks?.[0];
    if (!target?.id) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const existing = Array.isArray(target.comments) ? target.comments : [];
    const next = [
      ...existing,
      { comment: String(comment), time: new Date().toISOString() },
    ];
    await supabaseRequest("tasks", {
      method: "PATCH",
      query: { id: `eq.${target.id}` },
      body: { comments: next },
    });
    return NextResponse.json({ ok: true, comments: next });
  } catch (err) {
    console.error("Failed to add task comment:", err);
    return NextResponse.json({ error: "Unable to add comment" }, { status: 500 });
  }
}
