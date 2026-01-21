import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { capabilities: [], error: "Supabase is not configured for capabilities yet." },
      { status: 503 }
    );
  }

  try {
    const data = await supabaseRequest<any[]>("capabilities", {
      query: { select: "id,name", order: "name.asc" },
    });
    return NextResponse.json({ capabilities: data || [] });
  } catch (err) {
    console.error("Failed to load capabilities:", err);
    return NextResponse.json({ capabilities: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for capabilities yet." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const name = body?.name ? String(body.name).trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Missing capability name" }, { status: 400 });
  }

  try {
    const [created] = await supabaseRequest<any[]>("capabilities", {
      method: "POST",
      prefer: "return=representation",
      query: { select: "id,name" },
      body: { name },
    });
    return NextResponse.json({ capability: created });
  } catch (err) {
    console.error("Failed to create capability:", err);
    return NextResponse.json({ error: "Unable to create capability" }, { status: 500 });
  }
}
