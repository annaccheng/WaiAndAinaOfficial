import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

const TABLE_NAME = "site_content";
const HOMEPAGE_KEY = "homepage";

const defaultContent = {
  heroTitle: "Sustainable living & care",
  heroSubtitle:
    "A calm, practical hub for goat care, volunteer schedules, and farm routines.",
  aboutText:
    "Wai & Aina is a learning farm focused on responsibility, sustainability, and everyday care for animals and land.",
};

type SiteContentRow = {
  id: string;
  key: string;
  content: Record<string, string> | null;
};

async function readHomepageContent() {
  if (!isSupabaseConfigured()) return defaultContent;
  try {
    const rows = await supabaseRequest<SiteContentRow[]>(TABLE_NAME, {
      query: {
        select: "id,key,content",
        key: `eq.${HOMEPAGE_KEY}`,
        limit: 1,
      },
    });
    const content = rows?.[0]?.content || {};
    return {
      heroTitle: String(content.heroTitle || defaultContent.heroTitle),
      heroSubtitle: String(content.heroSubtitle || defaultContent.heroSubtitle),
      aboutText: String(content.aboutText || defaultContent.aboutText),
    };
  } catch (error) {
    console.error("Failed to read homepage content", error);
    return defaultContent;
  }
}

export async function GET() {
  const content = await readHomepageContent();
  return NextResponse.json({ content });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const userType = String(body?.userType || "").toLowerCase();
  if (userType !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const content = {
    heroTitle: String(body?.content?.heroTitle || defaultContent.heroTitle),
    heroSubtitle: String(body?.content?.heroSubtitle || defaultContent.heroSubtitle),
    aboutText: String(body?.content?.aboutText || defaultContent.aboutText),
  };

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true, content });
  }

  try {
    const existing = await supabaseRequest<Pick<SiteContentRow, "id">[]>(TABLE_NAME, {
      query: { select: "id", key: `eq.${HOMEPAGE_KEY}`, limit: 1 },
    });

    if (existing?.[0]?.id) {
      await supabaseRequest(TABLE_NAME, {
        method: "PATCH",
        query: { id: `eq.${existing[0].id}` },
        body: { content },
      });
    } else {
      await supabaseRequest(TABLE_NAME, {
        method: "POST",
        body: { key: HOMEPAGE_KEY, content },
      });
    }

    return NextResponse.json({ ok: true, content });
  } catch (error) {
    console.error("Failed to save homepage content", error);
    return NextResponse.json({ error: "Unable to save homepage content" }, { status: 500 });
  }
}
