import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";
import { sendPushNotifications } from "@/lib/push";

type RequestRow = {
  id: string;
  title: string;
  details: string;
  user_name: string;
  request_type: string;
  status: string;
  urgent: boolean;
  shareable: boolean;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

type SuggestionRow = {
  id: string;
  request_id: string;
  author_name: string;
  content: string;
  removed: boolean;
  removed_by: string | null;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
};

function normalizeStatus(value?: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "approved") return "Approved";
  if (normalized === "denied") return "Denied";
  return "In Progress";
}

async function notifyAdmins(title: string, body: string, url = "/hub/request") {
  const users = await supabaseRequest<any[]>("users", {
    query: { select: "display_name,user_role:user_roles(name)", active: "eq.true" },
  });
  const adminNames = Array.from(
    new Set(
      (users || [])
        .filter((user) => String(user?.user_role?.name || "").toLowerCase() === "admin")
        .map((user) => String(user.display_name || "").trim())
        .filter(Boolean)
    )
  );
  if (!adminNames.length) return;
  await sendPushNotifications({ userNames: adminNames, payload: { title, body, url, tag: "request-admin" } });
}

async function notifyRequestSubscribers(requestId: string, title: string, body: string, excludeUserNames: string[] = []) {
  const rows = await supabaseRequest<any[]>("request_subscribers", {
    query: {
      select: "user_name",
      request_id: `eq.${requestId}`,
    },
  });
  const userNames = Array.from(
    new Set((rows || []).map((row) => String(row.user_name || "").trim()).filter(Boolean))
  );
  if (!userNames.length) return;
  await sendPushNotifications({
    userNames,
    excludeUserNames,
    payload: { title, body, url: `/hub/request?requestId=${requestId}`, tag: `request-${requestId}` },
  });
}


async function isAdminUser(name: string) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return false;
  const rows = await supabaseRequest<any[]>("users", {
    query: {
      select: "display_name,user_role:user_roles(name)",
      display_name: `eq.${trimmed}`,
      limit: "1",
    },
  });
  const user = rows?.[0];
  return String(user?.user_role?.name || "").toLowerCase() === "admin";
}

async function fetchDetail(requestId: string) {
  const [request] = await supabaseRequest<RequestRow[]>("requests", {
    query: {
      select:
        "id,title,details,user_name,request_type,status,urgent,shareable,review_note,reviewed_by,reviewed_at,created_at,updated_at",
      id: `eq.${requestId}`,
      limit: "1",
    },
  });
  if (!request) return null;

  const suggestions = await supabaseRequest<SuggestionRow[]>("request_suggestions", {
    query: {
      select:
        "id,request_id,author_name,content,removed,removed_by,removed_at,created_at,updated_at",
      request_id: `eq.${requestId}`,
      order: "created_at.asc",
    },
  });

  return {
    id: request.id,
    title: request.title,
    details: request.details,
    user: request.user_name,
    requestType: request.request_type,
    status: request.status,
    urgent: !!request.urgent,
    shareable: !!request.shareable,
    reviewNote: request.review_note,
    reviewedBy: request.reviewed_by,
    reviewedAt: request.reviewed_at,
    createdTime: request.created_at,
    updatedTime: request.updated_at,
    suggestions: (suggestions || []).map((row) => ({
      id: row.id,
      author: row.author_name,
      content: row.content,
      removed: !!row.removed,
      removedBy: row.removed_by,
      removedAt: row.removed_at,
      createdTime: row.created_at,
    })),
  };
}

export async function GET(req: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ requests: [] });

  const { searchParams } = new URL(req.url);
  const id = String(searchParams.get("id") || "").trim();

  try {
    if (id) {
      const detail = await fetchDetail(id);
      if (!detail) return NextResponse.json({ error: "Request not found" }, { status: 404 });
      return NextResponse.json(detail);
    }

    const rows = await supabaseRequest<RequestRow[]>("requests", {
      query: {
        select:
          "id,title,details,user_name,request_type,status,urgent,shareable,review_note,reviewed_by,reviewed_at,created_at,updated_at",
        order: "updated_at.desc",
      },
    });

    return NextResponse.json({
      requests: (rows || []).map((row) => ({
        id: row.id,
        title: row.title,
        details: row.details,
        user: row.user_name,
        requestType: row.request_type,
        status: normalizeStatus(row.status),
        urgent: !!row.urgent,
        shareable: !!row.shareable,
        createdTime: row.created_at,
        updatedTime: row.updated_at,
      })),
    });
  } catch (err) {
    console.error("Failed to load requests", err);
    return NextResponse.json({ requests: [], error: "Unable to load requests" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const action = String(body?.action || "create").trim().toLowerCase();

  try {
    if (action === "suggestion") {
      const requestId = String(body?.id || "").trim();
      const author = String(body?.user || "").trim();
      const content = String(body?.content || "").trim();
      if (!requestId || !author || !content) {
        return NextResponse.json({ error: "Missing id, user, or content" }, { status: 400 });
      }

      const [ownerRequest] = await supabaseRequest<RequestRow[]>("requests", {
        query: { select: "id,user_name,shareable,title", id: `eq.${requestId}`, limit: "1" },
      });
      if (!ownerRequest) return NextResponse.json({ error: "Request not found" }, { status: 404 });
      if (!ownerRequest.shareable) {
        return NextResponse.json({ error: "Suggestions are disabled for this request." }, { status: 403 });
      }

      const [suggestion] = await supabaseRequest<SuggestionRow[]>("request_suggestions", {
        method: "POST",
        prefer: "return=representation",
        query: {
          select: "id,request_id,author_name,content,removed,removed_by,removed_at,created_at,updated_at",
        },
        body: {
          request_id: requestId,
          author_name: author,
          content,
        },
      });

      await supabaseRequest("request_subscribers", {
        method: "POST",
        prefer: "resolution=merge-duplicates",
        body: { request_id: requestId, user_name: author },
      });

      await notifyRequestSubscribers(
        requestId,
        `${author} suggested an update`,
        `${author} added a suggestion on "${ownerRequest.title}"`,
        [author]
      );

      return NextResponse.json({
        suggestion: {
          id: suggestion.id,
          author: suggestion.author_name,
          content: suggestion.content,
          removed: suggestion.removed,
          removedBy: suggestion.removed_by,
          removedAt: suggestion.removed_at,
          createdTime: suggestion.created_at,
        },
      });
    }

    const title = String(body?.title || "").trim();
    const details = String(body?.details || "").trim();
    const user = String(body?.user || "").trim();
    const requestType = String(body?.requestType || "Other").trim();
    const urgent = Boolean(body?.urgent);
    const shareable = Boolean(body?.shareable);

    if (!title || !details || !user) {
      return NextResponse.json({ error: "Missing title, details, or user" }, { status: 400 });
    }

    const [created] = await supabaseRequest<RequestRow[]>("requests", {
      method: "POST",
      prefer: "return=representation",
      query: {
        select:
          "id,title,details,user_name,request_type,status,urgent,shareable,review_note,reviewed_by,reviewed_at,created_at,updated_at",
      },
      body: {
        title,
        details,
        user_name: user,
        request_type: requestType,
        status: "In Progress",
        urgent,
        shareable,
      },
    });

    await supabaseRequest("request_subscribers", {
      method: "POST",
      prefer: "resolution=merge-duplicates",
      body: { request_id: created.id, user_name: user },
    });

    await notifyAdmins(
      `${urgent ? "🚨 " : ""}${user} submitted a request`,
      `${requestType}: ${title}`
    );

    return NextResponse.json({
      request: {
        id: created.id,
        title: created.title,
        details: created.details,
        user: created.user_name,
        requestType: created.request_type,
        status: normalizeStatus(created.status),
        urgent: !!created.urgent,
        shareable: !!created.shareable,
        createdTime: created.created_at,
        updatedTime: created.updated_at,
      },
    });
  } catch (err) {
    console.error("Failed to save request", err);
    return NextResponse.json({ error: "Unable to save request" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const action = String(body?.action || "").trim().toLowerCase();

  try {
    if (action === "review") {
      const id = String(body?.id || "").trim();
      const decision = normalizeStatus(body?.decision);
      const reviewNote = String(body?.reviewNote || "").trim();
      const reviewedBy = String(body?.reviewedBy || "").trim();
      if (!id || !reviewNote || !reviewedBy || decision === "In Progress") {
        return NextResponse.json(
          { error: "Review requires id, reviewedBy, decision (approved/denied), and review note." },
          { status: 400 }
        );
      }

      const [updated] = await supabaseRequest<RequestRow[]>("requests", {
        method: "PATCH",
        prefer: "return=representation",
        query: {
          select:
            "id,title,details,user_name,request_type,status,urgent,shareable,review_note,reviewed_by,reviewed_at,created_at,updated_at",
          id: `eq.${id}`,
        },
        body: {
          status: decision,
          review_note: reviewNote,
          reviewed_by: reviewedBy,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });

      if (!updated) return NextResponse.json({ error: "Request not found" }, { status: 404 });

      await notifyRequestSubscribers(
        updated.id,
        `${updated.title} was ${decision}`,
        `${reviewedBy} marked this request as ${decision}. Note: ${reviewNote}`
      );

      return NextResponse.json({
        request: {
          id: updated.id,
          title: updated.title,
          details: updated.details,
          user: updated.user_name,
          requestType: updated.request_type,
          status: updated.status,
          urgent: !!updated.urgent,
          shareable: !!updated.shareable,
          reviewNote: updated.review_note,
          reviewedBy: updated.reviewed_by,
          reviewedAt: updated.reviewed_at,
          createdTime: updated.created_at,
          updatedTime: updated.updated_at,
        },
      });
    }

    if (action === "remove-suggestion") {
      const suggestionId = String(body?.suggestionId || "").trim();
      const requestId = String(body?.id || "").trim();
      const actor = String(body?.user || "").trim();
      if (!suggestionId || !requestId || !actor) {
        return NextResponse.json({ error: "Missing suggestion id, request id, or user" }, { status: 400 });
      }

      const [ownerRequest] = await supabaseRequest<RequestRow[]>("requests", {
        query: { select: "id,user_name", id: `eq.${requestId}`, limit: "1" },
      });
      if (!ownerRequest) return NextResponse.json({ error: "Request not found" }, { status: 404 });
      if (ownerRequest.user_name.trim().toLowerCase() !== actor.trim().toLowerCase()) {
        return NextResponse.json({ error: "Only the original author can remove suggestions." }, { status: 403 });
      }

      const [updated] = await supabaseRequest<SuggestionRow[]>("request_suggestions", {
        method: "PATCH",
        prefer: "return=representation",
        query: {
          select:
            "id,request_id,author_name,content,removed,removed_by,removed_at,created_at,updated_at",
          id: `eq.${suggestionId}`,
          request_id: `eq.${requestId}`,
        },
        body: {
          removed: true,
          removed_by: actor,
          removed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });

      if (!updated) return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (err) {
    console.error("Failed to update request", err);
    return NextResponse.json({ error: "Unable to update request" }, { status: 500 });
  }
}


export async function DELETE(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const id = String(searchParams.get("id") || "").trim();
  const actor = String(searchParams.get("actor") || "").trim();

  if (!id || !actor) {
    return NextResponse.json({ error: "Missing id or actor" }, { status: 400 });
  }

  try {
    const admin = await isAdminUser(actor);
    if (!admin) {
      return NextResponse.json({ error: "Only admins can delete requests." }, { status: 403 });
    }

    await supabaseRequest("requests", {
      method: "DELETE",
      query: { id: `eq.${id}` },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete request", err);
    return NextResponse.json({ error: "Unable to delete request" }, { status: 500 });
  }
}
