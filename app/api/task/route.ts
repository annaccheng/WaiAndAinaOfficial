import { NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabase";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const listOnly = searchParams.get("list");
  const name = searchParams.get("name") || "";

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

  if (!name.trim()) {
    return NextResponse.json({ error: "Missing task name" }, { status: 400 });
  }

  try {
    const data = await supabaseRequest<any[]>("tasks", {
      query: {
        select:
          "id,name,description,status,extra_notes,links,estimated_time,task_type:task_types(name,color)",
        name: `ilike.${name}`,
        order: "created_at.desc",
        limit: 1,
      },
    });
    const task = data?.[0];
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    return NextResponse.json({
      name: task.name,
      description: task.description || "",
      extraNotes: task.extra_notes || [],
      status: task.status || "",
      comments: [],
      media: [],
      links: task.links || [],
      taskType: task.task_type
        ? { name: task.task_type.name, color: task.task_type.color || "default" }
        : { name: "", color: "default" },
      estimatedTime: task.estimated_time || "",
      properties: [],
    });
  } catch (err) {
    console.error("Failed to load task:", err);
    return NextResponse.json({ error: "Failed to fetch task" }, { status: 500 });
  }
}

export async function PATCH() {
  return NextResponse.json({ success: true });
}

export async function POST() {
  return NextResponse.json({ success: true });
}
