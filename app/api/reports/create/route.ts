import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

type ScheduleResponse = {
  people: string[];
  slots: { id: string; label: string; timeRange?: string | null }[];
  cells: Array<{ tasks: { id: string; name: string }[]; note: string }[] | string[]>;
  scheduleDate?: string;
  message?: string;
};
type CustomTable = {
  id: string;
  title: string;
  scheduleDate: string;
  visibleStart?: string | null;
  visibleEnd?: string | null;
  rowHeaders: string[];
  columnHeaders: string[];
  cells: string[][];
  rowHeaderType: string;
  columnHeaderType: string;
  cellType: string;
};

type TaskDetail = {
  id: string;
  name: string;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  estimatedTime?: number | null;
  personCount?: number | null;
  timeSlots?: string[] | null;
};

function toIsoDate(label?: string | null) {
  if (!label) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  if (!label.includes("/")) return null;
  const [month, day, year] = label.split("/");
  if (!month || !day || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeCellTasks(cell: any): { id?: string; name: string }[] {
  if (!cell) return [];
  if (typeof cell === "string") {
    const [firstLine] = cell.split("\n");
    return firstLine
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
  }
  return (cell.tasks || []).map((task: any) => ({
    id: task?.id,
    name: task?.name,
  }));
}

function normalizeCellNote(cell: any) {
  if (!cell) return "";
  if (typeof cell === "string") {
    const [, ...rest] = cell.split("\n");
    return rest.join("\n").trim();
  }
  return cell.note?.trim() || "";
}

function isDateInRange(date: string, start?: string | null, end?: string | null) {
  if (!date) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for reports yet." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const { dateLabel, createdBy } = body || {};
  const resolvedLabel =
    typeof dateLabel === "string" && dateLabel.trim()
      ? dateLabel.trim()
      : null;
  const reportDate = toIsoDate(resolvedLabel) || new Date().toISOString().slice(0, 10);
  const label = resolvedLabel || new Date().toLocaleDateString("en-US");

  try {
    const origin = new URL(req.url).origin;
    let schedule: ScheduleResponse = {
      people: [],
      slots: [],
      cells: [],
      scheduleDate: label,
    };
    try {
      const res = await fetch(
        `${origin}/api/schedule?date=${encodeURIComponent(label)}&staging=1`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        console.warn("Unable to load schedule data for report:", json.error || res.status);
      } else {
        schedule = (await res.json()) as ScheduleResponse;
      }
    } catch (err) {
      console.warn("Schedule fetch failed for report:", err);
    }

    const peopleSummary = schedule.people.map((person, rowIdx) => {
      const row = schedule.cells[rowIdx] || [];
      const taskEntries = row.flatMap((cell: any) => normalizeCellTasks(cell));
      const notes = row.map((cell: any) => normalizeCellNote(cell)).filter(Boolean);
      return {
        person,
        taskCount: taskEntries.length,
        tasks: taskEntries,
        notes,
      };
    });

    const shiftSummary = schedule.slots.map((slot, idx) => {
      const tasks = schedule.cells.flatMap((row: any) =>
        normalizeCellTasks(row[idx])
      );
      return {
        slot: slot.label,
        timeRange: slot.timeRange || null,
        taskCount: tasks.length,
        tasks,
      };
    });

    const scheduleDateLabel = schedule.scheduleDate || label;
    let customTables: CustomTable[] = [];
    try {
      const customRes = await fetch(
        `${origin}/api/schedule/custom-tables?date=${encodeURIComponent(label)}`,
        { cache: "no-store" }
      );
      if (customRes.ok) {
        const customJson = await customRes.json();
        customTables = (customJson.tables || []).filter((table: CustomTable) =>
          isDateInRange(reportDate, table.visibleStart, table.visibleEnd)
        );
      }
    } catch (err) {
      console.warn("Failed to load custom tables for report:", err);
    }

    let taskDetails: TaskDetail[] = [];
    try {
      const tasksRes = await fetch(
        `${origin}/api/tasks?includeOccurrences=true&start=${reportDate}&end=${reportDate}`,
        { cache: "no-store" }
      );
      if (tasksRes.ok) {
        const tasksJson = await tasksRes.json();
        taskDetails = (tasksJson.tasks || []).map((task: any) => ({
          id: String(task.id || ""),
          name: String(task.name || ""),
          description: task.description || null,
          status: task.status || null,
          priority: task.priority || null,
          estimatedTime: task.estimated_time ?? null,
          personCount: task.person_count ?? null,
          timeSlots: Array.isArray(task.time_slots) ? task.time_slots : null,
        }));
      }
    } catch (err) {
      console.warn("Failed to load task details for report:", err);
    }

    const payload = {
      scheduleDate: schedule.scheduleDate || label,
      people: schedule.people,
      slots: schedule.slots,
      cells: schedule.cells,
      peopleSummary,
      shiftSummary,
      notes: schedule.cells.flatMap((row: any) =>
        row.map((cell: any) => normalizeCellNote(cell)).filter(Boolean)
      ),
      customTables,
      taskDetails,
    };
    const totalTasks = shiftSummary.reduce((sum, entry) => sum + entry.taskCount, 0);
    const totalNotes = payload.notes.length;
    const reportTitle = "Daily Operations Report";
    const summary = {
      reportTitle,
      scheduleDate: scheduleDateLabel,
      peopleCount: schedule.people.length,
      shiftsCount: schedule.slots.length,
      totalTasks,
      totalNotes,
      customTableCount: customTables.length,
      totalDetailedTasks: taskDetails.length,
    };

    const [report] = await supabaseRequest<any[]>("schedule_reports", {
      method: "POST",
      prefer: "return=representation",
      query: {
        select: "id,report_date,date_label,report_title,summary,created_at,created_by,data",
      },
      body: {
        report_date: reportDate,
        date_label: label,
        report_title: reportTitle,
        summary,
        data: payload,
        created_by: createdBy || null,
      },
    });

    return NextResponse.json({ report });
  } catch (err) {
    console.error("Report creation failed:", err);
    return NextResponse.json({ error: "Unable to create report" }, { status: 500 });
  }
}
