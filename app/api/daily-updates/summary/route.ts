import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

type DailyUpdatePayload = {
  id: string;
  update_date: string;
  user_name: string;
  task_statuses: { taskId: string; taskName: string; status: string }[];
  extra_notes: string | null;
  requests: string | null;
};

function toIsoDate(label?: string | null) {
  if (!label) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  if (!label.includes("/")) return "";
  const [month, day, year] = label.split("/");
  if (!month || !day || !year) return "";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function fallbackSummary(dateIso: string, updates: DailyUpdatePayload[]) {
  if (!updates.length) {
    return `No daily updates were submitted for ${dateIso}.`;
  }

  const incomplete = updates.flatMap((update) =>
    (update.task_statuses || []).filter((task) => task.status.toLowerCase() !== "completed")
  );

  const requestCount = updates.filter((entry) => Boolean(entry.requests?.trim())).length;
  return [
    `Daily report summary for ${dateIso}: ${updates.length} team member${
      updates.length === 1 ? "" : "s"
    } submitted updates.`,
    `${incomplete.length} task${incomplete.length === 1 ? "" : "s"} were left incomplete or in progress.`,
    `${requestCount} update${requestCount === 1 ? "" : "s"} included requests that may need follow-up.`,
  ].join(" ");
}

async function generateAdminSummary(dateIso: string, updates: DailyUpdatePayload[]) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return fallbackSummary(dateIso, updates);

  const compactUpdates = updates.map((update) => ({
    user: update.user_name,
    statuses: (update.task_statuses || []).map((task) => ({
      taskName: task.taskName,
      status: task.status,
    })),
    extraNotes: update.extra_notes || "",
    requests: update.requests || "",
  }));

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          {
            role: "system",
            content:
              "You are an operations analyst helping farm admins review daily reports. Highlight patterns, important unfinished work, and practical next actions.",
          },
          {
            role: "user",
            content: [
              `Create an admin summary for ${dateIso} using the daily updates below.`,
              "Output markdown with these exact section headings:",
              "## Overall Summary",
              "## Important Incomplete Tasks",
              "## Risks / Follow-ups",
              "## Potential Tasks to Create",
              "Under each heading use concise bullets. In 'Important Incomplete Tasks', prioritize items that appear urgent, blocked, safety-related, animal-care related, or repeatedly unfinished.",
              "If data is missing, say so briefly.",
              "Daily updates JSON:",
              JSON.stringify(compactUpdates),
            ].join("\n"),
          },
        ],
      }),
    });

    if (!response.ok) throw new Error(`OpenAI ${response.status}`);
    const json = await response.json();
    const content = String(json?.choices?.[0]?.message?.content || "").trim();
    return content || fallbackSummary(dateIso, updates);
  } catch (err) {
    console.error("Failed to generate admin daily update summary", err);
    return fallbackSummary(dateIso, updates);
  }
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const dateIso = toIsoDate(body?.date);
  if (!dateIso) {
    return NextResponse.json({ error: "Missing date" }, { status: 400 });
  }

  try {
    const updates = await supabaseRequest<DailyUpdatePayload[]>("daily_updates", {
      query: {
        select: "id,update_date,user_name,task_statuses,extra_notes,requests",
        update_date: `eq.${dateIso}`,
        order: "updated_at.desc",
      },
    });

    const summary = await generateAdminSummary(dateIso, updates || []);
    return NextResponse.json({ summary, date: dateIso, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("Failed to build admin daily update summary", err);
    return NextResponse.json({ error: "Unable to generate summary" }, { status: 500 });
  }
}
