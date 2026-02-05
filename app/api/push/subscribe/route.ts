import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

type SubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for push yet." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const { userName, userRole, deviceId, subscription } = body || {};

  if (!userName || !deviceId || !subscription?.endpoint || !subscription?.keys) {
    return NextResponse.json(
      { error: "Missing push subscription details." },
      { status: 400 }
    );
  }

  const payload = subscription as SubscriptionPayload;

  try {
    await supabaseRequest("push_subscriptions", {
      method: "POST",
      query: { on_conflict: "endpoint" },
      prefer: "resolution=merge-duplicates",
      body: {
        user_name: String(userName),
        user_role: userRole ? String(userRole) : null,
        device_id: String(deviceId),
        endpoint: payload.endpoint,
        p256dh: payload.keys.p256dh,
        auth: payload.keys.auth,
        updated_at: new Date().toISOString(),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to store push subscription", err);
    return NextResponse.json(
      { error: "Unable to save push subscription" },
      { status: 500 }
    );
  }
}
