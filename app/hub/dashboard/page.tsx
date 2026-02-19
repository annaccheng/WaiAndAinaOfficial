"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadSession } from "@/lib/session";

type Slot = {
  id: string;
  label: string;
  timeRange: string;
  isMeal: boolean;
};

type ScheduleResponse = {
  people: string[];
  slots: Slot[];
  cells: string[][];
  reportFlags?: boolean[];
  scheduleDate?: string;
  reportTime?: string;
  taskResetTime?: string;
};

type MiniTask = {
  slot: string;
  timeRange: string;
  task: string;
  status: string;
  commentCount: number;
};

type TaskDetail = {
  id: string;
  name: string;
  description: string;
  status: string;
  commentCount: number;
  extraNotes: string[];
  links: string[];
  estimatedTime: string;
};

type MyTask = {
  id: string;
  name: string;
  slot: string;
  timeRange: string;
  status: string;
  commentCount: number;
  note: string;
  description: string;
  extraNotes: string[];
  links: string[];
  estimatedTime: string;
};

type DailyUpdateTaskStatus = {
  taskId: string;
  taskName: string;
  status: string;
};

type DailyUpdateEntry = {
  id: string;
  update_date: string;
  user_name: string;
  task_statuses: DailyUpdateTaskStatus[];
  extra_notes?: string | null;
  requests?: string | null;
  summary?: string | null;
  updated_at: string;
};

function getHawaiiDateLabel() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const year = parts.find((part) => part.type === "year")?.value;
  if (!month || !day || !year) return new Date().toLocaleDateString("en-US");
  return `${month}/${day}/${year}`;
}

const baseQuickLinks = [
  {
    href: "/hub/request",
    title: "Requests",
    description: "Submit or edit supply and task requests, plus follow comments.",
    icon: "📝",
  },
  {
    href: "/hub/goat",
    title: "Arcade",
    description: "Relax with Goat Run or Goat Dice and see team leaderboards.",
    icon: "🐐",
  },
  {
    href: "/hub/guides/how-to",
    title: "Guides",
    description: "Browse the how-to library for step-by-step farm workflows.",
    icon: "📘",
  },
];


const TASK_SEPARATOR_REGEX = /\s*[•·,]\s*/;

function isOffPlaceholder(task: string) {
  const base = task.split("\n")[0].trim();
  return base === "-";
}

function taskBaseName(task: string) {
  const firstLine = task.split("\n")[0] || "";
  return firstLine
    .split(TASK_SEPARATOR_REGEX)[0]
    ?.replace(/\s+/g, " ")
    .trim() || "";
}

function toIsoDateLabel(dateLabel?: string | null) {
  if (!dateLabel) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateLabel)) return dateLabel;
  if (!dateLabel.includes("/")) return null;
  const [month, day, year] = dateLabel.split("/");
  if (!month || !day || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function splitCellEntries(cell: string) {
  if (!cell.trim()) return [];
  const [firstLine, ...rest] = cell.split("\n");
  const note = rest.join("\n").trim();
  return firstLine
    .split(TASK_SEPARATOR_REGEX)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (note ? `${t}\n${note}` : t))
    .filter((entry) => !isOffPlaceholder(entry));
}

function getHawaiiTimeParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dateLabel = `${map.month}/${map.day}/${map.year}`;
  const hour = Number(map.hour || 0);
  const minute = Number(map.minute || 0);
  return { dateLabel, hour, minute };
}

export default function WorkDashboardPage() {
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);
  const [userType, setUserType] = useState<string | null>(null);
  const [miniLoading, setMiniLoading] = useState(false);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [myTasks, setMyTasks] = useState<MyTask[]>([]);
  const [scheduleDateLabel, setScheduleDateLabel] = useState<string | null>(null);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
  const [activeTask, setActiveTask] = useState<MyTask | null>(null);
  const [statusDraft, setStatusDraft] = useState<string>("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [overlayMessage, setOverlayMessage] = useState<string | null>(null);
  const [updateFeed, setUpdateFeed] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"updates" | "tasks">("updates");
  const [dailyUpdateSuccess, setDailyUpdateSuccess] = useState<string | null>(null);
  const [dailyUpdatesFeed, setDailyUpdatesFeed] = useState<DailyUpdateEntry[]>([]);
  const previousSnapshotRef = useRef<MiniTask[] | null>(null);

  const quickLinks = useMemo(() => {
    const normalizedType = (userType || "").toLowerCase();
    const canAccessMilk = normalizedType === "admin" || normalizedType === "volunteer";
    if (!canAccessMilk) return baseQuickLinks;
    return [
      ...baseQuickLinks,
      {
        href: "/hub/admin/milk-production",
        title: "Milk Production",
        description: "Open milk yields and allocation reporting in one place.",
        icon: "🥛",
      },
    ];
  }, [userType]);

  useEffect(() => {
    const session = loadSession();
    if (!session?.name) {
      router.replace("/");
      return;
    }
    setName(session.name);
    setUserType(session.userType ?? null);
  }, [router]);

  const isExternalVolunteer = useMemo(
    () => (userType || "").toLowerCase() === "external volunteer",
    [userType]
  );

  useEffect(() => {
    const loadStatusOptions = async () => {
      try {
        const res = await fetch("/api/task-types");
        if (!res.ok) return;
        const json = await res.json();
        const next = (json.statuses || []).map((status: { name: string }) => status.name);
        setStatusOptions(next.length ? next : ["Not Started", "In Progress", "Completed"]);
      } catch (err) {
        console.error("Failed to load status options", err);
        setStatusOptions(["Not Started", "In Progress", "Completed"]);
      }
    };

    loadStatusOptions();
  }, []);

  useEffect(() => {
    if (!activeTask) return undefined;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveTask(null);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeTask]);

  useEffect(() => {
    if (!name) {
      return;
    }
    try {
      const cacheKey = `hub-task-cache-${name.toLowerCase()}`;
      const cached = typeof window !== "undefined" ? localStorage.getItem(cacheKey) : null;
      if (cached) {
        const parsed = JSON.parse(cached) as MiniTask[];
        if (Array.isArray(parsed)) {
          previousSnapshotRef.current = parsed;
        }
      }
    } catch (err) {
      console.warn("Failed to read cached task snapshot", err);
    }
    const normalizedName = name.toLowerCase();
    async function loadMiniSchedule() {
      setMiniLoading(true);
      try {
        const dateLabel = getHawaiiDateLabel();
        const res = await fetch(`/api/schedule?date=${encodeURIComponent(dateLabel)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data: ScheduleResponse = await res.json();
        const scheduleLabel = data.scheduleDate || dateLabel;
        const occurrenceParam = toIsoDateLabel(scheduleLabel) || scheduleLabel;
        setScheduleDateLabel(scheduleLabel);
        const rowIndex = data.people.findIndex(
          (p) => p.toLowerCase() === normalizedName
        );
        if (rowIndex === -1) {
          setMyTasks([]);
          return;
        }

        const tasks: MyTask[] = [];
        data.slots.forEach((slot, col) => {
          if (isExternalVolunteer && !/weekend/i.test(slot.label)) return;
          const cell = data.cells[rowIndex]?.[col] || "";
          if (!cell.trim()) return;
          const entries = splitCellEntries(cell);
          entries.forEach((entry) => {
            const entryLines = entry.split("\n");
            const note = entryLines.slice(1).join("\n").trim();
            const baseName = taskBaseName(entry);
            tasks.push({
              slot: slot.label,
              timeRange: slot.timeRange,
              name: baseName,
              id: "",
              status: "",
              commentCount: 0,
              note,
              description: "",
              extraNotes: [],
              links: [],
              estimatedTime: "",
            });
          });
        });

        const uniqueTaskNames = Array.from(
          new Set(tasks.map((entry) => entry.name))
        ).filter(Boolean);

        const [taskListRes, detailResults]: [
          Response,
          TaskDetail[]
        ] = await Promise.all([
          fetch("/api/task?list=1"),
          Promise.all(
            uniqueTaskNames.map(async (taskName) => {
              const search = new URLSearchParams({ name: taskName });
              if (occurrenceParam) {
                search.set("occurrenceDate", occurrenceParam);
              }
              const detailRes = await fetch(`/api/task?${search.toString()}`);
              if (!detailRes.ok) {
                return {
                  id: "",
                  name: taskName,
                  description: "",
                  status: "",
                  commentCount: 0,
                  extraNotes: [],
                  links: [],
                  estimatedTime: "",
                };
              }
              const detail = await detailRes.json();
              return {
                id: detail.id || "",
                name: taskName,
                description: detail.description || "",
                status: detail.status || "",
                commentCount: Array.isArray(detail.comments) ? detail.comments.length : 0,
                extraNotes: Array.isArray(detail.extraNotes) ? detail.extraNotes : [],
                links: Array.isArray(detail.links) ? detail.links : [],
                estimatedTime: detail.estimatedTime || "",
              };
            })
          ),
        ]);

        const taskListJson = taskListRes.ok ? await taskListRes.json() : { tasks: [] };
        const statusMap = new Map<string, string>(
          (taskListJson.tasks || []).map((task: { name: string; status?: string }) => [
            task.name,
            task.status || "",
          ])
        );
        const detailMap = new Map(detailResults.map((item) => [item.name, item]));

        const enrichedTasks = tasks.map((entry) => {
          const detail = detailMap.get(entry.name);
          return {
            ...entry,
            id: detail?.id || "",
            status: detail?.status || statusMap.get(entry.name) || "",
            commentCount: detail?.commentCount || 0,
            description: detail?.description || "",
            extraNotes: detail?.extraNotes || [],
            links: detail?.links || [],
            estimatedTime: detail?.estimatedTime || "",
          };
        });

        const currentSnapshot = enrichedTasks.map((entry) => {
          const detail = detailMap.get(entry.name);
          return {
            task: entry.name,
            slot: entry.slot,
            timeRange: entry.timeRange,
            status: detail?.status || statusMap.get(entry.name) || "",
            commentCount: detail?.commentCount || 0,
          };
        });

        const previous = previousSnapshotRef.current;
        const nextAlerts: string[] = [];
        const nextFeed: string[] = [];

        if (previous?.length) {
          const prevMap = new Map(
            previous.map((task) => [task.task, task])
          );

          currentSnapshot.forEach((task) => {
            const prev = prevMap.get(task.task);
            if (!prev) {
              nextAlerts.push(`New task added: ${task.task} (${task.slot}).`);
              return;
            }
            if (prev.status !== task.status) {
              nextAlerts.push(`Status updated: ${task.task} is now "${task.status || "Unassigned"}".`);
              nextFeed.push(`Status update: ${task.task} → ${task.status || "Unassigned"}.`);
            }
            if (task.commentCount > (prev.commentCount || 0)) {
              nextAlerts.push("New task discussion activity detected.");
            }
          });

          previous.forEach((task) => {
            const stillAssigned = currentSnapshot.some((entry) => entry.task === task.task);
            if (!stillAssigned) {
              nextAlerts.push(`Task removed: ${task.task}.`);
              nextFeed.push(`Task removed from schedule: ${task.task}.`);
            }
          });
        }

        setAlerts(nextAlerts);
        setUpdateFeed(nextFeed);
        previousSnapshotRef.current = currentSnapshot;
        setMyTasks(enrichedTasks);
        try {
          if (typeof window !== "undefined") {
            const cacheKey = `hub-task-cache-${normalizedName}`;
            localStorage.setItem(cacheKey, JSON.stringify(currentSnapshot));
          }
        } catch (err) {
          console.warn("Failed to cache task snapshot", err);
        }
      } finally {
        setMiniLoading(false);
      }
    }

    loadMiniSchedule();
  }, [isExternalVolunteer, name]);


  const openTaskOverlay = (task: MyTask) => {
    setActiveTask(task);
    setStatusDraft(task.status || statusOptions[0] || "Not Started");
    setOverlayMessage(null);
  };

  const saveStatus = async () => {
    if (!activeTask?.id || !statusDraft) return;
    setStatusSaving(true);
    setOverlayMessage(null);

    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: activeTask.id, status: statusDraft }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Unable to save status.");

      setMyTasks((prev) =>
        prev.map((task) =>
          task.id === activeTask.id ? { ...task, status: statusDraft } : task
        )
      );
      setActiveTask((prev) => (prev ? { ...prev, status: statusDraft } : prev));
      setOverlayMessage("Status saved.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to save status.";
      setOverlayMessage(message);
    } finally {
      setStatusSaving(false);
    }
  };

  useEffect(() => {
    if (!name) return;
    const loadFeed = async () => {
      try {
        const dateLabel = getHawaiiDateLabel();
        const dateIso = toIsoDateLabel(dateLabel) || dateLabel;
        const res = await fetch(`/api/daily-updates?date=${encodeURIComponent(dateIso)}`);
        if (!res.ok) return;
        const json = await res.json();
        setDailyUpdatesFeed(Array.isArray(json.updates) ? json.updates : []);
      } catch (err) {
        console.error("Failed to load daily update feed", err);
      }
    };
    void loadFeed();
  }, [name, miniLoading]);



  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-[#d0c9a4] bg-gradient-to-br from-white via-[#f9f6e7] to-[#f1edd8] shadow-sm p-6 flex flex-col gap-3">
        <p className="text-xs uppercase tracking-[0.2em] text-[#7a7f54]">Work dashboard</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-[#3b4224]">Welcome{ name ? `, ${name.split(" ")[0]}` : "" }</h1>
          <span className="rounded-full bg-[#eef2d9] text-[#4f5730] px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em]">
            Central Hub
          </span>
        </div>
        <p className="text-sm text-[#4b5133] max-w-3xl leading-relaxed">
          Use the shortcuts below to jump between schedules, requests, guides, and games. The quick toggles above the page also let you swap views instantly.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setViewMode("updates")}
          className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] ${
            viewMode === "updates"
              ? "border-[#8fae4c] bg-[#8fae4c] text-white"
              : "border-[#d0c9a4] bg-white/80 text-[#4a5b2a]"
          }`}
        >
          Daily Updates
        </button>
        <button
          type="button"
          onClick={() => setViewMode("tasks")}
          className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] ${
            viewMode === "tasks"
              ? "border-[#8fae4c] bg-[#8fae4c] text-white"
              : "border-[#d0c9a4] bg-white/80 text-[#4a5b2a]"
          }`}
        >
          My Tasks
        </button>
      </div>
      <div className="space-y-4">
        {viewMode === "updates" && (
          <div className="rounded-3xl border border-[#c8c49c] bg-gradient-to-br from-[#fefcf3] via-[#f7f4e6] to-[#e8eccd] p-6 shadow-md">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className="text-3xl">📣</span>
                <div className="flex flex-col">
                  <span className="text-2xl font-semibold text-[#3b4224]">Daily updates</span>
                  <span className="text-xs uppercase tracking-[0.16em] text-[#7a7f54]">
                    Task activity log
                  </span>
                </div>
              </div>
              <span className="rounded-full bg-[#eef2d9] text-[#4f5730] px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em]">
                Today
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="text-xs text-[#4f5730]">
                Daily report submission is handled from the Schedule screen popup.
              </p>
              {dailyUpdateSuccess && <span className="text-xs text-[#4f5730]">{dailyUpdateSuccess}</span>}
            </div>
            <p className="mt-3 text-sm text-[#4b5133] leading-relaxed">
              Updates are based on the tasks you are assigned to and recent status or comment changes.
            </p>
            <div className="mt-4 rounded-xl border border-[#e2dbc0] bg-white/80 p-4 shadow-inner">
              {miniLoading && (
                <p className="text-sm text-[#7a7f54]">Refreshing updates…</p>
              )}
              {!miniLoading && updateFeed.length === 0 && (
                <p className="text-sm text-[#4b5133]">
                  No new updates yet. Check back after tasks are updated.
                </p>
              )}
              {!miniLoading && updateFeed.length > 0 && (
                <ul className="space-y-2 text-sm text-[#4b5133]">
                  {updateFeed.map((item, idx) => (
                    <li key={`${item}-${idx}`} className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-[#8fae4c]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-4 rounded-xl border border-[#e2dbc0] bg-white/80 p-4 shadow-inner">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[#3b4224]">Team daily reports</p>
                <span className="text-[11px] uppercase tracking-[0.12em] text-[#7a7f54]">Today</span>
              </div>
              {dailyUpdatesFeed.length ? (
                <div className="mt-2 space-y-2">
                  {dailyUpdatesFeed.map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-[#e6dfbe] bg-[#faf8ee] px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[#314123]">{entry.user_name}</p>
                        <span className="text-[10px] text-[#7a7f54]">{new Date(entry.updated_at).toLocaleTimeString()}</span>
                      </div>
                      {entry.summary && <p className="mt-1 text-sm text-[#4b5133]">{entry.summary}</p>}
                      <div className="mt-2 rounded-md border border-[#ece4c5] bg-white/70 px-2 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6b6f4c]">1) Task status check</p>
                        <p className="mt-1 text-xs text-[#4f5730]">
                          {entry.task_statuses?.length
                            ? `${entry.task_statuses.filter((row) => row.status.toLowerCase() === "completed").length} completed · ${entry.task_statuses.filter((row) => row.status.toLowerCase() === "in progress").length} in progress · ${entry.task_statuses.filter((row) => row.status.toLowerCase() === "not started").length} not started`
                            : "No task status changes shared."}
                        </p>
                      </div>
                      <div className="mt-2 rounded-md border border-[#ece4c5] bg-white/70 px-2 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6b6f4c]">2) Extra Notes</p>
                        <p className="mt-1 text-xs whitespace-pre-wrap text-[#4f5730]">{entry.extra_notes || "—"}</p>
                      </div>
                      <div className="mt-2 rounded-md border border-[#ece4c5] bg-white/70 px-2 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6b6f4c]">3) Request</p>
                        <p className="mt-1 text-xs whitespace-pre-wrap text-[#4f5730]">{entry.requests || "—"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-[#4b5133]">No team daily reports submitted yet.</p>
              )}
            </div>
          </div>
        )}

        {viewMode === "tasks" && (
          <div className="rounded-3xl border border-[#c8c49c] bg-gradient-to-br from-[#fefcf3] via-[#f7f4e6] to-[#e8eccd] p-6 shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="text-3xl">📆</span>
              <div className="flex flex-col">
                <span className="text-2xl font-semibold text-[#3b4224]">Open schedule</span>
                <span className="text-xs uppercase tracking-[0.16em] text-[#7a7f54]">Main workspace</span>
              </div>
            </div>
            <Link
              href="/hub"
              className="rounded-full bg-[#8fae4c] px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#f9f9ec] shadow-sm transition hover:bg-[#7e9c44]"
            >
              View full schedule
            </Link>
          </div>
          <p className="mt-3 text-sm text-[#4b5133] leading-relaxed">
            View shifts, tasks, and live updates with status changes, notes, and comments. Your personal schedule preview lives right below.
          </p>

          <div className="mt-4 rounded-xl border border-[#e2dbc0] bg-[#f7f4e6] shadow-inner">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e2dbc0] px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[#7a7f54]">My Tasks</p>
                <p className="text-sm font-semibold text-[#3b4224]">
                  {scheduleDateLabel ? `Tasks for ${scheduleDateLabel}` : "Tasks for today"}
                </p>
              </div>
              <span className="text-xs text-[#7a7f54]">
                {myTasks.length} task{myTasks.length === 1 ? "" : "s"}
              </span>
            </div>
            {miniLoading && (
              <p className="p-4 text-sm text-[#7a7f54]">Refreshing your schedule…</p>
            )}
            {!miniLoading && myTasks.length === 0 && (
              <p className="p-4 text-sm text-[#4b5133]">
                No tasks assigned to you yet for today.
              </p>
            )}
            {!miniLoading && myTasks.length > 0 && (
              <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                {myTasks.map((task) => (
                  <button
                    key={`${task.id}-${task.slot}-${task.timeRange}`}
                    type="button"
                    onClick={() => openTaskOverlay(task)}
                    className="flex h-full flex-col justify-between gap-3 rounded-2xl border border-[#e2dbc0] bg-white px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-[#3b4224]">
                          {task.name}
                        </span>
                        {task.status && (
                          <span className="rounded-full bg-[#eef2d9] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#4f5730]">
                            {task.status}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#7a7f54]">
                        {task.slot}
                        {task.timeRange ? ` · ${task.timeRange}` : ""}
                      </p>
                      {task.note && (
                        <p className="text-xs text-[#4b5133] line-clamp-2">
                          {task.note}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#7a7f54]">
                      <span>Tap for details</span>
                      <span>{task.commentCount} updates</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        )}

        <div className="grid md:grid-cols-3 gap-4">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm hover:-translate-y-0.5 transition"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{link.icon}</span>
                <div className="flex flex-col">
                  <span className="text-lg font-semibold text-[#3b4224]">{link.title}</span>
                  <span className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">Open {link.title}</span>
                </div>
              </div>
              <p className="mt-3 text-sm text-[#4b5133] leading-relaxed">{link.description}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#5d7f3b] underline underline-offset-4">
                Go to {link.title} →
              </span>
            </Link>
          ))}
        </div>

        {alerts.length > 0 && (
          <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-[#3b4224]">Schedule updates</h3>
              <span className="text-[11px] uppercase tracking-[0.12em] text-[#7a7f54]">
                Since last visit
              </span>
            </div>
            <ul className="mt-3 space-y-2 text-sm text-[#4b5133]">
              {alerts.map((alert, idx) => (
                <li key={`${alert}-${idx}`} className="flex items-start gap-2">
                  <span className="mt-1 h-2 w-2 rounded-full bg-[#8fae4c]" />
                  <span>{alert}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {activeTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-3xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#ede8d3] px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[#7a7f54]">Task details</p>
                <h2 className="text-xl font-semibold text-[#3b4224]">{activeTask.name}</h2>
                <p className="text-sm text-[#6b7247]">
                  {activeTask.slot}
                  {activeTask.timeRange ? ` · ${activeTask.timeRange}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTask(null)}
                className="rounded-full border border-[#d7d2b0] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#6b7247]"
              >
                Close
              </button>
            </div>
            <div className="space-y-4 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-[#7a7f54]">Description</p>
                <p className="mt-1 text-sm text-[#4b5133]">
                  {activeTask.description || "No description provided yet."}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-[#7a7f54]">Extra notes</p>
                {activeTask.extraNotes.length ? (
                  <ul className="mt-1 space-y-1 text-sm text-[#4b5133]">
                    {activeTask.extraNotes.map((note) => (
                      <li key={note} className="rounded-lg bg-[#f8f6e8] px-3 py-2">
                        {note}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-[#4b5133]">No extra notes listed.</p>
                )}
              </div>
              {activeTask.note && (
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[#7a7f54]">Schedule notes</p>
                  <p className="mt-1 whitespace-pre-line text-sm text-[#4b5133]">
                    {activeTask.note}
                  </p>
                </div>
              )}
              {activeTask.links.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[#7a7f54]">Links</p>
                  <ul className="mt-1 space-y-1 text-sm text-[#4b5133]">
                    {activeTask.links.map((link) => (
                      <li key={link}>
                        <a
                          href={link}
                          className="text-[#5d7f3b] underline underline-offset-4"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {link}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {activeTask.estimatedTime && (
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[#7a7f54]">Estimated time</p>
                  <p className="mt-1 text-sm text-[#4b5133]">{activeTask.estimatedTime}</p>
                </div>
              )}
              <div className="rounded-2xl border border-[#ece5c9] bg-[#fefcf3] p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[#7a7f54]">Update status</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <select
                    value={statusDraft}
                    onChange={(event) => setStatusDraft(event.target.value)}
                    className="rounded-full border border-[#d7d2b0] bg-white px-3 py-2 text-sm text-[#3b4224]"
                  >
                    {(statusOptions.length ? statusOptions : ["Not Started", "In Progress", "Completed"]).map(
                      (status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      )
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={saveStatus}
                    disabled={statusSaving}
                    className="rounded-full bg-[#8fae4c] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {statusSaving ? "Saving…" : "Save status"}
                  </button>
                  {overlayMessage && (
                    <span className="text-xs text-[#7a7f54]">{overlayMessage}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
