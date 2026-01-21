"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { loadSession } from "@/lib/session";

function normalizeCellTasks(cell: any): string[] {
  if (!cell) return [];
  if (typeof cell === "string") {
    const [firstLine] = cell.split("\n");
    return firstLine
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return (cell.tasks || []).map((task: any) => task?.name).filter(Boolean);
}

function normalizeCellNote(cell: any): string | null {
  if (!cell) return null;
  if (typeof cell === "string") {
    const [, ...rest] = cell.split("\n");
    const note = rest.join("\n").trim();
    return note ? note : null;
  }
  const note = cell.note?.trim();
  return note || null;
}

type ReportPayload = {
  id: string;
  report_date: string;
  date_label: string;
  report_title?: string | null;
  summary?: {
    reportTitle?: string;
    scheduleDate?: string;
    peopleCount?: number;
    shiftsCount?: number;
    totalTasks?: number;
    totalNotes?: number;
    customTableCount?: number;
    totalDetailedTasks?: number;
  } | null;
  data: {
    scheduleDate: string;
    people: string[];
    slots: { id: string; label: string; timeRange?: string | null }[];
    cells: Array<{ tasks: { id?: string; name: string }[]; note: string }[] | string[]>;
    peopleSummary?: {
      person: string;
      taskCount: number;
      tasks: { id?: string; name: string }[];
      notes: string[];
    }[];
    shiftSummary?: {
      slot: string;
      timeRange?: string | null;
      taskCount: number;
      tasks: { id?: string; name: string }[];
    }[];
    notes?: string[];
    customTables?: {
      id: string;
      title: string;
      scheduleDate: string;
      rowHeaders: string[];
      columnHeaders: string[];
      cells: string[][];
      rowHeaderType: string;
      columnHeaderType: string;
      cellType: string;
    }[];
    taskDetails?: {
      id: string;
      name: string;
      description?: string | null;
      status?: string | null;
      priority?: string | null;
      estimatedTime?: number | null;
      personCount?: number | null;
      timeSlots?: string[] | null;
    }[];
  };
  created_at: string;
  created_by?: string | null;
};

export default function AnalyticsReportPage() {
  const params = useParams<{ reportId: string }>();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const session = loadSession();
    if (!session?.name) {
      router.replace("/");
      return;
    }
    const isAdmin = (session.userType || "").toLowerCase() === "admin";
    if (!isAdmin) {
      setMessage("Admin access required.");
      return;
    }
    setAuthorized(true);
  }, [router]);

  useEffect(() => {
    if (!authorized) return;
    const loadReport = async () => {
      try {
        const res = await fetch(`/api/reports?id=${params.reportId}`);
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || "Unable to load report.");
        }
        setReport(json.report);
      } catch (err: any) {
        console.error("Failed to load report", err);
        setMessage(err?.message || "Unable to load report.");
      }
    };
    loadReport();
  }, [authorized, params.reportId]);

  const handleDownloadPdf = () => {
    if (typeof window === "undefined") return;
    setDownloading(true);
    window.requestAnimationFrame(() => {
      window.print();
      setDownloading(false);
    });
  };

  if (!authorized) {
    return (
      <div className="mx-auto max-w-4xl p-6 text-sm text-[#7a7f54]">
        {message || "Checking access..."}
      </div>
    );
  }

  if (!report) {
    return (
      <div className="mx-auto max-w-4xl p-6 text-sm text-[#7a7f54]">
        {message || "Loading report..."}
      </div>
    );
  }

  const reportTitle =
    report.report_title || report.summary?.reportTitle || "Daily Operations Report";
  const totalTasks =
    report.summary?.totalTasks ??
    (report.data.shiftSummary || []).reduce((sum, shift) => sum + shift.taskCount, 0);
  const totalNotes = report.summary?.totalNotes ?? (report.data.notes || []).length;
  const peopleCount = report.summary?.peopleCount ?? report.data.people.length;
  const shiftsCount = report.summary?.shiftsCount ?? report.data.slots.length;
  const customTableCount =
    report.summary?.customTableCount ?? (report.data.customTables || []).length;
  const totalDetailedTasks =
    report.summary?.totalDetailedTasks ?? (report.data.taskDetails || []).length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="rounded-2xl border border-[#d6cfb3] bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">Report</p>
            <h1 className="text-2xl font-semibold text-[#314123]">{reportTitle}</h1>
            <p className="text-sm text-[#5f5a3b]">
              {report.date_label} · Created {new Date(report.created_at).toLocaleString()}
              {report.created_by ? ` by ${report.created_by}` : ""}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 print-hidden">
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={downloading}
              className="rounded-md bg-[#314123] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-white shadow-sm transition hover:bg-[#2a371f] disabled:opacity-60"
            >
              {downloading ? "Preparing PDF…" : "Download PDF"}
            </button>
            <Link
              href="/hub/admin/analytics"
              className="rounded-md border border-[#d0c9a4] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8]"
            >
              Back to analytics
            </Link>
          </div>
        </div>
      </div>

      <div className="print-page print-compact rounded-2xl border border-[#d6cfb3] bg-white p-8 shadow-[0_16px_40px_rgba(49,65,35,0.08)]">
        <div className="flex flex-col gap-6 border-b border-[#ece3c4] pb-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <img
                  src="/logo.png"
                  alt="Wai & Aina"
                  className="h-12 w-12 rounded-lg border border-[#e2d7b5] object-cover"
                />
                <div>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-[#6b6f52]">
                    Wai & Aina · Admin Report
                  </p>
                  <h2 className="text-3xl font-semibold text-[#28321d]">{reportTitle}</h2>
                  <p className="text-sm text-[#58533a]">
                    Report date: {report.date_label}
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-[#e0d6b8] bg-[#fbf9f0] px-4 py-3 text-xs text-[#4b5133]">
              <div className="font-semibold uppercase tracking-[0.12em] text-[#7a7f54]">
                Prepared
              </div>
              <div>{new Date(report.created_at).toLocaleDateString()}</div>
              {report.created_by && <div>by {report.created_by}</div>}
              <div className="mt-2 text-[11px] uppercase tracking-[0.12em] text-[#7a7f54]">
                Generated
              </div>
              <div>{new Date(report.created_at).toLocaleTimeString()}</div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {[
              { label: "People", value: peopleCount },
              { label: "Shifts", value: shiftsCount },
              { label: "Tasks", value: totalTasks },
              { label: "Notes", value: totalNotes },
              { label: "Custom Tables", value: customTableCount },
              { label: "Detailed Tasks", value: totalDetailedTasks },
            ].map((metric) => (
              <div
                key={metric.label}
                className="rounded-xl border border-[#e0d6b8] bg-white px-3 py-2"
              >
                <div className="text-[10px] uppercase tracking-[0.16em] text-[#7a7f54]">
                  {metric.label}
                </div>
                <div className="text-xl font-semibold text-[#28321d]">{metric.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-2xl border border-[#e0d6b8] bg-[#fbf9f0] p-5">
            <h3 className="text-lg font-semibold text-[#314123]">Executive summary</h3>
            <p className="mt-2 text-sm text-[#4b5133]">
              This report captures the staging schedule for {report.date_label},
              detailing assigned tasks per person and shift, along with operational notes.
              Use this snapshot for staffing reviews, workload balance, and record keeping.
            </p>
            <div className="mt-4 grid gap-3 text-xs text-[#4b5133]">
              <div className="flex items-center justify-between border-b border-[#e2d7b5] pb-2">
                <span className="uppercase tracking-[0.12em] text-[#7a7f54]">
                  Schedule Date
                </span>
                <span className="font-semibold">{report.data.scheduleDate}</span>
              </div>
              <div className="flex items-center justify-between border-b border-[#e2d7b5] pb-2">
                <span className="uppercase tracking-[0.12em] text-[#7a7f54]">
                  Total Tasks
                </span>
                <span className="font-semibold">{totalTasks}</span>
              </div>
              <div className="flex items-center justify-between border-b border-[#e2d7b5] pb-2">
                <span className="uppercase tracking-[0.12em] text-[#7a7f54]">
                  Custom Tables
                </span>
                <span className="font-semibold">{customTableCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="uppercase tracking-[0.12em] text-[#7a7f54]">
                  Notes Captured
                </span>
                <span className="font-semibold">{totalNotes}</span>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-[#e0d6b8] bg-white p-5">
            <h3 className="text-lg font-semibold text-[#314123]">Highlights</h3>
            <ul className="mt-3 space-y-3 text-sm text-[#4b5133]">
              <li className="rounded-md border border-[#e0d6b8] bg-[#fdfcf8] px-3 py-2">
                Staffing coverage across {shiftsCount} shifts for {peopleCount} people.
              </li>
              <li className="rounded-md border border-[#e0d6b8] bg-[#fdfcf8] px-3 py-2">
                {totalTasks} tasks assigned with {totalNotes} operational notes recorded.
              </li>
              <li className="rounded-md border border-[#e0d6b8] bg-[#fdfcf8] px-3 py-2">
                Snapshot stored for historical reference and sharing.
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-[#e0d6b8] bg-white p-5">
          <h3 className="text-lg font-semibold text-[#314123]">Schedule snapshot</h3>
          <p className="mt-1 text-sm text-[#5f5a3b]">
            Task assignments by person and shift for {report.data.scheduleDate}.
          </p>
          <div className="mt-4 overflow-auto">
            <table className="min-w-full border-collapse text-[10px]">
              <thead className="bg-[#f5f1df] text-[9px] uppercase tracking-[0.18em] text-[#6b7247]">
                <tr>
                  <th className="border border-[#e0d6b8] px-3 py-2 text-left">Person</th>
                  {report.data.slots.map((slot) => (
                    <th key={slot.id} className="border border-[#e0d6b8] px-3 py-2 text-left">
                      <div className="font-semibold text-[#314123]">{slot.label}</div>
                      {slot.timeRange && (
                        <div className="text-[10px] font-normal text-[#7a7f54]">
                          {slot.timeRange}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.data.people.map((person, rowIdx) => (
                  <tr key={person} className="align-top">
                    <td className="border border-[#e0d6b8] px-3 py-2 font-semibold text-[#28321d]">
                      {person}
                    </td>
                    {report.data.slots.map((slot, colIdx) => {
                      const cell = report.data.cells[rowIdx]?.[colIdx];
                      const tasks = normalizeCellTasks(cell);
                      const note = normalizeCellNote(cell);
                      return (
                        <td
                          key={`${person}-${slot.id}`}
                          className="border border-[#e0d6b8] px-2 py-2 text-[#4b5133]"
                        >
                          {tasks.length > 0 ? (
                            <ul className="space-y-0.5">
                              {tasks.map((task) => (
                                <li key={`${person}-${slot.id}-${task}`} className="leading-snug">
                                  • {task}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-[11px] text-[#9aa07b]">No tasks</span>
                          )}
                          {note && (
                            <p className="mt-1 text-[9px] italic text-[#6a6c4d]">
                              Note: {note}
                            </p>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {(report.data.customTables || []).length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-[#314123]">Custom tables</h3>
            <div className="mt-4 space-y-6">
              {(report.data.customTables || []).map((table) => (
                <div
                  key={table.id}
                  className="rounded-2xl border border-[#e0d6b8] bg-white p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-base font-semibold text-[#314123]">{table.title}</h4>
                    <span className="text-[11px] uppercase tracking-[0.12em] text-[#7a7f54]">
                      {table.scheduleDate}
                    </span>
                  </div>
                  <div className="mt-3 overflow-auto">
                    <table className="min-w-full border-collapse text-[11px]">
                      <thead className="bg-[#f5f1df] text-[10px] uppercase tracking-[0.14em] text-[#6b7247]">
                        <tr>
                          <th className="border border-[#e0d6b8] px-3 py-2 text-left">
                            {table.rowHeaderType === "text" ? "Row" : "Rows"}
                          </th>
                          {table.columnHeaders.map((header, idx) => (
                            <th
                              key={`${table.id}-col-${idx}`}
                              className="border border-[#e0d6b8] px-3 py-2 text-left"
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {table.rowHeaders.map((rowHeader, rowIdx) => (
                          <tr key={`${table.id}-row-${rowIdx}`}>
                            <td className="border border-[#e0d6b8] px-3 py-2 font-semibold text-[#314123]">
                              {rowHeader}
                            </td>
                            {table.columnHeaders.map((_, colIdx) => (
                              <td
                                key={`${table.id}-cell-${rowIdx}-${colIdx}`}
                                className="border border-[#e0d6b8] px-3 py-2 text-[#4b5133]"
                              >
                                {table.cells[rowIdx]?.[colIdx] || "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(report.data.taskDetails || []).length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-[#314123]">Task bank</h3>
            <p className="mt-1 text-sm text-[#5f5a3b]">
              Detailed task list captured for record keeping.
            </p>
            <div className="mt-4 overflow-auto rounded-2xl border border-[#e0d6b8] bg-white">
              <table className="min-w-full border-collapse text-[10px]">
                <thead className="bg-[#f5f1df] text-[9px] uppercase tracking-[0.18em] text-[#6b7247]">
                  <tr>
                    <th className="border border-[#e0d6b8] px-3 py-2 text-left">Task</th>
                    <th className="border border-[#e0d6b8] px-3 py-2 text-left">Description</th>
                    <th className="border border-[#e0d6b8] px-3 py-2 text-left">Status</th>
                    <th className="border border-[#e0d6b8] px-3 py-2 text-left">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(report.data.taskDetails || [])]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((task) => (
                      <tr key={task.id} className="align-top">
                        <td className="border border-[#e0d6b8] px-3 py-2 font-semibold text-[#28321d]">
                          {task.name}
                        </td>
                        <td className="border border-[#e0d6b8] px-3 py-2 text-[#4b5133]">
                          {task.description || "—"}
                        </td>
                        <td className="border border-[#e0d6b8] px-3 py-2 text-[#4b5133]">
                          <span className="rounded-full bg-[#f3f0e1] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[#6b6f52]">
                            {task.status || "n/a"}
                          </span>
                        </td>
                        <td className="border border-[#e0d6b8] px-3 py-2 text-[#4b5133]">
                          <div className="flex flex-wrap gap-2">
                            {task.priority && (
                              <span className="rounded-full bg-[#f3f0e1] px-2 py-1 text-[9px]">
                                Priority: {task.priority}
                              </span>
                            )}
                            {task.estimatedTime !== null && task.estimatedTime !== undefined && (
                              <span className="rounded-full bg-[#f3f0e1] px-2 py-1 text-[9px]">
                                Est. time: {task.estimatedTime} hrs
                              </span>
                            )}
                            {task.personCount !== null && task.personCount !== undefined && (
                              <span className="rounded-full bg-[#f3f0e1] px-2 py-1 text-[9px]">
                                People: {task.personCount}
                              </span>
                            )}
                            {task.timeSlots && task.timeSlots.length > 0 && (
                              <span className="rounded-full bg-[#f3f0e1] px-2 py-1 text-[9px]">
                                Slots: {task.timeSlots.join(", ")}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {report.data.notes && report.data.notes.length > 0 && (
          <div className="mt-8 rounded-2xl border border-[#e0d6b8] bg-[#fdfcf8] p-5">
            <h3 className="text-lg font-semibold text-[#314123]">Notes log</h3>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[#4b5133]">
              {report.data.notes.map((note, idx) => (
                <li key={`report-note-${idx}`}>{note}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
