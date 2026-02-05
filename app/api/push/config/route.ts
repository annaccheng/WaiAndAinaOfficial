import { NextResponse } from "next/server";
import webpush from "web-push";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

async function loadStoredKeys() {
  if (!isSupabaseConfigured()) return null;
  const rows = await supabaseRequest<any[]>("push_config", {
    query: {
      select: "public_key,private_key",
      order: "created_at.desc",
      limit: 1,
    },
  });
  const entry = rows?.[0];
  if (!entry?.public_key || !entry?.private_key) return null;
  return {
    publicKey: String(entry.public_key),
    privateKey: String(entry.private_key),
  };
}

export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (publicKey) return NextResponse.json({ publicKey });

  const stored = await loadStoredKeys();
  return NextResponse.json({ publicKey: stored?.publicKey || "" });
}

export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for push yet." },
      { status: 503 }
    );
  }

  const existing = await loadStoredKeys();
  if (existing?.publicKey) {
    return NextResponse.json({ publicKey: existing.publicKey, created: false });
  }

  const keys = webpush.generateVAPIDKeys();
  await supabaseRequest("push_config", {
    method: "POST",
    body: {
      public_key: keys.publicKey,
      private_key: keys.privateKey,
    },
  });

  return NextResponse.json({ publicKey: keys.publicKey, created: true });
}
