import { NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabase";

type TaskTypeOption = { name: string; color: string };
type StatusOption = { name: string; color: string };

const FALLBACK_TYPES: TaskTypeOption[] = [
  { name: "General", color: "default" },
  { name: "Animal Care", color: "green" },
  { name: "Field Work", color: "orange" },
  { name: "Maintenance", color: "blue" },
];

export async function GET() {
  try {
    const data = await supabaseRequest<any[]>("task_types", {
      query: { select: "id,name,color", order: "name.asc" },
    });

    const types = (data || []).map((item) => ({
      name: item.name,
      color: item.color || "default",
      id: item.id,
    }));

    return NextResponse.json({
      types: types.length ? types : FALLBACK_TYPES,
      statuses: [
        { name: "Not Started", color: "gray" },
        { name: "In Progress", color: "blue" },
        { name: "Completed", color: "green" },
      ],
    });
  } catch (err) {
    console.error("Failed to load task types:", err);
    return NextResponse.json({
      types: FALLBACK_TYPES,
      statuses: [
        { name: "Not Started", color: "gray" },
        { name: "In Progress", color: "blue" },
        { name: "Completed", color: "green" },
      ],
    });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { name, color } = body || {};

  if (!name) {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  try {
    const data = await supabaseRequest<any[]>("task_types", {
      method: "POST",
      prefer: "return=representation",
      query: { select: "id,name,color" },
      body: { name: String(name).trim(), color: color || "default" },
    });
    return NextResponse.json({ type: data?.[0] });
  } catch (err) {
    console.error("Failed to create task type:", err);
    return NextResponse.json({ error: "Unable to create task type" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const { id, name, color } = body || {};

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof name === "string") updates.name = name.trim();
  if (typeof color === "string") updates.color = color.trim() || "default";

  if (!Object.keys(updates).length) {
    return NextResponse.json({ ok: true });
  }

  try {
    await supabaseRequest("task_types", {
      method: "PATCH",
      query: { id: `eq.${id}` },
      body: updates,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update task type:", err);
    return NextResponse.json({ error: "Unable to update task type" }, { status: 500 });
  }
}
