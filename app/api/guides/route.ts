import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

const TABLE_NAME = "guides";

type GuideRow = {
  id: string;
  title: string;
  content_markdown?: string | null;
  updated_at?: string;
  is_restricted?: boolean | null;
};

function isAdmin(userType: unknown) {
  return String(userType || "").toLowerCase() === "admin";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = String(searchParams.get("id") || "").trim();

  if (!isSupabaseConfigured()) {
    return NextResponse.json(id ? { guide: null } : { guides: [] });
  }

  try {
    if (id) {
      const rows = await supabaseRequest<GuideRow[]>(TABLE_NAME, {
        query: {
          select: "id,title,content_markdown,updated_at,is_restricted",
          id: `eq.${id}`,
          limit: 1,
        },
      });
      const guide = rows?.[0];
      if (!guide) {
        return NextResponse.json({ error: "Guide not found" }, { status: 404 });
      }
      return NextResponse.json({
        guide: {
          id: guide.id,
          title: guide.title,
          content: guide.content_markdown || "",
          restricted: Boolean(guide.is_restricted),
          lastEdited: guide.updated_at || new Date().toISOString(),
        },
      });
    }

    const rows = await supabaseRequest<GuideRow[]>(TABLE_NAME, {
      query: {
        select: "id,title,updated_at,is_restricted",
        order: "updated_at.desc",
      },
    });

    return NextResponse.json({
      guides: (rows || []).map((guide) => ({
        id: guide.id,
        title: guide.title,
        restricted: Boolean(guide.is_restricted),
        lastEdited: guide.updated_at || new Date().toISOString(),
      })),
    });
  } catch (err) {
    console.error("Failed to load guides", err);
    return NextResponse.json({ error: "Unable to load guides" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!isAdmin(body?.userType)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const title = String(body?.title || "").trim() || "Untitled Guide";
  const content = String(body?.content || "");
  const restricted = Boolean(body?.restricted);

  try {
    const rows = await supabaseRequest<GuideRow[]>(TABLE_NAME, {
      method: "POST",
      prefer: "return=representation",
      body: {
        title,
        content_markdown: content,
        is_restricted: restricted,
      },
    });

    const guide = rows?.[0];
    return NextResponse.json({
      guide: {
        id: guide?.id,
        title: guide?.title || title,
        content: guide?.content_markdown || content,
        restricted: Boolean(guide?.is_restricted),
        lastEdited: guide?.updated_at || new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("Failed to create guide", err);
    return NextResponse.json({ error: "Unable to create guide" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  if (!isAdmin(body?.userType)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const id = String(body?.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "Guide id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body?.title === "string") updates.title = body.title;
  if (typeof body?.content === "string") updates.content_markdown = body.content;
  if (typeof body?.restricted === "boolean") updates.is_restricted = body.restricted;

  if (!Object.keys(updates).length) {
    return NextResponse.json({ ok: true });
  }

  try {
    await supabaseRequest(TABLE_NAME, {
      method: "PATCH",
      query: { id: `eq.${id}` },
      body: updates,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update guide", err);
    return NextResponse.json({ error: "Unable to update guide" }, { status: 500 });
  }
}
