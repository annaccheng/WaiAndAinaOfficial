import { NextResponse } from "next/server";

type PresenceEntry = {
  user: string;
  initials: string;
  anchor: { person: string; slotId: string } | null;
  end: { person: string; slotId: string } | null;
  updatedAt: number;
  dateLabel: string;
};

const storeKey = "__schedulePresenceStore";

const getStore = () => {
  const globalRef = globalThis as typeof globalThis & {
    [storeKey]?: Map<string, PresenceEntry>;
  };
  if (!globalRef[storeKey]) {
    globalRef[storeKey] = new Map<string, PresenceEntry>();
  }
  return globalRef[storeKey]!;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dateLabel = searchParams.get("date") || "";
  if (!dateLabel) {
    return NextResponse.json({ entries: [] });
  }
  const store = getStore();
  const now = Date.now();
  const entries = Array.from(store.values()).filter(
    (entry) => entry.dateLabel === dateLabel && now - entry.updatedAt < 30_000
  );
  return NextResponse.json({ entries });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const user = typeof body?.user === "string" ? body.user : "";
  const dateLabel = typeof body?.dateLabel === "string" ? body.dateLabel : "";
  if (!user || !dateLabel) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const initials =
    typeof body?.initials === "string" && body.initials.trim()
      ? body.initials.trim()
      : user.slice(0, 2).toUpperCase();
  const anchor =
    body?.anchor && typeof body.anchor === "object"
      ? {
          person: String(body.anchor.person || ""),
          slotId: String(body.anchor.slotId || ""),
        }
      : null;
  const end =
    body?.end && typeof body.end === "object"
      ? {
          person: String(body.end.person || ""),
          slotId: String(body.end.slotId || ""),
        }
      : null;
  const store = getStore();
  store.set(`${dateLabel}-${user}`, {
    user,
    initials,
    anchor,
    end,
    updatedAt: Date.now(),
    dateLabel,
  });
  return NextResponse.json({ ok: true });
}
