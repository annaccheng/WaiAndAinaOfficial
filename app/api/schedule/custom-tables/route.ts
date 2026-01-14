import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

const TABLE_NAME = "schedule_custom_tables";
const DEFAULT_ROWS = 3;
const DEFAULT_COLUMNS = 3;

type CustomTableRow = {
  id: string;
  title: string;
  schedule_date: string;
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

function mapTable(row: CustomTableRow) {
  return {
    id: row.id,
    title: row.title,
    scheduleDate: row.schedule_date,
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
  const scheduleDate = toIsoDate(dateParam);
  if (!scheduleDate) {
    return NextResponse.json({ error: "Missing schedule date" }, { status: 400 });
  }

  try {
    const data = await supabaseRequest<CustomTableRow[]>(TABLE_NAME, {
      query: {
        select:
          "id,title,schedule_date,row_headers,column_headers,cells,row_header_type,column_header_type,cell_type",
        schedule_date: `eq.${scheduleDate}`,
        order: "created_at.asc",
      },
    });
    return NextResponse.json({ tables: (data || []).map(mapTable) });
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

  if (!scheduleDate) {
    return NextResponse.json({ error: "Missing schedule date" }, { status: 400 });
  }

  try {
    const rowHeaders = buildDefaultHeaders("Row", DEFAULT_ROWS);
    const columnHeaders = buildDefaultHeaders("Column", DEFAULT_COLUMNS);
    const cells = buildEmptyCells(DEFAULT_ROWS, DEFAULT_COLUMNS);

    const data = await supabaseRequest<CustomTableRow[]>(TABLE_NAME, {
      method: "POST",
      prefer: "return=representation",
      body: {
        schedule_date: scheduleDate,
        title,
        row_headers: rowHeaders,
        column_headers: columnHeaders,
        cells,
        row_header_type: "text",
        column_header_type: "text",
        cell_type: "user",
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

  try {
    await supabaseRequest(TABLE_NAME, {
      method: "PATCH",
      query: { id: `eq.${id}` },
      body: updates,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update custom table:", err);
    return NextResponse.json({ error: "Unable to update custom table" }, { status: 500 });
  }
}
