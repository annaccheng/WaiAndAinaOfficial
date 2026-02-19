import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";
import { sendPushNotifications } from "@/lib/push";

const TABLE_NAME = "schedule_custom_tables";
const DEFAULT_ROWS = 3;
const DEFAULT_COLUMNS = 3;

type CustomTableRow = {
  id: string;
  title: string;
  schedule_date: string;
  visible_start_date?: string | null;
  visible_end_date?: string | null;
  row_headers: string[] | null;
  column_headers: string[] | null;
  cells: string[][] | null;
  row_header_type: string | null;
  column_header_type: string | null;
  cell_type: string | null;
};

function toIsoDate(label?: string | null) {
  if (!label) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  if (!label.includes("/")) return null;
  const [month, day, year] = label.split("/");
  if (!month || !day || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function buildDefaultHeaders(prefix: string, count: number) {
  return Array.from({ length: count }, (_, idx) => `${prefix} ${idx + 1}`);
}

function buildEmptyCells(rows: number, columns: number) {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => ""));
}


function isDateInTableWindow(row: CustomTableRow, targetDate: string) {
  const start = row.visible_start_date || row.schedule_date;
  const end = row.visible_end_date || row.schedule_date;
  if (start && targetDate < start) return false;
  if (end && targetDate > end) return false;
  return true;
}

function mapTable(row: CustomTableRow) {
  return {
    id: row.id,
    title: row.title,
    scheduleDate: row.schedule_date,
    visibleStart: row.visible_start_date ?? row.schedule_date,
    visibleEnd: row.visible_end_date ?? row.schedule_date,
    rowHeaders: row.row_headers || [],
    columnHeaders: row.column_headers || [],
    cells: row.cells || [],
    rowHeaderType: row.row_header_type || "text",
    columnHeaderType: row.column_header_type || "text",
    cellType: row.cell_type || "text",
  };
}

export async function GET(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ tables: [] });
  }

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  const includePast = searchParams.get("past") === "1";
  const scheduleDate = toIsoDate(dateParam);
  if (!scheduleDate) {
    return NextResponse.json({ error: "Missing schedule date" }, { status: 400 });
  }

  try {
    const allRows = await supabaseRequest<CustomTableRow[]>(TABLE_NAME, {
      query: {
        select:
          "id,title,schedule_date,visible_start_date,visible_end_date,row_headers,column_headers,cells,row_header_type,column_header_type,cell_type",
        order: "schedule_date.asc,created_at.asc",
      },
    });

    if (includePast) {
      const pastRows = (allRows || []).filter((row) => row.schedule_date < scheduleDate);
      return NextResponse.json({ tables: pastRows.map(mapTable) });
    }

    const matchingRows = (allRows || []).filter(
      (row) => row.schedule_date === scheduleDate || isDateInTableWindow(row, scheduleDate)
    );

    if (matchingRows.length) {
      return NextResponse.json({ tables: matchingRows.map(mapTable) });
    }

    const fallbackDate =
      (allRows || [])
        .map((row) => row.schedule_date)
        .filter(Boolean)
        .sort()
        .at(-1) || null;
    const fallbackRows = fallbackDate
      ? (allRows || []).filter((row) => row.schedule_date === fallbackDate)
      : [];
    return NextResponse.json({ tables: fallbackRows.map(mapTable) });
  } catch (err) {
    console.error("Failed to load custom tables:", err);
    return NextResponse.json({ error: "Unable to load custom tables" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for schedule tables yet." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const scheduleDate = toIsoDate(body?.scheduleDate);
  const title = String(body?.title || "Custom Table");
  const visibleStart = toIsoDate(body?.visibleStart) || scheduleDate;
  const visibleEnd = toIsoDate(body?.visibleEnd) || scheduleDate;
  const rowHeaders = Array.isArray(body?.rowHeaders) ? body.rowHeaders : buildDefaultHeaders("Row", DEFAULT_ROWS);
  const columnHeaders = Array.isArray(body?.columnHeaders) ? body.columnHeaders : buildDefaultHeaders("Column", DEFAULT_COLUMNS);
  const providedCells = Array.isArray(body?.cells) ? body.cells : null;
  const cells = providedCells || buildEmptyCells(rowHeaders.length || DEFAULT_ROWS, columnHeaders.length || DEFAULT_COLUMNS);

  if (!scheduleDate) {
    return NextResponse.json({ error: "Missing schedule date" }, { status: 400 });
  }

  try {
    const data = await supabaseRequest<CustomTableRow[]>(TABLE_NAME, {
      method: "POST",
      prefer: "return=representation",
      body: {
        schedule_date: scheduleDate,
        title,
        visible_start_date: visibleStart,
        visible_end_date: visibleEnd,
        row_headers: rowHeaders,
        column_headers: columnHeaders,
        cells,
        row_header_type: typeof body?.rowHeaderType === "string" ? body.rowHeaderType : "text",
        column_header_type: typeof body?.columnHeaderType === "string" ? body.columnHeaderType : "text",
        cell_type: typeof body?.cellType === "string" ? body.cellType : "user",
      },
    });

    return NextResponse.json({ table: mapTable(data?.[0]) });
  } catch (err) {
    console.error("Failed to create custom table:", err);
    return NextResponse.json({ error: "Unable to create custom table" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for schedule tables yet." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const id = String(body?.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "Missing table id" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body?.title === "string") {
    updates.title = body.title;
  }
  if (typeof body?.visibleStart === "string" || body?.visibleStart === null) {
    const parsed = toIsoDate(body.visibleStart);
    updates.visible_start_date = parsed ?? null;
  }
  if (typeof body?.visibleEnd === "string" || body?.visibleEnd === null) {
    const parsed = toIsoDate(body.visibleEnd);
    updates.visible_end_date = parsed ?? null;
  }
  if (Array.isArray(body?.rowHeaders)) {
    updates.row_headers = body.rowHeaders;
  }
  if (Array.isArray(body?.columnHeaders)) {
    updates.column_headers = body.columnHeaders;
  }
  if (Array.isArray(body?.cells)) {
    updates.cells = body.cells;
  }
  if (typeof body?.rowHeaderType === "string") {
    updates.row_header_type = body.rowHeaderType;
  }
  if (typeof body?.columnHeaderType === "string") {
    updates.column_header_type = body.columnHeaderType;
  }
  if (typeof body?.cellType === "string") {
    updates.cell_type = body.cellType;
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ ok: true });
  }

  const tableTitle =
    typeof body?.title === "string" && body.title.trim()
      ? body.title.trim()
      : null;

  try {
    await supabaseRequest(TABLE_NAME, {
      method: "PATCH",
      query: { id: `eq.${id}` },
      body: updates,
    });
    let resolvedTitle = tableTitle;
    if (!resolvedTitle) {
      const [existing] = await supabaseRequest<Pick<CustomTableRow, "title">[]>(
        TABLE_NAME,
        {
          query: { select: "title", id: `eq.${id}`, limit: 1 },
        }
      );
      resolvedTitle = existing?.title || "Custom table";
    }
    await sendPushNotifications({
      roleContains: "volunteer",
      payload: {
        title: "Custom table updated",
        body: `${resolvedTitle} has been updated.`,
        url: "/hub",
        tag: "custom-table",
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update custom table:", err);
    return NextResponse.json({ error: "Unable to update custom table" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for schedule tables yet." },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(req.url);
  const id = String(searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json({ error: "Missing table id" }, { status: 400 });
  }

  try {
    await supabaseRequest(TABLE_NAME, {
      method: "DELETE",
      query: { id: `eq.${id}` },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete custom table:", err);
    return NextResponse.json({ error: "Unable to delete custom table" }, { status: 500 });
  }
}
