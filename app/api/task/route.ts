import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

const PHOTO_BUCKET = "Photos";

function buildPublicPhotoUrl(path: string) {
  const base = process.env.SUPABASE_URL;
  if (!base) return "";
  return `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
}

function extractPhotoPath(entry: string) {
  if (!entry) return "";
  const trimmed = entry.replace(/^\/+/, "");
  if (trimmed.startsWith(`${PHOTO_BUCKET}/`)) {
    return trimmed.slice(`${PHOTO_BUCKET}/`.length);
  }
  if (trimmed.startsWith(`storage/v1/object/${PHOTO_BUCKET}/`)) {
    return trimmed.slice(`storage/v1/object/${PHOTO_BUCKET}/`.length);
  }
  if (entry.startsWith("http")) {
    const marker = `/storage/v1/object/public/${PHOTO_BUCKET}/`;
    const idx = entry.indexOf(marker);
    if (idx !== -1) {
      return entry.slice(idx + marker.length);
    }
    const altMarker = `/storage/v1/object/${PHOTO_BUCKET}/`;
    const altIdx = entry.indexOf(altMarker);
    if (altIdx !== -1) {
      return entry.slice(altIdx + altMarker.length);
    }
    return "";
  }
  return entry;
}

async function signPhotoPaths(paths: string[]) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return [];

  const encodePath = (path: string) =>
    path
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");

  return Promise.all(
    paths.map(async (path) => {
      if (!path) return "";
      try {
        const res = await fetch(
          `${supabaseUrl}/storage/v1/object/sign/${PHOTO_BUCKET}/${encodePath(path)}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceRoleKey}`,
              apikey: serviceRoleKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ expiresIn: 60 * 60 * 24 }),
          }
        );
        if (!res.ok) return "";
        const json = await res.json();
        if (!json?.signedURL) return "";
        return `${supabaseUrl}${json.signedURL}`;
      } catch (err) {
        console.error("Failed to sign photo URL:", err);
        return "";
      }
    })
  );
}

type NormalizedComment = {
  id: string;
  text: string;
  createdTime: string;
  authorId?: string | null;
  authorName?: string | null;
};

type StoredComment =
  | string
  | {
      id?: string;
      text?: string;
      comment?: string;
      createdTime?: string;
      time?: string;
      authorId?: string | null;
      author_id?: string | null;
      userId?: string | null;
      author?: string | null;
      authorName?: string | null;
    };

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

function parseCommentAuthor(text: string) {
  const marker = " : ";
  const idx = text.indexOf(marker);
  if (idx === -1) return { authorName: null, text: text.trim() };
  const authorName = text.slice(0, idx).trim();
  const commentText = text.slice(idx + marker.length).trim();
  return {
    authorName: authorName || null,
    text: commentText || text.trim(),
  };
}

function normalizeComment(raw: StoredComment): NormalizedComment {
  const fallbackTime = new Date().toISOString();
  if (typeof raw === "string") {
    const parsed = parseCommentAuthor(raw);
    return {
      id: crypto.randomUUID(),
      text: parsed.text || raw.trim(),
      createdTime: fallbackTime,
      authorName: parsed.authorName,
    };
  }

  const text = String(raw.text ?? raw.comment ?? "").trim();
  const createdTime = String(raw.createdTime ?? raw.time ?? fallbackTime);
  const authorId = raw.authorId ?? raw.author_id ?? raw.userId ?? null;
  const authorName = raw.authorName ?? raw.author ?? null;
  return {
    id: raw.id || crypto.randomUUID(),
    text,
    createdTime,
    authorId,
    authorName,
  };
}

async function resolveCommentAuthors(comments: NormalizedComment[]) {
  const authorIds = Array.from(
    new Set(comments.map((comment) => comment.authorId).filter(Boolean))
  ) as string[];
  if (!authorIds.length) {
    return comments.map((comment) => ({
      ...comment,
      author: comment.authorName || "Unknown",
    }));
  }

  const users = await supabaseRequest<any[]>("users", {
    query: {
      select: "id,display_name",
      id: `in.(${authorIds.join(",")})`,
    },
  });
  const userMap = new Map(
    (users || []).map((user) => [user.id, user.display_name])
  );

  return comments.map((comment) => ({
    ...comment,
    author: userMap.get(comment.authorId || "") || comment.authorName || "Unknown",
  }));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const listOnly = searchParams.get("list");
  const id = searchParams.get("id") || "";
  const name = searchParams.get("name") || "";
  const occurrenceDate = toIsoDate(
    searchParams.get("occurrenceDate") || searchParams.get("date")
  );

  if (!isSupabaseConfigured()) {
    if (listOnly) {
      return NextResponse.json({ tasks: [] });
    }
    return NextResponse.json(
      { error: "Supabase is not configured for tasks yet." },
      { status: 503 }
    );
  }

  if (listOnly) {
    try {
      const data = await supabaseRequest<any[]>("tasks", {
        query: {
          select: "id,name,status,task_type:task_types(name,color)",
          order: "name.asc",
        },
      });
      const tasks = (data || []).map((task) => ({
        id: task.id,
        name: task.name,
        status: task.status,
        type: task.task_type?.name || "",
        typeColor: task.task_type?.color || "default",
      }));
      return NextResponse.json({ tasks });
    } catch (err) {
      console.error("Failed to list tasks:", err);
      return NextResponse.json({ tasks: [] });
    }
  }

  if (!id.trim() && !name.trim()) {
    return NextResponse.json({ error: "Missing task id or name" }, { status: 400 });
  }

  try {
    const buildQuery = (withOccurrence: boolean) => ({
      select:
        "id,name,description,status,extra_notes,person_count,links,estimated_time,recurring,occurrence_date,parent_task_id,comments,photos,task_type:task_types(name,color)",
      ...(id.trim() ? { id: `eq.${id}` } : { name: `ilike.${name}` }),
      ...(withOccurrence && occurrenceDate
        ? { occurrence_date: `eq.${occurrenceDate}` }
        : {}),
      order: "created_at.desc",
      limit: 1,
    });
    let data = await supabaseRequest<any[]>("tasks", {
      query: buildQuery(true),
    });
    if ((!data || !data.length) && !id.trim() && occurrenceDate) {
      data = await supabaseRequest<any[]>("tasks", {
        query: buildQuery(false),
      });
    }
    const task = data?.[0];
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const rawComments: StoredComment[] = Array.isArray(task.comments)
      ? task.comments
      : [];
    const normalizedComments = rawComments.map((comment) =>
      normalizeComment(comment)
    );
    const commentsWithAuthors = await resolveCommentAuthors(normalizedComments);
    const photos: string[] = Array.isArray(task.photos) ? task.photos : [];
    const photoPaths = photos.map((entry) => extractPhotoPath(String(entry))).filter(Boolean);
    const signedUrls = photoPaths.length ? await signPhotoPaths(photoPaths) : [];
    const signedMap = new Map(photoPaths.map((path, idx) => [path, signedUrls[idx] || ""]));
    const media = photos.map((entry) => {
      const path = extractPhotoPath(String(entry));
      const signedUrl = path ? signedMap.get(path) || "" : "";
      const fallbackUrl = entry.startsWith("http")
        ? entry
        : path
          ? buildPublicPhotoUrl(path)
          : "";
      const url = signedUrl || fallbackUrl;
      return {
        name: (path || entry).split("/").pop() || "Photo",
        url,
        kind: "image",
      };
    });
    return NextResponse.json({
      id: task.id,
      name: task.name,
      description: task.description || "",
      extraNotes: task.extra_notes || [],
      personCount: task.person_count ?? null,
      status: task.status || "",
      comments: commentsWithAuthors.map((comment) => ({
        id: comment.id,
        text: comment.text,
        createdTime: comment.createdTime,
        author: comment.author,
      })),
      media,
      photos,
      links: task.links || [],
      taskType: task.task_type
        ? { name: task.task_type.name, color: task.task_type.color || "default" }
        : { name: "", color: "default" },
      estimatedTime: task.estimated_time || "",
      properties: [],
      recurring: Boolean(task.recurring),
      occurrenceDate: task.occurrence_date || null,
      parentTaskId: task.parent_task_id || null,
    });
  } catch (err) {
    console.error("Failed to load task:", err);
    return NextResponse.json({ error: "Failed to fetch task" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for tasks yet." },
      { status: 503 }
    );
  }
  const body = await req.json().catch(() => null);
  const { id, name, status, occurrenceDate } = body || {};
  if (!id && !name) {
    return NextResponse.json({ error: "Missing task id or name" }, { status: 400 });
  }
  if (typeof status !== "string") {
    return NextResponse.json({ error: "Missing status" }, { status: 400 });
  }

  try {
    let targetId = id as string | undefined;
    if (!targetId && name) {
      const resolvedDate = toIsoDate(occurrenceDate);
      const baseQuery = {
        select: "id,name",
        name: `ilike.${name}`,
        order: "created_at.desc",
        limit: 1,
      };
      let matches = await supabaseRequest<any[]>("tasks", {
        query: {
          ...baseQuery,
          ...(resolvedDate ? { occurrence_date: `eq.${resolvedDate}` } : {}),
        },
      });
      if ((!matches || matches.length === 0) && resolvedDate) {
        matches = await supabaseRequest<any[]>("tasks", {
          query: baseQuery,
        });
      }
      targetId = matches?.[0]?.id;
    }
    if (!targetId) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    await supabaseRequest("tasks", {
      method: "PATCH",
      query: { id: `eq.${targetId}` },
      body: { status },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update task status:", err);
    return NextResponse.json({ error: "Unable to update task status" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for tasks yet." },
      { status: 503 }
    );
  }
  const body = await req.json().catch(() => null);
  const { name, comment, commentText, authorName, authorId, occurrenceDate } = body || {};
  const resolvedText = String(commentText ?? comment ?? "").trim();
  if (!name || !resolvedText) {
    return NextResponse.json({ error: "Missing task name or comment" }, { status: 400 });
  }
  try {
    const resolvedDate = toIsoDate(occurrenceDate);
    const tasks = await supabaseRequest<any[]>("tasks", {
      query: {
        select: "id,comments",
        name: `ilike.${name}`,
        ...(resolvedDate ? { occurrence_date: `eq.${resolvedDate}` } : {}),
        order: "created_at.desc",
        limit: 1,
      },
    });
    let target = tasks?.[0];
    if (!target && resolvedDate) {
      const fallback = await supabaseRequest<any[]>("tasks", {
        query: {
          select: "id,comments",
          name: `ilike.${name}`,
          order: "created_at.desc",
          limit: 1,
        },
      });
      target = fallback?.[0];
    }
    if (!target?.id) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const existing = Array.isArray(target.comments) ? target.comments : [];
    const parsed = parseCommentAuthor(resolvedText);
    const resolvedAuthorName = authorName || parsed.authorName;
    let resolvedAuthorId = authorId as string | undefined;
    if (!resolvedAuthorId && resolvedAuthorName) {
      const users = await supabaseRequest<any[]>("users", {
        query: {
          select: "id,display_name",
          display_name: `ilike.${resolvedAuthorName}`,
          limit: 1,
        },
      });
      resolvedAuthorId = users?.[0]?.id;
    }

    const createdTime = new Date().toISOString();
    const nextComment: NormalizedComment = {
      id: crypto.randomUUID(),
      text: parsed.text || resolvedText,
      createdTime,
      authorId: resolvedAuthorId,
      authorName: resolvedAuthorName || undefined,
    };
    const next = [...existing, nextComment];
    await supabaseRequest("tasks", {
      method: "PATCH",
      query: { id: `eq.${target.id}` },
      body: { comments: next },
    });
    const normalized = next.map((entry) =>
      normalizeComment(entry)
    );
    const commentsWithAuthors = await resolveCommentAuthors(normalized);
    return NextResponse.json({
      ok: true,
      comments: commentsWithAuthors.map((comment) => ({
        id: comment.id,
        text: comment.text,
        createdTime: comment.createdTime,
        author: comment.author,
      })),
    });
  } catch (err) {
    console.error("Failed to add task comment:", err);
    return NextResponse.json({ error: "Unable to add comment" }, { status: 500 });
  }
}
