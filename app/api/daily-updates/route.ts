import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";
import { sendPushNotifications } from "@/lib/push";

type DailyUpdatePayload = {
  id: string;
  update_date: string;
  user_name: string;
  task_statuses: { taskId: string; taskName: string; status: string }[];
  extra_notes: string | null;
  requests: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

type DailyTaskStatus = {
  taskId: string;
  taskName: string;
  status: string;
};

function toIsoDate(label?: string | null) {
  if (!label) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  if (!label.includes("/")) return "";
  const [month, day, year] = label.split("/");
  if (!month || !day || !year) return "";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function summarizeFallback(userName: string, statuses: string[], notes: string, requests: string) {
  const completed = statuses.filter((status) => status.toLowerCase() === "completed").length;
  const inProgress = statuses.filter((status) => status.toLowerCase() === "in progress").length;
  const workNote = completed
    ? `${userName} completed ${completed} task${completed === 1 ? "" : "s"}`
    : `${userName} shared today's work update`;
  const progressNote = inProgress ? ` and has ${inProgress} in progress` : "";
  const noteSnippet = notes ? ` Notes: ${notes.slice(0, 90)}.` : "";
  const requestSnippet = requests ? ` Request: ${requests.slice(0, 90)}.` : "";
  return `${workNote}${progressNote}.${noteSnippet}${requestSnippet}`.trim();
}

async function generateSummary(userName: string, statuses: string[], notes: string, requests: string) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return summarizeFallback(userName, statuses, notes, requests);

  try {
    const prompt = `Create a short push-notification summary (<=180 chars). User: ${userName}. Statuses: ${statuses.join(", ") || "none"}. Extra notes: ${notes || "none"}. Requests: ${requests || "none"}. Keep it positive and general.`;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You generate concise daily update summaries for push notifications." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 90,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const json = await res.json();
    const content = String(json?.choices?.[0]?.message?.content || "").trim();
    return content || summarizeFallback(userName, statuses, notes, requests);
  } catch (err) {
    console.error("Failed to generate OpenAI summary", err);
    return summarizeFallback(userName, statuses, notes, requests);
  }
}

export async function GET(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ updates: [] });
  }

  const { searchParams } = new URL(req.url);
  const dateIso = toIsoDate(searchParams.get("date"));
  const name = String(searchParams.get("name") || "").trim();
  if (!dateIso) {
    return NextResponse.json({ error: "Missing date" }, { status: 400 });
  }

  try {
    const query: Record<string, string> = {
      select:
        "id,update_date,user_name,task_statuses,extra_notes,requests,summary,created_at,updated_at",
      update_date: `eq.${dateIso}`,
      order: "updated_at.desc",
    };
    if (name) query.user_name = `eq.${name}`;
    const rows = await supabaseRequest<DailyUpdatePayload[]>("daily_updates", { query });
    return NextResponse.json({ updates: rows || [] });
  } catch (err) {
    console.error("Failed to load daily updates", err);
    return NextResponse.json({ updates: [], error: "Unable to load daily updates" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const userName = String(body?.userName || "").trim();
  const updateDate = toIsoDate(body?.updateDate);
  const taskStatuses: DailyTaskStatus[] = Array.isArray(body?.taskStatuses)
    ? (body.taskStatuses as unknown[])
        .map((row): DailyTaskStatus => {
          const source = row as Partial<DailyTaskStatus> | null | undefined;
          return {
            taskId: String(source?.taskId || "").trim(),
            taskName: String(source?.taskName || "").trim(),
            status: String(source?.status || "").trim(),
          };
        })
        .filter((row: DailyTaskStatus) => Boolean(row.taskName))
    : [];
  const extraNotes = String(body?.extraNotes || "").trim();
  const requests = String(body?.requests || "").trim();

  if (!userName || !updateDate) {
    return NextResponse.json({ error: "Missing userName or updateDate" }, { status: 400 });
  }

  const summary = await generateSummary(
    userName,
    taskStatuses.map((row) => row.status),
    extraNotes,
    requests
  );

  try {
    const [existing] = await supabaseRequest<DailyUpdatePayload[]>("daily_updates", {
      query: {
        select: "id",
        user_name: `eq.${userName}`,
        update_date: `eq.${updateDate}`,
        limit: "1",
      },
    });

    let saved: DailyUpdatePayload | null = null;
    if (existing?.id) {
      const [updated] = await supabaseRequest<DailyUpdatePayload[]>("daily_updates", {
        method: "PATCH",
        prefer: "return=representation",
        query: {
          select:
            "id,update_date,user_name,task_statuses,extra_notes,requests,summary,created_at,updated_at",
          id: `eq.${existing.id}`,
        },
        body: {
          task_statuses: taskStatuses,
          extra_notes: extraNotes || null,
          requests: requests || null,
          summary,
        },
      });
      saved = updated || null;
    } else {
      const [created] = await supabaseRequest<DailyUpdatePayload[]>("daily_updates", {
        method: "POST",
        prefer: "return=representation",
        query: {
          select:
            "id,update_date,user_name,task_statuses,extra_notes,requests,summary,created_at,updated_at",
        },
        body: {
          user_name: userName,
          update_date: updateDate,
          task_statuses: taskStatuses,
          extra_notes: extraNotes || null,
          requests: requests || null,
          summary,
        },
      });
      saved = created || null;
    }

    const users = await supabaseRequest<any[]>("users", {
      query: {
        select: "display_name,active,user_role:user_roles(name)",
      },
    });
    const recipients = Array.from(
      new Set(
        (users || [])
          .filter((user) => {
            const type = String(user?.user_role?.name || "").toLowerCase();
            const isAdmin = type === "admin";
            return Boolean(user?.active) || isAdmin;
          })
          .map((user) => String(user.display_name || "").trim())
          .filter(Boolean)
          .filter((entry) => entry.toLowerCase() !== userName.toLowerCase())
      )
    );

    if (recipients.length) {
      await sendPushNotifications({
        userNames: recipients,
        payload: {
          title: `${userName} submitted a daily update`,
          body: summary,
          url: "/hub/dashboard",
          tag: "daily-update",
        },
      });
    }

    return NextResponse.json({ update: saved, summary });
  } catch (err) {
    console.error("Failed to save daily update", err);
    return NextResponse.json({ error: "Unable to save daily update" }, { status: 500 });
  }
}
