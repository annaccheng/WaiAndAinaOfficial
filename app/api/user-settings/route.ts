import { NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabase";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = (searchParams.get("name") || "").trim();
  if (!name) {
    return NextResponse.json({ user: null });
  }

  try {
    const data = await supabaseRequest<any[]>("users", {
      query: { select: "id,display_name", display_name: `ilike.${name}`, limit: 1 },
    });

    return NextResponse.json({
      user: data?.[0] ? { id: data[0].id, name: data[0].display_name } : null,
    });
  } catch (err) {
    console.error("Failed to load user settings:", err);
    return NextResponse.json({ error: "Unable to load user" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: {
    name?: string;
    currentPassword?: string;
    newPassword?: string | null;
    newName?: string | null;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { name, currentPassword, newPassword, newName } = body;

  if (!name || !currentPassword) {
    return NextResponse.json(
      { error: "Missing name or currentPassword" },
      { status: 400 }
    );
  }

  try {
    const targetName = name.trim();
    const targetPass = currentPassword.trim();

    const data = await supabaseRequest<any[]>("users", {
      query: { select: "id,passcode", display_name: `ilike.${targetName}`, limit: 1 },
    });

    const user = data?.[0];
    if (!user || user.passcode !== targetPass) {
      return NextResponse.json(
        { error: "Current passcode incorrect" },
        { status: 401 }
      );
    }

    const updates: Record<string, unknown> = {};

    if (newPassword && newPassword.trim()) {
      updates.passcode = newPassword.trim();
    }

    if (newName && newName.trim()) {
      updates.display_name = newName.trim();
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: true });
    }

    await supabaseRequest("users", {
      method: "PATCH",
      query: { id: `eq.${user.id}` },
      body: updates,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update user settings:", err);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
