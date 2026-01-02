"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadSession } from "@/lib/session";
import type { TaskMeta } from "./types";

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
  message?: string;
};

type MealAssignment = {
  slotId: string;
  label: string;
  timeRange: string;
  task: string;
  people: string[];
};

type TaskClickPayload = {
  person: string;
  slot: Slot;
  task: string;          // full cell text
  groupNames: string[];  // all people sharing that merged box
  isMeal?: boolean;
};

type TaskComment = {
  id: string;
  text: string;
  createdTime: string;
  author: string;
};

type AnimalProfile = {
  id: string;
  name: string;
  summary: string;
  dailyCareNotes?: string;
  birthday?: string;
  ageLabel?: string;
  ageMonths: number | null;
  milkingMethod?: string;
  getMilked: boolean;
  type?: { name: string; color?: string };
  behaviors: string[];
  breed?: string;
  gender?: { name: string; color?: string };
  photos: { name: string; url: string }[];
};

type AnimalsResponse = {
  animals: AnimalProfile[];
  filters?: { types: { name: string; color?: string }[]; genders: { name: string; color?: string }[] };
  hasMore?: boolean;
  nextCursor?: string | null;
};

type TaskDetails = {
  name: string;
  description: string;
  extraNotes?: string;
  status: string;
  comments: TaskComment[];
  media: { name: string; url: string; kind: "image" | "video" | "audio" | "file" }[];
  links?: { label: string; url: string }[];
  taskType?: { name: string; color: string };
  estimatedTime?: string;
};

type TaskTypeOption = { name: string; color: string };
type StatusOption = { name: string; color: string };

function splitCellTasks(cell: string): string[] {
  if (!cell.trim()) return [];

  const [firstLine, ...rest] = cell.split("\n");
  const note = rest.join("\n").trim();

  return firstLine
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (note ? `${t}\n${note}` : t))
    .filter((t) => {
      const base = taskBaseName(t);
      return base && base !== "-";
    });
}

function taskBaseName(task: string): string {
  return task.split("\n")[0].trim();
}

function typeColorClasses(color?: string) {
  const map: Record<string, string> = {
    default: "bg-[#f7f7ef] border-[#e3e6d2] text-[#3f4630]",
    gray: "bg-slate-50 border-slate-200 text-slate-800",
    brown: "bg-amber-50 border-amber-200 text-amber-900",
    orange: "bg-orange-50 border-orange-200 text-orange-900",
    yellow: "bg-amber-100 border-amber-200 text-amber-900",
    green: "bg-green-50 border-green-200 text-green-900",
    blue: "bg-sky-50 border-sky-200 text-sky-900",
    purple: "bg-violet-50 border-violet-200 text-violet-900",
    pink: "bg-pink-50 border-pink-200 text-pink-900",
    red: "bg-rose-50 border-rose-200 text-rose-900",
  };

  return map[color || "default"] || map.default;
}

function computeGroupNamesForSlotTask(
  schedule: ScheduleResponse,
  slotId: string,
  taskFullText: string
): string[] {
  const slotIdx = schedule.slots.findIndex((s) => s.id === slotId);
  if (slotIdx === -1) return [];

  const base = taskBaseName(taskFullText || "");
  if (!base) return [];

  const names: string[] = [];

  schedule.people.forEach((person, rowIdx) => {
    const cell = (schedule.cells[rowIdx]?.[slotIdx] ?? "").trim();
    if (!cell) return;

    const hasTask = splitCellTasks(cell).some((t) => taskBaseName(t) === base);
    if (hasTask) names.push(person);
  });

  // de-dupe, preserve order
  return Array.from(new Set(names));
}

export default function HubSchedulePage() {
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [currentUserType, setCurrentUserType] = useState<string | null>(null);
  const [currentSlotId, setCurrentSlotId] = useState<string | null>(null);
  const [knownUsers, setKnownUsers] = useState<string[]>([]);
  const scheduleScrollRef = useRef<HTMLDivElement | null>(null);

  const [activeView, setActiveView] = useState<"schedule" | "myTasks">(
    "myTasks"
  );
  const [showMineOnly, setShowMineOnly] = useState(false);

  const [taskMetaMap, setTaskMetaMap] = useState<Record<string, TaskMeta>>({});
  const [taskTypes, setTaskTypes] = useState<TaskTypeOption[]>([]);
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>([]);
  const scheduleFetchInFlight = useRef(false);
  const scheduleLastFetchAt = useRef(0);
  const scheduleRefreshIntervalMs = 120_000;

  // Modal state
  const [modalTask, setModalTask] = useState<TaskClickPayload | null>(null);
  const [modalDetails, setModalDetails] = useState<TaskDetails | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalIsMeal, setModalIsMeal] = useState(false);
  const taskDetailsRequestRef = useRef(0);
  const [weekSchedules, setWeekSchedules] = useState<
    Record<string, ScheduleResponse | null>
  >({});
  const weekSchedulesRef = useRef<Record<string, ScheduleResponse | null>>({});
  const [weekDays, setWeekDays] = useState<{ day: string; dateLabel: string }[]>(
    []
  );
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);

  const [animals, setAnimals] = useState<AnimalProfile[]>([]);
  const [animalsLoaded, setAnimalsLoaded] = useState(false);
  const [animalLoading, setAnimalLoading] = useState(false);
  const [animalOverlay, setAnimalOverlay] = useState<AnimalProfile | null>(null);
  const [animalLookupError, setAnimalLookupError] = useState<string | null>(null);
  const animalFetchInFlight = useRef(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportStatus, setReportStatus] = useState<Record<string, string>>({});
  const [reportComments, setReportComments] = useState<Record<string, string>>({});
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [requestName, setRequestName] = useState("");
  const [requestDescription, setRequestDescription] = useState("");
  const [requestTypeOptions, setRequestTypeOptions] = useState<string[]>([]);
  const [requestType, setRequestType] = useState("");
  const [requestSubmitting, setRequestSubmitting] = useState(false);

  useEffect(() => {
    if (!animalOverlay) return undefined;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAnimalOverlay(null);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [animalOverlay]);

  const statusColorLookup = useMemo(() => {
    const map: Record<string, string> = {};
    statusOptions.forEach((opt) => {
      map[opt.name] = opt.color;
    });
    return map;
  }, [statusOptions]);

  const scheduleDateLabel = data?.scheduleDate;
  useEffect(() => {
    weekSchedulesRef.current = weekSchedules;
  }, [weekSchedules]);
  const formatDateLabel = useCallback((date: Date) => {
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  }, []);
  const scheduleDateObj = useMemo(() => {
    if (!scheduleDateLabel) return null;
    const parsed = new Date(scheduleDateLabel);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }, [scheduleDateLabel]);
  const scheduleDayName = useMemo(() => {
    if (!scheduleDateObj) return null;
    return scheduleDateObj.toLocaleDateString("en-US", { weekday: "long" });
  }, [scheduleDateObj]);

  useEffect(() => {
    if (!scheduleDateObj) return;
    const dayIndex = scheduleDateObj.getDay();
    const diffToMonday = (dayIndex + 6) % 7;
    const monday = new Date(scheduleDateObj);
    monday.setDate(scheduleDateObj.getDate() - diffToMonday);

    const nextWeekDays = Array.from({ length: 7 }, (_, idx) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + idx);
      return {
        day: date.toLocaleDateString("en-US", { weekday: "long" }),
        dateLabel: formatDateLabel(date),
      };
    });

    setWeekDays(nextWeekDays);
  }, [formatDateLabel, scheduleDateObj]);

  useEffect(() => {
    if (!scheduleDateLabel || !data) return;
    setWeekSchedules((prev) => ({
      ...prev,
      [scheduleDateLabel]: data,
    }));
  }, [data, scheduleDateLabel]);

  useEffect(() => {
    if (!weekDays.length || !scheduleDateLabel) return;
    let cancelled = false;

    const loadWeek = async () => {
      const next: Record<string, ScheduleResponse | null> = {};
      const pending = weekDays.filter(({ dateLabel }) => {
        if (dateLabel === scheduleDateLabel) return false;
        return weekSchedulesRef.current[dateLabel] === undefined;
      });

      await Promise.all(
        pending.map(async ({ dateLabel }) => {
          try {
            const res = await fetch(
              `/api/schedule?date=${encodeURIComponent(dateLabel)}`,
              { cache: "no-store" }
            );
            const json = await res.json();
            if (res.ok && json?.people && json?.slots) {
              const hasContent = json.people.length || json.slots.length;
              next[dateLabel] = hasContent ? json : null;
            }
          } catch (err) {
            console.error("Failed to load future schedule", err);
          }
        })
      );

      if (!cancelled && Object.keys(next).length) {
        setWeekSchedules((prev) => ({ ...prev, ...next }));
      }
    };

    loadWeek();
    return () => {
      cancelled = true;
    };
  }, [scheduleDateLabel, weekDays]);

  const isScheduleToday = useMemo(() => {
    if (!scheduleDateObj) return false;
    const now = new Date();
    return (
      now.getFullYear() === scheduleDateObj.getFullYear() &&
      now.getMonth() === scheduleDateObj.getMonth() &&
      now.getDate() === scheduleDateObj.getDate()
    );
  }, [scheduleDateObj]);

  const isScheduleYesterday = useMemo(() => {
    if (!scheduleDateObj) return false;
    const today = new Date();
    const target = new Date(scheduleDateObj);
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    const diffDays =
      (today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays === 1;
  }, [scheduleDateObj]);

  const scheduleTitle = scheduleDateLabel
    ? isScheduleToday
      ? `Today's Schedule ${scheduleDateLabel}`
      : isScheduleYesterday
        ? `Yesterday's Schedule ${scheduleDateLabel}`
        : `${scheduleDateLabel} Schedule`
    : "Today's Schedule";
  const scheduleOutdated = Boolean(scheduleDateLabel && !isScheduleToday);
  const scheduleOutdatedMessage = useMemo(() => {
    if (!scheduleOutdated) return null;
    if (isScheduleYesterday) {
      return "This is yesterday's schedule. Confirm timing before starting.";
    }
    return "This schedule date is not today. Please confirm timing before starting.";
  }, [isScheduleYesterday, scheduleOutdated]);

  async function ensureAnimalsLoaded() {
    if (animalsLoaded || animalFetchInFlight.current) return;
    animalFetchInFlight.current = true;
    setAnimalLoading(true);
    setAnimalLookupError(null);
    try {
      const allAnimals: AnimalProfile[] = [];
      let cursor: string | null = null;
      let hasMore = true;
      let page = 0;

      while (hasMore && page < 20) {
        const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        const res = await fetch(`/api/animals${qs}`);
        if (!res.ok) throw new Error("Failed to load animals");
        const json: AnimalsResponse = await res.json();
        allAnimals.push(...(json.animals || []));
        hasMore = Boolean(json.hasMore && json.nextCursor);
        cursor = json.nextCursor || null;
        page += 1;
      }

      setAnimals(allAnimals);
      setAnimalsLoaded(true);
    } catch (err) {
      console.error("Failed to load animals", err);
      setAnimalLookupError("Could not load animal info right now.");
    } finally {
      animalFetchInFlight.current = false;
      setAnimalLoading(false);
    }
  }

  async function handleAnimalReference(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setAnimalLookupError(null);
    await ensureAnimalsLoaded();

    const found = animals.find(
      (a) => a.name?.toLowerCase() === trimmed.toLowerCase()
    );

    if (found) {
      setAnimalOverlay(found);
    } else {
      setAnimalLookupError(`Could not find details for ${trimmed}.`);
    }
  }

  function renderTextWithAnimalLinks(text: string): React.ReactNode {
    if (!text) return "";
    const parts: React.ReactNode[] = [];
    const regex = /\[animal:([^\]]+)\]/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    const renderPlain = (plain: string) => {
      return plain.split("\n").flatMap((segment, idx) => {
        const nodes: React.ReactNode[] = [];
        if (idx > 0) {
          nodes.push(<br key={`br-${lastIndex}-${idx}`} />);
        }
        nodes.push(
          <span key={`plain-${lastIndex}-${idx}`} className="whitespace-pre-wrap">
            {segment}
          </span>
        );
        return nodes;
      });
    };

    while ((match = regex.exec(text)) !== null) {
      const before = text.slice(lastIndex, match.index);
      if (before) {
        parts.push(...renderPlain(before));
      }

      const animalName = match[1].trim();
      parts.push(
        <button
          key={`animal-${match.index}-${animalName}`}
          type="button"
          onClick={() => handleAnimalReference(animalName)}
          className="inline-flex items-center gap-1 rounded-full border border-[#cfd7b0] bg-[#f6f2de] px-2 py-0.5 text-[12px] font-semibold text-[#2f5ba0] underline underline-offset-2 hover:bg-[#ecf3d4]"
        >
          🐾 {animalName}
        </button>
      );
      lastIndex = regex.lastIndex;
    }

    const after = text.slice(lastIndex);
    if (after) {
      parts.push(...renderPlain(after));
    }

    return parts.length > 0 ? parts : text;
  }

  function renderCareNotes(notes?: string): React.ReactNode {
    if (!notes?.trim()) {
      return <span className="text-sm text-[#6a6748]">No daily care notes yet.</span>;
    }

    const pieces: React.ReactNode[] = [];
    const regex = /(https?:\/\/[^\s]+)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let idx = 0;

    while ((match = regex.exec(notes)) !== null) {
      const before = notes.slice(lastIndex, match.index);
      if (before) {
        pieces.push(
          <span key={`note-text-${idx}`} className="whitespace-pre-wrap text-sm text-[#4b5133]">
            {before}
          </span>
        );
      }

      const url = match[0];
      const bareUrl = url.split("?")[0];
      const isImage = /(\.png|\.jpe?g|\.gif|\.webp|\.avif)$/i.test(bareUrl);
      pieces.push(
        isImage ? (
          <div key={`note-img-${idx}`} className="overflow-hidden rounded-md border border-[#e6dfbe]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="Care note" className="w-full max-h-64 object-cover" />
          </div>
        ) : (
          <a
            key={`note-link-${idx}`}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[#3f5b23] underline decoration-dotted"
          >
            {url}
          </a>
        )
      );

      lastIndex = regex.lastIndex;
      idx += 1;
    }

    const trailing = notes.slice(lastIndex);
    if (trailing) {
      pieces.push(
        <span key="note-text-trailing" className="whitespace-pre-wrap text-sm text-[#4b5133]">
          {trailing}
        </span>
      );
    }

    return <div className="space-y-2">{pieces}</div>;
  }

  const normalizedUserType = (currentUserType || "").toLowerCase();
  const isExternalVolunteer = normalizedUserType === "external volunteer";
  const isVolunteer = normalizedUserType === "volunteer";
  const isAdmin = normalizedUserType === "admin";
  const showFullTaskDetail = !modalIsMeal;


  // Get logged-in user from session
  useEffect(() => {
    const session = loadSession();
    if (session?.name) setCurrentUserName(session.name);
    if (session?.userType) setCurrentUserType(session.userType);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/request/options");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const options = Array.isArray(json.requestTypes)
          ? json.requestTypes.map((opt: any) => opt.name || opt)
          : [];
        setRequestTypeOptions(options);
        setRequestType((prev) => prev || options[0] || "");
      } catch (err) {
        console.error("Failed to load request options", err);
      }
    })();
  }, []);

  const handleReportSubmit = async () => {
    if (!currentUserName || !data) return;
    setReportSubmitting(true);
    setReportError(null);

    try {
      const updates = reportRows.map(async (row) => {
        const base = taskBaseName(row.task);
        const status = reportStatus[base] || "";
        const comment = reportComments[base]?.trim() || "";

        if (status) {
          await fetch("/api/task", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: base, status }),
          });
        }

        if (comment) {
          await fetch("/api/task", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: base,
              comment: `${currentUserName} : ${comment}`,
            }),
          });
        }
      });

      await Promise.all(updates);

      if (requestName.trim() && requestDescription.trim()) {
        setRequestSubmitting(true);
        await fetch("/api/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: requestName.trim(),
            description: requestDescription.trim(),
            user: currentUserName,
            requestType,
            anonymous: false,
          }),
        });
        setRequestName("");
        setRequestDescription("");
      }

      const rowIndex = data.people.findIndex(
        (p) => p.toLowerCase() === currentUserName.toLowerCase()
      );
      if (rowIndex !== -1) {
        await fetch("/api/schedule/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            person: data.people[rowIndex],
            slotId: "Report",
            reportValue: true,
          }),
        });
      }

      setReportOpen(false);
    } catch (err) {
      console.error("Failed to submit report", err);
      setReportError("Unable to submit the report. Please try again.");
    } finally {
      setReportSubmitting(false);
      setRequestSubmitting(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/users");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (Array.isArray(json.users)) {
          setKnownUsers(json.users.map((user: any) => user.name || user).filter(Boolean));
        }
      } catch (err) {
        console.error("Failed to load users list", err);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/task-types");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (Array.isArray(json.types)) {
          setTaskTypes(json.types as TaskTypeOption[]);
        }
        if (Array.isArray(json.statuses)) {
          setStatusOptions(json.statuses as StatusOption[]);
        }
        if (Array.isArray(json.types) || Array.isArray(json.statuses)) return;
      } catch (err) {
        console.error("Failed to load task types", err);
      }

      setTaskTypes([
        { name: "General", color: "default" },
        { name: "Animal Care", color: "green" },
        { name: "Field Work", color: "orange" },
        { name: "Maintenance", color: "blue" },
      ]);
      setStatusOptions([
        { name: "Not Started", color: "gray" },
        { name: "In Progress", color: "blue" },
        { name: "Completed", color: "green" },
      ]);
    })();
  }, []);

  // Load schedule data from API (with auto-refresh)
  const loadSchedule = useCallback(
    async (opts: { showLoading?: boolean; force?: boolean } = {}) => {
      const { showLoading = false, force = false } = opts;
      const now = Date.now();
      if (scheduleFetchInFlight.current) return;
      if (!force && now - scheduleLastFetchAt.current < scheduleRefreshIntervalMs) {
        return;
      }
      scheduleFetchInFlight.current = true;
      scheduleLastFetchAt.current = now;
      if (showLoading) setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/schedule", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        setData(json);
        setError(json.message || null);
      } catch (e) {
        console.error(e);
        setError("Unable to load schedule. Please refresh when online.");
      } finally {
        scheduleFetchInFlight.current = false;
        if (showLoading) setLoading(false);
      }
    },
    [scheduleRefreshIntervalMs]
  );

  useEffect(() => {
    loadSchedule({ showLoading: true, force: true });
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadSchedule();
      }
    }, scheduleRefreshIntervalMs);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadSchedule();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadSchedule]);

  // Preload task status/description for tagging
  useEffect(() => {
    if (!data) return;

    const uniqueTasks = new Set<string>();
    data.cells.forEach((row) => {
      row.forEach((cell) => {
        splitCellTasks(cell).forEach((task) => {
          const primary = taskBaseName(task);
          if (primary) uniqueTasks.add(primary);
        });
      });
    });

    const missing = Array.from(uniqueTasks).filter(
      (name) => !taskMetaMap[name]
    );
    if (missing.length === 0) return;

    (async () => {
      const results = await Promise.all(
        missing.map(async (name) => {
          try {
            const res = await fetch(
              `/api/task?name=${encodeURIComponent(name)}`
            );
            if (!res.ok) return null;
            const json = await res.json();
            return {
              key: json.name || name,
              original: name,
              status: json.status || "",
              description: json.description || "",
              typeName: json.taskType?.name || "",
              typeColor: json.taskType?.color || "default",
            } as const;
          } catch (err) {
            console.error("Failed to preload task meta", err);
            return null;
          }
        })
      );

      setTaskMetaMap((prev) => {
        const next = { ...prev } as Record<string, TaskMeta>;
        results.forEach((item) => {
          if (item) {
            next[item.key] = {
              status: item.status,
              description: item.description,
              typeName: item.typeName,
              typeColor: item.typeColor,
            };
            next[item.original] = {
              status: item.status,
              description: item.description,
              typeName: item.typeName,
              typeColor: item.typeColor,
            };
          }
        });
        return next;
      });
    })();
  }, [data, taskMetaMap]);

  // Split slots
  const mealSlots = useMemo(
    () => data?.slots.filter((s) => s.isMeal) ?? [],
    [data]
  );
  const workSlots = useMemo(
    () => data?.slots.filter((s) => !s.isMeal) ?? [],
    [data]
  );

  const weekdayWorkSlots = useMemo(
    () => workSlots.filter((slot) => !/weekend/i.test(slot.label)),
    [workSlots]
  );

  const hasWeekdayScheduleContent = useMemo(() => {
    if (!data || weekdayWorkSlots.length === 0) return false;

    const slotIndexes = weekdayWorkSlots
      .map((slot) => data.slots.findIndex((s) => s.id === slot.id))
      .filter((idx) => idx >= 0);

    if (slotIndexes.length === 0) return false;

    return data.cells.some((row) =>
      slotIndexes.some((idx) => {
        const cell = (row?.[idx] ?? "").trim();
        return splitCellTasks(cell).length > 0;
      })
    );
  }, [data, weekdayWorkSlots]);

  const showStandardSection =
    !isExternalVolunteer && (loading || error || hasWeekdayScheduleContent);

  const scheduleDataForView = useMemo(() => {
    if (!data) return null;
    if (!showMineOnly || !currentUserName) return data;

    const matchIndex = data.people.findIndex(
      (p) => p.toLowerCase() === currentUserName.toLowerCase()
    );

    if (matchIndex < 0 || !data.cells[matchIndex]) {
      return data;
    }

    return {
      ...data,
      people: [data.people[matchIndex]],
      cells: [data.cells[matchIndex]],
    };
  }, [data, showMineOnly, currentUserName]);

  const scheduleDataToRender = scheduleDataForView || data;

  const eveningSlots = useMemo(
    () =>
      workSlots.filter(
        (slot) => /evening/i.test(slot.label) && !/weekend/i.test(slot.label)
      ),
    [workSlots]
  );

  const weekendSlots = useMemo(
    () => workSlots.filter((slot) => /weekend/i.test(slot.label)),
    [workSlots]
  );

  type ShiftTaskCell = {
    slot: Slot;
    tasks: { task: string; people: string[] }[];
  };

  type EveningDayRow = {
    day: string;
    condoCleaning: string[];
    eveningShift: string[];
    isActiveDay: boolean;
  };

  type EveningIndexTask = {
    task: string;
    slot: Slot;
    people: string[];
  };

  type WeekendSlotSummary = {
    slot: Slot;
    people: string[];
  };

  type WeekendIndexTask = {
    task: string;
    slot: Slot;
    people: string[];
  };

  const shiftTaskAssignments = useCallback(
    (targetSlots: Slot[]): ShiftTaskCell[] => {
      if (!data) return [];

      const knownUserSet = new Set(
        knownUsers.map((user) => user.toLowerCase().trim())
      );

      return targetSlots.map((slot) => {
        const slotIdx = data.slots.findIndex((s) => s.id === slot.id);
        if (slotIdx === -1) {
          return { slot, tasks: [] };
        }

        const taskMap: Record<string, Set<string>> = {};

        data.people.forEach((person, rowIdx) => {
          const cell = (data.cells[rowIdx]?.[slotIdx] ?? "").trim();
          if (!cell) return;

          const normalizedPerson = person.toLowerCase().trim();
          const isKnownUser = knownUserSet.has(normalizedPerson);

          if (isKnownUser) {
            const tasks = splitCellTasks(cell);
            tasks.forEach((task) => {
              const key = taskBaseName(task);
              if (!key) return;
              if (!taskMap[key]) taskMap[key] = new Set();
              taskMap[key].add(person);
            });
          } else {
            const taskName = person.trim();
            if (!taskName) return;
            const assignedPeople = splitCellTasks(cell).map(taskBaseName).filter(Boolean);
            if (!taskMap[taskName]) taskMap[taskName] = new Set();
            assignedPeople.forEach((assigned) => {
              taskMap[taskName].add(assigned);
            });
          }
        });

        return {
          slot,
          tasks: Object.entries(taskMap).map(([task, people]) => ({
            task,
            people: Array.from(people),
          })),
        };
      });
    },
    [data, knownUsers]
  );


  const weekendScheduleSummary = useMemo(() => {
    if (!data || weekendSlots.length === 0) {
      return { slotRows: [] as WeekendSlotSummary[], indexTasks: [] as WeekendIndexTask[] };
    }

    const sortNames = (names: string[]) => {
      const unique = Array.from(new Set(names.filter(Boolean)));
      if (!currentUserName) return unique;
      const normalizedUser = currentUserName.toLowerCase();
      const meIndex = unique.findIndex(
        (name) => name.toLowerCase() === normalizedUser
      );
      if (meIndex === -1) return unique;
      return [unique[meIndex], ...unique.filter((_, idx) => idx !== meIndex)];
    };

    const slotRows = weekendSlots.map((slot) => {
      const slotIdx = data.slots.findIndex((s) => s.id === slot.id);
      if (slotIdx === -1) {
        return { slot, people: [] };
      }

      const people = data.people.filter((person, rowIdx) => {
        const cell = (data.cells[rowIdx]?.[slotIdx] ?? "").trim();
        return splitCellTasks(cell).length > 0;
      });

      return { slot, people: sortNames(people) };
    });

    const indexMap = new Map<string, { task: string; slot: Slot; people: Set<string> }>();
    weekendSlots.forEach((slot) => {
      const slotIdx = data.slots.findIndex((s) => s.id === slot.id);
      if (slotIdx === -1) return;
      data.people.forEach((person, rowIdx) => {
        const cell = (data.cells[rowIdx]?.[slotIdx] ?? "").trim();
        if (!cell) return;
        splitCellTasks(cell).forEach((task) => {
          const base = taskBaseName(task);
          if (!base) return;
          const key = base.toLowerCase();
          if (!indexMap.has(key)) {
            indexMap.set(key, { task: base, slot, people: new Set() });
          }
          indexMap.get(key)?.people.add(person);
        });
      });
    });

    const indexTasks = Array.from(indexMap.values())
      .filter((entry) => entry.people.size > 1)
      .map((entry) => ({
        task: entry.task,
        slot: entry.slot,
        people: Array.from(entry.people),
      }))
      .sort((a, b) => a.task.localeCompare(b.task));

    return { slotRows, indexTasks };
  }, [currentUserName, data, weekendSlots]);

  const eveningScheduleSummary = useMemo(() => {
    const baseRows: EveningDayRow[] = (weekDays.length
      ? weekDays.map((entry) => entry.day)
      : [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ]
    ).map((day) => ({
      day,
      condoCleaning: [],
      eveningShift: [],
      isActiveDay: scheduleDayName?.toLowerCase() === day.toLowerCase(),
    }));

    const sortNames = (names: string[]) => {
      const unique = Array.from(new Set(names.filter(Boolean)));
      if (!currentUserName) return unique;
      const normalizedUser = currentUserName.toLowerCase();
      const meIndex = unique.findIndex(
        (name) => name.toLowerCase() === normalizedUser
      );
      if (meIndex === -1) return unique;
      return [unique[meIndex], ...unique.filter((_, idx) => idx !== meIndex)];
    };

    const collectAssignments = (schedule: ScheduleResponse | null) => {
      if (!schedule) {
        return { condo: [] as string[], evening: [] as string[] };
      }

      const slotIndices = schedule.slots
        .filter(
          (slot) =>
            /evening/i.test(slot.label) &&
            !/weekend/i.test(slot.label) &&
            !slot.isMeal
        )
        .map((slot) => schedule.slots.findIndex((s) => s.id === slot.id))
        .filter((idx) => idx !== -1);

      const condo = new Set<string>();
      const evening = new Set<string>();

      schedule.people.forEach((person, rowIdx) => {
        let hasNonCondo = false;
        let hasCondo = false;

        slotIndices.forEach((idx) => {
          const cell = (schedule.cells[rowIdx]?.[idx] ?? "").trim();
          if (!cell) return;
          const tasks = splitCellTasks(cell);
          tasks.forEach((task) => {
            const base = taskBaseName(task);
            if (!base) return;
            if (/condo cleaning/i.test(base)) {
              hasCondo = true;
            } else {
              hasNonCondo = true;
            }
          });
        });

        if (hasCondo) condo.add(person);
        if (hasNonCondo) evening.add(person);
      });

      return {
        condo: sortNames(Array.from(condo)),
        evening: sortNames(Array.from(evening)),
      };
    };

    const dayRows = baseRows.map((row) => {
      const dayEntry = weekDays.find(
        (entry) => entry.day.toLowerCase() === row.day.toLowerCase()
      );
      const schedule =
        dayEntry?.dateLabel && weekSchedules[dayEntry.dateLabel]
          ? weekSchedules[dayEntry.dateLabel]
          : row.isActiveDay
            ? data
            : null;
      const { condo, evening } = collectAssignments(schedule || null);
      return {
        ...row,
        condoCleaning: condo,
        eveningShift: evening,
      };
    });

    const indexMap = new Map<
      string,
      { task: string; slot: Slot; people: Set<string> }
    >();

    if (data) {
      const eveningIndices = eveningSlots
        .map((slot) => ({
          slot,
          idx: data.slots.findIndex((s) => s.id === slot.id),
        }))
        .filter((entry) => entry.idx !== -1);

      data.people.forEach((person, rowIdx) => {
        eveningIndices.forEach(({ slot, idx }) => {
          const cell = (data.cells[rowIdx]?.[idx] ?? "").trim();
          if (!cell) return;
          splitCellTasks(cell).forEach((task) => {
            const base = taskBaseName(task);
            if (!base) return;
            const key = base.toLowerCase();
            if (!indexMap.has(key)) {
              indexMap.set(key, { task: base, slot, people: new Set() });
            }
            indexMap.get(key)?.people.add(person);
          });
        });
      });
    }

    const indexTasks = Array.from(indexMap.values())
      .filter((entry) => entry.people.size > 1)
      .filter((entry) => !/condo cleaning/i.test(entry.task))
      .map((entry) => ({
        task: entry.task,
        slot: entry.slot,
        people: Array.from(entry.people),
      }))
      .sort((a, b) => a.task.localeCompare(b.task));

    return { dayRows, indexTasks };
  }, [
    currentUserName,
    data,
    eveningSlots,
    scheduleDayName,
    weekDays,
    weekSchedules,
  ]);

  const eveningHasContent =
    eveningScheduleSummary.dayRows.some(
      (row) => row.condoCleaning.length > 0 || row.eveningShift.length > 0
    ) || eveningScheduleSummary.indexTasks.length > 0;
  const weekendHasContent =
    weekendScheduleSummary.slotRows.some((row) => row.people.length > 0) ||
    weekendScheduleSummary.indexTasks.length > 0;

  const showEveningSection =
    !isExternalVolunteer && (isVolunteer || isAdmin || eveningHasContent);
  const showWeekendSection =
    isVolunteer || isAdmin || isExternalVolunteer || weekendHasContent;

  const myTasks = useMemo(() => {
    if (!data || !currentUserName) return [] as {
      slot: Slot;
      task: string;
      groupNames: string[];
    }[];

    const rowIndex = data.people.findIndex(
      (p) => p.toLowerCase() === currentUserName.toLowerCase()
    );
    if (rowIndex === -1) return [];

    return (
      workSlots
        .map((slot) => {
          const slotIdx = data.slots.findIndex((s) => s.id === slot.id);
          const cell = (data.cells[rowIndex]?.[slotIdx] ?? "").trim();
          const tasks = splitCellTasks(cell);
          if (tasks.length === 0) return [];

          return tasks.map((task) => {
            const groupNames = data.people.filter((_, idx) => {
              const candidate = (data.cells[idx]?.[slotIdx] ?? "").trim();
              const candidateTasks = splitCellTasks(candidate);
              return candidateTasks.some(
                (ct) => taskBaseName(ct) === taskBaseName(task)
              );
            });

            return { slot, task, groupNames };
          });
        })
        .flat()
        .filter(Boolean) as {
        slot: Slot;
        task: string;
        groupNames: string[];
      }[]
    );
  }, [data, currentUserName, workSlots]);

  const reportRows = useMemo(() => {
    if (!myTasks.length) return [];
    const unique = new Map<string, { task: string; groupNames: string[] }>();
    myTasks.forEach((entry) => {
      const base = taskBaseName(entry.task);
      if (!base) return;
      if (!unique.has(base)) {
        unique.set(base, { task: entry.task, groupNames: entry.groupNames });
      }
    });
    return Array.from(unique.values());
  }, [myTasks]);

  const scheduleReportFlag = useMemo(() => {
    if (!data || !currentUserName) return false;
    const rowIndex = data.people.findIndex(
      (p) => p.toLowerCase() === currentUserName.toLowerCase()
    );
    if (rowIndex === -1) return false;
    return Boolean(data.reportFlags?.[rowIndex]);
  }, [data, currentUserName]);

  useEffect(() => {
    if (!reportRows.length) return;
    setReportStatus((prev) => {
      const next = { ...prev };
      reportRows.forEach((row) => {
        const base = taskBaseName(row.task);
        if (!next[base]) {
          next[base] = taskMetaMap[base]?.status || "";
        }
      });
      return next;
    });
  }, [reportRows, taskMetaMap]);

  useEffect(() => {
    if (!data || !currentUserName || scheduleReportFlag) return;
    if (!data.scheduleDate) return;
    const now = new Date();
    const dateFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Honolulu",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const timeFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Honolulu",
      hour: "2-digit",
      hour12: false,
    });
    const hawaiiDate = dateFormatter.format(now);
    const hawaiiHour = Number(timeFormatter.format(now));
    if (hawaiiDate !== data.scheduleDate) return;
    if (hawaiiHour >= 14) {
      setReportOpen(true);
    }
  }, [currentUserName, data, scheduleReportFlag]);

  // Meal assignments
  const mealAssignments: MealAssignment[] = useMemo(() => {
    if (!data) return [];
    const result: MealAssignment[] = [];
    const { people, slots, cells } = data;

    slots.forEach((slot, slotIndex) => {
      if (!slot.isMeal) return;

      const taskMap: Record<string, Set<string>> = {};
      people.forEach((person, rowIndex) => {
        const cell = cells[rowIndex]?.[slotIndex] ?? "";
        const tasks = splitCellTasks(cell);
        tasks.forEach((task) => {
          const key = taskBaseName(task);
          if (!taskMap[key]) taskMap[key] = new Set();
          taskMap[key].add(person);
        });
      });

      for (const [task, ps] of Object.entries(taskMap)) {
        result.push({
          slotId: slot.id,
          label: slot.label,
          timeRange: slot.timeRange,
          task,
          people: Array.from(ps),
        });
      }
    });

    return result;
  }, [data]);

  const visibleMealSlots = useMemo(
    () =>
      mealSlots.filter((slot) =>
        mealAssignments.some((assignment) => assignment.slotId === slot.id)
      ),
    [mealAssignments, mealSlots]
  );

  const scrollSchedule = (direction: "left" | "right") => {
    const node = scheduleScrollRef.current;
    if (!node) return;
    const delta = direction === "left" ? -320 : 320;
    node.scrollBy({ left: delta, behavior: "smooth" });
  };

  useEffect(() => {
    function updateCurrentSlot(schedule: ScheduleResponse | null) {
      const minutesNow = getNowMinutes();
      let activeId: string | null = null;

      if (!schedule) {
        setCurrentSlotId(null);
        return;
      }

      for (const slot of schedule.slots) {
        if (!slot.timeRange) continue;
        const range = parseTimeRange(slot.timeRange);
        if (!range) continue;

        if (
          minutesNow >= range.startMinutes &&
          minutesNow < range.endMinutes
        ) {
          activeId = slot.id;
          break;
        }
      }

      setCurrentSlotId(activeId);
    }

    // run once immediately with the latest data
    updateCurrentSlot(data);

    // then update every minute, using the latest data from this effect
    const interval = setInterval(() => updateCurrentSlot(data), 60_000);
    return () => clearInterval(interval);
  }, [data]);

  async function loadTaskDetails(
    taskName: string,
    opts: { quiet?: boolean } = {}
  ) {
    const { quiet = false } = opts;
    const requestId = ++taskDetailsRequestRef.current;
    if (!quiet) setModalLoading(true);

    const applyDetails = (detail: TaskDetails) => {
      if (taskDetailsRequestRef.current !== requestId) return;
      setModalDetails(detail);
      const metaPayload = {
        status: detail.status || "",
        description: detail.description || "",
        typeName: detail.taskType?.name,
        typeColor: detail.taskType?.color,
      };
      setTaskMetaMap((prev) => ({
        ...prev,
        [detail.name || taskName]: metaPayload,
        [taskName]: metaPayload,
      }));
    };

    const emptyDetails: TaskDetails = {
      name: taskName,
      description: "",
      extraNotes: "",
      status: "",
      comments: [],
      media: [],
      links: [],
      taskType: { name: "", color: "default" },
      estimatedTime: "",
    };

    try {
      const res = await fetch(`/api/task?name=${encodeURIComponent(taskName)}`);
      if (!res.ok) {
        applyDetails(emptyDetails);
        return;
      }

      const json = await res.json();
      const detail: TaskDetails = {
        name: json.name || taskName,
        description: json.description || "",
        extraNotes: json.extraNotes || "",
        status: json.status || "",
        comments: json.comments || [],
        media: json.media || json.photos || [],
        links: json.links || [],
        taskType: json.taskType || { name: "", color: "default" },
        estimatedTime: json.estimatedTime || "",
      };
      applyDetails(detail);
    } catch (e) {
      console.error("Failed to load task details:", e);
      if (taskDetailsRequestRef.current === requestId) {
        setModalDetails(emptyDetails);
      }
    } finally {
      if (!quiet && taskDetailsRequestRef.current === requestId) {
        setModalLoading(false);
      }
    }
  }

  async function updateTaskStatus(newStatus: string, taskName: string) {
    setModalDetails((prev) =>
      prev ? { ...prev, status: newStatus } : prev
    );
    setTaskMetaMap((prev) => ({
      ...prev,
      [taskName]: {
        status: newStatus,
        description: prev[taskName]?.description || "",
        typeName: prev[taskName]?.typeName,
        typeColor: prev[taskName]?.typeColor,
      },
    }));

    try {
      await fetch("/api/task", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: taskName, status: newStatus }),
      });
    } catch (e) {
      console.error("Failed to update task status:", e);
    }
  }

  async function submitTaskComment(taskName: string) {
    if (!commentDraft.trim()) return;
    setCommentSubmitting(true);

    try {
      const comment = currentUserName
        ? `${currentUserName} : ${commentDraft.trim()}`
        : commentDraft.trim();
      const res = await fetch("/api/task", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: taskName, comment }),
      });

      if (res.ok) {
        setCommentDraft("");
        await loadTaskDetails(taskName);
      }
    } catch (e) {
      console.error("Failed to add comment:", e);
    } finally {
      setCommentSubmitting(false);
    }
  }

  // When a task box is clicked
async function handleTaskClick(taskPayload: TaskClickPayload) {
  // Always recompute group membership from the schedule matrix so the modal
  // never shows "solo" just because boxes didn't merge.
  const schedule = data;
  const computedGroup =
    schedule && taskPayload?.slot?.id
      ? computeGroupNamesForSlotTask(schedule, taskPayload.slot.id, taskPayload.task)
      : [];

  const mergedPayload: TaskClickPayload = {
    ...taskPayload,
    groupNames: computedGroup.length ? computedGroup : (taskPayload.groupNames || []),
    person:
      taskPayload.person ||
      (computedGroup.length ? computedGroup[0] : "") ||
      "Team",
  };

  setModalTask(mergedPayload);
  setModalDetails(null);
  setModalIsMeal(!!mergedPayload.isMeal);
  setCommentDraft("");

  const baseTitle = taskBaseName(mergedPayload.task || "");
  if (!baseTitle) {
    setModalDetails({
      name: mergedPayload.task,
      description: "",
      extraNotes: "",
      status: "",
      comments: [],
      media: [],
      links: [],
      taskType: { name: "", color: "default" },
      estimatedTime: "",
    });
    return;
  }

  await loadTaskDetails(baseTitle);
}


  function closeModal() {
    setModalTask(null);
    setModalDetails(null);
    setModalIsMeal(false);
    setCommentDraft("");
    setAnimalOverlay(null);
    setAnimalLookupError(null);
  }

  // Auto-refresh task details while the modal is open
  useEffect(() => {
    if (!modalTask || modalIsMeal) return undefined;
    const taskName = modalTask.task.split("\n")[0].trim();
    if (!taskName) return undefined;

    const interval = setInterval(
      () => loadTaskDetails(taskName, { quiet: true }),
      15_000
    );
    return () => clearInterval(interval);
  }, [modalIsMeal, modalTask]);

  return (
    <>
      <div className="space-y-8">
        {!loading &&
          data?.message &&
          !isExternalVolunteer &&
          !hasWeekdayScheduleContent && (
            <div className="rounded-lg border border-[#e4dcb8] bg-white/80 px-4 py-3 text-sm text-[#6a6748]">
              {data.message}
            </div>
          )}

        {!isExternalVolunteer && taskTypes.length > 0 && (
          <section className="rounded-lg border border-[#d0c9a4] bg-white/80 px-4 py-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#5d7f3b]">
                  Task type guide
                </p>
                <p className="text-xs text-[#7a7f54]">
                  Colors are softened to help you spot categories at a glance.
                </p>
              </div>
            </div>
            <TaskTypeLegend taskTypes={taskTypes} />
          </section>
        )}

        {!isExternalVolunteer && (
          <section>
            <h2 className="text-2xl font-semibold tracking-[0.18em] uppercase text-[#5d7f3b] mb-4">
              Meal Assignments
            </h2>

            {loading && (
              <p className="text-sm text-[#7a7f54]">Loading schedule…</p>
            )}
            {error && <p className="text-sm text-red-700">{error}</p>}

            {!loading && !error && visibleMealSlots.length === 0 && (
              <p className="text-sm text-[#7a7f54]">No meal assignments found.</p>
            )}

            <div className="space-y-4">
              {visibleMealSlots.map((slot) => (
                <MealBlock
                  key={slot.id}
                  slot={slot}
                  assignments={mealAssignments.filter(
                    (a) => a.slotId === slot.id
                  )}
                  currentUserName={currentUserName}
                  taskMetaMap={taskMetaMap}
                  onTaskClick={handleTaskClick}
                />
              ))}
            </div>
          </section>
        )}

        {showStandardSection && (
          <section className="space-y-3">
            <h2 className="text-2xl font-semibold tracking-[0.18em] uppercase text-[#5d7f3b] mb-1">
              {scheduleTitle}
            </h2>
            <p className="text-sm text-[#7a7f54]">
              Click any task to see its details, description, and who you are
              assigned with. Evening shift columns now sit beside the daytime schedule for a single view.
            </p>
            {scheduleOutdated && !loading && scheduleOutdatedMessage ? (
              <p className="mt-1 text-xs font-semibold text-red-700">
                {scheduleOutdatedMessage}
              </p>
            ) : null}
            {data?.message && !loading && (
              <p className="mt-1 text-xs text-[#7a7f54]">{data.message}</p>
            )}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setActiveView("schedule")}
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] border transition ${
                  activeView === "schedule"
                    ? "bg-[#a0b764] text-white border-[#8fae4c]"
                    : "bg-white text-[#5d7f3b] border-[#d0c9a4]"
                }`}
              >
                Schedule
              </button>
              <button
                type="button"
                onClick={() => setActiveView("myTasks")}
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] border transition ${
                  activeView === "myTasks"
                    ? "bg-[#a0b764] text-white border-[#8fae4c]"
                    : "bg-white text-[#5d7f3b] border-[#d0c9a4]"
                }`}
                >
                  My Tasks
                </button>
                <label className="inline-flex items-center gap-2 rounded-full border border-[#d0c9a4] bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#4a5b2a] shadow-sm">
                  <input
                    type="checkbox"
                    checked={showMineOnly}
                    onChange={(e) => setShowMineOnly(e.target.checked)}
                    className="h-4 w-4 rounded border-[#b5bf90] text-[#5d7f3b] focus:ring-[#7a8c43]"
                  />
                  Only me
                </label>
                <button
                  type="button"
                  onClick={() => loadSchedule({ showLoading: true, force: true })}
                  className="inline-flex items-center gap-2 rounded-full border border-[#d0c9a4] bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#4a5b2a] shadow-sm transition hover:bg-white"
                >
                  Refresh
                </button>
              </div>

              {activeView === "schedule" && (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => scrollSchedule("left")}
                    className="rounded-full border border-[#d0c9a4] bg-white/90 px-3 py-2 text-sm font-semibold text-[#4b522d] shadow hover:-translate-x-0.5 transition"
                    aria-label="Scroll schedule left"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollSchedule("right")}
                    className="rounded-full border border-[#d0c9a4] bg-white/90 px-3 py-2 text-sm font-semibold text-[#4b522d] shadow hover:translate-x-0.5 transition"
                    aria-label="Scroll schedule right"
                  >
                    →
                  </button>
                </div>
              )}

              <div className="mt-3 rounded-lg bg-[#a0b764] px-3 py-3">
                <div className="rounded-md bg-[#f8f4e3]">
                  {loading && (
                  <div className="px-4 py-6 text-sm text-center text-[#7a7f54]">
                    Loading schedule…
                  </div>
                )}
                {error && (
                  <div className="px-4 py-6 text-sm text-center text-red-700">
                    {error}
                  </div>
                )}

                {!loading &&
                  !error &&
                  scheduleDataToRender &&
                  weekdayWorkSlots.length > 0 &&
                  activeView === "schedule" && (
                    <>
                      <div className="relative">
                        <div className="pointer-events-none absolute inset-y-0 left-0 right-0 z-10 flex items-center justify-between px-2 sm:hidden">
                          <button
                            type="button"
                            onClick={() => scrollSchedule("left")}
                            className="pointer-events-auto rounded-full bg-white/90 border border-[#d0c9a4] shadow px-2 py-2 text-[#4b522d] hover:-translate-x-0.5 transition"
                            aria-label="Scroll schedule left"
                          >
                            ←
                          </button>
                          <button
                            type="button"
                            onClick={() => scrollSchedule("right")}
                            className="pointer-events-auto rounded-full bg-white/90 border border-[#d0c9a4] shadow px-2 py-2 text-[#4b522d] hover:translate-x-0.5 transition"
                            aria-label="Scroll schedule right"
                          >
                            →
                          </button>
                        </div>
                        <div
                          ref={scheduleScrollRef}
                          className="overflow-x-auto scroll-smooth pb-2"
                        >
                          <ScheduleGrid
                            data={scheduleDataToRender}
                            workSlots={weekdayWorkSlots}
                            currentUserName={currentUserName}
                            currentSlotId={currentSlotId}
                            onTaskClick={handleTaskClick}
                            statusMap={taskMetaMap}
                            statusColors={statusColorLookup}
                          />
                        </div>
                      </div>
                    </>
                  )}

                {!loading &&
                  !error &&
                  data &&
                  activeView === "myTasks" && (
                    <div className="px-4 py-4">
                      <MyTasksList
                        tasks={myTasks}
                        onTaskClick={handleTaskClick}
                        statusMap={taskMetaMap}
                        statusColors={statusColorLookup}
                        currentUserName={currentUserName}
                      />
                    </div>
                  )}

                {!loading &&
                  !error &&
                  data &&
                  weekdayWorkSlots.length === 0 &&
                  activeView === "schedule" && (
                  <div className="px-4 py-6 text-sm text-center text-[#7a7f54]">
                    No work slots defined in this schedule.
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {isExternalVolunteer && (
          <section className="space-y-3">
            <div className="rounded-lg bg-[#a0b764] px-3 py-3 text-sm text-[#f8f4e3] shadow">
              Weekend assignments available for External Volunteers are listed below.
            </div>
          </section>
        )}

        {!loading &&
          !error &&
          data &&
          showEveningSection && (
            <EveningScheduleTable
              title="Evening Schedule"
              description="Evening shift coverage laid out by weekday with a rollup of shared evening tasks."
              dayRows={eveningScheduleSummary.dayRows}
              indexTasks={eveningScheduleSummary.indexTasks}
              onTaskClick={handleTaskClick}
              taskMetaMap={taskMetaMap}
              statusColors={statusColorLookup}
              currentUserName={currentUserName}
            />
          )}

        {!loading &&
          !error &&
          data &&
          showWeekendSection && (
            <WeekendScheduleTable
              title="Weekend Schedule"
              description="Weekend shift coverage with assignments by shift."
              slotRows={weekendScheduleSummary.slotRows}
              indexTasks={weekendScheduleSummary.indexTasks}
              onTaskClick={handleTaskClick}
              taskMetaMap={taskMetaMap}
              statusColors={statusColorLookup}
              currentUserName={currentUserName}
            />
          )}

        {isExternalVolunteer &&
          !showWeekendSection &&
          !loading &&
          !error &&
          data && (
            <p className="text-sm text-[#7a7f54]">
              No weekend assignments are currently listed for you.
            </p>
          )}
      </div>

      {/* Task detail modal */}
      {modalTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-[#f8f4e3] border border-[#d0c9a4] px-6 py-5 shadow-2xl transform transition-all duration-200 ease-out scale-100 opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-[#7a7f54]">
                  {modalTask.slot.label}
                  {modalTask.slot.timeRange
                    ? ` • ${modalTask.slot.timeRange}`
                    : ""}
                </div>
                <h3 className="mt-1 text-lg font-semibold text-[#3e4c24]">
                  {modalTask.task.split("\n")[0].trim()}
                </h3>
                <p className="mt-1 text-xs text-[#86815a]">
                  For <span className="font-semibold">{modalTask.person}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full border border-[#d0c9a4] bg-white/80 px-2 py-1 text-xs text-[#6b6b4a] hover:bg-[#ece7d0]"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {showFullTaskDetail &&
                (() => {
                  const fallbackMeta =
                    taskMetaMap[taskBaseName(modalTask.task)] || {};
                  const typeName =
                    modalDetails?.taskType?.name || fallbackMeta.typeName;
                  const typeColor =
                    modalDetails?.taskType?.color || fallbackMeta.typeColor;

                  if (!typeName) return null;

                  return (
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-[4px] text-[11px] font-semibold shadow-sm ${typeColorClasses(
                          typeColor
                        )}`}
                      >
                        <span className="h-2 w-2 rounded-full bg-current opacity-70" />
                        {typeName}
                      </span>
                    </div>
                  );
                })()}

              <div className="rounded-lg border border-[#e2d7b5] bg-white/70 px-4 py-3 space-y-3">
                {modalTask.task.includes("\n") && (
                  <div className="text-[11px] leading-snug text-[#44422f] bg-[#f1edd8] border border-[#dfd6b3] rounded-md px-3 py-2">
                    {renderTextWithAnimalLinks(
                      modalTask.task
                        .split("\n")
                        .slice(1)
                        .join("\n")
                        .trim() || "No additional notes."
                    )}
                  </div>
                )}

                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-[#8a8256]">
                    Task description
                  </p>
                  {modalLoading ? (
                    <p className="text-[11px] italic text-[#8e875d]">
                      Loading task details…
                    </p>
                  ) : modalDetails?.description ? (
                    <div className="text-[12px] leading-snug text-[#4f4b33]">
                      {renderTextWithAnimalLinks(modalDetails.description)}
                    </div>
                  ) : (
                    <p className="text-[11px] italic text-[#a19a70]">
                      No description found for this task.
                    </p>
                  )}
                </div>

                {showFullTaskDetail && !modalLoading ? (
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-[#8a8256]">
                      Extra notes
                    </p>
                    {modalDetails?.extraNotes ? (
                      <div className="text-[12px] leading-snug text-[#4f4b33]">
                        {renderTextWithAnimalLinks(modalDetails.extraNotes)}
                      </div>
                    ) : (
                      <p className="text-[11px] italic text-[#a19a70]">
                        No extra notes shared yet.
                      </p>
                    )}
                  </div>
                ) : null}

                {animalLookupError ? (
                  <p className="text-[11px] text-red-700">{animalLookupError}</p>
                ) : null}
                {animalLoading && (
                  <p className="text-[11px] text-[#7a7f54]">Loading animal details…</p>
                )}

                {showFullTaskDetail && !modalLoading && modalDetails?.estimatedTime ? (
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-[#8a8256]">
                      Estimated Time for Completion
                    </p>
                    <p className="text-[12px] font-semibold text-[#3e4c24]">
                      {modalDetails.estimatedTime}
                    </p>
                  </div>
                ) : null}

                {showFullTaskDetail &&
                !modalLoading &&
                modalDetails?.links?.length ? (
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-[#8a8256]">
                      Relevant Links
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {modalDetails.links.map((link) => (
                        <a
                          key={`${link.url}-${link.label}`}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-full border border-[#cdd7ab] bg-white/80 px-3 py-1 text-[12px] font-semibold text-[#2f5ba0] underline underline-offset-2 hover:bg-[#f1edd8]"
                        >
                          {link.label || link.url}
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="text-[11px] text-[#666242]">
                  {(() => {
                    const me = modalTask.person.toLowerCase();
                    const others = modalTask.groupNames.filter(
                      (n) => n.toLowerCase() !== me
                    );

                    if (others.length === 0) {
                      return (
                        <span>
                          <span className="font-semibold">Assigned with:</span>{" "}
                          (no one else – solo task)
                        </span>
                      );
                    }

                    return (
                      <span>
                        <span className="font-semibold">Assigned with:</span>{" "}
                        {others.join(", ")}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {showFullTaskDetail && (
                <div className="rounded-lg border border-[#e2d7b5] bg-white/70 px-4 py-3 space-y-3">
                  <div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.12em] text-[#8a8256]">
                          Comments
                        </p>
                        <p className="text-[11px] text-[#6a6748]">
                          This is for comments, feedback, concerns, and request.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
                    {modalLoading && (
                      <p className="text-[11px] italic text-[#8e875d]">
                        Loading comments…
                      </p>
                    )}
                    {!modalLoading && modalDetails?.comments?.length === 0 && (
                      <p className="text-[11px] text-[#7a7f54] italic">
                        No comments yet.
                      </p>
                    )}
                    {!modalLoading &&
                      modalDetails?.comments?.map((comment) => (
                        <div
                          key={comment.id}
                          className="rounded-md border border-[#e1d8b6] bg-[#f7f3de] px-3 py-2"
                        >
                          <p className="text-[12px] text-[#3f3c2d] leading-snug">
                            {comment.text || "(No text)"}
                          </p>
                          <p className="mt-1 text-[10px] text-[#8a8256]">
                            {comment.author || "Unknown"} • {new Date(comment.createdTime).toLocaleString()}
                          </p>
                        </div>
                      ))}
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      placeholder="Add a comment"
                      className="flex-1 rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-sm text-[#3f3c2d] shadow-inner focus:outline-none focus:ring-2 focus:ring-[#8fae4c]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        submitTaskComment(modalDetails?.name || modalTask.task)
                      }
                      disabled={commentSubmitting || !commentDraft.trim()}
                      className="w-full sm:w-auto rounded-md bg-[#a0b764] px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#f9f9ec] shadow-md hover:bg-[#95ad5e] disabled:opacity-60"
                    >
                      {commentSubmitting ? "Posting…" : "Post"}
                    </button>
                  </div>
                </div>
              )}

              {showFullTaskDetail && (
                <div className="rounded-lg border border-[#e2d7b5] bg-white/70 px-4 py-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.12em] text-[#8a8256]">
                        Task Media
                      </p>
                      <p className="text-[11px] text-[#6a6748]">
                        Uploads are temporarily disabled. Existing media stays visible below.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {modalDetails?.media?.length ? (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {modalDetails.media.map((item) => {
                          if (item.kind === "video") {
                            return (
                              <div
                                key={item.url}
                                className="overflow-hidden rounded-md border border-[#e2d7b5] bg-[#f7f3de]"
                              >
                                <video
                                  src={item.url}
                                  controls
                                  className="h-36 w-full object-cover"
                                />
                                <p className="truncate px-2 py-1 text-[10px] text-[#5b593c]">
                                  {item.name}
                                </p>
                              </div>
                            );
                          }

                          if (item.kind === "audio") {
                            return (
                              <div
                                key={item.url}
                                className="rounded-md border border-[#e2d7b5] bg-[#f7f3de] p-2"
                              >
                                <p className="truncate text-[11px] font-semibold text-[#5b593c]">
                                  {item.name}
                                </p>
                                <audio src={item.url} controls className="mt-2 w-full" />
                              </div>
                            );
                          }

                          return (
                            <a
                              key={item.url}
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="group block overflow-hidden rounded-md border border-[#e2d7b5] bg-[#f7f3de]"
                            >
                              <div className="aspect-square w-full overflow-hidden">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={item.url}
                                  alt={item.name}
                                  className="h-full w-full object-cover transition group-hover:scale-105"
                                />
                              </div>
                              <p className="truncate px-2 py-1 text-[10px] text-[#5b593c]">
                                {item.name}
                              </p>
                            </a>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[11px] text-[#7a7f54] italic">
                        No media uploaded for this task yet.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {showFullTaskDetail && (
                <div className="rounded-lg border border-[#e2d7b5] bg-white/70 px-4 py-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.12em] text-[#8a8256]">
                        Status update
                      </p>
                      <p className="text-[11px] text-[#6a6748]">
                        Update Task Status
                      </p>
                    </div>
                    <StatusBadge
                      status={modalDetails?.status}
                      color={statusColorLookup[modalDetails?.status || ""]}
                    />
                  </div>
                  <select
                    value={modalDetails?.status || ""}
                    onChange={(e) =>
                      updateTaskStatus(
                        e.target.value,
                        modalDetails?.name || modalTask.task
                      )
                    }
                    className="w-full rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-sm text-[#3f3c2d] shadow-inner focus:outline-none focus:ring-2 focus:ring-[#8fae4c]"
                    disabled={!modalDetails || modalLoading}
                  >
                    <option value="" disabled>
                      Select a status
                    </option>
                    {statusOptions.map((option, idx) => (
                      <option key={option.name} value={option.name}>
                        {idx + 1}. {option.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-[#d0c9a4] bg-white/80 px-4 py-2 text-xs font-medium text-[#6b6b4a] hover:bg-[#ece7d0]"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {reportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[#d0c9a4] bg-[#f8f4e3] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-[#7a7f54]">
                  Daily report
                </p>
                <h3 className="mt-1 text-xl font-semibold text-[#3e4c24]">
                  Update today&apos;s tasks
                </h3>
                <p className="mt-1 text-sm text-[#6b6d4b]">
                  Quick status updates and notes for today&apos;s assignments.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                className="rounded-full border border-[#d0c9a4] bg-white/80 px-3 py-1 text-xs font-semibold text-[#6b6d4b] hover:bg-[#ece7d0]"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {reportRows.length === 0 && (
                <p className="text-sm text-[#7a7f54]">No tasks assigned today.</p>
              )}
              {reportRows.map((row) => {
                const base = taskBaseName(row.task);
                const currentStatus = reportStatus[base] || "";
                const currentComment = reportComments[base] || "";
                const includesUser = row.groupNames.some(
                  (p) => p.toLowerCase() === (currentUserName || "").toLowerCase()
                );
                const slotForTask =
                  myTasks.find((task) => taskBaseName(task.task) === base)?.slot ||
                  data?.slots?.[0];

                return (
                  <div
                    key={base}
                    className={`rounded-lg border border-[#e2d7b5] bg-white/80 p-4 shadow-sm ${
                      includesUser ? "ring-2 ring-[#d2e4a0]" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (!slotForTask) return;
                          handleTaskClick({
                            person: currentUserName || row.groupNames[0] || "Team",
                            slot: slotForTask,
                            task: row.task,
                            groupNames: row.groupNames,
                          });
                        }}
                        className="text-left text-base font-semibold text-[#3e4c24] underline decoration-[#8fae4c] underline-offset-4"
                      >
                        {base}
                      </button>
                      <span className="text-[11px] uppercase tracking-[0.12em] text-[#7a7f54]">
                        {row.groupNames.length}{" "}
                        {row.groupNames.length === 1 ? "person" : "people"}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-[180px_1fr]">
                      <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[#6b6f4c]">
                        Status
                        <select
                          value={currentStatus}
                          onChange={(e) =>
                            setReportStatus((prev) => ({
                              ...prev,
                              [base]: e.target.value,
                            }))
                          }
                          className="mt-1 w-full rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-sm text-[#3b4224] focus:border-[#8fae4c] focus:outline-none"
                        >
                          <option value="">Select status</option>
                          {statusOptions.map((opt) => (
                            <option key={opt.name} value={opt.name}>
                              {opt.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[#6b6f4c]">
                        Comment / extra notes
                        <textarea
                          value={currentComment}
                          onChange={(e) =>
                            setReportComments((prev) => ({
                              ...prev,
                              [base]: e.target.value,
                            }))
                          }
                          placeholder="Add a quick note for this task"
                          className="mt-1 min-h-[90px] w-full rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-sm text-[#3b4224] focus:border-[#8fae4c] focus:outline-none"
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 rounded-xl border border-[#e2d7b5] bg-white/80 p-4 shadow-sm">
              <h4 className="text-sm font-semibold text-[#3e4c24]">New request</h4>
              <p className="mt-1 text-xs text-[#6b6d4b]">
                Need something? Add a request right from your report.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <input
                  value={requestName}
                  onChange={(e) => setRequestName(e.target.value)}
                  placeholder="Request name"
                  className="w-full rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-sm text-[#3b4224] focus:border-[#8fae4c] focus:outline-none"
                />
                <select
                  value={requestType}
                  onChange={(e) => setRequestType(e.target.value)}
                  className="w-full rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-sm text-[#3b4224] focus:border-[#8fae4c] focus:outline-none"
                >
                  {requestTypeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                value={requestDescription}
                onChange={(e) => setRequestDescription(e.target.value)}
                placeholder="Describe what you need"
                className="mt-3 min-h-[90px] w-full rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-sm text-[#3b4224] focus:border-[#8fae4c] focus:outline-none"
              />
            </div>

            {reportError && (
              <p className="mt-4 rounded-lg border border-[#e2d7b5] bg-[#f9f6e7] px-4 py-3 text-sm text-[#4b5133]">
                {reportError}
              </p>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[#6b6d4b]">
                Submitting marks your report complete for today.
              </p>
              <button
                type="button"
                onClick={handleReportSubmit}
                disabled={reportSubmitting || requestSubmitting}
                className="rounded-md bg-[#8fae4c] px-4 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-[#f9f9ec] shadow-md transition hover:bg-[#7e9c44] disabled:opacity-60"
              >
                {reportSubmitting ? "Submitting…" : "Submit report"}
              </button>
            </div>
          </div>
        </div>
      )}

      {animalOverlay && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4 py-6"
          onClick={() => setAnimalOverlay(null)}
        >
          <div
            className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Animal details"
          >
            <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
              <div className="relative min-h-[240px] bg-[#f7f3e2]">
                {animalOverlay.photos?.length ? (
                  <div className="absolute inset-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={animalOverlay.photos[0].url}
                      alt={animalOverlay.photos[0].name || animalOverlay.name}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-6xl text-[#c2b98d]">🐐</div>
                )}
                <button
                  className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-white"
                  onClick={() => setAnimalOverlay(null)}
                  type="button"
                >
                  Close
                </button>
              </div>

              <div className="space-y-3 bg-white px-5 py-4 text-sm text-[#4b5133]">
                <div className="flex items-start justify-between gap-3 md:block">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-[#7a7f54]">Animal spotlight</p>
                    <h3 className="text-2xl font-semibold text-[#314123]">{animalOverlay.name}</h3>
                    <p className="text-sm text-[#5f5a3b]">{animalOverlay.summary || "No summary yet."}</p>
                  </div>
                  <button
                    className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-xs font-semibold text-[#5a5436] shadow-sm md:hidden"
                    onClick={() => setAnimalOverlay(null)}
                    type="button"
                  >
                    Close
                  </button>
                </div>

                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#7a7f54]">Daily care notes</p>
                  <div className="rounded-lg border border-[#e6dfbe] bg-[#f9f6e7] px-3 py-2">
                    {renderCareNotes(animalOverlay.dailyCareNotes)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-[#e6dfbe] bg-[#f9f6e7] px-3 py-2">
                    <p className="font-semibold text-[#3f4926]">Birthday</p>
                    <p className="text-[#5f5a3b]">
                      {animalOverlay.birthday
                        ? new Date(animalOverlay.birthday).toLocaleDateString()
                        : "Unknown"}
                    </p>
                    <p className="text-[#7c7755]">{animalOverlay.ageLabel || "Age not set"}</p>
                  </div>
                  <div className="rounded-lg border border-[#e6dfbe] bg-[#f9f6e7] px-3 py-2">
                    <p className="font-semibold text-[#3f4926]">Type</p>
                    <p className="text-[#5f5a3b]">{animalOverlay.type?.name || "Unspecified"}</p>
                    {animalOverlay.gender?.name ? (
                      <p className="text-[#7c7755]">Gender: {animalOverlay.gender.name}</p>
                    ) : null}
                  </div>
                  <div className="rounded-lg border border-[#e6dfbe] bg-[#f9f6e7] px-3 py-2">
                    <p className="font-semibold text-[#3f4926]">Breed</p>
                    <p className="text-[#5f5a3b]">{animalOverlay.breed || "Unknown"}</p>
                  </div>
                  <div className="rounded-lg border border-[#e6dfbe] bg-[#f9f6e7] px-3 py-2">
                    <p className="font-semibold text-[#3f4926]">Milking</p>
                    <p className="text-[#5f5a3b]">{animalOverlay.milkingMethod || "—"}</p>
                    <p className="text-[#7c7755]">
                      {animalOverlay.getMilked ? "Gets milked" : "Does not get milked"}
                    </p>
                  </div>
                </div>

                {animalOverlay.behaviors?.length ? (
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.16em] text-[#7a7f54]">Behaviors</p>
                    <div className="flex flex-wrap gap-2">
                      {animalOverlay.behaviors.map((behavior) => (
                        <span
                          key={behavior}
                          className="inline-flex items-center rounded-full bg-[#eef3d9] px-3 py-1 text-[12px] font-semibold text-[#4c5c24]"
                        >
                          {behavior}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-[#e6dfbe] bg-white px-4 py-3 md:hidden">
              <button
                type="button"
                onClick={() => setAnimalOverlay(null)}
                className="w-full rounded-md border border-[#d0c9a4] bg-[#f6f2de] px-4 py-2 text-sm font-semibold text-[#4b5133] shadow-sm"
              >
                Close details
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Meal block ---------- */

function MealBlock({
  slot,
  assignments,
  currentUserName,
  taskMetaMap,
  onTaskClick,
}: {
  slot: Slot;
  assignments: MealAssignment[];
  currentUserName: string | null;
  taskMetaMap?: Record<string, TaskMeta>;
  onTaskClick?: (payload: TaskClickPayload) => void;
}) {
  const icon = getMealIcon(slot.label);
  const normalizedUser = currentUserName?.toLowerCase() ?? "";

  return (
    <div className="rounded-lg bg-[#f5f0cd] border border-[#efe4b1] shadow-sm">
      <div className="flex items-center gap-2 border-b border-[#f1e6b9] px-4 py-2">
        <span className="text-lg">{icon}</span>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-[#5d7f3b]">
            {slot.label}
          </span>
          {slot.timeRange && (
            <span className="text-xs text-[#9b8e4e]">{slot.timeRange}</span>
          )}
        </div>
      </div>

      <div className="px-4 py-3 space-y-2">
        {assignments.map((a) => {
          const includesUser = a.people.some(
            (p) => p.toLowerCase() === normalizedUser
          );
          const meta = taskMetaMap?.[taskBaseName(a.task)];
          const typeClass = typeColorClasses(meta?.typeColor);
          const primaryPerson = includesUser
            ? currentUserName || a.people[0] || "Team"
            : a.people[0] || currentUserName || "Team";

          return (
            <button
              key={a.task}
              type="button"
              onClick={() =>
                onTaskClick?.({
                  person: primaryPerson,
                  slot,
                  task: a.task,
                  groupNames: a.people,
                  isMeal: true,
                })
              }
              className={`w-full text-left rounded-md border px-3 py-2 flex items-center justify-between text-sm shadow-sm transition ${typeClass} ${
                includesUser ? "ring-2 ring-[#f0d38d]" : "hover:shadow"
              }`}
            >
              <span className="text-[#5b5a3a]">{a.task}</span>
              <span className="text-[#7c7a4a] text-xs font-medium">
                {a.people.map((p, idx) => {
                  const isMe = p.toLowerCase() === normalizedUser;
                  return (
                    <span key={p}>
                      {idx > 0 && ", "}
                      {isMe ? (
                        <span className="font-semibold underline">{p}</span>
                      ) : (
                        p
                      )}
                    </span>
                  );
                })}
              </span>
            </button>
          );
        })}

        {assignments.length === 0 && (
          <p className="text-xs text-[#7a7f54] italic">
            No assignments in this time block.
          </p>
        )}
      </div>
    </div>
  );
}

function getMealIcon(label: string): string {
  if (/breakfast/i.test(label)) return "🥚";
  if (/lunch/i.test(label)) return "🍱";
  if (/dinner/i.test(label)) return "🍽️";
  return "🍽️";
}

function ShiftBoard({
  title,
  description,
  combined,
  layout = "slot",
  onTaskClick,
  taskMetaMap,
  statusColors,
  currentUserName,
}: {
  title: string;
  description: string;
  combined: { slot: Slot; names: string[]; tasks: { task: string; people: string[] }[] }[];
  layout?: "slot" | "person";
  onTaskClick?: (payload: TaskClickPayload) => void;
  taskMetaMap: Record<string, TaskMeta>;
  statusColors: Record<string, string>;
  currentUserName?: string | null;
}) {
  const normalizedUser = (currentUserName || "").toLowerCase().trim();
  const hasTasks = combined.some((cell) => cell.tasks.length > 0);
  const personMap = new Map<
    string,
    { name: string; tasks: { task: string; people: string[]; slot: Slot }[] }
  >();
  const ensurePersonEntry = (person: string) => {
    const trimmed = person.trim();
    if (!trimmed) return null;
    const key = trimmed.toLowerCase();
    if (!personMap.has(key)) {
      personMap.set(key, { name: trimmed, tasks: [] });
    }
    return personMap.get(key) || null;
  };

  combined.forEach((cell) => {
    cell.names.forEach((person) => {
      ensurePersonEntry(person);
    });

    cell.tasks.forEach((task) => {
      task.people.forEach((person) => {
        const entry = ensurePersonEntry(person);
        if (!entry) return;
        entry.tasks.push({
          task: task.task,
          people: task.people,
          slot: cell.slot,
        });
      });
    });
  });

  const personEntries = Array.from(personMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold tracking-[0.16em] uppercase text-[#5d7f3b]">
          {title}
        </h3>
        <p className="text-sm text-[#7a7f54]">{description}</p>
      </div>

      {layout === "person" ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {personEntries.map((entry) => (
            <div
              key={entry.name}
              className="rounded-lg border border-[#d0c9a4] bg-white/85 shadow-sm"
            >
              <div className="border-b border-[#e2d7b5] bg-[#f4f1df] px-4 py-3">
                <span className="text-sm font-semibold text-[#42502d]">
                  {entry.name}
                </span>
                <div className="mt-1 h-[1px] w-full bg-[#d7d0ad]" />
              </div>
              <div className="px-4 py-3">
                {entry.tasks.length === 0 ? (
                  <p className="text-[11px] italic text-[#7a7f54]">
                    No tasks listed yet.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {entry.tasks.map((taskItem, idx) => {
                      const meta = taskMetaMap[taskBaseName(taskItem.task)];
                      const status = meta?.status;
                      const typeClass = typeColorClasses(meta?.typeColor);

                      return (
                        <button
                          key={`${entry.name}-${taskItem.slot.id}-${taskItem.task}-${idx}`}
                          type="button"
                          onClick={() =>
                            onTaskClick?.({
                              person: entry.name,
                              slot: taskItem.slot,
                              task: taskItem.task,
                              groupNames: taskItem.people,
                            })
                          }
                          className={`rounded-md border px-3 py-2 text-left text-[12px] font-semibold shadow-sm transition hover:shadow ${typeClass}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span>{taskBaseName(taskItem.task)}</span>
                            <StatusBadge
                              status={status}
                              color={statusColors[status || ""]}
                            />
                          </div>
                          <span className="mt-1 block text-[10px] font-normal text-[#6b6d4b]">
                            {taskItem.slot.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {combined.map((cell) => (
            <div
              key={cell.slot.id}
              className="rounded-lg border border-[#d0c9a4] bg-white/85 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2 border-b border-[#e2d7b5] bg-[#f4f1df] px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-[#42502d]">
                    {cell.slot.label}
                  </span>
                  {cell.slot.timeRange && (
                    <span className="text-[11px] text-[#8a8256]">
                      {cell.slot.timeRange}
                    </span>
                  )}
                </div>
                <span className="rounded-full bg-[#eef2d9] px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#4f5730]">
                  {cell.tasks.length} {cell.tasks.length === 1 ? "task" : "tasks"}
                </span>
              </div>

              <div className="px-4 py-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {cell.names.length ? (
                    cell.names.map((name) => (
                      <span
                        key={name}
                        className="inline-flex items-center rounded-full bg-[#eef5dd] px-3 py-1 text-[12px] font-semibold text-[#42502d]"
                      >
                        {name}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] italic text-[#7a7f54]">
                      No one assigned yet.
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  {cell.tasks.length === 0 ? (
                    <p className="text-[11px] italic text-[#7a7f54]">
                      No tasks listed for this block.
                    </p>
                  ) : (
                    cell.tasks.map((task) => {
                      const participants =
                        task.people.length > 0 ? task.people : cell.names;
                      const primaryPerson = participants[0] || "Team";
                      const includesUser = normalizedUser
                        ? participants.some((p) => p.toLowerCase() === normalizedUser)
                        : false;
                      const meta = taskMetaMap[taskBaseName(task.task)];
                      const status = meta?.status;
                      const typeClass = typeColorClasses(meta?.typeColor);

                      return (
                        <button
                          key={`${cell.slot.id}-${task.task}`}
                          type="button"
                          onClick={() =>
                            onTaskClick?.({
                              person: primaryPerson,
                              slot: cell.slot,
                              task: task.task,
                              groupNames: participants,
                            })
                          }
                          className={`w-full rounded-md border px-3 py-2 text-left shadow-sm transition hover:shadow ${typeClass} ${
                            includesUser ? "ring-2 ring-[#d2e4a0]" : ""
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-semibold text-[#42502d]">
                                {task.task}
                              </div>
                              <div className="text-[11px] text-[#7a7f54] space-y-1">
                                <div className="flex flex-wrap gap-1">
                                  {participants.length
                                    ? participants.map((p) => {
                                        const isMe =
                                          normalizedUser &&
                                          p.toLowerCase() === normalizedUser;
                                        return (
                                          <span
                                            key={p}
                                            className={`rounded-full px-2 py-[2px] text-[11px] font-semibold ${
                                              isMe
                                                ? "bg-[#a0b764] text-white"
                                                : "bg-[#eef2d9] text-[#3f4b29]"
                                            }`}
                                          >
                                            {isMe ? `${p} (you)` : p}
                                          </span>
                                        );
                                      })
                                    : "No names yet"}
                                </div>
                                {includesUser && (
                                  <span className="inline-flex items-center rounded-full bg-[#f1edd8] px-2 py-[1px] text-[10px] font-semibold text-[#4f4b33]">
                                    You&apos;re on this task
                                  </span>
                                )}
                              </div>
                            </div>
                            <StatusBadge
                              status={status}
                              color={statusColors[status || ""]}
                            />
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!hasTasks && (
        <p className="text-sm text-[#7a7f54] italic">
          No tasks listed for this shift yet.
        </p>
      )}

      {normalizedUser && (
        <div className="rounded-lg border border-dashed border-[#d0c9a4] bg-[#f9f6e7] px-3 py-2 text-[12px] text-[#4f4b33]">
          {(() => {
            const userTasks = combined
              .map((cell) => ({
                slot: cell.slot,
                tasks: cell.tasks.filter((t) =>
                  t.people.some((p) => p.toLowerCase() === normalizedUser)
                ),
              }))
              .filter((entry) => entry.tasks.length > 0);

            if (!userTasks.length) {
              return "You have no assignments in this shift.";
            }

            return (
              <ul className="list-disc space-y-1 pl-4">
                {userTasks.map((entry) => (
                  <li key={entry.slot.id}>
                    <span className="font-semibold">{entry.slot.label}</span>:{" "}
                    {entry.tasks.map((t) => taskBaseName(t.task)).join(", ")}
                  </li>
                ))}
              </ul>
            );
          })()}
        </div>
      )}
    </section>
  );
}

function ShiftTaskTable({
  title,
  description,
  slots,
  onTaskClick,
  taskMetaMap,
  statusColors,
  currentUserName,
}: {
  title: string;
  description: string;
  slots: { slot: Slot; tasks: { task: string; people: string[] }[] }[];
  onTaskClick?: (payload: TaskClickPayload) => void;
  taskMetaMap: Record<string, TaskMeta>;
  statusColors: Record<string, string>;
  currentUserName?: string | null;
}) {
  const normalizedUser = (currentUserName || "").toLowerCase().trim();
  const hasTasks = slots.some((entry) => entry.tasks.length > 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold tracking-[0.16em] uppercase text-[#5d7f3b]">
          {title}
        </h3>
        <p className="text-sm text-[#7a7f54]">{description}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {slots.map((entry) => (
          <div
            key={entry.slot.id}
            className="rounded-lg border border-[#d0c9a4] bg-white/85 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2 border-b border-[#e2d7b5] bg-[#f4f1df] px-4 py-3">
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-[#42502d]">
                  {entry.slot.label}
                </span>
                {entry.slot.timeRange && (
                  <span className="text-[11px] text-[#8a8256]">
                    {entry.slot.timeRange}
                  </span>
                )}
              </div>
              <span className="rounded-full bg-[#eef2d9] px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#4f5730]">
                {entry.tasks.length} {entry.tasks.length === 1 ? "task" : "tasks"}
              </span>
            </div>

            <div className="px-4 py-3 space-y-2">
              {entry.tasks.length === 0 ? (
                <p className="text-[11px] italic text-[#7a7f54]">
                  No tasks listed for this shift.
                </p>
              ) : (
                entry.tasks.map((task) => {
                  const participants = task.people;
                  const includesUser = normalizedUser
                    ? participants.some((p) => p.toLowerCase() === normalizedUser)
                    : false;
                  const meta = taskMetaMap[taskBaseName(task.task)];
                  const status = meta?.status;
                  const typeClass = typeColorClasses(meta?.typeColor);
                  const primaryPerson = includesUser
                    ? currentUserName || participants[0] || "Team"
                    : participants[0] || currentUserName || "Team";

                  return (
                    <button
                      key={`${entry.slot.id}-${task.task}`}
                      type="button"
                      onClick={() =>
                        onTaskClick?.({
                          person: primaryPerson,
                          slot: entry.slot,
                          task: task.task,
                          groupNames: participants,
                        })
                      }
                      className={`w-full rounded-md border px-3 py-2 text-left shadow-sm transition hover:shadow ${typeClass} ${
                        includesUser ? "ring-2 ring-[#d2e4a0]" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-[#42502d]">
                            {task.task}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#7a7f54]">
                            <span className="rounded-full bg-white/80 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#4f5730]">
                              {participants.length}{" "}
                              {participants.length === 1 ? "person" : "people"}
                            </span>
                            {includesUser && (
                              <span className="inline-flex items-center rounded-full bg-[#f1edd8] px-2 py-[1px] text-[10px] font-semibold text-[#4f4b33]">
                                You&apos;re on this task
                              </span>
                            )}
                          </div>
                        </div>
                        <StatusBadge
                          status={status}
                          color={statusColors[status || ""]}
                        />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>

      {!hasTasks && (
        <p className="text-sm text-[#7a7f54] italic">
          No tasks listed for this shift yet.
        </p>
      )}
    </section>
  );
}

function EveningScheduleTable({
  title,
  description,
  dayRows,
  indexTasks,
  onTaskClick,
  taskMetaMap,
  statusColors,
  currentUserName,
}: {
  title: string;
  description: string;
  dayRows: {
    day: string;
    condoCleaning: string[];
    eveningShift: string[];
    isActiveDay: boolean;
  }[];
  indexTasks: { task: string; slot: Slot; people: string[] }[];
  onTaskClick?: (payload: TaskClickPayload) => void;
  taskMetaMap: Record<string, TaskMeta>;
  statusColors: Record<string, string>;
  currentUserName?: string | null;
}) {
  const normalizedUser = (currentUserName || "").toLowerCase().trim();

  const renderNames = (names: string[]) => {
    if (!names.length) {
      return <span className="text-[11px] italic text-[#7a7f54]">—</span>;
    }

    const ordered = normalizedUser
      ? [
          ...names.filter((name) => name.toLowerCase() === normalizedUser),
          ...names.filter((name) => name.toLowerCase() !== normalizedUser),
        ]
      : names;

    return (
      <div className="flex flex-wrap gap-1.5">
        {ordered.map((name) => {
          const isMe =
            normalizedUser && name.toLowerCase() === normalizedUser;
          return (
            <span
              key={name}
              className={`rounded-full px-2 py-[2px] text-[11px] font-semibold ${
                isMe
                  ? "bg-[#a0b764] text-white"
                  : "bg-[#eef2d9] text-[#3f4b29]"
              }`}
            >
              {isMe ? `${name} (you)` : name}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold tracking-[0.16em] uppercase text-[#5d7f3b]">
          {title}
        </h3>
        <p className="text-sm text-[#7a7f54]">{description}</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#d0c9a4] bg-white/85 shadow-sm">
        <table className="min-w-full border-collapse text-left text-sm text-[#4f5730]">
          <thead className="bg-[#f4f1df] text-[11px] uppercase tracking-[0.14em] text-[#6b6f4c]">
            <tr>
              <th className="px-4 py-3 border-b border-[#e2d7b5]">Day</th>
              <th className="px-4 py-3 border-b border-[#e2d7b5]">
                Condo Cleaning
              </th>
              <th className="px-4 py-3 border-b border-[#e2d7b5]">
                Evening shift
              </th>
            </tr>
          </thead>
          <tbody>
            {dayRows.map((row) => {
              const condoHasUser = normalizedUser
                ? row.condoCleaning.some((p) => p.toLowerCase() === normalizedUser)
                : false;
              const eveningHasUser = normalizedUser
                ? row.eveningShift.some((p) => p.toLowerCase() === normalizedUser)
                : false;

              return (
                <tr
                  key={row.day}
                  className={row.isActiveDay ? "bg-[#f9f6e7]" : ""}
                >
                  <td className="px-4 py-3 border-b border-[#eee6c8] font-semibold text-[#3e4c24]">
                    {row.day}
                  </td>
                  <td
                    className={`px-4 py-3 border-b border-[#eee6c8] ${
                      condoHasUser ? "ring-2 ring-[#d2e4a0] ring-inset" : ""
                    }`}
                  >
                    {renderNames(row.condoCleaning)}
                  </td>
                  <td
                    className={`px-4 py-3 border-b border-[#eee6c8] ${
                      eveningHasUser ? "ring-2 ring-[#d2e4a0] ring-inset" : ""
                    }`}
                  >
                    {renderNames(row.eveningShift)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#5d7f3b]">
            Evening shift tasks
          </p>
        </div>
        {indexTasks.length === 0 ? (
          <p className="text-sm text-[#7a7f54] italic">
            No shared evening shift tasks listed yet.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {indexTasks.map((entry) => {
              const participants = entry.people;
              const includesUser = normalizedUser
                ? participants.some((p) => p.toLowerCase() === normalizedUser)
                : false;
              const meta = taskMetaMap[taskBaseName(entry.task)];
              const status = meta?.status;
              const typeClass = typeColorClasses(meta?.typeColor);
              const primaryPerson = includesUser
                ? currentUserName || participants[0] || "Team"
                : participants[0] || currentUserName || "Team";

              return (
                <button
                  key={`${entry.slot.id}-${entry.task}`}
                  type="button"
                  onClick={() =>
                    onTaskClick?.({
                      person: primaryPerson,
                      slot: entry.slot,
                      task: entry.task,
                      groupNames: participants,
                    })
                  }
                  className={`w-full rounded-md border px-3 py-2 text-left shadow-sm transition hover:shadow ${typeClass} ${
                    includesUser ? "ring-2 ring-[#d2e4a0]" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-[#42502d]">
                        {entry.task}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#7a7f54]">
                        <span className="rounded-full bg-white/80 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#4f5730]">
                          {participants.length}{" "}
                          {participants.length === 1 ? "person" : "people"}
                        </span>
                        {includesUser && (
                          <span className="inline-flex items-center rounded-full bg-[#f1edd8] px-2 py-[1px] text-[10px] font-semibold text-[#4f4b33]">
                            You&apos;re on this task
                          </span>
                        )}
                      </div>
                    </div>
                    <StatusBadge
                      status={status}
                      color={statusColors[status || ""]}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function WeekendScheduleTable({
  title,
  description,
  slotRows,
  indexTasks,
  onTaskClick,
  taskMetaMap,
  statusColors,
  currentUserName,
}: {
  title: string;
  description: string;
  slotRows: { slot: Slot; people: string[] }[];
  indexTasks: { task: string; slot: Slot; people: string[] }[];
  onTaskClick?: (payload: TaskClickPayload) => void;
  taskMetaMap: Record<string, TaskMeta>;
  statusColors: Record<string, string>;
  currentUserName?: string | null;
}) {
  const normalizedUser = (currentUserName || "").toLowerCase().trim();

  const renderNames = (names: string[]) => {
    if (!names.length) {
      return <span className="text-[11px] italic text-[#7a7f54]">—</span>;
    }

    const ordered = normalizedUser
      ? [
          ...names.filter((name) => name.toLowerCase() === normalizedUser),
          ...names.filter((name) => name.toLowerCase() !== normalizedUser),
        ]
      : names;

    return (
      <div className="flex flex-wrap gap-1.5">
        {ordered.map((name) => {
          const isMe =
            normalizedUser && name.toLowerCase() === normalizedUser;
          return (
            <span
              key={name}
              className={`rounded-full px-2 py-[2px] text-[11px] font-semibold ${
                isMe
                  ? "bg-[#a0b764] text-white"
                  : "bg-[#eef2d9] text-[#3f4b29]"
              }`}
            >
              {isMe ? `${name} (you)` : name}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold tracking-[0.16em] uppercase text-[#5d7f3b]">
          {title}
        </h3>
        <p className="text-sm text-[#7a7f54]">{description}</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#d0c9a4] bg-white/85 shadow-sm">
        <table className="min-w-full border-collapse text-left text-sm text-[#4f5730]">
          <thead className="bg-[#f4f1df] text-[11px] uppercase tracking-[0.14em] text-[#6b6f4c]">
            <tr>
              {slotRows.map((row) => (
                <th
                  key={row.slot.id}
                  className="px-4 py-3 border-b border-[#e2d7b5]"
                >
                  <div className="flex flex-col">
                    <span>{row.slot.label}</span>
                    {row.slot.timeRange && (
                      <span className="text-[10px] text-[#8a8256] normal-case">
                        {row.slot.timeRange}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {slotRows.map((row) => {
                const hasUser = normalizedUser
                  ? row.people.some((p) => p.toLowerCase() === normalizedUser)
                  : false;
                return (
                  <td
                    key={row.slot.id}
                    className={`px-4 py-4 border-b border-[#eee6c8] align-top ${
                      hasUser ? "ring-2 ring-[#d2e4a0] ring-inset" : ""
                    }`}
                  >
                    {renderNames(row.people)}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#5d7f3b]">
            Weekend shift tasks
          </p>
        </div>
        {indexTasks.length === 0 ? (
          <p className="text-sm text-[#7a7f54] italic">
            No shared weekend shift tasks listed yet.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {indexTasks.map((entry) => {
              const participants = entry.people;
              const includesUser = normalizedUser
                ? participants.some((p) => p.toLowerCase() === normalizedUser)
                : false;
              const meta = taskMetaMap[taskBaseName(entry.task)];
              const status = meta?.status;
              const typeClass = typeColorClasses(meta?.typeColor);
              const primaryPerson = includesUser
                ? currentUserName || participants[0] || "Team"
                : participants[0] || currentUserName || "Team";

              return (
                <button
                  key={`${entry.slot.id}-${entry.task}`}
                  type="button"
                  onClick={() =>
                    onTaskClick?.({
                      person: primaryPerson,
                      slot: entry.slot,
                      task: entry.task,
                      groupNames: participants,
                    })
                  }
                  className={`w-full rounded-md border px-3 py-2 text-left shadow-sm transition hover:shadow ${typeClass} ${
                    includesUser ? "ring-2 ring-[#d2e4a0]" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-[#42502d]">
                        {entry.task}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#7a7f54]">
                        <span className="rounded-full bg-white/80 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#4f5730]">
                          {participants.length}{" "}
                          {participants.length === 1 ? "person" : "people"}
                        </span>
                        {includesUser && (
                          <span className="inline-flex items-center rounded-full bg-[#f1edd8] px-2 py-[1px] text-[10px] font-semibold text-[#4f4b33]">
                            You&apos;re on this task
                          </span>
                        )}
                      </div>
                    </div>
                    <StatusBadge
                      status={status}
                      color={statusColors[status || ""]}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function StatusBadge({ status, color }: { status?: string; color?: string }) {
  if (!status) return null;

  const badgeClass = typeColorClasses(color);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.12em] ${badgeClass}`}
    >
      <span className="h-2 w-2 rounded-full bg-current opacity-80" />
      {status}
    </span>
  );
}

function TaskTypeLegend({ taskTypes }: { taskTypes: TaskTypeOption[] }) {
  if (!taskTypes.length) return null;

  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {taskTypes.map((type) => (
        <span
          key={type.name}
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-[4px] text-[11px] font-semibold shadow-sm ${typeColorClasses(
            type.color
          )}`}
        >
          <span className="h-2 w-2 rounded-full bg-current opacity-70" />
          {type.name}
        </span>
      ))}
    </div>
  );
}

function MyTasksList({
  tasks,
  onTaskClick,
  statusMap = {},
  statusColors = {},
  currentUserName,
}: {
  tasks: { slot: Slot; task: string; groupNames: string[] }[];
  onTaskClick?: (payload: TaskClickPayload) => void;
  statusMap?: Record<string, TaskMeta>;
  statusColors?: Record<string, string>;
  currentUserName?: string | null;
}) {
  if (tasks.length === 0) {
    return (
      <p className="text-sm text-[#7a7f54] italic">
        No tasks assigned to you for this schedule.
      </p>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {tasks.map(({ slot, task, groupNames }) => {
        const primary = taskBaseName(task);
        const meta = statusMap[primary];
        const status = meta?.status || "";
        const description = meta?.description || "";
        const typeClass = typeColorClasses(meta?.typeColor);

        return (
          <button
            key={`${primary}-${slot.id}`}
            type="button"
            onClick={() =>
              onTaskClick?.({
                person: currentUserName || "Me",
                slot,
                task,
                groupNames,
              })
            }
            className={`w-full rounded-lg border px-4 py-3 text-left shadow-sm hover:border-[#b8c98a] hover:shadow ${typeClass}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-[#7a7f54]">
                  {slot.label}
                  {slot.timeRange ? ` • ${slot.timeRange}` : ""}
                </p>
                <p className="text-sm font-semibold text-[#3e4c24]">{primary}</p>
                {description && (
                  <p className="mt-1 text-[12px] text-[#4f4b33] leading-snug">
                    {description}
                  </p>
                )}
              </div>
              <StatusBadge
                status={status}
                color={statusColors[status || ""]}
              />
            </div>
            {task.includes("\n") && (
              <p className="mt-1 whitespace-pre-line text-[11px] text-[#5b593c]">
                {task
                  .split("\n")
                  .slice(1)
                  .join("\n")}
              </p>
            )}
            <p className="mt-2 text-[11px] text-[#6a6748]">
              {groupNames.length > 1
                ? `With ${groupNames
                    .filter(
                      (g) =>
                        currentUserName &&
                        g.toLowerCase() !== currentUserName.toLowerCase()
                    )
                    .join(", ")}`
                : "Solo shift"}
            </p>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Grid schedule ---------- */

function ScheduleGrid({
  data,
  workSlots,
  currentUserName,
  currentSlotId,
  onTaskClick,
  statusMap = {},
  statusColors = {},
}: {
  data: ScheduleResponse;
  workSlots: Slot[];
  currentUserName: string | null;
  currentSlotId: string | null;
  onTaskClick?: (payload: TaskClickPayload) => void;
  statusMap?: Record<string, TaskMeta>;
  statusColors?: Record<string, string>;
}) {
  const { people, slots, cells } = data;

  const workSlotIndices = workSlots
    .map((slot) => slots.findIndex((s) => s.id === slot.id))
    .filter((idx) => idx !== -1);

  const numRows = people.length;
  const numCols = workSlotIndices.length;

  const normalizedUser = currentUserName?.toLowerCase() ?? "";
  const baseRowHeight = 72;
  const baseIndex = people.findIndex(
    (p) => p.toLowerCase() === normalizedUser
  );
  const originalIndices = people.map((_, idx) => idx);

  // Normalize cells so merges + assignee detection are resilient to ordering/notes.
  function normalizeCellTasks(cell: string): string[] {
    return splitCellTasks(cell)
      .map((t) => taskBaseName(t))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  function cellSignature(cell: string): string {
    const bases = normalizeCellTasks(cell);
    return bases.join("||");
  }

  function getAssigneesForTask(slotIdx: number, taskText: string): string[] {
    const base = taskBaseName(taskText);
    if (!base) return [];

    const assignees: string[] = [];
    for (let i = 0; i < people.length; i++) {
      const cell = (cells[i]?.[slotIdx] ?? "").trim();
      if (!cell) continue;

      const hasTask = splitCellTasks(cell).some(
        (t) => taskBaseName(t) === base
      );
      if (hasTask) assignees.push(people[i]);
    }
    return assignees;
  }

  function pickPrimaryPerson(group: string[]): string {
    if (!group.length) return "Team";
    const me = (currentUserName || "").trim().toLowerCase();
    const includesMe = me && group.some((p) => p.toLowerCase() === me);
    return includesMe ? (currentUserName as string) : group[0];
  }

  const similarity = (a: number, b: number) => {
    let score = 0;
    let streak = 0;
    let bestStreak = 0;
    workSlotIndices.forEach((slotIdx) => {
      const sigA = cellSignature((cells[a]?.[slotIdx] ?? "").trim());
      const sigB = cellSignature((cells[b]?.[slotIdx] ?? "").trim());
      if (sigA && sigA === sigB) {
        score++;
        streak++;
        if (streak > bestStreak) bestStreak = streak;
      } else {
        streak = 0;
      }
    });
    return score + bestStreak * 0.5;
  };

  const remaining = [...originalIndices];
  const rowOrder: number[] = [];

  if (baseIndex !== -1) {
    const basePos = remaining.indexOf(baseIndex);
    if (basePos !== -1) remaining.splice(basePos, 1);
    rowOrder.push(baseIndex);
  } else if (remaining.length) {
    rowOrder.push(remaining.shift()!);
  }

  while (remaining.length) {
    let bestIdx = 0;
    let bestScore = -1;

    remaining.forEach((idx, i) => {
      const sharedWithPlaced = rowOrder.reduce(
        (sum, existing) => sum + similarity(existing, idx),
        0
      );
      const userBoost = baseIndex !== -1 ? similarity(baseIndex, idx) : 0;
      const score = sharedWithPlaced + userBoost * 2.25;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    });

    rowOrder.push(remaining.splice(bestIdx, 1)[0]);
  }

  const orderedPeople = rowOrder.map((i) => people[i]);

  // Merge data
  const rowSpan: number[][] = Array.from({ length: numRows }, () =>
    Array(numCols).fill(1)
  );
  const colSpan: number[][] = Array.from({ length: numRows }, () =>
    Array(numCols).fill(1)
  );
  const showCell: boolean[][] = Array.from({ length: numRows }, () =>
    Array(numCols).fill(true)
  );

  for (let c = 0; c < numCols; c++) {
    const slotIndex = workSlotIndices[c];
    let r = 0;
    while (r < numRows) {
      const baseRow = rowOrder[r];
      const cell = (cells[baseRow]?.[slotIndex] ?? "").trim();
      const sig = cellSignature(cell);

      if (!cell) {
        rowSpan[r][c] = 1;
        r++;
        continue;
      }

      let end = r + 1;
      while (end < numRows) {
        const nextRow = rowOrder[end];
        const nextCell = (cells[nextRow]?.[slotIndex] ?? "").trim();
        const nextSig = cellSignature(nextCell);
        if (!sig || nextSig !== sig) break;
        end++;
      }

      const span = end - r;
      rowSpan[r][c] = span;
      for (let rr = r + 1; rr < end; rr++) {
        showCell[rr][c] = false;
      }

      r = end;
    }
  }

  // Merge horizontally across consecutive shifts for the same task
  for (let r = 0; r < numRows; r++) {
    let c = 0;
    while (c < numCols) {
      if (!showCell[r][c]) {
        c++;
        continue;
      }

      const slotIndex = workSlotIndices[c];
      const baseRow = rowOrder[r];
      const baseTask = (cells[baseRow]?.[slotIndex] ?? "").trim();
      if (!baseTask) {
        c++;
        continue;
      }

      const spanDown = rowSpan[r][c];
      let colSpanCount = 1;
      let nextCol = c + 1;

      while (nextCol < numCols) {
        if (!showCell[r][nextCol]) break;
        if (rowSpan[r][nextCol] !== spanDown) break;

        const nextSlotIndex = workSlotIndices[nextCol];
        let allMatch = true;
        for (let offset = 0; offset < spanDown; offset++) {
          const vr = r + offset;
          const realRow = rowOrder[vr];
          const compareBase = (cells[realRow]?.[slotIndex] ?? "").trim();
          const compareNext = (cells[realRow]?.[nextSlotIndex] ?? "").trim();
          const sigBase = cellSignature(compareBase);
          const sigNext = cellSignature(compareNext);
          if (!sigBase || sigBase !== sigNext) {
            allMatch = false;
            break;
          }
        }

        if (!allMatch) break;

        colSpanCount++;
        showCell[r][nextCol] = false;
        nextCol++;
      }

      colSpan[r][c] = colSpanCount;
      c += colSpanCount;
    }
  }

  return (
    <table className="w-full min-w-[720px] border-collapse text-xs">
      <thead>
        <tr className="bg-[#e5e7c5]">
          <th className="border border-[#d1d4aa] px-3 py-2 text-left w-40 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#5d7f3b] sticky left-0 z-20 bg-[#e5e7c5]">
            Person
          </th>
          {workSlots.map((slot) => {
            const isCurrent = slot.id === currentSlotId;
            return (
              <th
                key={slot.id}
                data-slot-id={slot.id}
                className={`border border-[#d1d4aa] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em]
                  ${
                    isCurrent
                      ? "bg-[#cfe4ac] text-[#365120] shadow-inner"
                      : "bg-[#e5e7c5] text-[#5d7f3b]"
                  }`}
              >
                <div className="flex items-center gap-2">
                  <div>
                    <div>{slot.label}</div>
                    {slot.timeRange && (
                      <div className="text-[10px] text-[#7a7f54] normal-case">
                        {slot.timeRange}
                      </div>
                    )}
                  </div>
                  {isCurrent && (
                    <span className="inline-flex items-center rounded-full bg-white/80 px-2 py-[1px] text-[9px] font-semibold text-[#476524]">
                      Now
                    </span>
                  )}
                </div>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {orderedPeople.map((person, visualRow) => {
          const realRow = rowOrder[visualRow];
          const isCurrentUser =
            person.toLowerCase() === normalizedUser && !!normalizedUser;

          return (
            <tr
              key={person}
              className={
                visualRow % 2 === 0 ? "bg-[#faf8ea]" : "bg-[#f4f2df]"
              }
            >
              <td className="border border-[#d1d4aa] px-3 py-2 align-top sticky left-0 z-10 bg-[#f7f6e8]">
                <span
                  className={
                    "text-sm " +
                    (isCurrentUser
                      ? "font-bold text-[#3e4c24]"
                      : "font-semibold text-[#4f5730]")
                  }
                >
                  {person}
                </span>
              </td>

              {workSlotIndices.map((slotIndex, cIdx) => {
                if (!showCell[visualRow][cIdx]) return null;

                const slot = slots[slotIndex];
                const isCurrentCol = slot.id === currentSlotId;
                const task = (cells[realRow]?.[slotIndex] ?? "").trim();

                if (!task) {
                  return (
                    <td
                      key={`${visualRow}-${slotIndex}`}
                      rowSpan={rowSpan[visualRow][cIdx]}
                      style={{
                        minHeight: `${rowSpan[visualRow][cIdx] * baseRowHeight}px`,
                      }}
                    className={`border border-[#d1d4aa] p-1 align-top h-full ${
                      isCurrentCol ? "bg-[#f0f4de]" : ""
                    }`}
                  />
                );
              }

                const span = rowSpan[visualRow][cIdx];
                const spanHeight = span * baseRowHeight;

                // Collect all people in this merged box
                const groupNames: string[] = [];
                for (let offset = 0; offset < span; offset++) {
                  const vr = visualRow + offset;
                  const realIndex = rowOrder[vr];
                  groupNames.push(people[realIndex]);
                }

                const sharedCount = groupNames.length;
                const taskEntries = splitCellTasks(task);
                const displayTasks = taskEntries.length ? taskEntries : [task];

                return (
                  <td
                    key={`${visualRow}-${slotIndex}`}
                    rowSpan={span}
                    colSpan={colSpan[visualRow][cIdx]}
                    style={{ minHeight: `${spanHeight}px` }}
                    className={`border border-[#d1d4aa] p-1 align-top h-full ${
                      isCurrentCol ? "bg-[#f0f4de]" : ""
                    }`}
                  >
                    <div className="flex h-full w-full flex-col gap-2">
                     {displayTasks.map((taskText, idx) => {
  const primaryTitle = taskBaseName(taskText);
  const meta = statusMap[primaryTitle];

  // NEW: real assignees for THIS task in THIS slot (independent of merging)
  const allAssignees = getAssigneesForTask(slotIndex, taskText);
  const assigneeCount = allAssignees.length || 1;
  const assigneeLabel = assigneeCount === 1 ? "person" : "people";

  const note = taskText
    .split("\n")
    .slice(1)
    .join("\n");

  const perHeight = Math.max(
    spanHeight / displayTasks.length,
    baseRowHeight * 0.7
  );

  return (
    <button
      key={`${visualRow}-${slotIndex}-${primaryTitle}-${idx}`}
      type="button"
      onClick={() => {
        onTaskClick?.({
          person: pickPrimaryPerson(allAssignees),
          slot,
          task: taskText,
          groupNames: allAssignees.length ? allAssignees : [person],
        });
      }}
      style={{ minHeight: `${perHeight}px` }}
      className={`flex h-full min-h-full w-full flex-col justify-between gap-2 text-left rounded-md border p-2 text-[11px] leading-snug shadow-sm focus:outline-none focus:ring-2 focus:ring-[#8fae4c] ${typeColorClasses(
        meta?.typeColor
      )}`}
    >
      <div className="flex justify-between items-start gap-2">
        <span className="font-semibold">{primaryTitle}</span>

        {/* CHANGED: always show the count, even if it is 1 */}
        <span className="text-[9px] text-[#4f4f31] bg-white/70 rounded-full px-2 py-[1px]">
          {assigneeCount} {assigneeLabel}
        </span>
      </div>

      <div className="mt-1">
        <StatusBadge
          status={meta?.status}
          color={statusColors[meta?.status || ""]}
        />
      </div>

      {!!note && (
        <div className="whitespace-pre-line text-[10px] text-[#5b593c]">
          {note}
        </div>
      )}
    </button>
  );
})}

                    </div>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ScheduleGridMobile({
  data,
  workSlots,
  currentSlotId,
  onTaskClick,
  statusMap = {},
}: {
  data: ScheduleResponse;
  workSlots: Slot[];
  currentSlotId: string | null;
  onTaskClick?: (payload: TaskClickPayload) => void;
  statusMap?: Record<string, TaskMeta>;
}) {
  const slotIndexMap: Record<string, number> = {};
  data.slots.forEach((slot, idx) => {
    slotIndexMap[slot.id] = idx;
  });

  return (
    <div className="space-y-3">
      {data.people.map((person, rowIdx) => (
        <div
          key={person}
          className="rounded-lg border border-[#d1d4aa] bg-[#faf8ea] shadow-sm"
        >
          <div className="flex items-center justify-between border-b border-[#d1d4aa] px-3 py-2">
            <p className="text-sm font-semibold text-[#4f5730]">{person}</p>
            <span className="text-[11px] uppercase tracking-[0.12em] text-[#7a7f54]">
              Tasks
            </span>
          </div>
          <div className="space-y-2 px-3 pb-3 pt-2">
            {workSlots.map((slot) => {
              const slotIndex = slotIndexMap[slot.id];
              const task = (data.cells[rowIdx]?.[slotIndex] ?? "").trim();
              if (!task) return null;

              const groupNames = data.people.filter((_, idx) => {
                const candidate = (data.cells[idx]?.[slotIndex] ?? "").trim();
                return candidate && candidate === task;
              });

              const isCurrent = slot.id === currentSlotId;
              const primaryTitle = task.split("\n")[0].trim();
              const status = statusMap[primaryTitle]?.status || "";

              return (
                <button
                  key={`${person}-${slot.id}`}
                  type="button"
                  onClick={() =>
                    onTaskClick?.({
                      person,
                      slot,
                      task,
                      groupNames,
                    })
                  }
                  className={`w-full rounded-md border px-3 py-2 text-left shadow-sm transition bg-white ${
                    isCurrent ? "border-[#b8c98a]" : "border-[#e2d7b5]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                        <p className="text-[11px] uppercase tracking-[0.12em] text-[#7a7f54]">
                          {slot.label}
                        </p>
                        {slot.timeRange && (
                          <p className="text-[10px] text-[#8a8256]">{slot.timeRange}</p>
                        )}
                      </div>
                      <StatusBadge status={status} />
                    {isCurrent && (
                      <span className="mt-1 inline-flex items-center rounded-full bg-[#eef5dd] px-2 py-[1px] text-[10px] font-semibold text-[#476524]">
                        Now
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[#3f4630]">
                    {task.split("\n")[0].trim()}
                  </div>
                  {task.includes("\n") && (
                    <div className="mt-1 whitespace-pre-line text-[11px] text-[#55513a]">
                      {task
                        .split("\n")
                        .slice(1)
                        .join("\n")}
                    </div>
                  )}
                  <p className="mt-1 text-[11px] text-[#6a6748]">
                    With {groupNames.join(", ")}
                  </p>
                </button>
              );
            })}

            {workSlots.every((slot) => {
              const idx = slotIndexMap[slot.id];
              const task = (data.cells[rowIdx]?.[idx] ?? "").trim();
              return !task;
            }) && (
              <p className="text-[11px] text-[#7a7f54] italic">
                No tasks scheduled for this person.
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Time helpers ---------- */

function getNowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function parseTimeRange(
  range: string
): { startMinutes: number; endMinutes: number } | null {
  const pattern =
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
  const match = range.match(pattern);
  if (!match) return null;

  const [, h1Str, m1Str, ampm1, h2Str, m2Str, ampm2] = match;

  const h1 = parseInt(h1Str, 10);
  const m1 = m1Str ? parseInt(m1Str, 10) : 0;
  const h2 = parseInt(h2Str, 10);
  const m2 = m2Str ? parseInt(m2Str, 10) : 0;

  const startMinutes = toMinutes(h1, m1, ampm1 as string | undefined);
  const endMinutes = toMinutes(h2, m2, ampm2 as string | undefined, ampm1);

  return { startMinutes, endMinutes };
}

function toMinutes(
  hour: number,
  minute: number,
  ampm?: string,
  fallbackAmpm?: string
): number {
  let h = hour;
  let meridiem = ampm?.toLowerCase() as "am" | "pm" | undefined;

  if (!meridiem && fallbackAmpm) {
    meridiem = fallbackAmpm.toLowerCase() as "am" | "pm";
  }

  if (meridiem === "pm" && h < 12) h += 12;
  if (meridiem === "am" && h === 12) h = 0;

  return h * 60 + minute;
}
