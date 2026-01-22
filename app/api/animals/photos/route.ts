import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

const MAX_PHOTO_BYTES = 300 * 1024;
const BUCKET_NAME = "Animals";

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
    console.error("Failed to sign animal photo:", err);
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
  const animalId = String(formData.get("animalId") || "").trim();
  const nameOverride = String(formData.get("name") || "").trim();

  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image uploads are supported" }, { status: 400 });
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { error: "Image must be 300kb or less after compression." },
      { status: 400 }
    );
  }
  if (!animalId) {
    return NextResponse.json({ error: "Missing animal id" }, { status: 400 });
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
  const path = `${animalId}/${Date.now()}-${safeName}`;
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

  const photoName = nameOverride || file.name;
  await supabaseRequest("animal_photos", {
    method: "POST",
    prefer: "return=representation",
    body: {
      animal_id: animalId,
      name: photoName,
      path,
    },
  });

  const signedUrl = await signPhotoPath(path);
  const publicUrl = buildPublicUrl(path);

  return NextResponse.json({ url: signedUrl || publicUrl, path, name: photoName });
}
