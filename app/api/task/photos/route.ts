import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

const MAX_PHOTO_BYTES = 150 * 1024;
const BUCKET_NAME = "Photos";

function normalizePhotoEntries(raw: unknown): string[] {
  const entries = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return entries
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toIsoDate(label?: string | null) {
  if (!label) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  if (label.includes("/")) {
    const [month, day, year] = label.split("/");
    if (!month || !day || !year) return null;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return null;
}

function buildPublicUrl(path: string) {
  const base = process.env.SUPABASE_URL;
  if (!base) return "";
  return `${base}/storage/v1/object/public/${BUCKET_NAME}/${path}`;
}

async function signPhotoPath(path: string) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return "";
  const encodedPath = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  try {
    const res = await fetch(
      `${supabaseUrl}/storage/v1/object/sign/${BUCKET_NAME}/${encodedPath}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 365 }),
      }
    );
    if (!res.ok) return "";
    const json = await res.json();
    if (!json?.signedURL) return "";
    return `${supabaseUrl}${json.signedURL}`;
  } catch (err) {
    console.error("Failed to sign uploaded photo:", err);
    return "";
  }
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for uploads yet." },
      { status: 503 }
    );
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const taskId = String(formData.get("taskId") || "").trim();
  const taskName = String(formData.get("taskName") || "").trim();
  const occurrenceDate = toIsoDate(String(formData.get("occurrenceDate") || "").trim());

  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image uploads are supported" }, { status: 400 });
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { error: "Image must be 150kb or less after compression." },
      { status: 400 }
    );
  }
  if (!taskId && !taskName) {
    return NextResponse.json(
      { error: "Missing task id or name for photo attachment" },
      { status: 400 }
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Supabase is not configured for uploads yet." },
      { status: 503 }
    );
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const prefix = taskId || taskName.replace(/[^a-zA-Z0-9._-]+/g, "-") || "task";
  const path = `${prefix}/${Date.now()}-${safeName}`;
  const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET_NAME}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true",
    },
    body: Buffer.from(await file.arrayBuffer()),
  });

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    return NextResponse.json(
      { error: errorText || "Failed to upload image" },
      { status: uploadRes.status }
    );
  }

  const signedUrl = await signPhotoPath(path);
  const publicUrl = buildPublicUrl(path);

  try {
    let targetId = taskId || "";
    if (!targetId && taskName) {
      const matches = await supabaseRequest<any[]>("tasks", {
        query: {
          select: "id,photos",
          name: `ilike.${taskName}`,
          ...(occurrenceDate ? { occurrence_date: `eq.${occurrenceDate}` } : {}),
          order: "created_at.desc",
          limit: 1,
        },
      });
      targetId = matches?.[0]?.id || "";
    }

    if (!targetId) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const [task] = await supabaseRequest<any[]>("tasks", {
      query: { select: "id,photos", id: `eq.${targetId}`, limit: 1 },
    });
    const existingPhotos = normalizePhotoEntries(task?.photos);
    const nextPhotos = Array.from(new Set([...existingPhotos, path]));

    await supabaseRequest("tasks", {
      method: "PATCH",
      query: { id: `eq.${targetId}` },
      body: { photos: nextPhotos },
    });
  } catch (err) {
    console.error("Failed to attach photo to task:", err);
  }

  return NextResponse.json({ url: signedUrl || publicUrl, path });
}
