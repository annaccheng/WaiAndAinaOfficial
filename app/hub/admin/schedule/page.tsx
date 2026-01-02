"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadSession } from "@/lib/session";

type Slot = { id: string; label: string; timeRange?: string; isMeal?: boolean };
type ScheduleResponse = {
  people: string[];
  slots: Slot[];
  cells: string[][];
  scheduleDate?: string;
  message?: string;
};
type TaskCatalogItem = {
  id: string;
  name: string;
  type?: string;
  typeColor?: string;
  status?: string;
  occurrenceDate?: string | null;
  description?: string | null;
};
type TaskTypeOption = { name: string; color: string };
type StatusOption = { name: string; color: string };
type TaskPropertyField = {
  name: string;
  type: string;
  value: string | string[] | boolean | number | null;
  options?: { name: string; color?: string }[];
  readOnly?: boolean;
};
type TaskDetail = {
  name: string;
  description: string;
  taskType?: { name: string; color: string };
  properties?: TaskPropertyField[];
};
type DragPayload = {
  taskName: string;
  fromPerson?: string;
  fromSlotId?: string;
  fromIndex?: number;
};
type CellContent = { tasks: string[]; note: string };

const DRAG_DATA_TYPE = "application/json/task";

function parseCell(value: string): CellContent {
  if (!value?.trim()) return { tasks: [], note: "" };
  const [firstLine, ...rest] = value.split("\n");
  const note = rest.join("\n").trim();
  const tasks = firstLine
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return { tasks, note };
}

function serializeCell(content: CellContent): string {
  const line = content.tasks.join(", ").trim();
  const note = content.note.trim();
  const parts = [] as string[];
  if (line) parts.push(line);
  if (note) parts.push(note);
  return parts.join("\n");
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

function safeIndex(length: number, index?: number) {
  if (index === undefined || Number.isNaN(index)) return length;
  return Math.min(Math.max(index, 0), length);
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

async function compressImageFile(file: File, maxBytes = 500 * 1024) {
  if (file.size <= maxBytes) return file;
  const img = await loadImageElement(file);
  const scale = Math.min(1, Math.sqrt(maxBytes / file.size));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let quality = 0.9;
  let blob: Blob | null = null;
  while (quality > 0.2) {
    blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
    );
    if (blob && blob.size <= maxBytes) break;
    quality -= 0.1;
  }

  if (!blob) return file;
  if (blob.size > maxBytes) {
    // Last resort: accept the compressed blob even if slightly over the limit
    return new File([blob], `compressed-${file.name}`, { type: "image/jpeg" });
  }

  return new File([blob], `compressed-${file.name}`, { type: "image/jpeg" });
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
  const [selectedCell, setSelectedCell] = useState<{ person: string; slotId: string; slotLabel: string } | null>(null);
  const [customTask, setCustomTask] = useState("");
  const [quickTaskName, setQuickTaskName] = useState("");
  const [quickTaskDescription, setQuickTaskDescription] = useState("");
  const [inlineTaskDrafts, setInlineTaskDrafts] = useState<Record<string, string>>({});
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
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [taskEditFields, setTaskEditFields] = useState<TaskPropertyField[]>([]);
  const [taskDetailLoading, setTaskDetailLoading] = useState(false);
  const [taskEditSaving, setTaskEditSaving] = useState(false);
  const [taskEditMessage, setTaskEditMessage] = useState<string | null>(null);
  const [multiSelectDrafts, setMultiSelectDrafts] = useState<Record<string, string>>({});
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [shiftEditorOpen, setShiftEditorOpen] = useState(false);
  const [shifts, setShifts] = useState<Slot[]>([]);
  const [newShift, setNewShift] = useState({ label: "", timeRange: "" });
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const lastInlineAddRef = useRef<Record<string, string>>({});

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
        const [typeRes, scheduleListRes, shiftsRes] = await Promise.all([
          fetch("/api/task-types"),
          fetch("/api/schedule/list"),
          fetch("/api/shifts"),
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
          if (json.selectedDate) {
            setSelectedDate(json.selectedDate);
          } else if (Array.isArray(json.schedules) && json.schedules.length) {
            setSelectedDate(json.schedules[json.schedules.length - 1].dateLabel);
          } else {
            const today = new Date().toISOString().slice(0, 10);
            setSelectedDate(formatDateInput(today));
          }
        }
        if (shiftsRes.ok) {
          const json = await shiftsRes.json();
          setShifts(json.shifts || []);
        }
      } catch (err) {
        console.error("Failed to load schedule editor data", err);
        setMessage("Could not load schedule tools. Please refresh.");
      }
    };

    loadStatic();
  }, [authorized]);

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

  const filteredRecurringTasks = useMemo(() => {
    return recurringTasks.filter((task) => {
      const matchesSearch = task.name.toLowerCase().includes(taskSearch.toLowerCase());
      const matchesType = taskTypeFilter
        ? (task.type || "").toLowerCase() === taskTypeFilter.toLowerCase()
        : true;
      const matchesStatus = taskStatusFilter
        ? (task.status || "").toLowerCase() === taskStatusFilter.toLowerCase()
        : true;
      return matchesSearch && matchesType && matchesStatus;
    });
  }, [recurringTasks, taskSearch, taskStatusFilter, taskTypeFilter]);

  const filteredOneOffTasks = useMemo(() => {
    return oneOffTasks.filter((task) => {
      const matchesSearch = task.name.toLowerCase().includes(taskSearch.toLowerCase());
      const matchesType = taskTypeFilter
        ? (task.type || "").toLowerCase() === taskTypeFilter.toLowerCase()
        : true;
      return matchesSearch && matchesType;
    });
  }, [oneOffTasks, taskSearch, taskTypeFilter]);

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
            occurrenceDate: task.occurrence_date || null,
            description: task.description || null,
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
            occurrenceDate: task.occurrence_date || null,
            description: task.description || null,
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

  const findCoord = useCallback(
    (person: string | undefined, slotId: string | undefined, data: ScheduleResponse | null) => {
      if (!person || !slotId || !data) return null;
      const row = data.people.indexOf(person);
      const col = data.slots.findIndex((s) => s.id === slotId);
      if (row < 0 || col < 0) return null;
      return { row, col };
    },
    []
  );

  const persistCell = useCallback(async (person: string, slotId: string, content: CellContent) => {
    if (scheduleMode === "page" && !selectedDate) return;
    const key = `${person}-${slotId}`;
    setPendingCells((prev) => new Set(prev).add(key));
    try {
      const res = await fetch("/api/schedule/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person,
          slotId,
          replaceValue: serializeCell(content),
          dateLabel: scheduleMode === "page" ? selectedDate : undefined,
          staging: scheduleMode === "page",
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to save schedule update");
      }
    } catch (err) {
      console.error(err);
      const friendly = err instanceof Error ? err.message : "Unable to save this drop. Please retry.";
      setMessage(friendly);
    } finally {
      setPendingCells((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

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
          occurrenceDate: task.occurrence_date || null,
          description: task.description || null,
        }));
        setOneOffTasks(items);
      }
    } catch (err) {
      console.error("Failed to create quick task", err);
      setMessage("Unable to create quick task.");
    }
  }, [quickTaskDescription, quickTaskName, selectedDate]);

  const updateShiftOrder = useCallback(async (updated: Slot[]) => {
    setShifts(updated);
    try {
      await fetch("/api/shifts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shifts: updated }),
      });
    } catch (err) {
      console.error("Failed to update shifts", err);
    }
  }, []);

  const addShift = useCallback(async () => {
    if (!newShift.label.trim()) return;
    try {
      const res = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newShift.label.trim(),
          timeRange: newShift.timeRange.trim(),
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setShifts(json.shifts || []);
        setNewShift({ label: "", timeRange: "" });
      }
    } catch (err) {
      console.error("Failed to add shift", err);
    }
  }, [newShift.label, newShift.timeRange]);

  const handleTaskMove = useCallback(
    (payload: DragPayload, target: { person: string; slotId: string; slotLabel: string; targetIndex?: number }) => {
      if (!payload.taskName) return;
      const updates: { person: string; slotId: string; content: CellContent }[] = [];

      setScheduleData((prev) => {
        if (!prev) return prev;
        const nextCells = prev.cells.map((row) => [...row]);

        const targetCoord = findCoord(target.person, target.slotId, prev);
        if (!targetCoord) return prev;
        let targetContent = parseCell(nextCells[targetCoord.row][targetCoord.col]);

        let insertionIndex = safeIndex(targetContent.tasks.length, target.targetIndex);

        if (payload.fromPerson && payload.fromSlotId) {
          const sourceCoord = findCoord(payload.fromPerson, payload.fromSlotId, prev);
          if (sourceCoord) {
            const sourceContent = parseCell(nextCells[sourceCoord.row][sourceCoord.col]);
            const idx = payload.fromIndex ?? sourceContent.tasks.findIndex((t) => taskBaseName(t) === payload.taskName);
            if (idx > -1) {
              sourceContent.tasks.splice(idx, 1);
              if (sourceCoord.row === targetCoord.row && sourceCoord.col === targetCoord.col && insertionIndex > idx) {
                insertionIndex -= 1;
              }
              nextCells[sourceCoord.row][sourceCoord.col] = serializeCell(sourceContent);
              updates.push({ person: payload.fromPerson, slotId: payload.fromSlotId, content: sourceContent });
              if (sourceCoord.row === targetCoord.row && sourceCoord.col === targetCoord.col) {
                targetContent = sourceContent;
              }
            }
          }
        }

        targetContent.tasks.splice(insertionIndex, 0, payload.taskName);
        nextCells[targetCoord.row][targetCoord.col] = serializeCell(targetContent);
        updates.push({ person: target.person, slotId: target.slotId, content: targetContent });

        return { ...prev, cells: nextCells };
      });

      updates.forEach((u) => persistCell(u.person, u.slotId, u.content));
      setSelectedCell({ person: target.person, slotId: target.slotId, slotLabel: target.slotLabel });
      setPendingInsert(null);
      setDraggingTask(null);
    },
    [findCoord, persistCell]
  );

  const removeTaskFromCell = useCallback(
    (cell: { person: string; slotId: string }, task: string, index?: number) => {
      const updates: { person: string; slotId: string; content: CellContent }[] = [];

      setScheduleData((prev) => {
        if (!prev) return prev;
        const coord = findCoord(cell.person, cell.slotId, prev);
        if (!coord) return prev;
        const nextCells = prev.cells.map((row) => [...row]);
        const content = parseCell(nextCells[coord.row][coord.col]);
        const idx = index ?? content.tasks.findIndex((t) => taskBaseName(t) === taskBaseName(task));
        if (idx < 0) return prev;

        content.tasks.splice(idx, 1);
        nextCells[coord.row][coord.col] = serializeCell(content);
        updates.push({ person: cell.person, slotId: cell.slotId, content });

        return { ...prev, cells: nextCells };
      });

      updates.forEach((u) => persistCell(u.person, u.slotId, u.content));
    },
    [findCoord, persistCell]
  );

  const handleDropEvent = useCallback(
    (e: React.DragEvent, person: string, slot: Slot, targetIndex?: number) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const jsonPayload = e.dataTransfer.getData(DRAG_DATA_TYPE);
      const textPayload = e.dataTransfer.getData("text/task-name");
      let parsed: DragPayload = { taskName: textPayload };

      if (jsonPayload) {
        try {
          parsed = { ...parsed, ...JSON.parse(jsonPayload) };
        } catch (err) {
          console.error("Failed to parse drag payload", err);
        }
      }

      if (!parsed.taskName) return;
      handleTaskMove(parsed, { person, slotId: slot.id, slotLabel: slot.label, targetIndex });
      setPendingInsert(null);
    },
    [handleTaskMove]
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
    const value = scheduleData.cells?.[coord.row]?.[coord.col] || "";
    return { value, content: parseCell(value) };
  };

  const handleCustomAdd = () => {
    if (!customTask.trim() || !selectedCell) return;
    const existing = getCellValue(selectedCell)?.content.tasks.length || 0;
    handleTaskMove(
      { taskName: customTask.trim() },
      { ...selectedCell, targetIndex: existing }
    );
    setCustomTask("");
  };

  const loadTaskDetail = async (taskName: string) => {
    const base = taskBaseName(taskName);
    if (!base) return;
    setTaskDetailLoading(true);
    setTaskEditMessage(null);
    try {
      const res = await fetch(`/api/task?name=${encodeURIComponent(base)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load task details");
      const detail = {
        name: json.name || base,
        description: json.description || "",
        taskType: json.taskType,
        properties: json.properties || [],
      };
      setTaskDetail(detail);
      setTaskEditFields(detail.properties || []);
    } catch (err) {
      console.error(err);
      const friendly = err instanceof Error ? err.message : "Unable to load that task right now.";
      setMessage(friendly);
      setTaskDetail(null);
      setTaskEditFields([]);
    } finally {
      setTaskDetailLoading(false);
    }
  };

  const updateTaskField = (name: string, value: TaskPropertyField["value"]) => {
    setTaskEditFields((prev) =>
      prev.map((field) => (field.name === name ? { ...field, value } : field))
    );
  };

  const toggleMultiSelect = (field: TaskPropertyField, option: string) => {
    const current = Array.isArray(field.value) ? field.value : [];
    const next = current.includes(option)
      ? current.filter((val) => val !== option)
      : [...current, option];
    updateTaskField(field.name, next);
  };

  const addMultiSelectCustom = (field: TaskPropertyField, option: string) => {
    const trimmed = option.trim();
    if (!trimmed) return;
    const current = Array.isArray(field.value) ? field.value : [];
    if (!current.includes(trimmed)) {
      updateTaskField(field.name, [...current, trimmed]);
    }
  };

  const saveTaskEdits = async () => {
    if (!taskDetail?.name) return;
    setTaskEditSaving(true);
    setTaskEditMessage(null);
    try {
      const res = await fetch("/api/task", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: taskDetail.name,
          properties: taskEditFields,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update task");
      setTaskDetail({
        name: json.name || taskDetail.name,
        description: json.description || "",
        taskType: json.taskType,
        properties: json.properties || [],
      });
      setTaskEditFields(json.properties || []);
      setTaskEditMessage("Task updated.");
    } catch (err) {
      console.error(err);
      const friendly = err instanceof Error ? err.message : "Failed to update task";
      setTaskEditMessage(friendly);
    } finally {
      setTaskEditSaving(false);
    }
  };

  const addInlineTask = (person: string, slot: Slot, taskName: string, existingCount: number) => {
    const trimmed = taskName.trim();
    if (!trimmed) return;
    const key = `${person}-${slot.id}`;
    if (lastInlineAddRef.current[key] === trimmed) {
      return;
    }
    lastInlineAddRef.current[key] = trimmed;
    window.setTimeout(() => {
      if (lastInlineAddRef.current[key] === trimmed) {
        delete lastInlineAddRef.current[key];
      }
    }, 300);
    handleTaskMove(
      { taskName: trimmed },
      { person, slotId: slot.id, slotLabel: slot.label, targetIndex: existingCount }
    );
    setInlineTaskDrafts((prev) => ({ ...prev, [`${person}-${slot.id}`]: "" }));
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

  const handlePhotoUpload = async () => {
    if (!taskDetail?.name) {
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
      const form = new FormData();
      form.append("taskName", taskDetail.name);
      form.append("file", compressed);

      const res = await fetch("/api/task/photos", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");

      setPhotoMessage("Photo uploaded.");
      if (photoInputRef.current) {
        photoInputRef.current.value = "";
      }
      await loadTaskDetail(taskDetail.name);
    } catch (err) {
      console.error(err);
      const friendly = err instanceof Error ? err.message : "Upload failed";
      setPhotoMessage(friendly);
    } finally {
      setPhotoUploading(false);
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
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#fdfbf4]">
      <div className="border-b border-[#e2d7b5] bg-[#f7f4e6] px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
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
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#6a6c4d]">
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
            <Link
              href="/hub/admin"
              className="rounded-md border border-[#d0c9a4] bg-[#f6f1dd] px-3 py-2 font-semibold uppercase tracking-[0.08em] text-[#4b5133] shadow-sm transition hover:bg-[#ede6c6]"
            >
              Back to admin
            </Link>
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
          <span className="rounded-full bg-[#f0f4de] px-3 py-2 text-[11px] font-semibold text-[#4b5133]">
            Volunteers auto-sync from the Users database
          </span>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-[#e2d7b5] bg-[#f9f6e7] px-4 py-3 text-sm text-[#4b5133] shadow-sm">
          {message}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-4 px-4 py-4">
        <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[#d0c9a4] bg-white/70 p-4 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[#314123]">Schedule canvas</h2>
              <p className="text-xs text-[#6a6c4d]">Drag from anywhere, drop anywhere. Saving happens in the background.</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#6a6c4d]">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#f6f1dd] px-3 py-1 font-semibold text-[#4b5133]">
                {scheduleData?.slots.length || 0} shifts
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#f0f4de] px-3 py-1 font-semibold text-[#4b5133]">
                {scheduleData?.people.length || 0} teammates
              </span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#6a6c4d]">
            <span className="rounded-full bg-[#f6f1dd] px-3 py-1 font-semibold text-[#4b5133]">
              Volunteers auto-populate this grid.
            </span>
            <span className="text-[11px] text-[#7a7f54]">
              {pendingCells.size ? "Saving updates…" : "All changes saved."}
            </span>
          </div>

          {scheduleLoading && (
            <p className="mt-2 text-xs text-[#7a7f54]">Loading schedule…</p>
          )}
          <div className="mt-3 flex-1 overflow-auto rounded-xl border border-[#e2d7b5] bg-[#faf7eb] shadow-inner">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-[#e5e7c5]">
                <tr>
                  <th className="min-w-[160px] border border-[#d1d4aa] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[#5d7f3b] sticky left-0 top-0 z-30 bg-[#e5e7c5]">
                    Person
                  </th>
                  {scheduleData?.slots.map((slot) => (
                    <th
                      key={slot.id}
                      className="border border-[#d1d4aa] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[#5d7f3b] sticky top-0 z-20 bg-[#e5e7c5]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div>{slot.label}</div>
                          {slot.timeRange && (
                            <div className="text-[10px] text-[#7a7f54] normal-case">{slot.timeRange}</div>
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
                    <td className="border border-[#d1d4aa] px-3 py-2 align-top text-sm font-semibold text-[#4f5730] sticky left-0 z-20 bg-[#f6f4e3]">
                      <div className="flex items-center justify-between gap-2">
                        <span>{person}</span>
                        <span className="text-[10px] text-[#7a7f54]">{rowIdx + 1}</span>
                      </div>
                    </td>
                    {scheduleData.slots.map((slot, colIdx) => {
                      const cell = scheduleData.cells?.[rowIdx]?.[colIdx] || "";
                      const content = parseCell(cell);
                      const isSelected =
                        selectedCell?.person === person && selectedCell?.slotId === slot.id;
                      const saving = pendingCells.has(`${person}-${slot.id}`);

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
                          className={`border border-[#d1d4aa] p-2 align-top transition-colors duration-150 ${
                            isSelected ? "bg-[#f0f4de]" : ""
                          } ${saving ? "animate-pulse" : ""}`}
                          onClick={() => setSelectedCell({ person, slotId: slot.id, slotLabel: slot.label })}
                          onDragOver={(e) => handleDragOverEvent(e, person, slot.id, content.tasks.length)}
                          onDragEnter={(e) => handleDragOverEvent(e, person, slot.id, content.tasks.length)}
                          onDragLeave={(e) => {
                            e.preventDefault();
                            if (pendingInsert?.person === person && pendingInsert.slotId === slot.id) {
                              setPendingInsert(null);
                            }
                          }}
                        >
                          <div
                            className="flex h-full w-full flex-col gap-2"
                            onDragOver={(e) => handleDragOverEvent(e, person, slot.id, content.tasks.length)}
                            onDragEnter={(e) => handleDragOverEvent(e, person, slot.id, content.tasks.length)}
                            onDrop={(e) => {
                              const targetIndex =
                                pendingInsert?.person === person && pendingInsert?.slotId === slot.id
                                  ? pendingInsert.index
                                  : content.tasks.length;
                              handleDropEvent(e, person, slot, targetIndex);
                              setPendingInsert(null);
                            }}
                          >
                            {dropLine(0)}
                            {content.tasks.map((task, idx) => {
                              const base = taskBaseName(task);
                              const meta = recurringTasks.find((t) => t.name === base);
                              const isDraggingThis =
                                draggingTask?.taskName === base &&
                                draggingTask?.fromPerson === person &&
                                draggingTask?.fromSlotId === slot.id;

                              return (
                                <React.Fragment key={`${person}-${slot.id}-${task}-${idx}`}>
                                  <button
                                    type="button"
                                    draggable
                                    onDragStart={(e) => {
                                      setDraggingTask({ taskName: base, fromPerson: person, fromSlotId: slot.id, fromIndex: idx });
                                      e.dataTransfer.setData("text/task-name", base);
                                      e.dataTransfer.setData("text/plain", base);
                                      e.dataTransfer.setData(DRAG_DATA_TYPE, JSON.stringify({
                                        taskName: base,
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
                                      setSelectedCell({ person, slotId: slot.id, slotLabel: slot.label });
                                      loadTaskDetail(base);
                                    }}
                                    className={`flex w-full flex-col gap-2 rounded-lg border p-2 text-left text-[11px] leading-snug shadow-sm transition duration-150 ease-out focus:outline-none focus:ring-2 focus:ring-[#8fae4c] ${typeColorClasses(
                                      meta?.typeColor
                                    )} ${isDraggingThis ? "scale-[1.02] shadow-md ring-2 ring-[#c8d99a]" : "hover:-translate-y-[1px]"}`}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <span className="font-semibold">{base}</span>
                                      <div className="flex items-center gap-2">
                                        {meta?.status && (
                                          <span className="rounded-full bg-white/80 px-2 py-[1px] text-[9px] font-semibold text-[#4f4f31]">
                                            {meta.status}
                                          </span>
                                        )}
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            removeTaskFromCell({ person, slotId: slot.id }, task, idx);
                                          }}
                                          className="rounded-full border border-[#d1d4aa] bg-white/80 px-2 py-[1px] text-[10px] font-semibold text-[#a05252] hover:bg-[#f7e3e3]"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    </div>
                                    {content.note && (
                                      <p className="text-[11px] text-[#4f4b33] opacity-90">{content.note}</p>
                                    )}
                                  </button>
                                  {dropLine(idx + 1)}
                                </React.Fragment>
                              );
                            })}

                            {!content.tasks.length && (
                              <div
                                onDragOver={(e) => handleDragOverEvent(e, person, slot.id, 0)}
                                onDragEnter={(e) => handleDragOverEvent(e, person, slot.id, 0)}
                                onDrop={(e) => handleDropEvent(e, person, slot, 0)}
                                className="flex flex-col gap-2 rounded-md border border-dashed border-[#d0c9a4] bg-white/60 p-2 text-[11px] text-[#7a7f54]"
                              >
                                <span className="text-[11px] italic text-[#7a7f54]">
                                  Drop tasks here or type below.
                                </span>
                              </div>
                            )}
                            <div className="rounded-md border border-[#d0c9a4] bg-white/80 p-2">
                              <label className="text-[10px] uppercase tracking-[0.12em] text-[#7a7f54]">
                                Add task
                              </label>
                              <input
                                list="task-options"
                                value={inlineTaskDrafts[`${person}-${slot.id}`] || ""}
                                onFocus={() => setSelectedCell({ person, slotId: slot.id, slotLabel: slot.label })}
                                onChange={(e) =>
                                  setInlineTaskDrafts((prev) => ({
                                    ...prev,
                                    [`${person}-${slot.id}`]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    addInlineTask(person, slot, inlineTaskDrafts[`${person}-${slot.id}`] || "", content.tasks.length);
                                  }
                                }}
                                onBlur={() =>
                                  addInlineTask(
                                    person,
                                    slot,
                                    inlineTaskDrafts[`${person}-${slot.id}`] || "",
                                    content.tasks.length
                                  )
                                }
                                placeholder="Type or choose a task"
                                className="mt-1 w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-1 text-[12px] text-[#3f4630] focus:border-[#8fae4c] focus:outline-none"
                              />
                            </div>
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
            {recurringTasks.map((task) => (
              <option key={task.id} value={task.name} />
            ))}
          </datalist>
        </div>

        <div className="relative w-[420px] shrink-0 space-y-4 overflow-y-auto">
          <div
            className="z-20 w-full rounded-2xl border border-[#d0c9a4] bg-white/90 shadow-lg backdrop-blur"
          >
            <div className="flex items-center justify-between gap-2 rounded-t-2xl bg-[#f0f4de] px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#4b5133]">
              <span>Recurring task dock</span>
              <span className="rounded-md border border-[#d0c9a4] bg-white px-2 py-[2px] text-[10px] font-semibold text-[#4b5133]">
                {selectedDate || "Pick a date"}
              </span>
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

              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {filteredRecurringTasks.map((task) => (
                  <button
                    key={task.id}
                    draggable
                    onDragStart={(e) => {
                      setDraggingTask({ taskName: task.name });
                      e.dataTransfer.setData("text/task-name", task.name);
                      e.dataTransfer.setData("text/plain", task.name);
                      e.dataTransfer.setData(DRAG_DATA_TYPE, JSON.stringify({ taskName: task.name }));
                      e.dataTransfer.effectAllowed = "copyMove";
                    }}
                    onDragEnd={() => {
                      setDraggingTask(null);
                      setPendingInsert(null);
                    }}
                    onClick={() => loadTaskDetail(task.name)}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm text-[#2f3b21] shadow-sm transition hover:-translate-y-[1px] hover:border-[#9fb668] ${typeColorClasses(
                      task.typeColor
                    )}`}
                  >
                    <div>
                      <div className="font-semibold">{task.name}</div>
                      <div className="text-[11px] text-[#5f5a3b]">
                        {task.type || "Uncategorized"}
                        {task.status ? ` • ${task.status}` : ""}
                      </div>
                    </div>
                    <span className="text-lg">🐐</span>
                  </button>
                ))}
                {!filteredRecurringTasks.length && (
                  <p className="text-[12px] text-[#7a7f54]">
                    No recurring tasks for this date.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#d0c9a4] bg-white/90 shadow-lg backdrop-blur">
            <div className="rounded-t-2xl bg-[#f0f4de] px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#4b5133]">
              One-off task dock
            </div>
            <div className="space-y-2 p-3 text-sm">
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {filteredOneOffTasks.map((task) => (
                  <button
                    key={task.id}
                    draggable
                    onDragStart={(e) => {
                      setDraggingTask({ taskName: task.name });
                      e.dataTransfer.setData("text/task-name", task.name);
                      e.dataTransfer.setData("text/plain", task.name);
                      e.dataTransfer.setData(DRAG_DATA_TYPE, JSON.stringify({ taskName: task.name }));
                      e.dataTransfer.effectAllowed = "copyMove";
                    }}
                    onDragEnd={() => {
                      setDraggingTask(null);
                      setPendingInsert(null);
                    }}
                    onClick={() => loadTaskDetail(task.name)}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm text-[#2f3b21] shadow-sm transition hover:-translate-y-[1px] hover:border-[#9fb668] ${typeColorClasses(
                      task.typeColor
                    )}`}
                  >
                    <div>
                      <div className="font-semibold">{task.name}</div>
                      <div className="text-[11px] text-[#5f5a3b]">
                        {task.type || "Uncategorized"}
                        {task.occurrenceDate ? ` • ${task.occurrenceDate}` : ""}
                      </div>
                    </div>
                    <span className="text-lg">🌿</span>
                  </button>
                ))}
                {!filteredOneOffTasks.length && (
                  <p className="text-[12px] text-[#7a7f54]">No one-off tasks loaded.</p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-[#314123]">Quick task</h3>
            <p className="mt-1 text-[12px] text-[#6b6d4b]">
              Adds a one-off task for {selectedDate || "the selected date"}.
            </p>
            <div className="mt-2 space-y-2">
              <input
                value={quickTaskName}
                onChange={(e) => setQuickTaskName(e.target.value)}
                className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-sm"
                placeholder="Task name"
              />
              <textarea
                value={quickTaskDescription}
                onChange={(e) => setQuickTaskDescription(e.target.value)}
                className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-sm"
                placeholder="Task description"
                rows={3}
              />
              <button
                type="button"
                onClick={createQuickTask}
                className="w-full rounded-md bg-[#8fae4c] px-3 py-2 text-xs font-semibold uppercase text-white"
              >
                Add quick task
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-[#314123]">Selected slot</h3>
            {selectedCell ? (
              <div className="mt-2 space-y-2 text-sm text-[#4b5133]">
                <p className="text-[12px] text-[#6b6d4b]">
                  {selectedCell.person} • {selectedCell.slotLabel}
                </p>
                <div className="space-y-1">
                  {getCellValue(selectedCell)?.content.tasks.map((task, idx) => (
                    <div
                      key={`${task}-${idx}`}
                      className="flex items-center justify-between rounded-md border border-[#e2d7b5] bg-[#f6f1dd] px-2 py-1"
                    >
                      <button
                        type="button"
                        onClick={() => loadTaskDetail(task)}
                        className="text-[12px] font-semibold text-[#2f3b21] underline-offset-2 hover:underline"
                      >
                        {task}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeTaskFromCell(selectedCell, task, idx)}
                        className="text-[11px] font-semibold text-[#a05252] hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {!getCellValue(selectedCell)?.content.tasks.length && (
                    <p className="text-[12px] text-[#7a7f54]">No tasks yet. Drag one in or add below.</p>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-[12px] text-[#5f5a3b]">Add a custom task</label>
                  <div className="flex items-center gap-2">
                    <input
                      value={customTask}
                      onChange={(e) => setCustomTask(e.target.value)}
                      className="flex-1 rounded-md border border-[#d0c9a4] px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                      placeholder="e.g., Cow Milking"
                    />
                    <button
                      type="button"
                      onClick={handleCustomAdd}
                      className="rounded-md bg-[#8fae4c] px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#f9f9ec] shadow-sm transition hover:bg-[#7e9c44]"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[12px] text-[#7a7f54]">Select a cell to edit tasks.</p>
            )}
          </div>

          <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#314123]">Shift editor</h3>
              <button
                type="button"
                onClick={() => setShiftEditorOpen((prev) => !prev)}
                className="rounded-md border border-[#d0c9a4] bg-white px-2 py-1 text-[10px] font-semibold uppercase text-[#4f5730]"
              >
                {shiftEditorOpen ? "Collapse" : "Expand"}
              </button>
            </div>
            {shiftEditorOpen && (
              <div className="mt-3 space-y-2 text-sm">
                {shifts.map((shift, index) => (
                  <div
                    key={shift.id}
                    className="flex items-center justify-between rounded-md border border-[#e2d7b5] bg-white/90 px-2 py-2"
                  >
                    <div>
                      <div className="text-sm font-semibold text-[#314123]">{shift.label}</div>
                      {shift.timeRange && (
                        <div className="text-[11px] text-[#6b6d4b]">{shift.timeRange}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (index === 0) return;
                          const updated = [...shifts];
                          [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
                          updateShiftOrder(updated);
                        }}
                        className="rounded-md border border-[#d0c9a4] px-2 py-1 text-[10px] font-semibold uppercase text-[#4f5730]"
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (index === shifts.length - 1) return;
                          const updated = [...shifts];
                          [updated[index + 1], updated[index]] = [updated[index], updated[index + 1]];
                          updateShiftOrder(updated);
                        }}
                        className="rounded-md border border-[#d0c9a4] px-2 py-1 text-[10px] font-semibold uppercase text-[#4f5730]"
                      >
                        Down
                      </button>
                    </div>
                  </div>
                ))}
                {!shifts.length && (
                  <p className="text-[12px] text-[#7a7f54]">No shifts loaded.</p>
                )}
                <div className="mt-3 space-y-2">
                  <input
                    value={newShift.label}
                    onChange={(e) => setNewShift((prev) => ({ ...prev, label: e.target.value }))}
                    className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-sm"
                    placeholder="Shift name"
                  />
                  <input
                    value={newShift.timeRange}
                    onChange={(e) =>
                      setNewShift((prev) => ({ ...prev, timeRange: e.target.value }))
                    }
                    className="w-full rounded-md border border-[#d0c9a4] px-2 py-2 text-sm"
                    placeholder="Time range (optional)"
                  />
                  <button
                    type="button"
                    onClick={addShift}
                    className="w-full rounded-md bg-[#8fae4c] px-3 py-2 text-xs font-semibold uppercase text-white"
                  >
                    Add shift
                  </button>
                </div>
              </div>
            )}
          </div>

          {taskDetail && (
            <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.12em] text-[#7a7f54]">Task detail</p>
                  <h3 className="text-base font-semibold text-[#314123]">{taskDetail.name}</h3>
                </div>
                {taskDetailLoading && (
                  <span className="text-[11px] text-[#6b6d4b]">Loading…</span>
                )}
              </div>
              <p className="mt-2 whitespace-pre-line text-sm text-[#4b5133]">{taskDetail.description || "No description yet."}</p>
              {taskDetail.taskType?.name && (
                <span className="mt-2 inline-block rounded-full bg-[#f6f1dd] px-3 py-1 text-[11px] font-semibold text-[#4b5133]">
                  {taskDetail.taskType.name}
                </span>
              )}
              <div className="mt-3 space-y-2 rounded-lg border border-dashed border-[#d0c9a4] bg-[#f9f6e7] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">Attach photo (500kb max)</p>
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
                  {photoUploading ? (
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                      Uploading…
                    </span>
                  ) : (
                    "Upload photo"
                  )}
                </button>
                {photoMessage && (
                  <p className="text-[12px] text-[#4b5133]">{photoMessage}</p>
                )}
              </div>
            </div>
          )}

          {taskDetail && (
            <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.12em] text-[#7a7f54]">Task editor</p>
                  <h3 className="text-base font-semibold text-[#314123]">Edit task properties</h3>
                </div>
                {taskEditSaving && <span className="text-[11px] text-[#6b6d4b]">Saving…</span>}
              </div>

              <div className="mt-3 space-y-3">
                {taskEditFields.map((field) => {
                  const value = field.value;
                  const isReadOnly = field.readOnly;

                  if (field.type === "checkbox") {
                    return (
                      <label
                        key={field.name}
                        className="flex items-center justify-between rounded-md border border-[#e2d7b5] bg-[#f6f1dd] px-3 py-2 text-sm text-[#4b5133]"
                      >
                        <span className="font-semibold">{field.name}</span>
                        <input
                          type="checkbox"
                          checked={Boolean(value)}
                          disabled={isReadOnly}
                          onChange={(e) => updateTaskField(field.name, e.target.checked)}
                          className="h-4 w-4 accent-[#8fae4c]"
                        />
                      </label>
                    );
                  }

                  if (field.type === "select" || field.type === "status") {
                    return (
                      <label key={field.name} className="space-y-1 text-sm text-[#4b5133]">
                        <span className="text-[12px] font-semibold text-[#5f5a3b]">{field.name}</span>
                        <select
                          value={String(value || "")}
                          disabled={isReadOnly}
                          onChange={(e) => updateTaskField(field.name, e.target.value)}
                          className="w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none disabled:opacity-60"
                        >
                          <option value="">None</option>
                          {field.options?.map((opt) => (
                            <option key={opt.name} value={opt.name}>
                              {opt.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  }

                  if (field.type === "multi_select") {
                    const selected = Array.isArray(value) ? value : [];
                    const options = field.options || [];
                    const customValue = multiSelectDrafts[field.name] || "";

                    return (
                      <div key={field.name} className="space-y-2 text-sm text-[#4b5133]">
                        <span className="text-[12px] font-semibold text-[#5f5a3b]">{field.name}</span>
                        <div className="flex flex-wrap gap-2">
                          {options.length ? (
                            options.map((opt) => (
                              <label
                                key={opt.name}
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] font-semibold ${
                                  selected.includes(opt.name)
                                    ? "bg-[#dfeac1] border-[#b9cd7f] text-[#2f3b21]"
                                    : "bg-white border-[#d0c9a4] text-[#4b5133]"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="accent-[#8fae4c]"
                                  checked={selected.includes(opt.name)}
                                  disabled={isReadOnly}
                                  onChange={() => toggleMultiSelect(field, opt.name)}
                                />
                                {opt.name}
                              </label>
                            ))
                          ) : (
                            <span className="text-[12px] text-[#7a7f54]">No options defined.</span>
                          )}
                        </div>
                        {!isReadOnly && (
                          <div className="flex items-center gap-2">
                            <input
                              value={customValue}
                              onChange={(e) =>
                                setMultiSelectDrafts((prev) => ({
                                  ...prev,
                                  [field.name]: e.target.value,
                                }))
                              }
                              placeholder="Add custom option"
                              className="flex-1 rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                addMultiSelectCustom(field, customValue);
                                setMultiSelectDrafts((prev) => ({ ...prev, [field.name]: "" }));
                              }}
                              className="rounded-md bg-[#8fae4c] px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#f9f9ec] shadow-sm transition hover:bg-[#7e9c44]"
                            >
                              Add
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  }

                  if (field.type === "rich_text") {
                    return (
                      <label key={field.name} className="space-y-1 text-sm text-[#4b5133]">
                        <span className="text-[12px] font-semibold text-[#5f5a3b]">{field.name}</span>
                        <textarea
                          value={String(value || "")}
                          disabled={isReadOnly}
                          onChange={(e) => updateTaskField(field.name, e.target.value)}
                          className="min-h-[80px] w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none disabled:opacity-60"
                        />
                      </label>
                    );
                  }

                  if (field.type === "number") {
                    return (
                      <label key={field.name} className="space-y-1 text-sm text-[#4b5133]">
                        <span className="text-[12px] font-semibold text-[#5f5a3b]">{field.name}</span>
                        <input
                          type="number"
                          value={value === null ? "" : String(value)}
                          disabled={isReadOnly}
                          onChange={(e) => updateTaskField(field.name, e.target.value)}
                          className="w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none disabled:opacity-60"
                        />
                      </label>
                    );
                  }

                  if (field.type === "date") {
                    return (
                      <label key={field.name} className="space-y-1 text-sm text-[#4b5133]">
                        <span className="text-[12px] font-semibold text-[#5f5a3b]">{field.name}</span>
                        <input
                          type="date"
                          value={String(value || "")}
                          disabled={isReadOnly}
                          onChange={(e) => updateTaskField(field.name, e.target.value)}
                          className="w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none disabled:opacity-60"
                        />
                      </label>
                    );
                  }

                  return (
                    <label key={field.name} className="space-y-1 text-sm text-[#4b5133]">
                      <span className="text-[12px] font-semibold text-[#5f5a3b]">{field.name}</span>
                      <input
                        type="text"
                        value={String(value || "")}
                        disabled={isReadOnly}
                        onChange={(e) => updateTaskField(field.name, e.target.value)}
                        className="w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none disabled:opacity-60"
                      />
                    </label>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={saveTaskEdits}
                  disabled={taskEditSaving}
                  className="rounded-md bg-[#8fae4c] px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#f9f9ec] shadow-sm transition hover:bg-[#7e9c44] disabled:opacity-60"
                >
                  Save task updates
                </button>
                {taskEditMessage && (
                  <span className="text-[12px] text-[#4b5133]">{taskEditMessage}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
