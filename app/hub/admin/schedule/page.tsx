"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadSession } from "@/lib/session";

type Slot = { id: string; label: string; timeRange?: string; isMeal?: boolean };
type ScheduleResponse = {
  people: string[];
  slots: Slot[];
  cells: CellContent[][];
  cellExists?: boolean[][];
  scheduleDate?: string;
  message?: string;
};
type ScheduledTask = { id: string; name: string };
type TaskCatalogItem = {
  id: string;
  name: string;
  type?: string;
  typeColor?: string;
  status?: string;
  priority?: string;
  occurrenceDate?: string | null;
  recurring?: boolean;
  parentTaskId?: string | null;
  description?: string | null;
  personCount?: number | null;
  timeSlots?: string[] | null;
  estimatedTime?: string | null;
};
type TaskTypeOption = { name: string; color: string };
type StatusOption = { name: string; color: string };
type TaskDetail = {
  id: string;
  name: string;
  description: string;
  extraNotes: string[];
  personCount?: number | null;
  status?: string;
  priority?: string;
  taskType?: { name: string; color: string };
  recurring?: boolean;
  occurrenceDate?: string | null;
  parentTaskId?: string | null;
};
type DragPayload = {
  taskId: string;
  taskName: string;
  fromPerson?: string;
  fromSlotId?: string;
  fromIndex?: number;
};
type CellContent = { tasks: ScheduledTask[]; note: string; blocked?: boolean };
type AutoSlotChoice = { row: number; col: number; score: number };

const DRAG_DATA_TYPE = "application/json/task";
const DEFAULT_SHIFT_HOURS = 1.5;

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

function statusBadgeClasses(status?: string) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (normalized === "in progress") {
    return "border-sky-200 bg-sky-50 text-sky-800";
  }
  if (normalized === "not started") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-[#d0c9a4] bg-[#f6f1dd] text-[#4b5133]";
}

function parseEstimatedHours(value?: string | null) {
  if (!value) return DEFAULT_SHIFT_HOURS;
  const match = String(value).match(/[\d.]+/);
  const parsed = match ? Number.parseFloat(match[0]) : Number.NaN;
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_SHIFT_HOURS;
  return parsed;
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function compressImageFile(file: File, maxBytes = 150 * 1024) {
  if (file.size <= maxBytes) return file;
  const img = await loadImageElement(file);
  const scale = Math.min(1, Math.sqrt(maxBytes / file.size));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let quality = 0.85;
  let blob: Blob | null = null;
  while (quality > 0.2) {
    blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
    );
    if (blob && blob.size <= maxBytes) break;
    quality -= 0.1;
  }

  if (!blob || blob.size > maxBytes) return null;
  return new File([blob], `compressed-${file.name}`, { type: "image/jpeg" });
}

function safeIndex(length: number, index?: number) {
  if (index === undefined || Number.isNaN(index)) return length;
  return Math.min(Math.max(index, 0), length);
}


export default function AdminScheduleEditorPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleResponse | null>(null);
  const [recurringTasks, setRecurringTasks] = useState<TaskCatalogItem[]>([]);
  const [oneOffTasks, setOneOffTasks] = useState<TaskCatalogItem[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskTypeOption[]>([]);
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>([]);
  const [taskSearch, setTaskSearch] = useState("");
  const [taskTypeFilter, setTaskTypeFilter] = useState("");
  const [taskStatusFilter, setTaskStatusFilter] = useState("");
  const [showAllRecurring, setShowAllRecurring] = useState(false);
  const [hideCompletedRecurring, setHideCompletedRecurring] = useState(false);
  const [hideFullyScheduledRecurring, setHideFullyScheduledRecurring] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{
    person: string;
    slotId: string;
    slotLabel: string;
  } | null>(null);
  const [customTask, setCustomTask] = useState("");
  const [quickTaskName, setQuickTaskName] = useState("");
  const [quickTaskDescription, setQuickTaskDescription] = useState("");
  const [recurringQuickName, setRecurringQuickName] = useState("");
  const [recurringQuickDescription, setRecurringQuickDescription] = useState("");
  const [recurringQuickUntil, setRecurringQuickUntil] = useState("");
  const [recurringQuickInterval, setRecurringQuickInterval] = useState(1);
  const [recurringQuickUnit, setRecurringQuickUnit] = useState("day");
  const [draggingTask, setDraggingTask] = useState<DragPayload | null>(null);
  const [pendingInsert, setPendingInsert] = useState<{ person: string; slotId: string; index: number } | null>(null);
  const [pendingCells, setPendingCells] = useState<Set<string>>(new Set());
  const [availableSchedules, setAvailableSchedules] = useState<
    { dateLabel: string; liveId?: string; stagingId?: string }[]
  >([]);
  const [scheduleMode, setScheduleMode] = useState<"database" | "page">("page");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleNote, setScheduleNote] = useState<string | null>(null);
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [copySourceDate, setCopySourceDate] = useState<string>("");
  const [copyTargetDate, setCopyTargetDate] = useState<string>("");
  const [copyingSchedule, setCopyingSchedule] = useState(false);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [taskEditDraft, setTaskEditDraft] = useState({
    description: "",
    extraNotes: "",
    personCount: "",
  });
  const [taskDetailLoading, setTaskDetailLoading] = useState(false);
  const [taskEditSaving, setTaskEditSaving] = useState(false);
  const [taskEditMessage, setTaskEditMessage] = useState<string | null>(null);
  const [mobileDockOpen, setMobileDockOpen] = useState(false);
  const [mobileDockTab, setMobileDockTab] = useState<"recurring" | "oneOff">("recurring");
  const [desktopDockOpen, setDesktopDockOpen] = useState(true);
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  const [blackoutMode, setBlackoutMode] = useState(false);
  const [blackoutRangeStart, setBlackoutRangeStart] = useState("");
  const [blackoutRangeEnd, setBlackoutRangeEnd] = useState("");
  const [blackoutApplying, setBlackoutApplying] = useState(false);
  const [recurringDockExpanded, setRecurringDockExpanded] = useState(false);
  const [oneOffDockExpanded, setOneOffDockExpanded] = useState(false);
  const [showPastIncomplete, setShowPastIncomplete] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [saveLog, setSaveLog] = useState<{
    status: "idle" | "saving" | "success" | "error";
    message?: string;
    lastAttempt?: string;
    payload?: { person: string; slotId: string; dateLabel?: string };
  }>({ status: "idle" });
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const formatDateInput = (value: string) => {
    if (!value) return "";
    const [year, month, day] = value.split("-");
    if (!year || !month || !day) return value;
    return `${month}/${day}/${year}`;
  };

  const formatLabelToInput = (label: string) => {
    const [month, day, year] = label.split("/");
    if (!month || !day || !year) return "";
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  };

  const addDaysToIso = (isoDate: string, days: number) => {
    const base = isoDate ? new Date(isoDate) : new Date();
    const next = new Date(base);
    next.setDate(next.getDate() + days);
    return next.toISOString().slice(0, 10);
  };

  const buildNotesText = (notes: string[]) => notes.filter(Boolean).join("\n");

  const todayLabel = formatDateInput(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    const session = loadSession();
    if (!session || !session.name) {
      router.replace("/");
      return;
    }

    const userType = (session.userType || "").toLowerCase();
    if (userType === "admin") {
      setAuthorized(true);
    } else {
      setMessage("You need admin access to adjust the schedule.");
    }
  }, [router]);

  useEffect(() => {
    if (!authorized) return;
    const loadStatic = async () => {
      try {
        const [typeRes, scheduleListRes] = await Promise.all([
          fetch("/api/task-types"),
          fetch("/api/schedule/list"),
        ]);

        if (typeRes.ok) {
          const json = await typeRes.json();
          setTaskTypes(json.types || []);
          setStatusOptions(json.statuses || []);
        }
        if (scheduleListRes.ok) {
          const json = await scheduleListRes.json();
          setAvailableSchedules(json.schedules || []);
          setScheduleMode(json.mode === "database" ? "database" : "page");
          setSelectedDate(todayLabel);
        }
      } catch (err) {
        console.error("Failed to load schedule editor data", err);
        setMessage("Could not load schedule tools. Please refresh.");
      }
    };

    loadStatic();
  }, [authorized]);


  useEffect(() => {
    if (!selectedDate) {
      setSelectedDate(todayLabel);
    }
  }, [selectedDate, todayLabel]);

  const selectedEntry = useMemo(
    () => availableSchedules.find((entry) => entry.dateLabel === selectedDate),
    [availableSchedules, selectedDate]
  );


  useEffect(() => {
    if (!authorized) return;
    if (scheduleMode === "page" && !selectedDate) return;
    let cancelled = false;

    const loadSchedule = async () => {
      setScheduleLoading(true);
      setScheduleNote(null);
      try {
        const url =
          scheduleMode === "page"
            ? `/api/schedule?date=${encodeURIComponent(selectedDate)}&staging=1`
            : "/api/schedule";
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) {
            setScheduleData(json);
            if (scheduleMode === "page" && !selectedDate && json?.scheduleDate) {
              setSelectedDate(json.scheduleDate);
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load schedule editor data", err);
          setMessage("Could not load schedule tools. Please refresh.");
        }
      } finally {
        if (!cancelled) setScheduleLoading(false);
      }
    };

    loadSchedule();
    return () => {
      cancelled = true;
    };
  }, [authorized, scheduleMode, selectedDate]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // no-op placeholder to avoid hydration mismatch if future window sizing is needed
  }, [scheduleMode, selectedDate]);

  const taskMetaById = useMemo(() => {
    const entries: Array<[string, TaskCatalogItem]> = [...recurringTasks, ...oneOffTasks].map(
      (task) => [task.id, task]
    );
    return new Map<string, TaskCatalogItem>(entries);
  }, [oneOffTasks, recurringTasks]);

  const taskNameOptions = useMemo(() => {
    const names = new Set<string>();
    [...recurringTasks, ...oneOffTasks].forEach((task) => names.add(task.name));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [oneOffTasks, recurringTasks]);

  const scheduleTitle = useMemo(() => {
    if (!selectedDate) return "Schedule editor";
    return `Editing Staging - ${selectedDate}`;
  }, [selectedDate]);

  const scheduleOptions = useMemo(() => {
    const options = [...availableSchedules];
    if (selectedDate && !options.find((entry) => entry.dateLabel === selectedDate)) {
      options.push({ dateLabel: selectedDate });
    }
    return options;
  }, [availableSchedules, selectedDate]);

  useEffect(() => {
    if (!authorized) return;
    let cancelled = false;

    const loadTaskDocks = async () => {
      try {
        const dateParam = selectedDate ? formatLabelToInput(selectedDate) : "";
        const recurringPromise = selectedDate
          ? fetch(
              `/api/tasks?recurring=true&includeOccurrences=true&start=${dateParam}&end=${dateParam}`
            )
          : Promise.resolve(null);
        const oneOffPromise = fetch("/api/tasks?recurring=false&includeOccurrences=true");
        const [recurringRes, oneOffRes] = await Promise.all([recurringPromise, oneOffPromise]);

        if (!cancelled && recurringRes && recurringRes.ok) {
          const json = await recurringRes.json();
          const items = (json.tasks || []).map((task: any) => ({
            id: task.id,
            name: task.name,
            type: task.task_type?.name || "",
            typeColor: task.task_type?.color || "default",
            status: task.status || "",
            priority: task.priority || "",
            occurrenceDate: task.occurrence_date || null,
            recurring: Boolean(task.recurring),
            parentTaskId: task.parent_task_id || null,
            description: task.description || null,
            personCount: task.person_count ?? null,
            timeSlots: task.time_slots || [],
            estimatedTime: task.estimated_time || null,
          }));
          setRecurringTasks(items);
        } else if (!cancelled && !selectedDate) {
          setRecurringTasks([]);
        }
        if (!cancelled && oneOffRes.ok) {
          const json = await oneOffRes.json();
          const items = (json.tasks || []).map((task: any) => ({
            id: task.id,
            name: task.name,
            type: task.task_type?.name || "",
            typeColor: task.task_type?.color || "default",
            status: task.status || "",
            priority: task.priority || "",
            occurrenceDate: task.occurrence_date || null,
            recurring: Boolean(task.recurring),
            parentTaskId: task.parent_task_id || null,
            description: task.description || null,
            personCount: task.person_count ?? null,
            timeSlots: task.time_slots || [],
            estimatedTime: task.estimated_time || null,
          }));
          setOneOffTasks(items);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load task docks", err);
        }
      }
    };

    loadTaskDocks();
    return () => {
      cancelled = true;
    };
  }, [authorized, selectedDate]);

  const taskPeopleCountById = useMemo(() => {
    if (!scheduleData) {
      return { byId: new Map<string, number>(), byName: new Map<string, number>() };
    }
    const peopleSets = new Map<string, Set<string>>();
    const nameSets = new Map<string, Set<string>>();
    scheduleData.people.forEach((person, rowIdx) => {
      const row = scheduleData.cells?.[rowIdx] || [];
      row.forEach((cell) => {
        (cell?.tasks || []).forEach((task) => {
          if (!peopleSets.has(task.id)) {
            peopleSets.set(task.id, new Set<string>());
          }
          peopleSets.get(task.id)?.add(person);
          const nameKey = task.name.trim().toLowerCase();
          if (!nameSets.has(nameKey)) {
            nameSets.set(nameKey, new Set<string>());
          }
          nameSets.get(nameKey)?.add(person);
        });
      });
    });
    const counts = new Map<string, number>();
    const nameCounts = new Map<string, number>();
    peopleSets.forEach((set, taskId) => counts.set(taskId, set.size));
    nameSets.forEach((set, name) => nameCounts.set(name, set.size));
    return { byId: counts, byName: nameCounts };
  }, [scheduleData]);

  const priorityRank = useCallback((priority?: string) => {
    const map: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
    if (!priority) return 3;
    return map[priority] ?? 3;
  }, []);

  const statusRank = useCallback((status?: string) => {
    const map: Record<string, number> = { "Not Started": 0, "In Progress": 1, Completed: 2 };
    if (!status) return 3;
    return map[status] ?? 3;
  }, []);

  const isTaskHandled = useCallback(
    (task: TaskCatalogItem) => {
      const assigned =
        taskPeopleCountById.byId.get(task.id) ??
        taskPeopleCountById.byName.get(task.name.trim().toLowerCase()) ??
        0;
      const needed =
        task.personCount && task.personCount > 0 ? Number(task.personCount) : null;
      const hasEnoughPeople = needed ? assigned >= needed : false;
      const isCompleted = (task.status || "").toLowerCase() === "completed";
      return { handled: hasEnoughPeople || isCompleted, hasEnoughPeople, isCompleted };
    },
    [taskPeopleCountById]
  );

  const sortTasks = useCallback(
    (a: TaskCatalogItem, b: TaskCatalogItem) => {
      const aHandled = isTaskHandled(a).handled;
      const bHandled = isTaskHandled(b).handled;
      if (aHandled !== bHandled) return aHandled ? 1 : -1;
      const aPriority = priorityRank(a.priority);
      const bPriority = priorityRank(b.priority);
      if (aPriority !== bPriority) return aPriority - bPriority;
      const aStatus = statusRank(a.status);
      const bStatus = statusRank(b.status);
      if (aStatus !== bStatus) return aStatus - bStatus;
      const aDate = a.occurrenceDate || "";
      const bDate = b.occurrenceDate || "";
      if (aDate !== bDate) {
        if (!aDate) return 1;
        if (!bDate) return -1;
        return aDate.localeCompare(bDate);
      }
      return a.name.localeCompare(b.name);
    },
    [isTaskHandled, priorityRank, statusRank]
  );

  const filteredRecurringTasks = useMemo(() => {
    const dateParam = selectedDate ? formatLabelToInput(selectedDate) : "";
    return recurringTasks
      .filter((task) => {
        const matchesSearch = task.name.toLowerCase().includes(taskSearch.toLowerCase());
        const matchesType = taskTypeFilter
          ? (task.type || "").toLowerCase() === taskTypeFilter.toLowerCase()
          : true;
        const matchesStatus = taskStatusFilter
          ? (task.status || "").toLowerCase() === taskStatusFilter.toLowerCase()
          : true;
        const matchesDate = showAllRecurring ? true : dateParam ? task.occurrenceDate === dateParam : true;
        const isCompleted = (task.status || "").toLowerCase() === "completed";
        const hasEnoughPeople = isTaskHandled(task).hasEnoughPeople;
        const passesCompleted = hideCompletedRecurring ? !isCompleted : true;
        const passesScheduled = hideFullyScheduledRecurring ? !hasEnoughPeople : true;
        return (
          matchesSearch &&
          matchesType &&
          matchesStatus &&
          matchesDate &&
          passesCompleted &&
          passesScheduled
        );
      })
      .sort(sortTasks);
  }, [
    recurringTasks,
    selectedDate,
    taskSearch,
    taskStatusFilter,
    taskTypeFilter,
    showAllRecurring,
    hideCompletedRecurring,
    hideFullyScheduledRecurring,
    isTaskHandled,
    sortTasks,
  ]);

  const filteredOneOffTasks = useMemo(() => {
    const selectedIso = selectedDate ? formatLabelToInput(selectedDate) : "";
    const filtered = oneOffTasks.filter((task) => {
      const matchesSearch = task.name.toLowerCase().includes(taskSearch.toLowerCase());
      const matchesType = taskTypeFilter
        ? (task.type || "").toLowerCase() === taskTypeFilter.toLowerCase()
        : true;
      const matchesStatus = taskStatusFilter
        ? (task.status || "").toLowerCase() === taskStatusFilter.toLowerCase()
        : true;
      const occurrence = task.occurrenceDate || "";
      const isPast = selectedIso && occurrence ? occurrence < selectedIso : false;
      const isCompleted = (task.status || "").toLowerCase() === "completed";
      const allowPast = !isPast || (showPastIncomplete && !isCompleted);
      return matchesSearch && matchesType && matchesStatus && allowPast;
    });

    return filtered.sort(sortTasks);
  }, [
    oneOffTasks,
    selectedDate,
    showPastIncomplete,
    taskSearch,
    taskTypeFilter,
    taskStatusFilter,
    sortTasks,
  ]);

  const dayOverviewSummary = useMemo(() => {
    if (!scheduleData) return null;

    const taskLookup = new Map<string, TaskCatalogItem>();
    [...recurringTasks, ...oneOffTasks].forEach((task) => {
      const name = task.name.trim().toLowerCase();
      if (name) taskLookup.set(name, task);
    });

    const taskMap = new Map<
      string,
      { name: string; status: string; notes: Set<string>; assignments: number }
    >();
    const standaloneNotes = new Set<string>();

    scheduleData.cells.forEach((row) => {
      row.forEach((cell) => {
        const note = cell.note?.trim();
        if (!cell.tasks.length && note) {
          standaloneNotes.add(note);
        }
        cell.tasks.forEach((task) => {
          const name = task.name.trim();
          if (!name) return;
          const key = name.toLowerCase();
          if (!taskMap.has(key)) {
            const meta = taskLookup.get(key);
            taskMap.set(key, {
              name,
              status: meta?.status || "Not Started",
              notes: new Set<string>(),
              assignments: 0,
            });
          }
          const entry = taskMap.get(key);
          if (!entry) return;
          entry.assignments += 1;
          if (note) entry.notes.add(note);
        });
      });
    });

    const tasks = Array.from(taskMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const completed = tasks.filter(
      (task) => task.status.toLowerCase() === "completed"
    ).length;
    return {
      tasks,
      total: tasks.length,
      completed,
      open: tasks.length - completed,
      standaloneNotes: Array.from(standaloneNotes),
    };
  }, [oneOffTasks, recurringTasks, scheduleData]);

  const dayOverview = useMemo(() => {
    if (!scheduleData) return null;

    const taskLookup = new Map<string, TaskCatalogItem>();
    [...recurringTasks, ...oneOffTasks].forEach((task) => {
      const name = task.name.trim().toLowerCase();
      if (name) taskLookup.set(name, task);
    });

    const taskMap = new Map<
      string,
      { name: string; status: string; notes: Set<string>; assignments: number }
    >();
    const standaloneNotes = new Set<string>();

    scheduleData.cells.forEach((row) => {
      row.forEach((cell) => {
        const note = cell.note?.trim();
        if (!cell.tasks.length && note) {
          standaloneNotes.add(note);
        }
        cell.tasks.forEach((task) => {
          const name = task.name.trim();
          if (!name) return;
          const key = name.toLowerCase();
          if (!taskMap.has(key)) {
            const meta = taskLookup.get(key);
            taskMap.set(key, {
              name,
              status: meta?.status || "Not Started",
              notes: new Set<string>(),
              assignments: 0,
            });
          }
          const entry = taskMap.get(key);
          if (!entry) return;
          entry.assignments += 1;
          if (note) entry.notes.add(note);
        });
      });
    });

    const tasks = Array.from(taskMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const completed = tasks.filter(
      (task) => task.status.toLowerCase() === "completed"
    ).length;
    return {
      tasks,
      total: tasks.length,
      completed,
      open: tasks.length - completed,
      standaloneNotes: Array.from(standaloneNotes),
    };
  }, [oneOffTasks, recurringTasks, scheduleData]);

  const findCoord = useCallback(
    (person: string | undefined, slotId: string | undefined, data: ScheduleResponse | null) => {
      if (!person || !slotId || !data) return null;
      const normalizedPerson = person.trim().toLowerCase();
      const row = data.people.findIndex(
        (name) => name.trim().toLowerCase() === normalizedPerson
      );
      const col = data.slots.findIndex((s) => s.id === slotId);
      if (row < 0 || col < 0) return null;
      return { row, col };
    },
    []
  );

  const persistCell = useCallback(
    async (person: string, slotId: string, content: CellContent) => {
      const activeDate = selectedDate || scheduleData?.scheduleDate || "";
      if (scheduleMode === "page" && !activeDate) {
        setSaveLog({
          status: "error",
          message: "Missing schedule date. Select a date before saving.",
          lastAttempt: new Date().toLocaleTimeString(),
          payload: { person, slotId },
        });
        return;
      }
      const key = `${person}-${slotId}`;
      setPendingCells((prev) => new Set(prev).add(key));
      setSaveLog({
        status: "saving",
        lastAttempt: new Date().toLocaleTimeString(),
        payload: { person, slotId, dateLabel: activeDate },
      });
      try {
        const res = await fetch("/api/schedule/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            person,
            slotId,
            tasks: content.tasks.map((task) => task.id),
            note: content.note,
            blocked: Boolean(content.blocked),
            dateLabel: scheduleMode === "page" ? activeDate : undefined,
            staging: scheduleMode === "page",
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          const errorMessage = json.error || "Failed to save schedule update";
          throw new Error(errorMessage);
        }
        setSaveLog({
          status: "success",
          message: "Saved to Supabase.",
          lastAttempt: new Date().toLocaleTimeString(),
          payload: { person, slotId, dateLabel: activeDate },
        });
      } catch (err) {
        console.error(err);
        const friendly =
          err instanceof Error ? err.message : "Unable to save this drop. Please retry.";
        setMessage(friendly);
        setSaveLog({
          status: "error",
          message: friendly,
          lastAttempt: new Date().toLocaleTimeString(),
          payload: { person, slotId, dateLabel: activeDate },
        });
      } finally {
        setPendingCells((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [scheduleData?.scheduleDate, scheduleMode, selectedDate]
  );

  const createQuickTask = useCallback(async () => {
    if (!quickTaskName.trim() || !selectedDate) return;
    const dateParam = formatLabelToInput(selectedDate);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: quickTaskName.trim(),
          description: quickTaskDescription.trim() || null,
          status: "Not Started",
          priority: "Medium",
          recurring: false,
          origin_date: dateParam,
          occurrence_date: dateParam,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to create task");
      }
      setQuickTaskName("");
      setQuickTaskDescription("");
      const oneOffRes = await fetch("/api/tasks?recurring=false&includeOccurrences=true");
      if (oneOffRes.ok) {
          const json = await oneOffRes.json();
          const items = (json.tasks || []).map((task: any) => ({
            id: task.id,
            name: task.name,
            type: task.task_type?.name || "",
            typeColor: task.task_type?.color || "default",
            status: task.status || "",
            priority: task.priority || "",
            occurrenceDate: task.occurrence_date || null,
            recurring: Boolean(task.recurring),
            parentTaskId: task.parent_task_id || null,
            description: task.description || null,
            personCount: task.person_count ?? null,
            timeSlots: task.time_slots || [],
            estimatedTime: task.estimated_time || null,
          }));
          setOneOffTasks(items);
        }
    } catch (err) {
      console.error("Failed to create quick task", err);
      setMessage("Unable to create quick task.");
    }
  }, [quickTaskDescription, quickTaskName, selectedDate]);

  const createRecurringQuickTask = useCallback(async () => {
    if (!recurringQuickName.trim()) return;
    const dateParam = selectedDate ? formatLabelToInput(selectedDate) : "";
    const originDate = dateParam || new Date().toISOString().slice(0, 10);
    const untilDate = recurringQuickUntil || addDaysToIso(originDate, 30);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: recurringQuickName.trim(),
          description: recurringQuickDescription.trim() || null,
          status: "Not Started",
          priority: "Medium",
          recurring: true,
          recurrence_interval: Math.max(1, Number(recurringQuickInterval) || 1),
          recurrence_unit: recurringQuickUnit || "day",
          recurrence_until: untilDate,
          origin_date: originDate,
          occurrence_date: originDate,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to create recurring task");
      }
      setRecurringQuickName("");
      setRecurringQuickDescription("");
      setRecurringQuickUntil("");
      setRecurringQuickInterval(1);
      setRecurringQuickUnit("day");
      if (selectedDate) {
        const recurringRes = await fetch(
          `/api/tasks?recurring=true&includeOccurrences=true&start=${originDate}&end=${originDate}`
        );
        if (recurringRes.ok) {
          const json = await recurringRes.json();
          const items = (json.tasks || []).map((task: any) => ({
            id: task.id,
            name: task.name,
            type: task.task_type?.name || "",
            typeColor: task.task_type?.color || "default",
            status: task.status || "",
            priority: task.priority || "",
            occurrenceDate: task.occurrence_date || null,
            recurring: Boolean(task.recurring),
            parentTaskId: task.parent_task_id || null,
            description: task.description || null,
            personCount: task.person_count ?? null,
            timeSlots: task.time_slots || [],
            estimatedTime: task.estimated_time || null,
          }));
          setRecurringTasks(items);
        }
      }
    } catch (err) {
      console.error("Failed to create recurring quick task", err);
      setMessage("Unable to create recurring quick task.");
    }
  }, [
    addDaysToIso,
    recurringQuickDescription,
    recurringQuickInterval,
    recurringQuickName,
    recurringQuickUnit,
    recurringQuickUntil,
    selectedDate,
  ]);

  const resolveTaskEntry = useCallback(
    async (taskName: string): Promise<ScheduledTask | null> => {
      const trimmed = taskName.trim();
      if (!trimmed) return null;
      const normalized = trimmed.toLowerCase();
      const dateParam = selectedDate ? formatLabelToInput(selectedDate) : "";

      const exactOneOff = oneOffTasks.find(
        (task) =>
          task.name.toLowerCase() === normalized &&
          (!dateParam || task.occurrenceDate === dateParam)
      );
      if (exactOneOff) return { id: exactOneOff.id, name: exactOneOff.name };

      const recurringMatch = recurringTasks.find(
        (task) => task.name.toLowerCase() === normalized
      );
      if (recurringMatch) {
        if (dateParam && recurringMatch.occurrenceDate !== dateParam && recurringMatch.recurring) {
          try {
            const res = await fetch("/api/tasks/occurrence", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                seriesId: recurringMatch.parentTaskId || recurringMatch.id,
                occurrenceDate: dateParam,
              }),
            });
            const json = await res.json();
            if (res.ok && json.task?.id) {
              const created = {
                id: json.task.id,
                name: json.task.name,
                type: json.task.task_type?.name || "",
                typeColor: json.task.task_type?.color || "default",
                status: json.task.status || "",
                priority: json.task.priority || "",
                occurrenceDate: json.task.occurrence_date || dateParam,
                recurring: Boolean(json.task.recurring),
                parentTaskId: json.task.parent_task_id || null,
                description: json.task.description || null,
                personCount: json.task.person_count ?? null,
              };
              setRecurringTasks((prev) => [created, ...prev]);
              return { id: created.id, name: created.name };
            }
          } catch (err) {
            console.error("Failed to ensure recurring occurrence", err);
          }
        }
        return { id: recurringMatch.id, name: recurringMatch.name };
      }

      if (dateParam) {
        try {
          const seriesRes = await fetch(
            `/api/tasks?recurring=true&includeOccurrences=false&search=${encodeURIComponent(trimmed)}`
          );
          const seriesJson = await seriesRes.json();
          const series = (seriesJson.tasks || []).find(
            (task: any) => String(task.name || "").toLowerCase() === normalized
          );
          if (series?.id) {
            const occurrenceRes = await fetch("/api/tasks/occurrence", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ seriesId: series.id, occurrenceDate: dateParam }),
            });
            const occurrenceJson = await occurrenceRes.json();
            if (occurrenceRes.ok && occurrenceJson.task?.id) {
              const created = {
                id: occurrenceJson.task.id,
                name: occurrenceJson.task.name,
                type: occurrenceJson.task.task_type?.name || "",
                typeColor: occurrenceJson.task.task_type?.color || "default",
                status: occurrenceJson.task.status || "",
                priority: occurrenceJson.task.priority || "",
                occurrenceDate: occurrenceJson.task.occurrence_date || dateParam,
                recurring: Boolean(occurrenceJson.task.recurring),
                parentTaskId: occurrenceJson.task.parent_task_id || null,
                description: occurrenceJson.task.description || null,
                personCount: occurrenceJson.task.person_count ?? null,
              };
              setRecurringTasks((prev) => [created, ...prev]);
              return { id: created.id, name: created.name };
            }
          }
        } catch (err) {
          console.error("Failed to resolve recurring series", err);
        }
      }

      const fallbackOneOff = oneOffTasks.find(
        (task) => task.name.toLowerCase() === normalized
      );
      if (fallbackOneOff) return { id: fallbackOneOff.id, name: fallbackOneOff.name };

      if (!dateParam) return null;

      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmed,
            description: null,
            status: "Not Started",
            priority: "Medium",
            recurring: false,
            origin_date: dateParam,
            occurrence_date: dateParam,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          console.error("Failed to create ad-hoc task", json?.error);
          return null;
        }
        if (json.task?.id) {
          const created = {
            id: json.task.id,
            name: json.task.name,
            type: "",
            typeColor: "default",
            status: json.task.status || "",
            occurrenceDate: json.task.occurrence_date || dateParam,
            description: json.task.description || null,
          };
          setOneOffTasks((prev) => [created, ...prev]);
          return { id: created.id, name: created.name };
        }
      } catch (err) {
        console.error("Failed to create ad-hoc task", err);
      }
      return null;
    },
    [oneOffTasks, recurringTasks, selectedDate]
  );

  const handleTaskMove = useCallback(
    (payload: DragPayload, target: { person: string; slotId: string; slotLabel: string; targetIndex?: number }) => {
      if (!payload.taskId || !payload.taskName) return;
      const updates: { person: string; slotId: string; content: CellContent }[] = [];
      const taskEntry = { id: payload.taskId, name: payload.taskName };

      const directPersist = async () => {
        const content: CellContent = { tasks: [taskEntry], note: "" };
        setSaveLog({
          status: "saving",
          message: "Target cell not loaded; saving directly to Supabase.",
          lastAttempt: new Date().toLocaleTimeString(),
          payload: { person: target.person, slotId: target.slotId },
        });
        await persistCell(target.person, target.slotId, content);
        await refreshSchedule();
      };

      if (!scheduleData) {
        void directPersist();
        return;
      }

      const nextCells = scheduleData.cells.map((row) =>
        row.map((cell) => ({ ...cell, tasks: [...cell.tasks] }))
      );

      const targetCoord = findCoord(target.person, target.slotId, scheduleData);
      if (!targetCoord) {
        void directPersist();
        return;
      }
      let targetContent = nextCells[targetCoord.row][targetCoord.col];

      let insertionIndex = safeIndex(targetContent.tasks.length, target.targetIndex);

      if (payload.fromPerson && payload.fromSlotId) {
        const sourceCoord = findCoord(payload.fromPerson, payload.fromSlotId, scheduleData);
        if (sourceCoord) {
          const sourceContent = nextCells[sourceCoord.row][sourceCoord.col];
          const idx =
            payload.fromIndex ??
            sourceContent.tasks.findIndex((t) => t.id === payload.taskId);
          if (idx > -1) {
            sourceContent.tasks.splice(idx, 1);
            if (
              sourceCoord.row === targetCoord.row &&
              sourceCoord.col === targetCoord.col &&
              insertionIndex > idx
            ) {
              insertionIndex -= 1;
            }
            updates.push({
              person: payload.fromPerson,
              slotId: payload.fromSlotId,
              content: sourceContent,
            });
            if (
              sourceCoord.row === targetCoord.row &&
              sourceCoord.col === targetCoord.col
            ) {
              targetContent = sourceContent;
            }
          }
        }
      }

      targetContent.tasks.splice(insertionIndex, 0, taskEntry);
      updates.push({
        person: target.person,
        slotId: target.slotId,
        content: targetContent,
      });

      setScheduleData({ ...scheduleData, cells: nextCells });

      updates.forEach((u) => persistCell(u.person, u.slotId, u.content));
      if (!updates.length) {
        void directPersist();
      }
      setSelectedCell({ person: target.person, slotId: target.slotId, slotLabel: target.slotLabel });
      setPendingInsert(null);
      setDraggingTask(null);
    },
    [findCoord, persistCell, scheduleData]
  );

  const removeTaskFromCell = useCallback(
    (cell: { person: string; slotId: string }, task: ScheduledTask, index?: number) => {
      if (!scheduleData) return;
      const coord = findCoord(cell.person, cell.slotId, scheduleData);
      if (!coord) return;
      const nextCells = scheduleData.cells.map((row) =>
        row.map((entry) => ({ ...entry, tasks: [...entry.tasks] }))
      );
      const content = nextCells[coord.row][coord.col];
      const idx = index ?? content.tasks.findIndex((t) => t.id === task.id);
      if (idx < 0) return;
      content.tasks.splice(idx, 1);
      setScheduleData({ ...scheduleData, cells: nextCells });
      persistCell(cell.person, cell.slotId, content);
    },
    [findCoord, persistCell, scheduleData]
  );

  const handleDropEvent = useCallback(
    (e: React.DragEvent, person: string, slot: Slot, targetIndex?: number) => {
      e.preventDefault();
      e.stopPropagation();
      const activeDate = selectedDate || scheduleData?.scheduleDate || "";
      if (scheduleMode === "page" && !activeDate) {
        setSaveLog({
          status: "error",
          message: "Select a schedule date before saving drops.",
          lastAttempt: new Date().toLocaleTimeString(),
          payload: { person, slotId: slot.id },
        });
        return;
      }
      if (!scheduleData) {
        setSaveLog({
          status: "error",
          message: "Schedule data has not loaded yet. Please refresh and try again.",
          lastAttempt: new Date().toLocaleTimeString(),
          payload: { person, slotId: slot.id },
        });
        return;
      }
      const coord = findCoord(person, slot.id, scheduleData);
      if (coord) {
        const targetCell = scheduleData.cells?.[coord.row]?.[coord.col];
        if (targetCell?.blocked) {
          setSaveLog({
            status: "error",
            message: "This cell is blocked for scheduling.",
            lastAttempt: new Date().toLocaleTimeString(),
            payload: { person, slotId: slot.id },
          });
          return;
        }
      }
      e.dataTransfer.dropEffect = "move";
      const jsonPayload = e.dataTransfer.getData(DRAG_DATA_TYPE);
      const textPayload = e.dataTransfer.getData("text/task-name");
      let parsed: DragPayload = { taskId: "", taskName: textPayload };

      const finalizeDrop = async () => {
        if (jsonPayload) {
          try {
            parsed = { ...parsed, ...JSON.parse(jsonPayload) };
          } catch (err) {
            console.error("Failed to parse drag payload", err);
          }
        }

        if (!parsed.taskId && parsed.taskName) {
          const resolved = await resolveTaskEntry(parsed.taskName);
          if (!resolved) return;
          parsed = {
            ...parsed,
            taskId: resolved.id,
            taskName: resolved.name,
          };
        }

        if (!parsed.taskId || !parsed.taskName) return;
        handleTaskMove(parsed, { person, slotId: slot.id, slotLabel: slot.label, targetIndex });
        setPendingInsert(null);
      };

      void finalizeDrop();
    },
    [handleTaskMove, resolveTaskEntry, scheduleData, scheduleMode, selectedDate]
  );

  const handleDragOverEvent = useCallback(
    (e: React.DragEvent, person: string, slotId: string, index: number) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = draggingTask?.fromPerson ? "move" : "copy";
      setPendingInsert({ person, slotId, index });
    },
    [draggingTask]
  );

  const getCellValue = (cell: { person: string; slotId: string } | null) => {
    if (!cell || !scheduleData) return null;
    const coord = findCoord(cell.person, cell.slotId, scheduleData);
    if (!coord) return null;
    const content = scheduleData.cells?.[coord.row]?.[coord.col];
    if (!content) return null;
    return { content };
  };

  const toggleBlackoutCell = useCallback(
    async (person: string, slot: Slot, nextBlocked: boolean) => {
      const activeDate = selectedDate || scheduleData?.scheduleDate || "";
      if (!activeDate) return;
      setPendingCells((prev) => new Set(prev).add(`${person}-${slot.id}`));
      try {
        await fetch("/api/schedule/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            person,
            slotId: slot.id,
            dateLabel: activeDate,
            tasks: [],
            note: "",
            blocked: nextBlocked,
          }),
        });
        setScheduleData((prev) => {
          if (!prev) return prev;
          const coord = findCoord(person, slot.id, prev);
          if (!coord) return prev;
          const nextCells = prev.cells.map((row, rowIdx) =>
            row.map((cell, colIdx) => {
              if (rowIdx !== coord.row || colIdx !== coord.col) return cell;
              return { ...cell, tasks: [], note: "", blocked: nextBlocked };
            })
          );
          return { ...prev, cells: nextCells };
        });
      } catch (err) {
        console.error("Failed to update blackout cell", err);
        setMessage("Unable to update blackout cell.");
      } finally {
        setPendingCells((prev) => {
          const next = new Set(prev);
          next.delete(`${person}-${slot.id}`);
          return next;
        });
      }
    },
    [findCoord, scheduleData?.scheduleDate, selectedDate]
  );

  const applyBlackoutRange = useCallback(async () => {
    if (!scheduleData) {
      setMessage("Load a schedule before applying blackout ranges.");
      return;
    }
    if (!blackoutRangeStart || !blackoutRangeEnd) {
      setMessage("Select a start and end date for the blackout range.");
      return;
    }
    const startDate = new Date(blackoutRangeStart);
    const endDate = new Date(blackoutRangeEnd);
    if (Number.isNaN(startDate.valueOf()) || Number.isNaN(endDate.valueOf())) {
      setMessage("Blackout range dates are invalid.");
      return;
    }
    if (startDate > endDate) {
      setMessage("Blackout range start date must be before the end date.");
      return;
    }

    const blockedCells: { person: string; slotId: string }[] = [];
    scheduleData.people.forEach((person, rowIdx) => {
      scheduleData.slots.forEach((slot, colIdx) => {
        const cell = scheduleData.cells?.[rowIdx]?.[colIdx];
        if (cell?.blocked) {
          blockedCells.push({ person, slotId: slot.id });
        }
      });
    });

    if (!blockedCells.length) {
      setMessage("No blocked cells found to apply across the range.");
      return;
    }

    setBlackoutApplying(true);
    setMessage(null);
    try {
      const dates: string[] = [];
      const cursor = new Date(startDate);
      while (cursor <= endDate) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setDate(cursor.getDate() + 1);
      }

      for (const dateLabel of dates) {
        await Promise.all(
          blockedCells.map(async (cell) => {
            await fetch("/api/schedule/update", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                person: cell.person,
                slotId: cell.slotId,
                dateLabel,
                tasks: [],
                note: "",
                blocked: true,
              }),
            });
          })
        );
      }
      setMessage("Blackout range applied to all selected dates.");
    } catch (err) {
      console.error("Failed to apply blackout range", err);
      setMessage("Unable to apply blackout range.");
    } finally {
      setBlackoutApplying(false);
    }
  }, [blackoutRangeEnd, blackoutRangeStart, scheduleData]);

  const selectCell = (person: string, slot: Slot) => {
    const coord = findCoord(person, slot.id, scheduleData);
    const current = coord ? scheduleData?.cells?.[coord.row]?.[coord.col] : null;
    if (blackoutMode) {
      const nextBlocked = !current?.blocked;
      toggleBlackoutCell(person, slot, nextBlocked);
      return;
    }
    if (current?.blocked) {
      setMessage("This cell is blocked. Toggle blackout mode to edit it.");
      return;
    }
    if (selectedCell?.person !== person || selectedCell?.slotId !== slot.id) {
      setCustomTask("");
    }
    setSelectedCell({ person, slotId: slot.id, slotLabel: slot.label });
  };

  const handleCustomAdd = async () => {
    if (!customTask.trim() || !selectedCell) return;
    const existing = getCellValue(selectedCell)?.content.tasks.length || 0;
    const taskEntry = await resolveTaskEntry(customTask.trim());
    if (!taskEntry) {
      setMessage("Couldn't find or create that task yet.");
      return;
    }
    handleTaskMove(
      { taskId: taskEntry.id, taskName: taskEntry.name },
      { ...selectedCell, targetIndex: existing }
    );
    setCustomTask("");
  };

  const loadTaskDetail = async (taskId: string, fallbackName?: string) => {
    if (!taskId) return;
    setTaskDetailLoading(true);
    setTaskEditMessage(null);
    setPhotoMessage(null);
    try {
      const res = await fetch(`/api/task?id=${encodeURIComponent(taskId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load task details");
      const detail = {
        id: json.id || taskId,
        name: json.name || fallbackName || "Task",
        description: json.description || "",
        extraNotes: Array.isArray(json.extraNotes) ? json.extraNotes : [],
        personCount: json.personCount ?? null,
        status: json.status || "",
        priority: json.priority || "",
        taskType: json.taskType,
        recurring: json.recurring || false,
        occurrenceDate: json.occurrenceDate || null,
        parentTaskId: json.parentTaskId || null,
      };
      setTaskDetail(detail);
      setTaskEditDraft({
        description: detail.description || "",
        extraNotes: buildNotesText(detail.extraNotes || []),
        personCount:
          detail.personCount === null || detail.personCount === undefined
            ? ""
            : String(detail.personCount),
      });
    } catch (err) {
      console.error(err);
      const friendly = err instanceof Error ? err.message : "Unable to load that task right now.";
      setMessage(friendly);
      setTaskDetail(null);
      setTaskEditDraft({ description: "", extraNotes: "", personCount: "" });
    } finally {
      setTaskDetailLoading(false);
    }
  };

  const saveTaskEdits = async () => {
    if (!taskDetail?.id) return;
    setTaskEditSaving(true);
    setTaskEditMessage(null);
    try {
      const notesList = taskEditDraft.extraNotes
        .split("\n")
        .map((note) => note.trim())
        .filter(Boolean);
      const personCount =
        taskEditDraft.personCount.trim() === ""
          ? null
          : Number(taskEditDraft.personCount);
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: taskDetail.id,
          description: taskEditDraft.description.trim(),
          extra_notes: notesList,
          person_count: Number.isNaN(personCount) ? null : personCount,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to update task");
      setTaskDetail({
        ...taskDetail,
        description: taskEditDraft.description.trim(),
        extraNotes: notesList,
        personCount: Number.isNaN(personCount) ? null : personCount,
      });
      setTaskEditMessage("Task updated.");
    } catch (err) {
      console.error(err);
      const friendly = err instanceof Error ? err.message : "Failed to update task";
      setTaskEditMessage(friendly);
    } finally {
      setTaskEditSaving(false);
    }
  };

  const handlePhotoUpload = async () => {
    if (!taskDetail?.id || !taskDetail?.name) {
      setPhotoMessage("Select a task before uploading a photo.");
      return;
    }
    const file = photoInputRef.current?.files?.[0];
    if (!file) {
      setPhotoMessage("Choose an image to upload.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setPhotoMessage("Only image files are supported.");
      return;
    }

    setPhotoUploading(true);
    setPhotoMessage(null);
    try {
      const compressed = await compressImageFile(file);
      if (!compressed) {
        setPhotoMessage("Image must be 150kb or less after compression.");
        return;
      }
      const form = new FormData();
      form.append("taskId", taskDetail.id);
      form.append("taskName", taskDetail.name);
      form.append("file", compressed);

      const res = await fetch("/api/task/photos", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");

      setPhotoMessage("Photo uploaded.");
      if (photoInputRef.current) {
        photoInputRef.current.value = "";
      }
      await loadTaskDetail(taskDetail.id, taskDetail.name);
    } catch (err) {
      console.error(err);
      const friendly = err instanceof Error ? err.message : "Upload failed";
      setPhotoMessage(friendly);
    } finally {
      setPhotoUploading(false);
    }
  };

  const refreshSchedule = async () => {
    try {
      if (scheduleMode === "page" && !selectedDate) return;
      const res =
        scheduleMode === "page"
          ? await fetch(
              `/api/schedule?date=${encodeURIComponent(selectedDate)}&staging=1`
            )
          : await fetch("/api/schedule");
      if (res.ok) {
        const json = await res.json();
        setScheduleData(json);
        setMessage(null);
      }
      if (scheduleMode === "page") {
        const listRes = await fetch("/api/schedule/list");
        if (listRes.ok) {
          const listJson = await listRes.json();
          setAvailableSchedules(listJson.schedules || []);
        }
      }
    } catch (err) {
      console.error("Refresh failed", err);
      setMessage("Unable to refresh schedule. Try again soon.");
    }
  };

  const publishSchedule = async () => {
    if (scheduleMode !== "page") return;
    if (!selectedDate) return;
    setScheduleNote(null);
    try {
      const res = await fetch("/api/schedule/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateLabel: selectedDate }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to publish schedule");
      }
      setScheduleNote(`Published staging schedule for ${selectedDate}.`);
    } catch (err) {
      console.error("Failed to publish schedule", err);
      setScheduleNote("Unable to publish the schedule right now.");
    }
  };

  const copySchedule = async () => {
    if (scheduleMode !== "page") return;
    if (!copySourceDate || !copyTargetDate) {
      setScheduleNote("Select both a source date and a target date to copy.");
      return;
    }
    if (copySourceDate === copyTargetDate) {
      setScheduleNote("Source and target dates must be different.");
      return;
    }

    setCopyingSchedule(true);
    setScheduleNote(null);

    try {
      const res = await fetch(
        `/api/schedule?date=${encodeURIComponent(copySourceDate)}&staging=1`
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to load source schedule.");
      }
      const sourceData: ScheduleResponse = await res.json();

      if (!sourceData?.people?.length || !sourceData?.slots?.length) {
        setScheduleNote("Source schedule is empty. Nothing to copy.");
        return;
      }

      const updates: Promise<void>[] = [];
      sourceData.people.forEach((person, rowIdx) => {
        sourceData.slots.forEach((slot, colIdx) => {
          const cell = sourceData.cells?.[rowIdx]?.[colIdx];
          if (!cell) return;
          if (!cell.tasks.length && !cell.note && !cell.blocked) return;
          updates.push(
            fetch("/api/schedule/update", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                person,
                slotId: slot.id,
                tasks: cell.tasks.map((task) => task.id),
                note: cell.note,
                blocked: cell.blocked,
                dateLabel: copyTargetDate,
                staging: true,
              }),
            }).then(async (response) => {
              if (!response.ok) {
                const json = await response.json().catch(() => ({}));
                throw new Error(json.error || "Failed to copy schedule cell.");
              }
            })
          );
        });
      });

      await Promise.all(updates);
      setScheduleNote(`Copied schedule from ${copySourceDate} to ${copyTargetDate}.`);
      setSelectedDate(copyTargetDate);
      await refreshSchedule();
    } catch (err) {
      console.error("Copy schedule failed", err);
      setScheduleNote("Copy schedule failed. Please try again.");
    } finally {
      setCopyingSchedule(false);
    }
  };

  const autoGenerateSchedule = async () => {
    if (!scheduleData) return;
    if (scheduleMode === "page" && !selectedDate) {
      setScheduleNote("Pick a schedule date before auto-generating.");
      return;
    }

    setAutoGenerating(true);
    setScheduleNote(null);

    try {
      const slotLabelMap = new Map(
        scheduleData.slots.map((slot, index) => [slot.label.toLowerCase(), { slot, index }])
      );
      const slotIndexesById = new Map(
        scheduleData.slots.map((slot, index) => [slot.id, index])
      );

      const tasksToPlace = [...recurringTasks, ...oneOffTasks]
        .filter((task) => (task.status || "").toLowerCase() !== "completed")
        .sort((a, b) => {
          if (a.recurring !== b.recurring) return a.recurring ? -1 : 1;
          const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
          if (priorityDiff !== 0) return priorityDiff;
          return a.name.localeCompare(b.name);
        });

      const nextCells = scheduleData.cells.map((row) =>
        row.map((cell) => ({ tasks: [...cell.tasks], note: cell.note, blocked: cell.blocked }))
      );
      const changedCells = new Set<string>();

      const addTaskToCell = (rowIdx: number, colIdx: number, task: ScheduledTask) => {
        const cell = nextCells[rowIdx]?.[colIdx];
        if (!cell || cell.blocked) return;
        cell.tasks.push(task);
        changedCells.add(`${rowIdx}-${colIdx}`);
      };

      tasksToPlace.forEach((task) => {
        const peopleNeeded = task.personCount && task.personCount > 0 ? task.personCount : 1;
        const estimatedHours = parseEstimatedHours(task.estimatedTime);
        const shiftsPerPerson = Math.max(1, Math.ceil(estimatedHours / DEFAULT_SHIFT_HOURS));
        const totalAssignments = peopleNeeded * shiftsPerPerson;

        const alreadyAssigned = scheduleData.cells.reduce((count, row) => {
          return (
            count +
            row.reduce(
              (rowCount, cell) =>
                rowCount +
                cell.tasks.filter((assigned) => assigned.id === task.id).length,
              0
            )
          );
        }, 0);
        let remaining = Math.max(0, totalAssignments - alreadyAssigned);
        if (!remaining) return;

        const allowedSlotIndexes = (task.timeSlots || [])
          .map((slotLabel) => slotLabelMap.get(slotLabel.toLowerCase()))
          .filter(Boolean)
          .map((entry) => entry?.index as number);
        const slotIndexes =
          allowedSlotIndexes.length > 0
            ? Array.from(new Set(allowedSlotIndexes))
            : scheduleData.slots.map((_slot, index) => index);

        while (remaining > 0) {
          let best: AutoSlotChoice | null = null;
          scheduleData.people.forEach((_person, rowIdx) => {
            slotIndexes.forEach((colIdx) => {
              const cell = nextCells[rowIdx]?.[colIdx];
              if (!cell) return;
              const score = cell.tasks.length;
              if (!best || score < best.score) {
                best = { row: rowIdx, col: colIdx, score };
              }
            });
          });

          if (!best) break;
          const chosen = best as AutoSlotChoice;
          addTaskToCell(chosen.row, chosen.col, { id: task.id, name: task.name });
          remaining -= 1;
        }
      });

      setScheduleData({ ...scheduleData, cells: nextCells });

      await Promise.all(
        Array.from(changedCells).map(async (key) => {
          const [rowStr, colStr] = key.split("-");
          const rowIdx = Number(rowStr);
          const colIdx = Number(colStr);
          const person = scheduleData.people[rowIdx];
          const slot = scheduleData.slots[colIdx];
          if (!person || !slot) return;
          const cell = nextCells[rowIdx]?.[colIdx];
          if (!cell) return;
          await persistCell(person, slot.id, cell);
        })
      );

      setScheduleNote("Auto-generated schedule updates were applied. Review and publish when ready.");
    } catch (err) {
      console.error("Auto-generate failed", err);
      setScheduleNote("Auto-generate failed. Please try again.");
    } finally {
      setAutoGenerating(false);
    }
  };

  if (!authorized) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 text-center text-sm text-[#7a7f54]">
        {message || "Checking admin access…"}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col overflow-x-hidden bg-[#fdfbf4]">
      <div className="border-b border-[#e2d7b5] bg-[#f7f4e6] px-6 py-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">Admin schedule</p>
            <h1 className="text-2xl font-semibold text-[#314123]">{scheduleTitle}</h1>
            <p className="text-sm text-[#5f5a3b]">
              Staging schedule with auto-synced volunteers and background saves.
            </p>
            {selectedEntry && (
              <p className="mt-1 text-xs text-[#6a6c4d]">
                Live: {selectedEntry.liveId ? "ready" : "missing"} • Staging:{" "}
                {selectedEntry.stagingId ? "ready" : "missing"}
              </p>
            )}
            {scheduleNote && (
              <p className="mt-2 text-xs text-[#4b5133]">{scheduleNote}</p>
            )}
          </div>
          <div className="flex flex-col gap-3 text-xs text-[#6a6c4d]">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={refreshSchedule}
                className="rounded-md border border-[#d0c9a4] bg-white px-3 py-2 font-semibold uppercase tracking-[0.08em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8]"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={publishSchedule}
                disabled={!selectedDate || scheduleMode !== "page"}
                className="rounded-md bg-[#8fae4c] px-4 py-2 font-semibold uppercase tracking-[0.08em] text-[#f9f9ec] shadow-sm transition hover:bg-[#7e9c44] disabled:opacity-60"
              >
                Publish
              </button>
              <button
                type="button"
                onClick={autoGenerateSchedule}
                disabled={autoGenerating || !scheduleData}
                className="rounded-md border border-[#d0c9a4] bg-white px-4 py-2 font-semibold uppercase tracking-[0.08em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8] disabled:opacity-60"
              >
                {autoGenerating ? "Auto-generating…" : "Auto-generate"}
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setBlackoutMode((prev) => !prev)}
                className={`rounded-md border px-4 py-2 font-semibold uppercase tracking-[0.08em] shadow-sm transition ${
                  blackoutMode
                    ? "border-[#22311b] bg-[#2f3b21] text-[#f9f9ec] hover:bg-[#25301b]"
                    : "border-[#d0c9a4] bg-white text-[#314123] hover:bg-[#f1edd8]"
                }`}
              >
                {blackoutMode ? "Blackout mode: On" : "Blackout mode"}
              </button>
              <Link
                href="/hub/admin/tasks"
                className="rounded-md bg-[#6f8f3d] px-4 py-2 font-semibold uppercase tracking-[0.08em] text-white shadow-md transition hover:bg-[#5f7f35]"
              >
                Task editor
              </Link>
              <Link
                href="/hub/admin/shifts"
                className="rounded-md border border-[#d0c9a4] bg-white px-3 py-2 font-semibold uppercase tracking-[0.08em] text-[#4b5133] shadow-sm transition hover:bg-[#f1edd8]"
              >
                Shift editor
              </Link>
              <Link
                href="/hub/admin"
                className="rounded-md border border-[#d0c9a4] bg-[#f6f1dd] px-3 py-2 font-semibold uppercase tracking-[0.08em] text-[#4b5133] shadow-sm transition hover:bg-[#ede6c6]"
              >
                Back to admin
              </Link>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3 text-xs text-[#6a6c4d]">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[#7a7f54]">
              Schedule date
            </span>
            <input
              type="date"
              value={selectedDate ? formatLabelToInput(selectedDate) : ""}
              onChange={(e) => {
                const next = formatDateInput(e.target.value);
                setSelectedDate(next);
              }}
              disabled={scheduleMode !== "page"}
              className="rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-xs text-[#314123] focus:border-[#8fae4c] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[#7a7f54]">
              Recent schedule dates
            </span>
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              disabled={scheduleMode !== "page"}
              className="rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-xs text-[#314123] focus:border-[#8fae4c] focus:outline-none"
            >
              <option value="">Select a date</option>
              {scheduleOptions.map((entry) => (
                <option key={entry.dateLabel} value={entry.dateLabel}>
                  {entry.dateLabel}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-[#d0c9a4] bg-white/80 px-3 py-2">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.12em] text-[#7a7f54]">
                Copy from
              </span>
              <input
                type="date"
                value={copySourceDate ? formatLabelToInput(copySourceDate) : ""}
                onChange={(e) => setCopySourceDate(formatDateInput(e.target.value))}
                disabled={scheduleMode !== "page"}
                className="rounded-md border border-[#d0c9a4] bg-white px-2 py-1 text-xs text-[#314123]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.12em] text-[#7a7f54]">
                Copy to
              </span>
              <input
                type="date"
                value={copyTargetDate ? formatLabelToInput(copyTargetDate) : ""}
                onChange={(e) => setCopyTargetDate(formatDateInput(e.target.value))}
                disabled={scheduleMode !== "page"}
                className="rounded-md border border-[#d0c9a4] bg-white px-2 py-1 text-xs text-[#314123]"
              />
            </div>
            <button
              type="button"
              onClick={copySchedule}
              disabled={copyingSchedule || scheduleMode !== "page"}
              className="h-8 rounded-md bg-[#6f8f3d] px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white shadow-sm disabled:opacity-60"
            >
              {copyingSchedule ? "Copying…" : "Copy schedule"}
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-[#d0c9a4] bg-white/80 px-3 py-2">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.12em] text-[#7a7f54]">
                Blackout from
              </span>
              <input
                type="date"
                value={blackoutRangeStart}
                onChange={(e) => setBlackoutRangeStart(e.target.value)}
                className="rounded-md border border-[#d0c9a4] bg-white px-2 py-1 text-xs text-[#314123]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.12em] text-[#7a7f54]">
                Blackout to
              </span>
              <input
                type="date"
                value={blackoutRangeEnd}
                onChange={(e) => setBlackoutRangeEnd(e.target.value)}
                className="rounded-md border border-[#d0c9a4] bg-white px-2 py-1 text-xs text-[#314123]"
              />
            </div>
            <button
              type="button"
              onClick={applyBlackoutRange}
              disabled={blackoutApplying}
              className="h-8 rounded-md bg-[#2f3b21] px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white shadow-sm disabled:opacity-60"
            >
              {blackoutApplying ? "Applying…" : "Apply blackout range"}
            </button>
          </div>
          <span className="rounded-full bg-[#f0f4de] px-3 py-2 text-[11px] font-semibold text-[#4b5133]">
            Volunteers auto-sync from the Users database
          </span>
          {blackoutMode && (
            <span className="rounded-full bg-[#2f3b21] px-3 py-2 text-[11px] font-semibold text-white">
              Blackout mode active: click cells to block or unblock.
            </span>
          )}
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-[#e2d7b5] bg-[#f9f6e7] px-4 py-3 text-sm text-[#4b5133] shadow-sm">
          {message}
        </div>
      )}

      {(scheduleLoading || pendingCells.size > 0) && (
        <div className="rounded-xl border border-[#d0c9a4] bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#4b5133] shadow-sm">
          {scheduleLoading ? "Loading schedule data…" : "Saving updates… Please wait."}
        </div>
      )}

      <div
  className={`flex min-w-0 flex-1 flex-col gap-3 px-2 py-3 pb-24 lg:flex-row lg:pb-32 ${
    canvasExpanded ? "lg:min-h-[calc(100vh-10rem)]" : ""
  }`}
>
        <div
  className={`flex min-h-0 min-w-0 flex-col rounded-2xl border border-[#d0c9a4] p-2 shadow-md bg-white
    ${canvasExpanded ? "lg:flex-[5]" : "lg:flex-[4]"}
  `}
>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[#314123]">Schedule canvas</h2>
              <p className="text-xs text-[#6a6c4d]">Tap a cell to add tasks or notes.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#6a6c4d]">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#f6f1dd] px-3 py-1 font-semibold text-[#4b5133]">
                {scheduleData?.slots.length || 0} shifts
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#f0f4de] px-3 py-1 font-semibold text-[#4b5133]">
                {scheduleData?.people.length || 0} teammates
              </span>
              <button
                type="button"
                onClick={() => setCanvasExpanded((prev) => !prev)}
                className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#4b5133] shadow-sm"
              >
                {canvasExpanded ? "Exit expanded" : "Expand canvas"}
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#6a6c4d]">
            <span className="text-[11px] text-[#7a7f54]">
              {pendingCells.size ? "Saving updates…" : "All changes saved."}
            </span>
          </div>

          {scheduleLoading && (
            <p className="mt-2 text-xs text-[#7a7f54]">Loading schedule…</p>
          )}
          <div
            className={`relative mt-2 flex-1 overflow-auto rounded-xl border border-[#e2d7b5] bg-[#faf7eb] shadow-inner ${
              scheduleLoading ? "pointer-events-none opacity-80" : ""
            } ${canvasExpanded ? "min-h-[70vh] lg:min-h-[calc(100vh-18rem)]" : ""}`}
          >
            {scheduleLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 text-sm font-semibold text-[#4b5133]">
                Loading schedule…
              </div>
            )}
            <table className="w-full table-fixed border-collapse text-[9px] sm:text-[10px]">
              <thead className="bg-[#e5e7c5]">
                <tr>
                  <th className="w-[74px] sm:w-[96px] border border-[#d1d4aa] px-1 sm:px-1.5 py-1 text-left text-[8px] sm:text-[9px] font-semibold uppercase tracking-[0.14em] text-[#5d7f3b] sticky left-0 top-0 z-30 bg-[#e5e7c5]">
                    Person
                  </th>
                  {scheduleData?.slots.map((slot) => (
                    <th
  key={slot.id}
  className="w-[92px] sm:w-[110px] border border-[#d1d4aa] px-1 sm:px-1.5 py-1 text-left text-[8px] sm:text-[9px] font-semibold uppercase tracking-[0.12em] text-[#5d7f3b] sticky top-0 z-20 bg-[#e5e7c5]"
>
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div>{slot.label}</div>
                          {slot.timeRange && (
                            <div className="text-[9px] text-[#7a7f54] normal-case">{slot.timeRange}</div>
                          )}
                        </div>
                        {slot.isMeal && <span className="text-lg">🍽️</span>}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scheduleData?.people.map((person, rowIdx) => (
                    <tr key={person} className={rowIdx % 2 === 0 ? "bg-[#faf8ea]" : "bg-[#f4f2df]"}>
                    <td className="border border-[#d1d4aa] px-1.5 sm:px-2 py-1.5 align-top text-[10px] sm:text-[11px] font-semibold text-[#4f5730] sticky left-0 z-20 bg-[#f6f4e3]">
                      <div className="flex items-center justify-between gap-2">
                        <span>{person}</span>
                        <span className="text-[10px] text-[#7a7f54]">{rowIdx + 1}</span>
                      </div>
                    </td>
                    {scheduleData.slots.map((slot, colIdx) => {
                      const cell = scheduleData.cells?.[rowIdx]?.[colIdx] || { tasks: [], note: "" };
                      const content = cell;
                      const isSelected =
                        selectedCell?.person === person && selectedCell?.slotId === slot.id;
                      const saving = pendingCells.has(`${person}-${slot.id}`);
                      const cellExists = scheduleData.cellExists?.[rowIdx]?.[colIdx] ?? true;
                      const isBlocked = Boolean(content.blocked);

                      const dropLine = (index: number) => (
                        <div
                          key={`${person}-${slot.id}-drop-${index}`}
                          onDragOver={(e) => handleDragOverEvent(e, person, slot.id, index)}
                          onDragEnter={(e) => handleDragOverEvent(e, person, slot.id, index)}
                          onDragLeave={(e) => {
                            e.preventDefault();
                            if (pendingInsert?.person === person && pendingInsert.slotId === slot.id && pendingInsert.index === index) {
                              setPendingInsert(null);
                            }
                          }}
                          onDrop={(e) => {
                            e.stopPropagation();
                            handleDropEvent(e, person, slot, index);
                          }}
                          className={`h-2 rounded-full transition-all duration-150 ${
                            pendingInsert?.person === person && pendingInsert.slotId === slot.id && pendingInsert.index === index
                              ? "bg-[#c8d99a] shadow-[0_0_0_2px_rgba(200,217,154,0.6)]"
                              : "bg-transparent"
                          }`}
                        />
                      );

                      return (
                        <td
                          key={`${person}-${slot.id}`}
                          className={`border border-[#d1d4aa] min-h-[28px] p-0.5 align-top transition-colors duration-150 ${
  isSelected ? "bg-[#f0f4de]" : ""
} ${saving ? "animate-pulse" : ""} ${cellExists ? "" : "opacity-60"} ${
  isBlocked ? "bg-[#2f3b21]/10" : ""
}`}

                          onClick={() => selectCell(person, slot)}
                          onDragOver={(e) => {
                            if (isBlocked) return;
                            handleDragOverEvent(e, person, slot.id, content.tasks.length);
                          }}
                          onDragEnter={(e) => {
                            if (isBlocked) return;
                            handleDragOverEvent(e, person, slot.id, content.tasks.length);
                          }}
                          onDragLeave={(e) => {
                            e.preventDefault();
                            if (pendingInsert?.person === person && pendingInsert.slotId === slot.id) {
                              setPendingInsert(null);
                            }
                          }}
                          onDrop={(e) => {
                            if (isBlocked) return;
                            handleDropEvent(e, person, slot, content.tasks.length);
                            setPendingInsert(null);
                          }}
                        >
                          <div
                            className="flex h-full w-full flex-col gap-0.5"
                            onDragOver={(e) => {
                              if (isBlocked) return;
                              handleDragOverEvent(e, person, slot.id, content.tasks.length);
                            }}
                            onDragEnter={(e) => {
                              if (isBlocked) return;
                              handleDragOverEvent(e, person, slot.id, content.tasks.length);
                            }}
                            onDrop={(e) => {
                              if (isBlocked) return;
                              if (!cellExists) {
                                setSaveLog({
                                  status: "error",
                                  message: "This cell is still loading from Supabase.",
                                  lastAttempt: new Date().toLocaleTimeString(),
                                  payload: { person, slotId: slot.id },
                                });
                                return;
                              }
                              const targetIndex =
                                pendingInsert?.person === person && pendingInsert?.slotId === slot.id
                                  ? pendingInsert.index
                                  : content.tasks.length;
                              handleDropEvent(e, person, slot, targetIndex);
                              setPendingInsert(null);
                            }}
                          >
                            {!cellExists && (
                              <div className="rounded-md border border-dashed border-[#d0c9a4] bg-white/70 px-2 py-2 text-[11px] text-[#7a7f54]">
                                🔒 Cell not loaded yet. Please wait for the schedule to finish syncing.
                              </div>
                            )}
                            {isBlocked ? (
                              <div className="flex flex-1 flex-col items-center justify-center rounded-md border border-dashed border-[#2f3b21]/40 bg-[#2f3b21]/10 px-2 py-3 text-center text-[11px] text-[#2f3b21]">
                                <span className="text-base">🛑</span>
                                <span className="font-semibold uppercase tracking-[0.12em]">
                                  Blackout
                                </span>
                                <span className="text-[10px] text-[#4f5730]">
                                  No scheduling in this slot
                                </span>
                              </div>
                            ) : (
                              <>
                                {dropLine(0)}
                                {content.tasks.map((task, idx) => {
                                  const meta = taskMetaById.get(task.id);
                                  const isDraggingThis =
                                    draggingTask?.taskId === task.id &&
                                    draggingTask?.fromPerson === person &&
                                    draggingTask?.fromSlotId === slot.id;
                                  const assignedCount =
                                    taskPeopleCountById.byId.get(task.id) ??
                                    taskPeopleCountById.byName.get(task.name.trim().toLowerCase()) ??
                                    0;
                                  const neededCount = meta?.personCount ?? 0;
                                  const hasEnoughPeople =
                                    neededCount > 0 ? assignedCount >= neededCount : false;

                                  return (
                                    <React.Fragment key={`${person}-${slot.id}-${task.id}-${idx}`}>
                                      <div
                                        role="button"
                                        tabIndex={0}
                                        draggable
                                        onDragStart={(e) => {
                                          setDraggingTask({
                                            taskId: task.id,
                                            taskName: task.name,
                                            fromPerson: person,
                                            fromSlotId: slot.id,
                                            fromIndex: idx,
                                          });
                                          e.dataTransfer.setData("text/task-name", task.name);
                                          e.dataTransfer.setData("text/plain", task.name);
                                          e.dataTransfer.setData(DRAG_DATA_TYPE, JSON.stringify({
                                            taskId: task.id,
                                            taskName: task.name,
                                            fromPerson: person,
                                            fromSlotId: slot.id,
                                            fromIndex: idx,
                                          }));
                                          e.dataTransfer.effectAllowed = "move";
                                        }}
                                        onDragEnd={() => {
                                          setDraggingTask(null);
                                          setPendingInsert(null);
                                        }}
                                        onClick={() => {
                                          selectCell(person, slot);
                                          loadTaskDetail(task.id, task.name);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            selectCell(person, slot);
                                            loadTaskDetail(task.id, task.name);
                                          }
                                        }}
                                        className={`flex w-full flex-col gap-0.5 rounded-lg border px-2.5 py-0.5 text-left text-[10px] leading-tight shadow-sm transition duration-150 ease-out focus:outline-none focus:ring-2 focus:ring-[#8fae4c] sm:text-[11px] ${typeColorClasses(
                                          meta?.typeColor
                                        )} ${isDraggingThis ? "scale-[1.02] shadow-md ring-2 ring-[#c8d99a]" : "hover:-translate-y-[1px]"}`}
                                      >
                                        <span className="flex items-center gap-2">
                                          <button
                                            type="button"
                                            draggable={false}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              removeTaskFromCell({ person, slotId: slot.id }, task, idx);
                                            }}
                                            onMouseDown={(e) => {
                                              e.stopPropagation();
                                            }}
                                            className="rounded-full border border-[#d1d4aa] bg-white/80 px-1.5 py-[1px] text-[9px] font-semibold text-[#a05252] hover:bg-[#f7e3e3]"
                                          >
                                            ✕
                                          </button>
                                          <span className="text-[9px] sm:text-[10px] font-semibold text-[#2f3b21] leading-snug break-words whitespace-normal">
  {task.name}
</span>
                                        </span>
                                        <span className="flex items-center gap-2 text-[9px] text-[#4f4f31]">
                                          <span className="rounded-full bg-white/80 px-1.5 py-[1px] font-semibold">
                                            {assignedCount}/{neededCount}
                                          </span>
                                          {hasEnoughPeople && (
                                            <span
                                              className="text-[11px] text-emerald-600"
                                              title="Enough people assigned"
                                            >
                                              ✅
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                      {dropLine(idx + 1)}
                                    </React.Fragment>
                                  );
                                })}

                                {content.note && (
                                  <p className="text-[10px] text-[#4f4b33] opacity-90">{content.note}</p>
                                )}
                                {isSelected && cellExists && (
                                  <input
                                    list="task-options"
                                    value={customTask}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => setCustomTask(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        void handleCustomAdd();
                                      }
                                      if (e.key === "Escape") {
                                        setCustomTask("");
                                      }
                                    }}
                                    onBlur={() => {
                                      if (customTask.trim()) {
                                        void handleCustomAdd();
                                      }
                                    }}
                                    placeholder="Type task + Enter"
                                    className="w-full rounded-full border border-[#d0c9a4] bg-white px-2 py-1 text-[10px] text-[#3f4630] focus:border-[#8fae4c] focus:outline-none"
                                  />
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {!scheduleData?.people?.length && (
                  <tr>
                    <td
                      colSpan={(scheduleData?.slots?.length || 0) + 1}
                      className="px-3 py-4 text-center text-sm text-[#7a7f54]"
                    >
                      No schedule found. Try refreshing.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <datalist id="task-options">
            {taskNameOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {dayOverviewSummary && (
            <div className="mt-4 rounded-xl border border-[#d0c9a4] bg-white/90 p-4 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-base font-semibold text-[#314123]">Day overview</h3>
                  <p className="text-xs text-[#6a6c4d]">
                    Tasks issued for {scheduleData?.scheduleDate || "this day"} with status and notes.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-[#4b5133]">
                  <span className="rounded-full border border-[#d0c9a4] bg-[#f6f1dd] px-3 py-1 font-semibold">
                    {dayOverviewSummary.total} tasks
                  </span>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">
                    {dayOverviewSummary.completed} completed
                  </span>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-semibold text-amber-800">
                    {dayOverviewSummary.open} open
                  </span>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {dayOverviewSummary.tasks.length ? (
                  dayOverviewSummary.tasks.map((task) => (
                    <div
                      key={task.name}
                      className="rounded-lg border border-[#e2d7b5] bg-[#faf7eb] px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-[#314123]">{task.name}</div>
                        <span
                          className={`rounded-full border px-2 py-[2px] text-[10px] font-semibold uppercase ${statusBadgeClasses(
                            task.status
                          )}`}
                        >
                          {task.status || "Not Started"}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-[#6a6c4d]">
                        Assigned {task.assignments} time{task.assignments === 1 ? "" : "s"}.
                      </p>
                      {task.notes.size > 0 && (
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-[#4b5133]">
                          {Array.from(task.notes).map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-[#7a7f54]">No tasks listed for this day yet.</p>
                )}
              </div>
              {dayOverviewSummary.standaloneNotes.length > 0 && (
                <div className="mt-4 rounded-lg border border-dashed border-[#d0c9a4] bg-[#f9f6e7] px-3 py-2 text-[11px] text-[#4b5133]">
                  <p className="font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">
                    Notes without tasks
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {dayOverviewSummary.standaloneNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

       <div
  className={`order-first w-full shrink-0 space-y-4 overflow-y-visible lg:order-none lg:shrink-0 lg:sticky lg:top-4 lg:h-[calc(100vh-4rem)] lg:self-start lg:overflow-hidden ${
    canvasExpanded ? "lg:w-[240px]" : "lg:w-[280px]"
  }`}
>
          <div className="space-y-4 lg:flex lg:h-full lg:flex-col lg:overflow-y-auto lg:pr-1">
            <div className="hidden lg:flex items-center justify-between rounded-2xl border border-[#d0c9a4] bg-white/90 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#4b5133] shadow-sm">
              <span>Task dock</span>
              <button
                type="button"
                onClick={() => setDesktopDockOpen((prev) => !prev)}
                className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#4b5133]"
              >
                {desktopDockOpen ? "Collapse" : "Expand"}
              </button>
            </div>

            {desktopDockOpen ? (
              <div className="hidden lg:flex lg:flex-1 lg:flex-col lg:gap-4">
                <div className="rounded-2xl border border-[#d0c9a4] bg-white/90 shadow-lg backdrop-blur">
                  <div className="flex items-center justify-between gap-2 rounded-t-2xl bg-[#f0f4de] px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#4b5133]">
                    <span>Recurring task dock</span>
                    <div className="flex items-center gap-2">
                      <span className="rounded-md border border-[#d0c9a4] bg-white px-2 py-[2px] text-[10px] font-semibold text-[#4b5133]">
                        {selectedDate || "Pick a date"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setRecurringDockExpanded((prev) => !prev)}
                        className="rounded-md border border-[#d0c9a4] bg-white px-2 py-[2px] text-[10px] font-semibold text-[#4b5133]"
                      >
                        {recurringDockExpanded ? "Collapse list" : "Expand list"}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2 p-3 text-sm">
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                  placeholder="Search tasks"
                  className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                />
                <select
                  value={taskTypeFilter}
                  onChange={(e) => setTaskTypeFilter(e.target.value)}
                  className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                >
                  <option value="">All types</option>
                  {taskTypes.map((opt) => (
                    <option key={opt.name} value={opt.name}>
                      {opt.name}
                    </option>
                  ))}
                </select>
              </div>
              <select
                value={taskStatusFilter}
                onChange={(e) => setTaskStatusFilter(e.target.value)}
                className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
              >
                      <option value="">All statuses</option>
                      {statusOptions.map((opt) => (
                        <option key={opt.name} value={opt.name}>
                          {opt.name}
                        </option>
                      ))}
                    </select>
                    <div className="rounded-lg border border-[#e2d7b5] bg-white/80 p-2 text-[11px] text-[#4b5133]">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">
                        Recurring filters
                      </p>
                      <div className="mt-2 space-y-2">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={showAllRecurring}
                            onChange={(e) => setShowAllRecurring(e.target.checked)}
                            className="h-4 w-4 rounded border-[#b5bf90] text-[#5d7f3b] focus:ring-[#7a8c43]"
                          />
                          Show all recurring
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={hideCompletedRecurring}
                            onChange={(e) => setHideCompletedRecurring(e.target.checked)}
                            className="h-4 w-4 rounded border-[#b5bf90] text-[#5d7f3b] focus:ring-[#7a8c43]"
                          />
                          Hide completed
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={hideFullyScheduledRecurring}
                            onChange={(e) => setHideFullyScheduledRecurring(e.target.checked)}
                            className="h-4 w-4 rounded border-[#b5bf90] text-[#5d7f3b] focus:ring-[#7a8c43]"
                          />
                          Hide fully scheduled
                        </label>
                      </div>
                    </div>

                    <div className="rounded-lg border border-dashed border-[#d0c9a4] bg-[#f9f6e7] p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">
                        Quick recurring task
                      </p>
                      <div className="mt-2 space-y-2">
                        <input
                          value={recurringQuickName}
                          onChange={(e) => setRecurringQuickName(e.target.value)}
                          className="w-full rounded-md border border-[#d0c9a4] px-2 py-1.5 text-xs focus:border-[#8fae4c] focus:outline-none"
                          placeholder="Task name"
                        />
                        <textarea
                          value={recurringQuickDescription}
                          onChange={(e) => setRecurringQuickDescription(e.target.value)}
                          className="w-full rounded-md border border-[#d0c9a4] px-2 py-1.5 text-xs focus:border-[#8fae4c] focus:outline-none"
                          placeholder="Task description"
                          rows={2}
                        />
                        <div className="grid gap-2 sm:grid-cols-2">
                          <input
                            type="number"
                            min={1}
                            value={recurringQuickInterval}
                            onChange={(e) =>
                              setRecurringQuickInterval(Number(e.target.value) || 1)
                            }
                            className="w-full rounded-md border border-[#d0c9a4] px-2 py-1.5 text-xs focus:border-[#8fae4c] focus:outline-none"
                            placeholder="Every"
                          />
                          <select
                            value={recurringQuickUnit}
                            onChange={(e) => setRecurringQuickUnit(e.target.value)}
                            className="w-full rounded-md border border-[#d0c9a4] px-2 py-1.5 text-xs focus:border-[#8fae4c] focus:outline-none"
                          >
                            <option value="day">Day</option>
                            <option value="month">Month</option>
                            <option value="year">Year</option>
                          </select>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            type="date"
                            value={recurringQuickUntil}
                            onChange={(e) => setRecurringQuickUntil(e.target.value)}
                            className="w-full rounded-md border border-[#d0c9a4] px-2 py-1.5 text-xs focus:border-[#8fae4c] focus:outline-none"
                            placeholder="Until date"
                          />
                          <button
                            type="button"
                            onClick={createRecurringQuickTask}
                            disabled={!recurringQuickName.trim()}
                            className="w-full rounded-md bg-[#6f8f3d] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white disabled:opacity-60"
                          >
                            Add recurring
                          </button>
                        </div>
                        <p className="text-[10px] text-[#6b6d4b]">
                          Defaults to a daily recurring task for 30 days if no end date is set.
                        </p>
                      </div>
                    </div>

                    <div
                      className={`space-y-2 pr-1 ${
                        recurringDockExpanded ? "max-h-none overflow-visible" : "max-h-48 overflow-y-auto"
                      }`}
                    >
                      {filteredRecurringTasks.map((task) => {
                        const taskHandled = isTaskHandled(task);
                        return (
                          <button
                            key={task.id}
                            draggable
                            onDragStart={(e) => {
                              setDraggingTask({ taskId: task.id, taskName: task.name });
                              e.dataTransfer.setData("text/task-name", task.name);
                              e.dataTransfer.setData("text/plain", task.name);
                              e.dataTransfer.setData(
                                DRAG_DATA_TYPE,
                                JSON.stringify({ taskId: task.id, taskName: task.name })
                              );
                              e.dataTransfer.effectAllowed = "copyMove";
                            }}
                            onDragEnd={() => {
                              setDraggingTask(null);
                              setPendingInsert(null);
                            }}
                            onClick={() => loadTaskDetail(task.id, task.name)}
                            className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-sm text-[#2f3b21] shadow-sm transition hover:-translate-y-[1px] hover:border-[#9fb668] ${typeColorClasses(
                              task.typeColor
                            )}`}
                          >
                            <div>
                              <div className="font-semibold">{task.name}</div>
                              <div className="text-[11px] text-[#5f5a3b]">
                                {task.type || "Uncategorized"}
                                {task.status ? ` • ${task.status}` : ""}
                                {task.priority ? ` • ${task.priority}` : ""}
                              </div>
                            </div>
                            {taskHandled.hasEnoughPeople && (
                              <span className="text-2xl text-emerald-600">✅</span>
                            )}
                          </button>
                        );
                      })}
                      {!filteredRecurringTasks.length && (
                        <p className="text-[12px] text-[#7a7f54]">
                          No recurring tasks for this date.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-[#d0c9a4] bg-white/90 shadow-lg backdrop-blur">
                  <div className="flex items-center justify-between rounded-t-2xl bg-[#f0f4de] px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#4b5133]">
                    <span>One-off task dock</span>
                    <button
                      type="button"
                      onClick={() => setOneOffDockExpanded((prev) => !prev)}
                      className="rounded-md border border-[#d0c9a4] bg-white px-2 py-[2px] text-[10px] font-semibold text-[#4b5133]"
                    >
                      {oneOffDockExpanded ? "Collapse list" : "Expand list"}
                    </button>
                  </div>
                  <div className="space-y-2 p-3 text-sm">
                    <div className="rounded-lg border border-[#e2d7b5] bg-white/80 p-2 text-[11px] text-[#4b5133]">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">
                        One-off filters
                      </p>
                      <div className="mt-2 space-y-2">
                        <select
                          value={taskStatusFilter}
                          onChange={(e) => setTaskStatusFilter(e.target.value)}
                          className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-xs focus:border-[#8fae4c] focus:outline-none"
                        >
                          <option value="">All statuses</option>
                          {statusOptions.map((opt) => (
                            <option key={opt.name} value={opt.name}>
                              {opt.name}
                            </option>
                          ))}
                        </select>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={showPastIncomplete}
                            onChange={(e) => setShowPastIncomplete(e.target.checked)}
                            className="h-4 w-4 rounded border-[#b5bf90] text-[#5d7f3b] focus:ring-[#7a8c43]"
                          />
                          Show past incomplete
                        </label>
                      </div>
                    </div>
                    <div className="rounded-lg border border-dashed border-[#d0c9a4] bg-[#f9f6e7] p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">
                        Quick one-off task
                      </p>
                      <p className="mt-1 text-[10px] text-[#6b6d4b]">
                        Adds a one-off task for {selectedDate || "the selected date"}.
                      </p>
                      <div className="mt-2 space-y-2">
                        <input
                          value={quickTaskName}
                          onChange={(e) => setQuickTaskName(e.target.value)}
                          className="w-full rounded-md border border-[#d0c9a4] px-2 py-1.5 text-xs focus:border-[#8fae4c] focus:outline-none"
                          placeholder="Task name"
                        />
                        <textarea
                          value={quickTaskDescription}
                          onChange={(e) => setQuickTaskDescription(e.target.value)}
                          className="w-full rounded-md border border-[#d0c9a4] px-2 py-1.5 text-xs focus:border-[#8fae4c] focus:outline-none"
                          placeholder="Task description"
                          rows={2}
                        />
                        <button
                          type="button"
                          onClick={createQuickTask}
                          disabled={!quickTaskName.trim() || !selectedDate}
                          className="w-full rounded-md bg-[#8fae4c] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white disabled:opacity-60"
                        >
                          Add one-off
                        </button>
                      </div>
                    </div>

                    <div
                      className={`space-y-2 pr-1 ${
                        oneOffDockExpanded ? "max-h-none overflow-visible" : "max-h-48 overflow-y-auto"
                      }`}
                    >
                      {filteredOneOffTasks.map((task) => {
                        const taskHandled = isTaskHandled(task);
                        return (
                          <button
                            key={task.id}
                            draggable
                            onDragStart={(e) => {
                              setDraggingTask({ taskId: task.id, taskName: task.name });
                              e.dataTransfer.setData("text/task-name", task.name);
                              e.dataTransfer.setData("text/plain", task.name);
                              e.dataTransfer.setData(
                                DRAG_DATA_TYPE,
                                JSON.stringify({ taskId: task.id, taskName: task.name })
                              );
                              e.dataTransfer.effectAllowed = "copyMove";
                            }}
                            onDragEnd={() => {
                              setDraggingTask(null);
                              setPendingInsert(null);
                            }}
                            onClick={() => loadTaskDetail(task.id, task.name)}
                            className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-sm text-[#2f3b21] shadow-sm transition hover:-translate-y-[1px] hover:border-[#9fb668] ${typeColorClasses(
                              task.typeColor
                            )}`}
                          >
                            <div>
                              <div className="font-semibold">{task.name}</div>
                              <div className="text-[11px] text-[#5f5a3b]">
                                {task.type || "Uncategorized"}
                                {task.occurrenceDate ? ` • Target ${task.occurrenceDate}` : ""}
                                {task.priority ? ` • ${task.priority}` : ""}
                              </div>
                            </div>
                            {taskHandled.hasEnoughPeople && (
                              <span className="text-2xl text-emerald-600">✅</span>
                            )}
                          </button>
                        );
                      })}
                      {!filteredOneOffTasks.length && (
                        <p className="text-[12px] text-[#7a7f54]">No one-off tasks loaded.</p>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            ) : (
              <button
                type="button"
                onClick={() => setDesktopDockOpen(true)}
                className="hidden w-full rounded-2xl border border-[#d0c9a4] bg-white/90 px-3 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#4b5133] shadow-sm lg:block"
              >
                Open task dock
              </button>
            )}

            {taskDetail && (
              <div className="rounded-2xl border border-[#d0c9a4] bg-white/90 p-3 shadow-md">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.12em] text-[#7a7f54]">
                      Task detail
                    </p>
                    <h3 className="text-base font-semibold text-[#314123]">{taskDetail.name}</h3>
                  </div>
                  {taskDetailLoading && (
                    <span className="text-[11px] text-[#6b6d4b]">Loading…</span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  {taskDetail.status && (
                    <span className="rounded-full bg-[#f6f1dd] px-3 py-1 font-semibold text-[#4b5133]">
                      {taskDetail.status}
                    </span>
                  )}
                  {taskDetail.priority && (
                    <span className="rounded-full bg-white/80 px-3 py-1 font-semibold text-[#4b5133]">
                      {taskDetail.priority} priority
                    </span>
                  )}
                  <span className="rounded-full bg-white/80 px-3 py-1 font-semibold text-[#4b5133]">
                    {taskDetail.recurring ? "Recurring" : "One-off"}
                  </span>
                  {taskDetail.taskType?.name && (
                    <span className="rounded-full bg-[#f6f1dd] px-3 py-1 font-semibold text-[#4b5133]">
                      {taskDetail.taskType.name}
                    </span>
                  )}
                </div>
                {(taskDetail.recurring || taskDetail.occurrenceDate) && (
                  <p className="mt-2 text-[11px] text-[#6b6d4b]">
                    {taskDetail.recurring
                      ? taskDetail.parentTaskId
                        ? "Recurring series • this occurrence"
                        : "Recurring series"
                      : "One-off task"}
                    {taskDetail.occurrenceDate ? ` • ${taskDetail.occurrenceDate}` : ""}
                  </p>
                )}
                {taskDetail.recurring && (
                  <p className="mt-2 text-[11px] text-[#6b6d4b]">
                    Tip: update just this occurrence to avoid changing the full series.
                  </p>
                )}

                <div className="mt-3 space-y-3 text-sm text-[#4b5133]">
                  <label className="space-y-1">
                    <span className="text-[12px] font-semibold text-[#5f5a3b]">Description</span>
                    <textarea
                      value={taskEditDraft.description}
                      onChange={(e) =>
                        setTaskEditDraft((prev) => ({ ...prev, description: e.target.value }))
                      }
                      className="min-h-[90px] w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[12px] font-semibold text-[#5f5a3b]">Extra notes</span>
                    <textarea
                      value={taskEditDraft.extraNotes}
                      onChange={(e) =>
                        setTaskEditDraft((prev) => ({ ...prev, extraNotes: e.target.value }))
                      }
                      className="min-h-[80px] w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                      placeholder="One note per line"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[12px] font-semibold text-[#5f5a3b]">People needed</span>
                    <input
                      type="number"
                      min={0}
                      value={taskEditDraft.personCount}
                      onChange={(e) =>
                        setTaskEditDraft((prev) => ({ ...prev, personCount: e.target.value }))
                      }
                      className="w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                    />
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={saveTaskEdits}
                    disabled={taskEditSaving}
                    className="rounded-md bg-[#8fae4c] px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#f9f9ec] shadow-sm transition hover:bg-[#7e9c44] disabled:opacity-60"
                  >
                    {taskEditSaving ? "Saving…" : "Save basic updates"}
                  </button>
                  {taskEditMessage && (
                    <span className="text-[12px] text-[#4b5133]">{taskEditMessage}</span>
                  )}
                  <Link
                    href={`/hub/admin/tasks?search=${encodeURIComponent(taskDetail.name)}`}
                    className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-[11px] font-semibold text-[#4b5133]"
                  >
                    Open in task editor
                  </Link>
                </div>

                <div className="mt-4 space-y-2 rounded-lg border border-dashed border-[#d0c9a4] bg-[#f9f6e7] p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">
                    Upload task photo (150kb max)
                  </p>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    className="w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handlePhotoUpload}
                    disabled={photoUploading}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-[#8fae4c] px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#f9f9ec] shadow-sm transition hover:bg-[#7e9c44] disabled:opacity-60"
                  >
                    {photoUploading ? "Uploading…" : "Upload photo"}
                  </button>
                  {photoMessage && (
                    <p className="text-[12px] text-[#4b5133]">{photoMessage}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="lg:hidden">
        {mobileDockOpen ? (
          <div className="fixed inset-x-0 bottom-0 z-40 rounded-t-3xl border border-[#d0c9a4] bg-white/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#e2d7b5] px-4 py-3">
              <div className="text-sm font-semibold uppercase tracking-[0.12em] text-[#4b5133]">
                Task dock
              </div>
              <button
                type="button"
                onClick={() => setMobileDockOpen(false)}
                className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-xs font-semibold uppercase text-[#4b5133]"
              >
                Close
              </button>
            </div>
            <div className="px-4 pt-3">
              <div className="grid gap-2">
                <input
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                  placeholder="Search tasks"
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    value={taskTypeFilter}
                    onChange={(e) => setTaskTypeFilter(e.target.value)}
                    className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                  >
                    <option value="">All types</option>
                    {taskTypes.map((opt) => (
                      <option key={opt.name} value={opt.name}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={taskStatusFilter}
                    onChange={(e) => setTaskStatusFilter(e.target.value)}
                    className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                  >
                    <option value="">All statuses</option>
                    {statusOptions.map((opt) => (
                      <option key={opt.name} value={opt.name}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-3 flex gap-2 rounded-full bg-[#f6f1dd] p-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#4b5133]">
                <button
                  type="button"
                  onClick={() => setMobileDockTab("recurring")}
                  className={`flex-1 rounded-full px-3 py-2 transition ${
                    mobileDockTab === "recurring" ? "bg-white shadow" : ""
                  }`}
                >
                  Recurring
                </button>
                <button
                  type="button"
                  onClick={() => setMobileDockTab("oneOff")}
                  className={`flex-1 rounded-full px-3 py-2 transition ${
                    mobileDockTab === "oneOff" ? "bg-white shadow" : ""
                  }`}
                >
                  One-off
                </button>
              </div>
            </div>
            <div className="max-h-[55vh] overflow-y-auto px-4 py-3 pb-6">
              {mobileDockTab === "recurring" && (
                <>
                  <div className="mb-3 rounded-lg border border-[#e2d7b5] bg-white/90 p-3 text-[11px] text-[#4b5133]">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">
                      Recurring filters
                    </p>
                    <div className="mt-2 space-y-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={showAllRecurring}
                          onChange={(e) => setShowAllRecurring(e.target.checked)}
                          className="h-4 w-4 rounded border-[#b5bf90] text-[#5d7f3b] focus:ring-[#7a8c43]"
                        />
                        Show all recurring
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={hideCompletedRecurring}
                          onChange={(e) => setHideCompletedRecurring(e.target.checked)}
                          className="h-4 w-4 rounded border-[#b5bf90] text-[#5d7f3b] focus:ring-[#7a8c43]"
                        />
                        Hide completed
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={hideFullyScheduledRecurring}
                          onChange={(e) => setHideFullyScheduledRecurring(e.target.checked)}
                          className="h-4 w-4 rounded border-[#b5bf90] text-[#5d7f3b] focus:ring-[#7a8c43]"
                        />
                        Hide fully scheduled
                      </label>
                    </div>
                  </div>
                  <div className="mb-3 rounded-lg border border-dashed border-[#d0c9a4] bg-[#f9f6e7] p-3 text-sm">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">
                      Quick recurring task
                    </p>
                    <div className="mt-2 space-y-2">
                      <input
                        value={recurringQuickName}
                        onChange={(e) => setRecurringQuickName(e.target.value)}
                        className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-xs focus:border-[#8fae4c] focus:outline-none"
                        placeholder="Task name"
                      />
                      <textarea
                        value={recurringQuickDescription}
                        onChange={(e) => setRecurringQuickDescription(e.target.value)}
                        className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-xs focus:border-[#8fae4c] focus:outline-none"
                        placeholder="Task description"
                        rows={2}
                      />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          type="number"
                          min={1}
                          value={recurringQuickInterval}
                          onChange={(e) =>
                            setRecurringQuickInterval(Number(e.target.value) || 1)
                          }
                          className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-xs focus:border-[#8fae4c] focus:outline-none"
                          placeholder="Every"
                        />
                        <select
                          value={recurringQuickUnit}
                          onChange={(e) => setRecurringQuickUnit(e.target.value)}
                          className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-xs focus:border-[#8fae4c] focus:outline-none"
                        >
                          <option value="day">Day</option>
                          <option value="month">Month</option>
                          <option value="year">Year</option>
                        </select>
                      </div>
                      <input
                        type="date"
                        value={recurringQuickUntil}
                        onChange={(e) => setRecurringQuickUntil(e.target.value)}
                        className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-xs focus:border-[#8fae4c] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={createRecurringQuickTask}
                        disabled={!recurringQuickName.trim()}
                        className="w-full rounded-md bg-[#6f8f3d] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white disabled:opacity-60"
                      >
                        Add recurring
                      </button>
                    </div>
                    <p className="mt-2 text-[10px] text-[#6b6d4b]">
                      Defaults to a daily recurring task for 30 days if no end date is set.
                    </p>
                  </div>
                </>
              )}
              {mobileDockTab === "oneOff" && (
                <>
                  <div className="mb-3 rounded-lg border border-[#e2d7b5] bg-white/90 p-3 text-[11px] text-[#4b5133]">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">
                      One-off filters
                    </p>
                    <div className="mt-2 space-y-2">
                      <select
                        value={taskStatusFilter}
                        onChange={(e) => setTaskStatusFilter(e.target.value)}
                        className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-xs focus:border-[#8fae4c] focus:outline-none"
                      >
                        <option value="">All statuses</option>
                        {statusOptions.map((opt) => (
                          <option key={opt.name} value={opt.name}>
                            {opt.name}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={showPastIncomplete}
                          onChange={(e) => setShowPastIncomplete(e.target.checked)}
                          className="h-4 w-4 rounded border-[#b5bf90] text-[#5d7f3b] focus:ring-[#7a8c43]"
                        />
                        Show past incomplete
                      </label>
                    </div>
                  </div>
                  <div className="mb-3 rounded-lg border border-dashed border-[#d0c9a4] bg-[#f9f6e7] p-3 text-sm">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">
                      Quick one-off task
                    </p>
                    <p className="mt-1 text-[10px] text-[#6b6d4b]">
                      Adds a one-off task for {selectedDate || "the selected date"}.
                    </p>
                    <div className="mt-2 space-y-2">
                      <input
                        value={quickTaskName}
                        onChange={(e) => setQuickTaskName(e.target.value)}
                        className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-xs focus:border-[#8fae4c] focus:outline-none"
                        placeholder="Task name"
                      />
                      <textarea
                        value={quickTaskDescription}
                        onChange={(e) => setQuickTaskDescription(e.target.value)}
                        className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-xs focus:border-[#8fae4c] focus:outline-none"
                        placeholder="Task description"
                        rows={2}
                      />
                      <button
                        type="button"
                        onClick={createQuickTask}
                        disabled={!quickTaskName.trim() || !selectedDate}
                        className="w-full rounded-md bg-[#8fae4c] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white disabled:opacity-60"
                      >
                        Add one-off
                      </button>
                    </div>
                  </div>
                </>
              )}
              {(mobileDockTab === "recurring" ? filteredRecurringTasks : filteredOneOffTasks).map(
                (task) => {
                  const taskHandled = isTaskHandled(task);
                  return (
                    <button
                      key={task.id}
                      draggable
                      onDragStart={(e) => {
                        setDraggingTask({ taskId: task.id, taskName: task.name });
                        e.dataTransfer.setData("text/task-name", task.name);
                        e.dataTransfer.setData("text/plain", task.name);
                        e.dataTransfer.setData(
                          DRAG_DATA_TYPE,
                          JSON.stringify({ taskId: task.id, taskName: task.name })
                        );
                        e.dataTransfer.effectAllowed = "copyMove";
                      }}
                      onDragEnd={() => {
                        setDraggingTask(null);
                        setPendingInsert(null);
                      }}
                      onClick={() => loadTaskDetail(task.id, task.name)}
                      className={`mb-2 flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-sm text-[#2f3b21] shadow-sm transition hover:-translate-y-[1px] hover:border-[#9fb668] ${typeColorClasses(
                        task.typeColor
                      )}`}
                    >
                      <div>
                        <div className="font-semibold">{task.name}</div>
                        <div className="text-[11px] text-[#5f5a3b]">
                          {task.type || "Uncategorized"}
                          {task.status ? ` • ${task.status}` : ""}
                          {task.priority ? ` • ${task.priority}` : ""}
                        </div>
                      </div>
                      {taskHandled.hasEnoughPeople && (
                        <span className="text-2xl text-emerald-600">✅</span>
                      )}
                    </button>
                  );
                }
              )}
              {mobileDockTab === "recurring" && !filteredRecurringTasks.length && (
                <p className="text-[12px] text-[#7a7f54]">No recurring tasks for this date.</p>
              )}
              {mobileDockTab === "oneOff" && !filteredOneOffTasks.length && (
                <p className="text-[12px] text-[#7a7f54]">No one-off tasks loaded.</p>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMobileDockOpen(true)}
            className="fixed inset-x-4 bottom-4 z-40 rounded-full bg-[#8fae4c] px-4 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-white shadow-lg"
          >
            Open task dock
          </button>
        )}
      </div>

    </div>
  );
}
