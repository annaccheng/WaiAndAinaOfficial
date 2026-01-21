import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

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

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      animals: [],
      filters: { types: [], genders: [] },
      hasMore: false,
      nextCursor: null,
    });
  }

  try {
    const [animals, types, genders] = await Promise.all([
      supabaseRequest<any[]>("animals", {
        query: {
          select:
            "id,name,summary,daily_care_notes,birthday,age_label,age_months,milking_method,get_milked,breed,behaviors,stats,animal_type:animal_types(id,name,color),animal_gender:animal_genders(id,name,color),animal_photos:animal_photos(id,name,path,created_at)",
          order: "name.asc",
        },
      }),
      supabaseRequest<any[]>("animal_types", {
        query: { select: "name,color", order: "name.asc" },
      }),
      supabaseRequest<any[]>("animal_genders", {
        query: { select: "name,color", order: "name.asc" },
      }),
    ]);

    const normalized = await Promise.all(
      (animals || []).map(async (animal) => {
        const photos = await Promise.all(
          (animal.animal_photos || []).map(async (photo: any) => {
            const signed = await signPhotoPath(photo.path);
            return {
              name: photo.name,
              url: signed || buildPublicUrl(photo.path),
            };
          })
        );
        return {
          id: animal.id,
          name: animal.name,
          summary: animal.summary || "",
          dailyCareNotes: animal.daily_care_notes || "",
          birthday: animal.birthday,
          ageLabel: animal.age_label,
          ageMonths: animal.age_months ?? null,
          milkingMethod: animal.milking_method || "",
          getMilked: Boolean(animal.get_milked),
          type: animal.animal_type
            ? { name: animal.animal_type.name, color: animal.animal_type.color }
            : undefined,
          behaviors: animal.behaviors || [],
          breed: animal.breed || "",
          gender: animal.animal_gender
            ? { name: animal.animal_gender.name, color: animal.animal_gender.color }
            : undefined,
          photos,
          stats: animal.stats || {},
        };
      })
    );

    return NextResponse.json({
      animals: normalized,
      filters: { types: types || [], genders: genders || [] },
      hasMore: false,
      nextCursor: null,
    });
  } catch (err) {
    console.error("Failed to load animals:", err);
    return NextResponse.json(
      { animals: [], filters: { types: [], genders: [] }, hasMore: false, nextCursor: null },
      { status: 500 }
    );
  }
}

async function ensureLookupId(table: "animal_types" | "animal_genders", name?: string | null) {
  if (!name?.trim()) return null;
  const trimmed = name.trim();
  const [existing] = await supabaseRequest<any[]>(table, {
    query: { select: "id,name,color", name: `ilike.${trimmed}` },
  });
  if (existing?.id) return existing.id as string;
  const [created] = await supabaseRequest<any[]>(table, {
    method: "POST",
    prefer: "return=representation",
    body: { name: trimmed },
  });
  return created?.id || null;
}

function normalizeAnimalRecord(animal: any, photos: { name: string; url: string }[]) {
  return {
    id: animal.id,
    name: animal.name,
    summary: animal.summary || "",
    dailyCareNotes: animal.daily_care_notes || "",
    birthday: animal.birthday,
    ageLabel: animal.age_label,
    ageMonths: animal.age_months ?? null,
    milkingMethod: animal.milking_method || "",
    getMilked: Boolean(animal.get_milked),
    type: animal.animal_type
      ? { name: animal.animal_type.name, color: animal.animal_type.color }
      : undefined,
    behaviors: animal.behaviors || [],
    breed: animal.breed || "",
    gender: animal.animal_gender
      ? { name: animal.animal_gender.name, color: animal.animal_gender.color }
      : undefined,
    photos,
    stats: animal.stats || {},
  };
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for animals yet." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const name = String(body?.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "Missing animal name" }, { status: 400 });
  }

  const typeId = await ensureLookupId("animal_types", body?.typeName);
  const genderId = await ensureLookupId("animal_genders", body?.genderName);

  const [created] = await supabaseRequest<any[]>("animals", {
    method: "POST",
    prefer: "return=representation",
    body: {
      name,
      summary: body?.summary || null,
      daily_care_notes: body?.dailyCareNotes || null,
      birthday: body?.birthday || null,
      age_label: body?.ageLabel || null,
      age_months: Number.isFinite(body?.ageMonths) ? body.ageMonths : null,
      milking_method: body?.milkingMethod || null,
      get_milked: Boolean(body?.getMilked),
      breed: body?.breed || null,
      behaviors: Array.isArray(body?.behaviors) ? body.behaviors : [],
      stats: body?.stats || {},
      animal_type_id: typeId,
      animal_gender_id: genderId,
    },
    query: {
      select:
        "id,name,summary,daily_care_notes,birthday,age_label,age_months,milking_method,get_milked,breed,behaviors,stats,animal_type:animal_types(id,name,color),animal_gender:animal_genders(id,name,color)",
    },
  });

  if (!created) {
    return NextResponse.json({ error: "Unable to create animal" }, { status: 500 });
  }

  return NextResponse.json({
    animal: normalizeAnimalRecord(created, []),
  });
}

export async function PATCH(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for animals yet." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const id = String(body?.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "Missing animal id" }, { status: 400 });
  }

  const typeId = await ensureLookupId("animal_types", body?.typeName);
  const genderId = await ensureLookupId("animal_genders", body?.genderName);

  const updates: Record<string, unknown> = {};
  if (typeof body?.name === "string") updates.name = body.name.trim();
  if ("summary" in (body || {})) updates.summary = body.summary || null;
  if ("dailyCareNotes" in (body || {})) updates.daily_care_notes = body.dailyCareNotes || null;
  if ("birthday" in (body || {})) updates.birthday = body.birthday || null;
  if ("ageLabel" in (body || {})) updates.age_label = body.ageLabel || null;
  if ("ageMonths" in (body || {}))
    updates.age_months = Number.isFinite(body.ageMonths) ? body.ageMonths : null;
  if ("milkingMethod" in (body || {})) updates.milking_method = body.milkingMethod || null;
  if ("getMilked" in (body || {})) updates.get_milked = Boolean(body.getMilked);
  if ("breed" in (body || {})) updates.breed = body.breed || null;
  if (Array.isArray(body?.behaviors)) updates.behaviors = body.behaviors;
  if ("stats" in (body || {})) updates.stats = body.stats || {};
  if (typeId !== null) updates.animal_type_id = typeId;
  if (genderId !== null) updates.animal_gender_id = genderId;

  await supabaseRequest("animals", {
    method: "PATCH",
    query: { id: `eq.${id}` },
    body: updates,
  });

  const [updated] = await supabaseRequest<any[]>("animals", {
    query: {
      select:
        "id,name,summary,daily_care_notes,birthday,age_label,age_months,milking_method,get_milked,breed,behaviors,stats,animal_type:animal_types(id,name,color),animal_gender:animal_genders(id,name,color),animal_photos:animal_photos(id,name,path,created_at)",
      id: `eq.${id}`,
    },
  });

  if (!updated) {
    return NextResponse.json({ error: "Unable to update animal" }, { status: 500 });
  }

  const photos = await Promise.all(
    (updated.animal_photos || []).map(async (photo: any) => {
      const signed = await signPhotoPath(photo.path);
      return {
        name: photo.name,
        url: signed || buildPublicUrl(photo.path),
      };
    })
  );

  return NextResponse.json({
    animal: normalizeAnimalRecord(updated, photos),
  });
}
