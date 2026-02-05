import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for push yet." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const { endpoint, deviceId, userName } = body || {};

  if (!endpoint && !deviceId) {
    return NextResponse.json(
      { error: "Missing endpoint or device id." },
      { status: 400 }
    );
  }

  try {
    const query: Record<string, string> = {};
    if (endpoint) {
      query.endpoint = `eq.${String(endpoint)}`;
    }
    if (deviceId) {
      query.device_id = `eq.${String(deviceId)}`;
    }
    if (userName) {
      query.user_name = `eq.${String(userName)}`;
    }
    await supabaseRequest("push_subscriptions", {
      method: "DELETE",
      query,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to remove push subscription", err);
    return NextResponse.json(
      { error: "Unable to remove push subscription" },
      { status: 500 }
    );
  }
}
