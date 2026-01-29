"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadSession } from "@/lib/session";

type Slot = { id: string; label: string; timeRange?: string | null };
type CellContent = { tasks: { id: string; name: string }[]; note: string };
type ScheduleResponse = {
  people: string[];
  slots: Slot[];
  cells: Array<CellContent[] | string[]>;
  scheduleDate?: string;
  message?: string;
};
type TaskStatusCounts = {
  completed: number;
  inProgress: number;
  notStarted: number;
  total: number;
};
type TaskStatusLookup = Record<string, string>;
type ReportSummary = {
  id: string;
  report_date: string;
  date_label: string;
  report_title?: string | null;
  summary?: {
    reportTitle?: string;
    totalTasks?: number;
  } | null;
  created_at: string;
  created_by?: string | null;
};

function formatLabel(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

function toIsoDateLabel(dateLabel?: string | null) {
  if (!dateLabel) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateLabel)) return dateLabel;
  if (!dateLabel.includes("/")) return null;
  const [month, day, year] = dateLabel.split("/");
  if (!month || !day || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeCellTasks(cell: CellContent | string) {
  if (!cell) return [];
  if (typeof cell === "string") {
    const [firstLine] = cell.split("\n");
    return firstLine
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return cell.tasks.map((task) => task.name).filter(Boolean);
}

function normalizeCellNote(cell: CellContent | string) {
  if (!cell) return "";
  if (typeof cell === "string") {
    const [, ...rest] = cell.split("\n");
    return rest.join("\n").trim();
  }
  return cell.note?.trim() || "";
}

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(
    formatLabel(new Date())
  );
  const [daySchedule, setDaySchedule] = useState<ScheduleResponse | null>(null);
  const [weekSchedules, setWeekSchedules] = useState<
    { dateLabel: string; schedule: ScheduleResponse | null }[]
  >([]);
  const [statusCounts, setStatusCounts] = useState<TaskStatusCounts | null>(
    null
  );
  const [taskStatusByName, setTaskStatusByName] = useState<TaskStatusLookup>({});
  const [weekTasks, setWeekTasks] = useState<any[]>([]);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [reportCreating, setReportCreating] = useState(false);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const session = loadSession();
    if (!session?.name) {
      router.replace("/");
      return;
    }
    setCurrentUserName(session.name);
    const isAdmin = (session.userType || "").toLowerCase() === "admin";
    if (!isAdmin) {
      setMessage("Admin access required.");
      return;
    }
    setAuthorized(true);
  }, [router]);

  const weekRange = useMemo(() => {
    const base = selectedDate ? new Date(selectedDate) : new Date();
    if (Number.isNaN(base.getTime())) {
      return { start: new Date(), labels: [] as string[] };
    }
    const dayIndex = base.getDay();
    const diffToMonday = (dayIndex + 6) % 7;
    const monday = new Date(base);
    monday.setDate(base.getDate() - diffToMonday);
    const labels = Array.from({ length: 7 }, (_, idx) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + idx);
      return formatLabel(date);
    });
    return { start: monday, labels };
  }, [selectedDate]);

  useEffect(() => {
    if (!authorized) return;
    let cancelled = false;

    const loadAnalytics = async () => {
      setLoading(true);
      try {
        const dateLabel = selectedDate || formatLabel(new Date());
        const dayRes = await fetch(
          `/api/schedule?date=${encodeURIComponent(dateLabel)}&staging=1`
        );
        const dayJson = dayRes.ok ? await dayRes.json() : null;
        if (!cancelled) {
          setDaySchedule(dayJson);
        }

        const weekData = await Promise.all(
          weekRange.labels.map(async (label) => {
            try {
              const res = await fetch(
                `/api/schedule?date=${encodeURIComponent(label)}&staging=1`
              );
              if (!res.ok) return { dateLabel: label, schedule: null };
              return { dateLabel: label, schedule: await res.json() };
            } catch {
              return { dateLabel: label, schedule: null };
            }
          })
        );

        if (!cancelled) {
          setWeekSchedules(weekData);
        }

        const startIso = toIsoDateLabel(weekRange.labels[0]);
        const endIso = toIsoDateLabel(
          weekRange.labels[weekRange.labels.length - 1]
        );
        if (startIso && endIso) {
          const res = await fetch(
            `/api/tasks?includeOccurrences=true&start=${startIso}&end=${endIso}`
          );
          if (res.ok) {
            const json = await res.json();
            const tasks = json.tasks || [];
            const statusLookup = tasks.reduce((acc: TaskStatusLookup, task: any) => {
              if (task?.name) {
                acc[String(task.name).toLowerCase()] = String(task.status || "");
              }
              return acc;
            }, {});
            const counts = tasks.reduce(
              (acc: TaskStatusCounts, task: any) => {
                const status = (task.status || "").toLowerCase();
                if (status === "completed") acc.completed += 1;
                else if (status === "in progress") acc.inProgress += 1;
                else acc.notStarted += 1;
                acc.total += 1;
                return acc;
              },
              { completed: 0, inProgress: 0, notStarted: 0, total: 0 }
            );
            if (!cancelled) {
              setStatusCounts(counts);
              setTaskStatusByName(statusLookup);
              setWeekTasks(tasks);
            }
          } else if (!cancelled) {
            setStatusCounts(null);
            setTaskStatusByName({});
            setWeekTasks([]);
          }
        }

        const reportsRes = await fetch("/api/reports?list=1");
        if (reportsRes.ok) {
          const reportsJson = await reportsRes.json();
          if (!cancelled) {
            setReports(reportsJson.reports || []);
          }
        }
      } catch (err) {
        console.error("Failed to load analytics", err);
        if (!cancelled) {
          setMessage("Unable to load analytics right now.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadAnalytics();
    return () => {
      cancelled = true;
    };
  }, [authorized, selectedDate, weekRange.labels]);

  const daySummary = useMemo(() => {
    if (!daySchedule) return null;
    const taskCountBySlot = daySchedule.slots.map((slot, idx) => {
      const slotTasks = daySchedule.cells.reduce((count, row) => {
        const cell = row[idx];
        return count + normalizeCellTasks(cell).length;
      }, 0);
      return { slot: slot.label, count: slotTasks };
    });
    const totalTasks = taskCountBySlot.reduce((sum, entry) => sum + entry.count, 0);
    const notes = daySchedule.cells.reduce((count, row) => {
      return (
        count +
        row.reduce((rowCount, cell) => rowCount + (normalizeCellNote(cell) ? 1 : 0), 0)
      );
    }, 0);
    return {
      totalTasks,
      notes,
      people: daySchedule.people.length,
      slots: daySchedule.slots.length,
      bySlot: taskCountBySlot,
    };
  }, [daySchedule]);

  const weekSummary = useMemo(() => {
    const totals = weekSchedules.map((entry) => {
      if (!entry.schedule) return { label: entry.dateLabel, tasks: 0 };
      const tasks = entry.schedule.cells.reduce((count, row) => {
        return count + row.reduce((rowCount, cell) => rowCount + normalizeCellTasks(cell).length, 0);
      }, 0);
      return { label: entry.dateLabel, tasks };
    });
    const max = Math.max(...totals.map((entry) => entry.tasks), 1);
    return { totals, max };
  }, [weekSchedules]);

  const productivityByPerson = useMemo(() => {
    const summary = new Map<
      string,
      { tasks: string[]; outstanding: string[]; shifts: number }
    >();
    weekSchedules.forEach((entry) => {
      const schedule = entry.schedule;
      if (!schedule) return;
      schedule.people.forEach((person, rowIdx) => {
        if (!summary.has(person)) {
          summary.set(person, { tasks: [], outstanding: [], shifts: 0 });
        }
        const row = schedule.cells[rowIdx] || [];
        row.forEach((cell) => {
          const tasks = normalizeCellTasks(cell).map((task) => task);
          const hasTasks = tasks.length > 0;
          const personSummary = summary.get(person);
          if (!personSummary) return;
          if (hasTasks) {
            personSummary.shifts += 1;
          }
          tasks.forEach((taskName) => {
            personSummary.tasks.push(taskName);
            const status = taskStatusByName[taskName.toLowerCase()] || "";
            if (status.toLowerCase() !== "completed") {
              personSummary.outstanding.push(taskName);
            }
          });
        });
      });
    });

    return Array.from(summary.entries()).map(([person, data]) => ({
      person,
      totalTasks: data.tasks.length,
      outstandingTasks: data.outstanding.length,
      shifts: data.shifts,
      uniqueTasks: Array.from(new Set(data.tasks)),
      outstandingUnique: Array.from(new Set(data.outstanding)),
    }));
  }, [taskStatusByName, weekSchedules]);

  const outstandingTasks = useMemo(() => {
    const map = new Map<
      string,
      { name: string; count: number; priority: string; occurrenceDate?: string | null }
    >();
    weekTasks.forEach((task) => {
      const name = String(task?.name || "").trim();
      if (!name) return;
      const status = String(task?.status || "").toLowerCase();
      if (status === "completed") return;
      if (!map.has(name)) {
        map.set(name, {
          name,
          count: 0,
          priority: String(task?.priority || ""),
          occurrenceDate: task?.occurrence_date || null,
        });
      }
      const entry = map.get(name);
      if (entry) {
        entry.count += 1;
        if (!entry.occurrenceDate && task?.occurrence_date) {
          entry.occurrenceDate = task.occurrence_date;
        }
      }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [weekTasks]);

  const priorityBreakdown = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0, other: 0 };
    outstandingTasks.forEach((task) => {
      const priority = task.priority.toLowerCase();
      if (priority === "high") counts.high += 1;
      else if (priority === "medium") counts.medium += 1;
      else if (priority === "low") counts.low += 1;
      else counts.other += 1;
    });
    return counts;
  }, [outstandingTasks]);

  const workloadSignals = useMemo(() => {
    let totalCells = 0;
    let filledCells = 0;
    let assignments = 0;
    weekSchedules.forEach((entry) => {
      const schedule = entry.schedule;
      if (!schedule) return;
      totalCells += schedule.people.length * schedule.slots.length;
      schedule.cells.forEach((row) => {
        row.forEach((cell) => {
          const tasks = normalizeCellTasks(cell);
          assignments += tasks.length;
          if (tasks.length > 0) filledCells += 1;
        });
      });
    });
    return {
      totalCells,
      filledCells,
      assignments,
      fillRate: totalCells ? filledCells / totalCells : 0,
      avgTasksPerFilled: filledCells ? assignments / filledCells : 0,
    };
  }, [weekSchedules]);

  const handleCreateReport = async () => {
    if (!selectedDate) return;
    setReportCreating(true);
    setReportMessage(null);
    try {
      const res = await fetch("/api/reports/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateLabel: selectedDate, createdBy: currentUserName }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to create report.");
      }
      setReportMessage(`Report created for ${selectedDate}.`);
      const refreshed = await fetch("/api/reports?list=1");
      if (refreshed.ok) {
        const refreshedJson = await refreshed.json();
        setReports(refreshedJson.reports || []);
      }
    } catch (err: any) {
      console.error("Failed to create report", err);
      setReportMessage(err?.message || "Unable to create report.");
    } finally {
      setReportCreating(false);
    }
  };

  if (!authorized) {
    return (
      <div className="mx-auto max-w-4xl p-6 text-sm text-[#7a7f54]">
        {message || "Checking access..."}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-2 py-6">
      <div className="rounded-3xl border border-[#d0c9a4] bg-white/80 p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">Admin</p>
            <h1 className="text-2xl font-semibold text-[#314123]">Analytics Dashboard</h1>
            <p className="text-sm text-[#5f5a3b]">
              Track daily workload, weekly trends, and schedule health signals.
            </p>
          </div>
          <Link
            href="/hub/admin"
            className="rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8]"
          >
            Back to admin
          </Link>
        </div>
        {message && <p className="mt-4 text-sm font-semibold text-[#4b5133]">{message}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[#6a6c4d]">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[#7a7f54]">
              Focus date
            </span>
            <input
              type="date"
              value={toIsoDateLabel(selectedDate) || ""}
              onChange={(e) => setSelectedDate(formatLabel(new Date(e.target.value)))}
              className="rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-xs text-[#314123]"
            />
          </label>
          <span className="rounded-full bg-[#f0f4de] px-3 py-1 text-[11px] font-semibold text-[#4b5133]">
            Week of {weekRange.labels[0]}
          </span>
          {loading && <span className="text-[11px] text-[#7a7f54]">Refreshing data…</span>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[#314123]">Day overview</h2>
          <p className="text-sm text-[#5f5a3b]">
            Snapshot for {selectedDate || "today"}.
          </p>
          {daySummary ? (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-[#e2d7b5] bg-white/80 px-2 py-3">
                  <div className="text-xs uppercase tracking-[0.12em] text-[#7a7f54]">
                    Tasks
                  </div>
                  <div className="text-lg font-semibold text-[#314123]">
                    {daySummary.totalTasks}
                  </div>
                </div>
                <div className="rounded-xl border border-[#e2d7b5] bg-white/80 px-2 py-3">
                  <div className="text-xs uppercase tracking-[0.12em] text-[#7a7f54]">
                    Notes
                  </div>
                  <div className="text-lg font-semibold text-[#314123]">{daySummary.notes}</div>
                </div>
                <div className="rounded-xl border border-[#e2d7b5] bg-white/80 px-2 py-3">
                  <div className="text-xs uppercase tracking-[0.12em] text-[#7a7f54]">
                    People
                  </div>
                  <div className="text-lg font-semibold text-[#314123]">{daySummary.people}</div>
                </div>
                <div className="rounded-xl border border-[#e2d7b5] bg-white/80 px-2 py-3">
                  <div className="text-xs uppercase tracking-[0.12em] text-[#7a7f54]">
                    Shifts
                  </div>
                  <div className="text-lg font-semibold text-[#314123]">{daySummary.slots}</div>
                </div>
              </div>
              <div className="mt-5">
                <h3 className="text-sm font-semibold text-[#314123]">Assignments by shift</h3>
                <div className="mt-3 space-y-2">
                  {daySummary.bySlot.map((entry) => (
                    <div key={entry.slot} className="flex items-center gap-3">
                      <div className="w-32 text-xs text-[#5f5a3b]">{entry.slot}</div>
                      <div className="flex-1 rounded-full bg-[#f1edd8]">
                        <div
                          className="h-2 rounded-full bg-[#8fae4c]"
                          style={{
                            width: `${Math.min(100, (entry.count / Math.max(daySummary.totalTasks, 1)) * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="text-xs font-semibold text-[#314123]">{entry.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-[#7a7f54]">
              No schedule data available for this date.
            </p>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[#314123]">Week overview</h2>
            <p className="text-sm text-[#5f5a3b]">Task load across the week.</p>
            <div className="mt-4 space-y-3">
              {weekSummary.totals.map((entry) => (
                <div key={entry.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-[#5f5a3b]">
                    <span>{entry.label}</span>
                    <span className="font-semibold text-[#314123]">{entry.tasks}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#f1edd8]">
                    <div
                      className="h-2 rounded-full bg-[#6f8f3d]"
                      style={{ width: `${(entry.tasks / weekSummary.max) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[#314123]">Status mix</h2>
            <p className="text-sm text-[#5f5a3b]">Tasks by status for the week.</p>
            {statusCounts ? (
              <div className="mt-4 grid gap-4 text-xs text-[#4b5133] sm:grid-cols-[120px_1fr]">
                <div className="flex items-center justify-center">
                  <div
                    className="h-24 w-24 rounded-full"
                    style={{
                      background: `conic-gradient(#2f855a 0 ${Math.round(
                        (statusCounts.completed / Math.max(statusCounts.total, 1)) * 360
                      )}deg, #0284c7 0 ${Math.round(
                        ((statusCounts.completed + statusCounts.inProgress) /
                          Math.max(statusCounts.total, 1)) *
                          360
                      )}deg, #f59e0b 0 360deg)`,
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span>Completed</span>
                    <span className="font-semibold text-emerald-700">
                      {statusCounts.completed}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>In progress</span>
                    <span className="font-semibold text-sky-700">
                      {statusCounts.inProgress}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Not started</span>
                    <span className="font-semibold text-amber-700">
                      {statusCounts.notStarted}
                    </span>
                  </div>
                  <div className="mt-2 rounded-full bg-[#f1edd8]">
                    <div
                      className="h-2 rounded-full bg-emerald-500"
                      style={{
                        width: `${(statusCounts.completed / Math.max(statusCounts.total, 1)) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="text-[11px] text-[#6a6c4d]">
                    {statusCounts.total} total tasks this week.
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-[#7a7f54]">
                Status data unavailable.
              </p>
            )}
          </div>
          <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[#314123]">Productivity signals</h2>
            <p className="text-sm text-[#5f5a3b]">Utilization and throughput highlights.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[#e2d7b5] bg-white/90 px-2 py-3">
                <div className="text-xs uppercase tracking-[0.12em] text-[#7a7f54]">
                  Completion rate
                </div>
                <div className="text-lg font-semibold text-[#314123]">
                  {statusCounts
                    ? `${Math.round(
                        (statusCounts.completed / Math.max(statusCounts.total, 1)) * 100
                      )}%`
                    : "—"}
                </div>
              </div>
              <div className="rounded-xl border border-[#e2d7b5] bg-white/90 px-2 py-3">
                <div className="text-xs uppercase tracking-[0.12em] text-[#7a7f54]">
                  Avg tasks per filled shift
                </div>
                <div className="text-lg font-semibold text-[#314123]">
                  {workloadSignals.avgTasksPerFilled.toFixed(1)}
                </div>
              </div>
              <div className="rounded-xl border border-[#e2d7b5] bg-white/90 px-2 py-3">
                <div className="text-xs uppercase tracking-[0.12em] text-[#7a7f54]">
                  Filled shift rate
                </div>
                <div className="text-lg font-semibold text-[#314123]">
                  {Math.round(workloadSignals.fillRate * 100)}%
                </div>
              </div>
              <div className="rounded-xl border border-[#e2d7b5] bg-white/90 px-2 py-3">
                <div className="text-xs uppercase tracking-[0.12em] text-[#7a7f54]">
                  Assignments logged
                </div>
                <div className="text-lg font-semibold text-[#314123]">
                  {workloadSignals.assignments}
                </div>
              </div>
            </div>
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">
                Outstanding task priority mix
              </p>
              <div className="mt-2 space-y-2 text-[11px] text-[#4b5133]">
                {[
                  { label: "High", value: priorityBreakdown.high, color: "bg-rose-500" },
                  { label: "Medium", value: priorityBreakdown.medium, color: "bg-amber-500" },
                  { label: "Low", value: priorityBreakdown.low, color: "bg-emerald-500" },
                  { label: "Other", value: priorityBreakdown.other, color: "bg-slate-400" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-3">
                    <div className="w-16 text-[11px]">{item.label}</div>
                    <div className="flex-1 rounded-full bg-[#f1edd8]">
                      <div
                        className={`h-2 rounded-full ${item.color}`}
                        style={{
                          width: `${Math.min(
                            100,
                            (item.value / Math.max(outstandingTasks.length, 1)) * 100
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="w-6 text-right text-[11px] font-semibold">
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[#314123]">Report creator</h2>
            <p className="text-sm text-[#5f5a3b]">
              Capture a snapshot of the selected day for record keeping.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCreateReport}
                disabled={reportCreating || !selectedDate}
                className="rounded-md bg-[#8fae4c] px-2 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white shadow-sm disabled:opacity-60"
              >
                {reportCreating ? "Creating…" : "Create report"}
              </button>
              {reportMessage && (
                <span className="text-xs font-semibold text-[#4b5133]">{reportMessage}</span>
              )}
            </div>
            <div className="mt-4 space-y-2 text-xs text-[#4b5133]">
              {reports.length ? (
                reports.slice(0, 5).map((report) => (
                  <Link
                    key={report.id}
                    href={`/hub/admin/analytics/reports/${report.id}`}
                    className="flex items-center justify-between gap-2 rounded-md border border-[#e2d7b5] bg-white/80 px-3 py-2 hover:bg-[#f9f6e7]"
                  >
                    <div className="flex flex-col">
                      <span className="font-semibold text-[#314123]">
                        {report.report_title || "Schedule Report"}
                      </span>
                      <span className="text-[11px] text-[#6a6c4d]">{report.date_label}</span>
                    </div>
                    <span className="text-[11px] text-[#6a6c4d]">
                      {new Date(report.created_at).toLocaleDateString()}
                    </span>
                  </Link>
                ))
              ) : (
                <span className="text-xs text-[#7a7f54]">No reports saved yet.</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-[#314123]">Outstanding tasks</h2>
        <p className="text-sm text-[#5f5a3b]">
          Active tasks that still need completion this week.
        </p>
        <div className="mt-4 overflow-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[#efe7cf] text-xs uppercase tracking-[0.12em] text-[#6b7247]">
              <tr>
                <th className="border border-[#e0d6b8] px-3 py-2 text-left">Task</th>
                <th className="border border-[#e0d6b8] px-3 py-2 text-left">Priority</th>
                <th className="border border-[#e0d6b8] px-3 py-2 text-left">Occurrences</th>
                <th className="border border-[#e0d6b8] px-3 py-2 text-left">Next date</th>
              </tr>
            </thead>
            <tbody>
              {outstandingTasks.length ? (
                outstandingTasks.slice(0, 15).map((task) => (
                  <tr key={task.name} className="bg-white">
                    <td className="border border-[#e0d6b8] px-3 py-2 font-semibold text-[#314123]">
                      {task.name}
                    </td>
                    <td className="border border-[#e0d6b8] px-3 py-2">
                      {task.priority || "—"}
                    </td>
                    <td className="border border-[#e0d6b8] px-3 py-2">{task.count}</td>
                    <td className="border border-[#e0d6b8] px-3 py-2 text-xs text-[#4b5133]">
                      {task.occurrenceDate || "—"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={4}
                    className="border border-[#e0d6b8] px-3 py-2 text-sm text-[#7a7f54]"
                  >
                    No outstanding tasks found for this week.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-[#314123]">Productivity by person</h2>
        <p className="text-sm text-[#5f5a3b]">
          Weekly task load, outstanding tasks, and shifts with assignments.
        </p>
        <div className="mt-4 overflow-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[#efe7cf] text-xs uppercase tracking-[0.12em] text-[#6b7247]">
              <tr>
                <th className="border border-[#e0d6b8] px-3 py-2 text-left">Person</th>
                <th className="border border-[#e0d6b8] px-3 py-2 text-left">Shifts</th>
                <th className="border border-[#e0d6b8] px-3 py-2 text-left">Total tasks</th>
                <th className="border border-[#e0d6b8] px-3 py-2 text-left">Outstanding</th>
                <th className="border border-[#e0d6b8] px-3 py-2 text-left">Outstanding tasks</th>
              </tr>
            </thead>
            <tbody>
              {productivityByPerson.length ? (
                productivityByPerson.map((entry) => (
                  <tr key={entry.person} className="bg-white">
                    <td className="border border-[#e0d6b8] px-3 py-2 font-semibold text-[#314123]">
                      {entry.person}
                    </td>
                    <td className="border border-[#e0d6b8] px-3 py-2">{entry.shifts}</td>
                    <td className="border border-[#e0d6b8] px-3 py-2">{entry.totalTasks}</td>
                    <td className="border border-[#e0d6b8] px-3 py-2">
                      {entry.outstandingTasks}
                    </td>
                    <td className="border border-[#e0d6b8] px-3 py-2 text-xs text-[#4b5133]">
                      {entry.outstandingUnique.length
                        ? entry.outstandingUnique.join(", ")
                        : "—"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={5}
                    className="border border-[#e0d6b8] px-3 py-2 text-sm text-[#7a7f54]"
                  >
                    No assignments found for this week.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
