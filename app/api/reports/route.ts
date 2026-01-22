import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

export async function GET(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { reports: [], error: "Supabase is not configured for reports yet." },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(req.url);
  const list = searchParams.get("list");
  const id = searchParams.get("id");

  try {
    if (list) {
      const reports = await supabaseRequest<any[]>("schedule_reports", {
        query: {
          select: "id,report_date,date_label,report_title,summary,created_at,created_by",
          order: "report_date.desc",
        },
      });
      return NextResponse.json({ reports: reports || [] });
    }

    if (id) {
      const [report] = await supabaseRequest<any[]>("schedule_reports", {
        query: {
          select: "id,report_date,date_label,report_title,summary,data,created_at,created_by",
          id: `eq.${id}`,
        },
      });
      if (!report) {
        return NextResponse.json({ error: "Report not found" }, { status: 404 });
      }
      return NextResponse.json({ report });
    }

    return NextResponse.json({ reports: [] });
  } catch (err) {
    console.error("Failed to load reports:", err);
    return NextResponse.json({ error: "Unable to load reports" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for reports yet." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const { reportDate, dateLabel, data, createdBy } = body || {};
  if (!reportDate || !dateLabel || !data) {
    return NextResponse.json({ error: "Missing report payload" }, { status: 400 });
  }

  try {
    const [report] = await supabaseRequest<any[]>("schedule_reports", {
      method: "POST",
      prefer: "return=representation",
      query: {
        select: "id,report_date,date_label,report_title,summary,data,created_at,created_by",
      },
      body: {
        report_date: reportDate,
        date_label: dateLabel,
        report_title: data?.reportTitle || null,
        summary: data?.summary || {},
        data,
        created_by: createdBy || null,
      },
    });
    return NextResponse.json({ report });
  } catch (err) {
    console.error("Failed to create report:", err);
    return NextResponse.json({ error: "Unable to create report" }, { status: 500 });
  }
}
