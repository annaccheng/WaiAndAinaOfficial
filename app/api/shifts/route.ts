import { NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabase";

const DEFAULT_SHIFTS = [
  { label: "Breakfast", timeRange: "10:30-11:30" },
  { label: "Lunch", timeRange: "2:30-3:30" },
  { label: "Dinner", timeRange: null },
  { label: "Morning Shift 1", timeRange: "7:30-9:00" },
  { label: "Morning Shift 2", timeRange: "9:00-10:30" },
  { label: "Noon Shift 1", timeRange: "11:30-1:00" },
  { label: "Noon Shift 2", timeRange: "1:00-2:30" },
  { label: "Afternoon Shift 1", timeRange: "3:30-4:00" },
  { label: "Afternoon Shift 2", timeRange: "4:00-6:30" },
  { label: "Evening Shift", timeRange: null },
  { label: "Weekend Saturday Morning", timeRange: null },
  { label: "Weekend Saturday Evening", timeRange: null },
  { label: "Weekend Sunday Morning", timeRange: null },
  { label: "Weekend Sunday Evening", timeRange: null },
];

async function ensureDefaultShifts() {
  const existing = await supabaseRequest<any[]>("shifts", {
    query: { select: "id", limit: 1 },
  });
  if (existing?.length) return;

  await supabaseRequest("shifts", {
    method: "POST",
    body: DEFAULT_SHIFTS.map((shift, index) => ({
      label: shift.label,
      time_range: shift.timeRange,
      order_index: index + 1,
    })),
  });
}

export async function GET() {
  try {
    await ensureDefaultShifts();
    const data = await supabaseRequest<any[]>("shifts", {
      query: { select: "id,label,time_range,order_index", order: "order_index.asc" },
    });
    const shifts = (data || []).map((shift) => ({
      id: shift.id,
      label: shift.label,
      timeRange: shift.time_range || "",
    }));
    return NextResponse.json({ shifts });
  } catch (err) {
    console.error("Failed to load shifts:", err);
    return NextResponse.json({ shifts: [] });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { label, timeRange } = body || {};
  if (!label) {
    return NextResponse.json({ error: "Missing label" }, { status: 400 });
  }

  try {
    const existing = await supabaseRequest<any[]>("shifts", {
      query: { select: "order_index", order: "order_index.desc", limit: 1 },
    });
    const nextOrder = (existing?.[0]?.order_index ?? 0) + 1;
    await supabaseRequest("shifts", {
      method: "POST",
      body: {
        label: String(label).trim(),
        time_range: timeRange ? String(timeRange).trim() : null,
        order_index: nextOrder,
      },
    });

    const data = await supabaseRequest<any[]>("shifts", {
      query: { select: "id,label,time_range,order_index", order: "order_index.asc" },
    });
    const shifts = (data || []).map((shift) => ({
      id: shift.id,
      label: shift.label,
      timeRange: shift.time_range || "",
    }));
    return NextResponse.json({ shifts });
  } catch (err) {
    console.error("Failed to create shift:", err);
    return NextResponse.json({ error: "Unable to create shift" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const { shifts } = body || {};
  if (!Array.isArray(shifts)) {
    return NextResponse.json({ error: "Missing shifts" }, { status: 400 });
  }

  try {
    await Promise.all(
      shifts.map((shift: any, index: number) =>
        supabaseRequest("shifts", {
          method: "PATCH",
          query: { id: `eq.${shift.id}` },
          body: {
            label: shift.label,
            time_range: shift.timeRange || null,
            order_index: index + 1,
          },
        })
      )
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update shifts:", err);
    return NextResponse.json({ error: "Unable to update shifts" }, { status: 500 });
  }
}
