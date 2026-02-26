"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadSession } from "@/lib/session";
import { CustomTablesEditor } from "@/components/CustomTablesEditor";

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
  commentCount?: number;
  taskHelpReferences?: string[];
};
type TaskTypeOption = { id?: string; name: string; color: string };
type StatusOption = { name: string; color: string };
type TaskLink = { label: string; url: string };
type TaskDetail = {
  id: string;
  name: string;
  description: string;
  extraNotes: string[];
  personCount?: number | null;
  status?: string;
  priority?: string;
  taskType?: { name: string; color: string };
  links?: TaskLink[];
  recurring?: boolean;
  occurrenceDate?: string | null;
  parentTaskId?: string | null;
  recurrenceInterval?: number | null;
  recurrenceUnit?: string | null;
  recurrenceUntil?: string | null;
  taskHelpReferences?: string[];
  createdByName?: string | null;
};
type SuggestedOneOffTask = ScheduledTask & { sourceTaskId: string };
type TaskHistorySnapshot = {
  id: string;
  name: string;
  occurrenceDate: string | null;
  description: string;
  extraNotes: string[];
  personCount: number | null;
  status: string;
  priority: string;
  taskTypeName: string;
  links: TaskLink[];
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
type UndoChange = {
  person: string;
  slotId: string;
  previous: CellContent;
  next: CellContent;
};
type UndoEntry = {
  label: string;
  changes: UndoChange[];
};
type OverviewTaskEntry = {
  id: string | null;
  name: string;
  status: string;
  notes: Set<string>;
  assignments: number;
  recurring: boolean;
  parentTaskId: string | null;
};
type IndicatorRuleType =
  | "missing_description"
  | "status"
  | "priority"
  | "task_type"
  | "has_comments";
type IndicatorRule = {
  id: string;
  label: string;
  emoji: string;
  type: IndicatorRuleType;
  value?: string;
};
type TaskCommentPreview = { id: string; text: string; createdTime: string; author: string };
type DailyUpdateEntry = {
  id: string;
  user_name: string;
  task_statuses: { taskId: string; taskName: string; status: string }[];
  extra_notes: string | null;
  requests: string | null;
  summary: string | null;
  updated_at: string;
};

type DailyUpdateSummaryCacheEntry = {
  summary: string;
  generatedAt: string;
};

type DayOverviewSummary = {
  tasks: OverviewTaskEntry[];
  recurringTasks: OverviewTaskEntry[];
  oneOffTasks: OverviewTaskEntry[];
  total: number;
  completed: number;
  open: number;
  standaloneNotes: string[];
};

const DRAG_DATA_TYPE = "application/json/task";
const DEFAULT_SHIFT_HOURS = 1.5;
const TASK_EDIT_SECTIONS_CACHE_KEY = "admin-schedule-task-edit-sections";
const TASK_COMMENT_CACHE_KEY = "admin-schedule-task-comment-counts";
const SCHEDULE_HIDDEN_SLOTS_CACHE_KEY = "admin-schedule-hidden-slots";
const SCHEDULE_DOCK_TAB_CACHE_KEY = "admin-schedule-dock-tab";
const SCHEDULE_COLUMN_WIDTH_CACHE_KEY = "admin-schedule-column-width";
const SCHEDULE_DOCK_SIZE_CACHE_KEY = "admin-schedule-dock-size";
const SCHEDULE_SECTION_VISIBILITY_KEY = "admin-schedule-section-visibility";
const YESTERDAY_OVERVIEW_VISIBILITY_KEY = "admin-schedule-yesterday-overview-visible";
const AFK_TIMEOUT_MS = 20_000;

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

function ChecklistDropdown({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string[];
  options: string[];
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  const selected = new Set(value);
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm text-[#4b5133]">
        {value.length ? value.join(", ") : placeholder}
      </summary>
      <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-[#d0c9a4] bg-white p-2 shadow-lg">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2 px-1 py-1 text-xs text-[#4b5133]">
            <input
              type="checkbox"
              checked={selected.has(option)}
              onChange={(event) => {
                const next = new Set(value);
                if (event.target.checked) next.add(option);
                else next.delete(option);
                onChange(Array.from(next));
              }}
              className="accent-[#8fae4c]"
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </details>
  );
}


function normalizeCommentDate(value: unknown) {
  if (!value) return "";
  const raw = String(value);
  const isoMatch = raw.match(/^\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function countCommentsForDate(comments: unknown, targetIso: string) {
  if (!targetIso || !Array.isArray(comments)) return 0;
  return comments.reduce((count, comment) => {
    if (!comment || typeof comment !== "object") return count;
    const created = (comment as { createdTime?: unknown; time?: unknown }).createdTime ??
      (comment as { createdTime?: unknown; time?: unknown }).time;
    return normalizeCommentDate(created) === targetIso ? count + 1 : count;
  }, 0);
}


function normalizeCustomKeybind(value: string, fallback: string) {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/\s+/g, "").toUpperCase();
}

function matchesCustomKeybind(event: KeyboardEvent, keybind: string) {
  const normalized = keybind.toUpperCase();
  const usesCtrl = normalized.includes("CTRL");
  const usesCmd = normalized.includes("CMD") || normalized.includes("META");
  const usesShift = normalized.includes("SHIFT");
  const usesAlt = normalized.includes("ALT") || normalized.includes("OPTION");
  const matchKey = normalized.split("+").pop()?.toLowerCase() || "";
  const hasPrimary = usesCtrl || usesCmd;
  const primaryPressed = usesCtrl
    ? event.ctrlKey
    : usesCmd
      ? event.metaKey
      : event.ctrlKey || event.metaKey;
  if (hasPrimary && !primaryPressed) return false;
  if (usesShift !== event.shiftKey) return false;
  if (usesAlt !== event.altKey) return false;
  return Boolean(matchKey) && event.key.toLowerCase() === matchKey;
}

function parseEstimatedHours(value?: string | null) {
  if (!value) return DEFAULT_SHIFT_HOURS;
  const match = String(value).match(/[\d.]+/);
  const parsed = match ? Number.parseFloat(match[0]) : Number.NaN;
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_SHIFT_HOURS;
  return parsed;
}

const TASK_SEPARATOR_REGEX = /\s*•\s*/;
const DEFAULT_STATUS_EMOJI_MAP: Record<string, string> = {
  "not started": "🕒",
  "in progress": "⚙️",
  completed: "✅",
  blocked: "⛔",
};
const INDICATOR_RULES_STORAGE_KEY = "admin-schedule-indicator-rules";
const STATUS_EMOJI_STORAGE_KEY = "admin-schedule-status-emoji-map";
const DAILY_UPDATES_SUMMARY_CACHE_KEY = "admin-schedule-daily-updates-summary-cache";

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

const MAX_UNDO_ENTRIES = 25;

function cloneCellContent(cell: CellContent): CellContent {
  return {
    tasks: cell.tasks.map((task) => ({ ...task })),
    note: cell.note,
    blocked: cell.blocked,
  };
}

const stripTaskNameCommas = (value: string) => value.replace(/,/g, "");

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
  const [statusEmojiMap, setStatusEmojiMap] = useState<Record<string, string>>(
    DEFAULT_STATUS_EMOJI_MAP
  );
  const [indicatorRules, setIndicatorRules] = useState<IndicatorRule[]>([]);
  const [sectionVisibility, setSectionVisibility] = useState({
    customTables: true,
    scheduleCanvas: true,
    dayOverviews: true,
    dailyUpdates: true,
  });
  const [selectedCell, setSelectedCell] = useState<{
    person: string;
    slotId: string;
    slotLabel: string;
  } | null>(null);
  const [isSelectingRange, setIsSelectingRange] = useState(false);
  const [selectionAnchor, setSelectionAnchor] = useState<{
    person: string;
    slotId: string;
  } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{
    person: string;
    slotId: string;
  } | null>(null);
  const [cellClipboardRange, setCellClipboardRange] = useState<{
    rows: number;
    cols: number;
    cells: CellContent[][];
  } | null>(null);
  const [presenceSelections, setPresenceSelections] = useState<
    Record<
      string,
      {
        user: string;
        initials: string;
        updatedAt: number;
        anchor: { person: string; slotId: string } | null;
        end: { person: string; slotId: string } | null;
      }
    >
  >({});
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [activeSiteUsers, setActiveSiteUsers] = useState<string[]>([]);
  const [customTask, setCustomTask] = useState("");
  const [quickTaskName, setQuickTaskName] = useState("");
  const [quickTaskDescription, setQuickTaskDescription] = useState("");
  const [recurringQuickName, setRecurringQuickName] = useState("");
  const [recurringQuickDescription, setRecurringQuickDescription] = useState("");
  const [recurringQuickUntil, setRecurringQuickUntil] = useState("");
  const [recurringQuickInterval, setRecurringQuickInterval] = useState(1);
  const [recurringQuickUnit, setRecurringQuickUnit] = useState("day");
  const [draggingTask, setDraggingTask] = useState<DragPayload | null>(null);
  const [copyDragActive, setCopyDragActive] = useState(false);
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
  const [unpublishingSchedule, setUnpublishingSchedule] = useState(false);
  const [newCustomVolunteer, setNewCustomVolunteer] = useState("");
  const [addingCustomVolunteer, setAddingCustomVolunteer] = useState(false);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [taskEditDraft, setTaskEditDraft] = useState({
    name: "",
    description: "",
    extraNotes: "",
    personCount: "",
    status: "",
    priority: "",
    taskType: "",
    links: [] as TaskLink[],
    taskHelpReferences: [] as string[],
  });
  const [taskEditSections, setTaskEditSections] = useState({
    title: true,
    description: true,
    extraNotes: true,
    personCount: true,
    status: true,
    priority: true,
    taskType: true,
    taskHelpReferences: true,
    links: true,
    photos: true,
    recurrence: true,
  });
  const [taskDetailLoading, setTaskDetailLoading] = useState(false);
  const [taskEditSaving, setTaskEditSaving] = useState(false);
  const [taskEditMessage, setTaskEditMessage] = useState<string | null>(null);
  const [taskEditApplyTo, setTaskEditApplyTo] = useState<"single" | "all" | "future">("single");
  const [taskEditFutureDate, setTaskEditFutureDate] = useState("");
  const [taskOneOffHistory, setTaskOneOffHistory] = useState<TaskHistorySnapshot[]>([]);
  const [taskHistoryLoading, setTaskHistoryLoading] = useState(false);
  const [taskHistoryPreview, setTaskHistoryPreview] = useState<TaskHistorySnapshot | null>(null);
  const [expandedOverviewTasks, setExpandedOverviewTasks] = useState<Set<string>>(new Set());
  const [dayOverviewCommentsByTask, setDayOverviewCommentsByTask] = useState<Record<string, TaskCommentPreview[]>>({});
  const [dayOverviewCommentsLoading, setDayOverviewCommentsLoading] = useState<Set<string>>(new Set());
  const [yesterdayOverviewVisible, setYesterdayOverviewVisible] = useState(true);
  const [canvasCopyKeybind, setCanvasCopyKeybind] = useState("Ctrl/Cmd+C");
  const [canvasPasteKeybind, setCanvasPasteKeybind] = useState("Ctrl/Cmd+V");
  const taskEditLastSavedSignatureRef = useRef<string>("");
  const taskEditAutoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editingTaskKey, setEditingTaskKey] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskName, setEditingTaskName] = useState("");
  const [editingTaskSaving, setEditingTaskSaving] = useState(false);
  const [hasUnpublishedChanges, setHasUnpublishedChanges] = useState(false);
  const [desktopDockTab, setDesktopDockTab] = useState<"recurring" | "oneOff">(
    "recurring"
  );
  const [hiddenSlotIds, setHiddenSlotIds] = useState<Set<string>>(new Set());
  const [hoveredTaskTooltip, setHoveredTaskTooltip] = useState<{
    name: string;
    status: string;
    type: string;
    assigned: number;
    needed: number;
    x: number;
    y: number;
  } | null>(null);
  const editingTaskInputRef = useRef<HTMLInputElement | null>(null);
  const customTaskInputRef = useRef<HTMLInputElement | null>(null);
  const customTaskCellRef = useRef<{ person: string; slotId: string; slotLabel: string } | null>(
    null
  );
  const skipCustomTaskBlurRef = useRef(false);
  const scheduleContainerRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const lastActivityRef = useRef(Date.now());
  const [taskCommentCache, setTaskCommentCache] = useState<Record<string, number>>({});
  const [mobileDockOpen, setMobileDockOpen] = useState(false);
  const [mobileDockTab, setMobileDockTab] = useState<"recurring" | "oneOff">("recurring");
  const [desktopDockOpen, setDesktopDockOpen] = useState(true);
  const [dockPosition, setDockPosition] = useState({ x: 0, y: 0 });
  const [dockDragging, setDockDragging] = useState(false);
  const [dockDragOffset, setDockDragOffset] = useState({ x: 0, y: 0 });
  const [dockSize, setDockSize] = useState<{ width: number; height: number } | null>(null);
  const [dockResizing, setDockResizing] = useState<{
    axis: "x" | "y" | "both";
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  const [blackoutMode, setBlackoutMode] = useState(false);
  const [blackoutRangeStart, setBlackoutRangeStart] = useState("");
  const [blackoutRangeEnd, setBlackoutRangeEnd] = useState("");
  const [blackoutApplying, setBlackoutApplying] = useState(false);
  const [recurringDockExpanded, setRecurringDockExpanded] = useState(false);
  const [oneOffDockExpanded, setOneOffDockExpanded] = useState(false);
  const [showPastIncomplete, setShowPastIncomplete] = useState(false);
  const [suggestModeEnabled, setSuggestModeEnabled] = useState(false);
  const [suggestedOneOffByCell, setSuggestedOneOffByCell] = useState<
    Record<string, SuggestedOneOffTask[]>
  >({});
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [photoDropActive, setPhotoDropActive] = useState(false);
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [saveLog, setSaveLog] = useState<{
    status: "idle" | "saving" | "success" | "error";
    message?: string;
    lastAttempt?: string;
    payload?: { person: string; slotId: string; dateLabel?: string };
  }>({ status: "idle" });
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [cellClipboard, setCellClipboard] = useState<CellContent | null>(null);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);
  const [yesterdayScheduleData, setYesterdayScheduleData] =
    useState<ScheduleResponse | null>(null);
  const [yesterdayRecurringTasks, setYesterdayRecurringTasks] = useState<TaskCatalogItem[]>([]);
  const [yesterdayOneOffTasks, setYesterdayOneOffTasks] = useState<TaskCatalogItem[]>([]);
  const [yesterdayLoading, setYesterdayLoading] = useState(false);
  const [carryOverTaskId, setCarryOverTaskId] = useState<string | null>(null);
  const [columnWidth, setColumnWidth] = useState<number | null>(null);
  const [columnResizing, setColumnResizing] = useState<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const [isAfk, setIsAfk] = useState(false);
  const [dailyUpdates, setDailyUpdates] = useState<DailyUpdateEntry[]>([]);
  const [dailyUpdatesLoading, setDailyUpdatesLoading] = useState(false);
  const [dailyUpdatesError, setDailyUpdatesError] = useState<string | null>(null);
  const [dailyUpdatesSummaryCache, setDailyUpdatesSummaryCache] = useState<Record<string, DailyUpdateSummaryCacheEntry>>({});
  const [dailyUpdatesSummaryLoading, setDailyUpdatesSummaryLoading] = useState(false);
  const [dailyUpdatesSummaryError, setDailyUpdatesSummaryError] = useState<string | null>(null);

  const cloneOneOffTaskForDate = useCallback(
    async (sourceTaskId: string, targetIso: string) => {
      const detailRes = await fetch(`/api/task?id=${encodeURIComponent(sourceTaskId)}`, {
        cache: "no-store",
      });
      const detailJson = await detailRes.json().catch(() => ({}));
      if (!detailRes.ok) {
        throw new Error(detailJson.error || "Failed to load one-off task for duplication.");
      }
      const createRes = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: detailJson.name || "Task",
          description: detailJson.description || null,
          status: detailJson.status || "Not Started",
          priority: detailJson.priority || "Medium",
          recurring: false,
          origin_date: targetIso,
          occurrence_date: targetIso,
          person_count: detailJson.personCount ?? null,
          links: Array.isArray(detailJson.links)
            ? detailJson.links.map((link: any) => String(link?.url || link?.label || "")).filter(Boolean)
            : [],
          estimated_time: detailJson.estimatedTime || null,
          extra_notes: Array.isArray(detailJson.extraNotes) ? detailJson.extraNotes : [],
        }),
      });
      const createJson = await createRes.json().catch(() => ({}));
      if (!createRes.ok || !createJson?.task?.id) {
        throw new Error(createJson.error || "Failed to duplicate one-off task.");
      }
      return createJson.task as any;
    },
    []
  );

  const formatDateInput = useCallback((value: string) => {
    if (!value) return "";
    const [year, month, day] = value.split("-");
    if (!year || !month || !day) return value;
    return `${month}/${day}/${year}`;
  }, []);

  const formatLabelToInput = useCallback((label: string) => {
    const [month, day, year] = label.split("/");
    if (!month || !day || !year) return "";
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }, []);

  const addDaysToIso = useCallback((isoDate: string, days: number) => {
    const base = isoDate ? new Date(isoDate) : new Date();
    const next = new Date(base);
    next.setDate(next.getDate() + days);
    return next.toISOString().slice(0, 10);
  }, []);

  const buildNotesText = (notes: string[]) => notes.filter(Boolean).join("\n");

  const todayLabel = formatDateInput(new Date().toISOString().slice(0, 10));

  const refreshScheduleList = useCallback(async () => {
    const scheduleListRes = await fetch("/api/schedule/list", { cache: "no-store" });
    if (!scheduleListRes.ok) return;
    const json = await scheduleListRes.json();
    setAvailableSchedules(json.schedules || []);
    setScheduleMode(json.mode === "database" ? "database" : "page");
  }, []);

  useEffect(() => {
    const session = loadSession();
    if (!session || !session.name) {
      router.replace("/");
      return;
    }

    setCurrentUserName(session.name || null);
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
        const [typeRes, usersRes] = await Promise.all([
          fetch("/api/task-types", { cache: "no-store" }),
          fetch("/api/users", { cache: "no-store" }),
        ]);

        if (typeRes.ok) {
          const json = await typeRes.json();
          setTaskTypes(json.types || []);
          setStatusOptions(json.statuses || []);
        }
        if (usersRes.ok) {
          const usersJson = await usersRes.json();
          const activeUsers = Array.isArray(usersJson.users)
            ? usersJson.users
                .filter((user: any) => user?.active)
                .map((user: any) => String(user?.name || "").trim())
                .filter(Boolean)
            : [];
          setActiveSiteUsers(activeUsers);
        }
        await refreshScheduleList();
        setSelectedDate(todayLabel);
      } catch (err) {
        console.error("Failed to load schedule editor data", err);
        setMessage("Could not load schedule tools. Please refresh.");
      }
    };

    loadStatic();
  }, [authorized, refreshScheduleList, todayLabel]);

  useEffect(() => {
    if (editingTaskKey && editingTaskInputRef.current) {
      editingTaskInputRef.current.focus();
      editingTaskInputRef.current.select();
    }
  }, [editingTaskKey]);

  useEffect(() => {
    if (!selectedCell || editingTaskKey) return;
    requestAnimationFrame(() => {
      customTaskInputRef.current?.focus();
      customTaskInputRef.current?.select();
    });
  }, [editingTaskKey, selectedCell]);

  useEffect(() => {
    if (!selectedCell) return;
    customTaskCellRef.current = {
      person: selectedCell.person,
      slotId: selectedCell.slotId,
      slotLabel: selectedCell.slotLabel,
    };
  }, [selectedCell]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dockWidth = dockSize?.width ?? (canvasExpanded ? 240 : 320);
    setDockPosition((prev) => ({
      x: prev.x || Math.max(16, window.innerWidth - dockWidth - 16),
      y: prev.y || 96,
    }));
  }, [canvasExpanded, dockSize?.width]);

  useEffect(() => {
    if (!dockDragging) return;
    const handleMove = (event: MouseEvent) => {
      setDockPosition({
        x: Math.max(8, event.clientX - dockDragOffset.x),
        y: Math.max(8, event.clientY - dockDragOffset.y),
      });
    };
    const handleUp = () => setDockDragging(false);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dockDragging, dockDragOffset]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cached = localStorage.getItem(SCHEDULE_DOCK_SIZE_CACHE_KEY);
    if (!cached) return;
    try {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === "object") {
        const width = Number(parsed.width);
        const height = Number(parsed.height);
        if (width > 0 && height > 0) {
          setDockSize({ width, height });
        }
      }
    } catch (err) {
      console.warn("Failed to parse dock size cache", err);
    }
  }, []);

  useEffect(() => {
    if (dockSize) return;
    setDockSize({ width: canvasExpanded ? 240 : 320, height: 560 });
  }, [canvasExpanded, dockSize]);

  useEffect(() => {
    if (!dockResizing) return;
    const handleMove = (event: MouseEvent) => {
      const nextWidth = Math.max(220, dockResizing.startWidth + (event.clientX - dockResizing.startX));
      const nextHeight = Math.max(
        240,
        dockResizing.startHeight + (event.clientY - dockResizing.startY)
      );
      setDockSize((prev) => ({
        width: dockResizing.axis === "y" ? prev?.width ?? nextWidth : nextWidth,
        height: dockResizing.axis === "x" ? prev?.height ?? nextHeight : nextHeight,
      }));
    };
    const handleUp = () => setDockResizing(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dockResizing]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (dockResizing || !dockSize) return;
    localStorage.setItem(SCHEDULE_DOCK_SIZE_CACHE_KEY, JSON.stringify(dockSize));
  }, [dockResizing, dockSize]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cached = localStorage.getItem(SCHEDULE_COLUMN_WIDTH_CACHE_KEY);
    if (!cached) return;
    const parsed = Number(cached);
    if (!Number.isNaN(parsed) && parsed > 0) {
      setColumnWidth(parsed);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const cached = localStorage.getItem(SCHEDULE_SECTION_VISIBILITY_KEY);
      if (!cached) return;
      const parsed = JSON.parse(cached) as Partial<typeof sectionVisibility>;
      if (parsed && typeof parsed === "object") {
        setSectionVisibility((prev) => ({ ...prev, ...parsed }));
      }
    } catch (err) {
      console.warn("Failed to parse section visibility cache", err);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(SCHEDULE_SECTION_VISIBILITY_KEY, JSON.stringify(sectionVisibility));
    } catch (err) {
      console.warn("Failed to save section visibility cache", err);
    }
  }, [sectionVisibility]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cached = localStorage.getItem(YESTERDAY_OVERVIEW_VISIBILITY_KEY);
    if (cached === "true") setYesterdayOverviewVisible(true);
    if (cached === "false") setYesterdayOverviewVisible(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const key = `custom-table-keybinds-${(currentUserName || "guest").toLowerCase()}`;
      const cached = localStorage.getItem(key);
      if (!cached) return;
      const parsed = JSON.parse(cached) as { copy?: string; paste?: string };
      setCanvasCopyKeybind(
        normalizeCustomKeybind(parsed.copy || "Ctrl/Cmd+C", "Ctrl/Cmd+C")
      );
      setCanvasPasteKeybind(
        normalizeCustomKeybind(parsed.paste || "Ctrl/Cmd+V", "Ctrl/Cmd+V")
      );
    } catch (err) {
      console.warn("Failed to parse shared keybind cache", err);
    }
  }, [currentUserName]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(YESTERDAY_OVERVIEW_VISIBILITY_KEY, String(yesterdayOverviewVisible));
  }, [yesterdayOverviewVisible]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (columnResizing || columnWidth === null) return;
    localStorage.setItem(SCHEDULE_COLUMN_WIDTH_CACHE_KEY, String(columnWidth));
  }, [columnResizing, columnWidth]);

  useEffect(() => {
    if (!columnResizing) return;
    const handleMove = (event: MouseEvent) => {
      const nextWidth = Math.max(120, columnResizing.startWidth + (event.clientX - columnResizing.startX));
      setColumnWidth(nextWidth);
    };
    const handleUp = () => setColumnResizing(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [columnResizing]);


  useEffect(() => {
    if (!selectedDate) {
      setSelectedDate(todayLabel);
    }
  }, [selectedDate, todayLabel]);

  const toggleSectionVisibility = useCallback(
    (key: keyof typeof sectionVisibility) => {
      setSectionVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
    },
    []
  );

  const selectedEntry = useMemo(
    () => availableSchedules.find((entry) => entry.dateLabel === selectedDate),
    [availableSchedules, selectedDate]
  );

  const visibleSlotsWithIndex = useMemo(() => {
    if (!scheduleData?.slots?.length) return [];
    return scheduleData.slots
      .map((slot, index) => ({ slot, index }))
      .filter((entry) => !hiddenSlotIds.has(entry.slot.id));
  }, [scheduleData?.slots, hiddenSlotIds]);

  const hiddenSlots = useMemo(() => {
    if (!scheduleData?.slots?.length || hiddenSlotIds.size === 0) return [];
    return scheduleData.slots.filter((slot) => hiddenSlotIds.has(slot.id));
  }, [scheduleData?.slots, hiddenSlotIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (columnWidth !== null) return;
    if (!visibleSlotsWithIndex.length) return;
    const containerWidth = scheduleContainerRef.current?.clientWidth ?? window.innerWidth;
    const personColumnWidth = 120;
    const availableWidth = Math.max(containerWidth - personColumnWidth, 240);
    const nextWidth = Math.max(120, Math.floor(availableWidth / visibleSlotsWithIndex.length));
    setColumnWidth(nextWidth);
    localStorage.setItem(SCHEDULE_COLUMN_WIDTH_CACHE_KEY, String(nextWidth));
  }, [columnWidth, visibleSlotsWithIndex.length]);


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
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) {
            setScheduleData(json);
            setHasUnpublishedChanges(false);
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
    if (!authorized || isAfk) return;
    if (scheduleMode === "page" && !selectedDate) return;
    const interval = setInterval(async () => {
      try {
        const url =
          scheduleMode === "page"
            ? `/api/schedule?date=${encodeURIComponent(selectedDate)}&staging=1`
            : "/api/schedule";
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        setScheduleData((prev) => {
          if (!prev) return json;
          if (JSON.stringify(prev.cells) === JSON.stringify(json.cells)) return prev;
          return json;
        });
      } catch (err) {
        console.warn("Live refresh failed", err);
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [authorized, isAfk, pendingCells.size, scheduleMode, selectedDate]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cached = localStorage.getItem(TASK_EDIT_SECTIONS_CACHE_KEY);
    if (!cached) return;
    try {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === "object") {
        setTaskEditSections((prev) => ({ ...prev, ...parsed }));
      }
    } catch (err) {
      console.warn("Failed to parse task edit section cache", err);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      TASK_EDIT_SECTIONS_CACHE_KEY,
      JSON.stringify(taskEditSections)
    );
  }, [taskEditSections]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cached = localStorage.getItem(SCHEDULE_HIDDEN_SLOTS_CACHE_KEY);
    if (!cached) return;
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        setHiddenSlotIds(new Set(parsed.map(String)));
      }
    } catch (err) {
      console.warn("Failed to parse hidden slots cache", err);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      SCHEDULE_HIDDEN_SLOTS_CACHE_KEY,
      JSON.stringify(Array.from(hiddenSlotIds))
    );
  }, [hiddenSlotIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cached = localStorage.getItem(SCHEDULE_DOCK_TAB_CACHE_KEY);
    if (!cached) return;
    if (cached === "recurring" || cached === "oneOff") {
      setDesktopDockTab(cached);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(SCHEDULE_DOCK_TAB_CACHE_KEY, desktopDockTab);
  }, [desktopDockTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cached = localStorage.getItem(TASK_COMMENT_CACHE_KEY);
    if (!cached) return;
    try {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === "object") {
        setTaskCommentCache(parsed);
      }
    } catch (err) {
      console.warn("Failed to parse task comment cache", err);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cached = localStorage.getItem(STATUS_EMOJI_STORAGE_KEY);
    if (!cached) return;
    try {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === "object") {
        setStatusEmojiMap((prev) => ({ ...prev, ...parsed }));
      }
    } catch (err) {
      console.warn("Failed to parse status emoji cache", err);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STATUS_EMOJI_STORAGE_KEY, JSON.stringify(statusEmojiMap));
  }, [statusEmojiMap]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cached = localStorage.getItem(INDICATOR_RULES_STORAGE_KEY);
    if (!cached) return;
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        const normalized = parsed.filter((rule) => rule && typeof rule === "object" && rule.type !== "missing_person_count");
        if (normalized.length) {
          setIndicatorRules(normalized as IndicatorRule[]);
        }
      }
    } catch (err) {
      console.warn("Failed to parse indicator rules cache", err);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(INDICATOR_RULES_STORAGE_KEY, JSON.stringify(indicatorRules));
  }, [indicatorRules]);

  useEffect(() => {
    const clearTooltip = () => setHoveredTaskTooltip(null);
    window.addEventListener("scroll", clearTooltip, true);
    window.addEventListener("blur", clearTooltip);
    window.addEventListener("mouseleave", clearTooltip);
    window.addEventListener("pointerdown", clearTooltip);
    window.addEventListener("keydown", clearTooltip);
    return () => {
      window.removeEventListener("scroll", clearTooltip, true);
      window.removeEventListener("blur", clearTooltip);
      window.removeEventListener("mouseleave", clearTooltip);
      window.removeEventListener("pointerdown", clearTooltip);
      window.removeEventListener("keydown", clearTooltip);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // no-op placeholder to avoid hydration mismatch if future window sizing is needed
  }, [scheduleMode, selectedDate]);

  useEffect(() => {
    const handleKeyChange = (event: KeyboardEvent) => {
      const isMac =
        typeof navigator !== "undefined" &&
        /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey;
      setCopyDragActive(modifierPressed);
    };
    const clearModifier = () => setCopyDragActive(false);
    window.addEventListener("keydown", handleKeyChange);
    window.addEventListener("keyup", handleKeyChange);
    window.addEventListener("blur", clearModifier);
    return () => {
      window.removeEventListener("keydown", handleKeyChange);
      window.removeEventListener("keyup", handleKeyChange);
      window.removeEventListener("blur", clearModifier);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const markActive = () => {
      lastActivityRef.current = Date.now();
      setIsAfk(false);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        markActive();
      }
    };
    const activityEvents = ["mousemove", "keydown", "pointerdown", "scroll", "touchstart"];
    activityEvents.forEach((event) => window.addEventListener(event, markActive, { passive: true }));
    document.addEventListener("visibilitychange", handleVisibility);
    const interval = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= AFK_TIMEOUT_MS) {
        setIsAfk(true);
      }
    }, 1_000);
    return () => {
      activityEvents.forEach((event) =>
        window.removeEventListener(event, markActive)
      );
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearInterval(interval);
    };
  }, []);

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

  const yesterdayLabel = useMemo(() => {
    if (!selectedDate) return "";
    const selectedIso = formatLabelToInput(selectedDate);
    if (!selectedIso) return "";
    return formatDateInput(addDaysToIso(selectedIso, -1));
  }, [addDaysToIso, formatLabelToInput, formatDateInput, selectedDate]);
  const customTablesDateLabel = useMemo(
    () => selectedDate || scheduleData?.scheduleDate || null,
    [scheduleData?.scheduleDate, selectedDate]
  );

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
        const activeCommentDate = dateParam || new Date().toISOString().slice(0, 10);
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
            commentCount: countCommentsForDate(task.comments, activeCommentDate),
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
            commentCount: countCommentsForDate(task.comments, activeCommentDate),
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

  useEffect(() => {
    if (!authorized || !yesterdayLabel || scheduleMode !== "page") {
      setYesterdayScheduleData(null);
      setYesterdayRecurringTasks([]);
      setYesterdayOneOffTasks([]);
      return;
    }
    let cancelled = false;
    setYesterdayLoading(true);

    const loadYesterday = async () => {
      try {
        const dateParam = formatLabelToInput(yesterdayLabel);
        if (!dateParam) return;
        const [scheduleRes, recurringRes, oneOffRes] = await Promise.all([
          fetch(`/api/schedule?date=${encodeURIComponent(yesterdayLabel)}&staging=1`, {
            cache: "no-store",
          }),
          fetch(
            `/api/tasks?recurring=true&includeOccurrences=true&start=${dateParam}&end=${dateParam}`
          ),
          fetch(`/api/tasks?recurring=false&start=${dateParam}&end=${dateParam}`),
        ]);
        if (cancelled) return;
        if (scheduleRes.ok) {
          const json = await scheduleRes.json();
          setYesterdayScheduleData(json);
        } else {
          setYesterdayScheduleData(null);
        }
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
            commentCount: countCommentsForDate(task.comments, dateParam),
          }));
          setYesterdayRecurringTasks(items);
        } else {
          setYesterdayRecurringTasks([]);
        }
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
            commentCount: countCommentsForDate(task.comments, dateParam),
          }));
          setYesterdayOneOffTasks(items);
        } else {
          setYesterdayOneOffTasks([]);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load yesterday overview", err);
          setYesterdayScheduleData(null);
          setYesterdayRecurringTasks([]);
          setYesterdayOneOffTasks([]);
        }
      } finally {
        if (!cancelled) setYesterdayLoading(false);
      }
    };

    loadYesterday();
    return () => {
      cancelled = true;
    };
  }, [authorized, formatLabelToInput, scheduleMode, yesterdayLabel]);

  const ghostSuggestedOneOffByCell = useMemo(() => {
    if (!suggestModeEnabled || !scheduleData || !yesterdayScheduleData) return {} as Record<string, SuggestedOneOffTask[]>;
    const yesterdayOneOffById = new Map(yesterdayOneOffTasks.map((task) => [task.id, task]));
    if (!yesterdayOneOffById.size) return {} as Record<string, SuggestedOneOffTask[]>;
    const next: Record<string, SuggestedOneOffTask[]> = {};

    yesterdayScheduleData.people.forEach((person, rowIdx) => {
      const targetRowIdx = scheduleData.people.findIndex(
        (name) => name.trim().toLowerCase() === person.trim().toLowerCase()
      );
      if (targetRowIdx < 0) return;
      yesterdayScheduleData.slots.forEach((slot, colIdx) => {
        const targetSlot = scheduleData.slots.find((entry) => entry.id === slot.id);
        if (!targetSlot) return;
        const cell = yesterdayScheduleData.cells?.[rowIdx]?.[colIdx];
        if (!cell?.tasks?.length) return;
        const key = `${scheduleData.people[targetRowIdx]}-${targetSlot.id}`;
        const currentNames = new Set(
          (scheduleData.cells?.[targetRowIdx]?.[scheduleData.slots.findIndex((s) => s.id === targetSlot.id)]?.tasks || [])
            .map((task) => task.name.trim().toLowerCase())
        );
        const suggestions = cell.tasks
          .filter((task) => yesterdayOneOffById.has(task.id))
          .filter((task) => !currentNames.has(task.name.trim().toLowerCase()))
          .map((task) => ({
            id: `ghost-${task.id}-${rowIdx}-${colIdx}`,
            name: task.name,
            sourceTaskId: task.id,
          }));
        if (suggestions.length) {
          next[key] = suggestions;
        }
      });
    });

    return next;
  }, [scheduleData, suggestModeEnabled, yesterdayOneOffTasks, yesterdayScheduleData]);

  const visibleSuggestedOneOffByCell = useMemo(() => {
    const merged: Record<string, SuggestedOneOffTask[]> = {};
    const addAll = (source: Record<string, SuggestedOneOffTask[]>) => {
      Object.entries(source).forEach(([key, items]) => {
        const existingIds = new Set((merged[key] || []).map((item) => item.id));
        const toAdd = items.filter((item) => !existingIds.has(item.id));
        if (toAdd.length) {
          merged[key] = [...(merged[key] || []), ...toAdd];
        }
      });
    };
    addAll(ghostSuggestedOneOffByCell);
    addAll(suggestedOneOffByCell);
    return merged;
  }, [ghostSuggestedOneOffByCell, suggestedOneOffByCell]);

  const taskCommentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    [...recurringTasks, ...oneOffTasks].forEach((task) => {
      counts[task.id] = task.commentCount ?? 0;
    });
    return counts;
  }, [oneOffTasks, recurringTasks]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(TASK_COMMENT_CACHE_KEY, JSON.stringify(taskCommentCounts));
    setTaskCommentCache(taskCommentCounts);
  }, [taskCommentCounts]);

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

  const ruleMatches = useCallback((rule: IndicatorRule, task?: TaskCatalogItem) => {
    if (!task) return false;
    switch (rule.type) {
      case "missing_description":
        return !task.description?.trim();
      case "status":
        return Boolean(rule.value) && task.status?.toLowerCase() === rule.value?.toLowerCase();
      case "priority":
        return Boolean(rule.value) && task.priority?.toLowerCase() === rule.value?.toLowerCase();
      case "task_type":
        return Boolean(rule.value) && task.type?.toLowerCase() === rule.value?.toLowerCase();
      case "has_comments":
        return Boolean(task.commentCount && task.commentCount > 0);
      default:
        return false;
    }
  }, []);

  const getTaskIndicators = useCallback(
    (task?: TaskCatalogItem) => {
      const indicators: Array<{ emoji: string; label: string }> = [];
      const statusKey = (task?.status || "").toLowerCase();
      const statusEmoji = statusEmojiMap[statusKey];
      if (statusEmoji) {
        indicators.push({
          emoji: statusEmoji,
          label: `Status: ${task?.status || "Unknown"}`,
        });
      }
      indicatorRules.forEach((rule) => {
        if (!rule.emoji) return;
        if (ruleMatches(rule, task)) {
          indicators.push({ emoji: rule.emoji, label: rule.label });
        }
      });
      return indicators;
    },
    [indicatorRules, ruleMatches, statusEmojiMap]
  );

  const addIndicatorRule = useCallback(() => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `rule-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    setIndicatorRules((prev) => [
      ...prev,
      {
        id,
        label: "New indicator",
        emoji: "✨",
        type: "status",
        value: "Not Started",
      },
    ]);
  }, []);

  const updateStatusEmoji = useCallback((status: string, value: string) => {
    const key = status.toLowerCase();
    setStatusEmojiMap((prev) => ({ ...prev, [key]: value }));
  }, []);

  const updateIndicatorRule = useCallback((id: string, updates: Partial<IndicatorRule>) => {
    setIndicatorRules((prev) =>
      prev.map((rule) => (rule.id === id ? { ...rule, ...updates } : rule))
    );
  }, []);

  const removeIndicatorRule = useCallback((id: string) => {
    setIndicatorRules((prev) => prev.filter((rule) => rule.id !== id));
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

  const buildDayOverviewSummary = useCallback(
    (
      data: ScheduleResponse | null,
      metaById: Map<string, TaskCatalogItem>,
      metaByName: Map<string, TaskCatalogItem>
    ): DayOverviewSummary | null => {
      if (!data) return null;

      const taskMap = new Map<string, OverviewTaskEntry>();
      const standaloneNotes = new Set<string>();

      data.cells.forEach((row) => {
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
              const meta =
                metaById.get(task.id) || metaByName.get(key) || ({} as TaskCatalogItem);
              taskMap.set(key, {
                id: task.id || meta?.id || null,
                name,
                status: meta?.status || "Not Started",
                notes: new Set<string>(),
                assignments: 0,
                recurring: Boolean(meta?.recurring),
                parentTaskId: meta?.parentTaskId || null,
              });
            }
            const entry = taskMap.get(key);
            if (!entry) return;
            entry.assignments += 1;
            if (note) entry.notes.add(note);
            if (!entry.id && task.id) {
              entry.id = task.id;
            }
          });
        });
      });

      const tasks = Array.from(taskMap.values()).sort((a, b) => a.name.localeCompare(b.name));
      const recurringTasks = tasks.filter((task) => task.recurring);
      const oneOffTasks = tasks.filter((task) => !task.recurring);
      const completed = tasks.filter(
        (task) => task.status.toLowerCase() === "completed"
      ).length;
      return {
        tasks,
        recurringTasks,
        oneOffTasks,
        total: tasks.length,
        completed,
        open: tasks.length - completed,
        standaloneNotes: Array.from(standaloneNotes),
      };
    },
    []
  );

  const todayTaskMetaByName = useMemo(() => {
    const entries: Array<[string, TaskCatalogItem]> = [...recurringTasks, ...oneOffTasks].map(
      (task) => [task.name.trim().toLowerCase(), task]
    );
    return new Map<string, TaskCatalogItem>(entries);
  }, [oneOffTasks, recurringTasks]);

  const yesterdayTaskMetaById = useMemo(() => {
    const entries: Array<[string, TaskCatalogItem]> = [...yesterdayRecurringTasks, ...oneOffTasks].map(
      (task) => [task.id, task]
    );
    return new Map<string, TaskCatalogItem>(entries);
  }, [oneOffTasks, yesterdayRecurringTasks]);

  const yesterdayTaskMetaByName = useMemo(() => {
    const entries: Array<[string, TaskCatalogItem]> = [...yesterdayRecurringTasks, ...oneOffTasks].map(
      (task) => [task.name.trim().toLowerCase(), task]
    );
    return new Map<string, TaskCatalogItem>(entries);
  }, [oneOffTasks, yesterdayRecurringTasks]);

  const dayOverviewSummary = useMemo(
    () => buildDayOverviewSummary(scheduleData, taskMetaById, todayTaskMetaByName),
    [buildDayOverviewSummary, scheduleData, taskMetaById, todayTaskMetaByName]
  );

  const yesterdayOverviewSummary = useMemo(
    () =>
      buildDayOverviewSummary(
        yesterdayScheduleData,
        yesterdayTaskMetaById,
        yesterdayTaskMetaByName
      ),
    [buildDayOverviewSummary, yesterdayScheduleData, yesterdayTaskMetaById, yesterdayTaskMetaByName]
  );

  const selectedDateIso = useMemo(
    () => (selectedDate ? formatLabelToInput(selectedDate) : ""),
    [formatLabelToInput, selectedDate]
  );

  const dailyUpdatesSummary = selectedDateIso ? dailyUpdatesSummaryCache[selectedDateIso] : undefined;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const cached = localStorage.getItem(DAILY_UPDATES_SUMMARY_CACHE_KEY);
      if (!cached) return;
      const parsed = JSON.parse(cached) as Record<string, DailyUpdateSummaryCacheEntry>;
      if (parsed && typeof parsed === "object") {
        setDailyUpdatesSummaryCache(parsed);
      }
    } catch (err) {
      console.warn("Failed to parse daily updates summary cache", err);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        DAILY_UPDATES_SUMMARY_CACHE_KEY,
        JSON.stringify(dailyUpdatesSummaryCache)
      );
    } catch (err) {
      console.warn("Failed to save daily updates summary cache", err);
    }
  }, [dailyUpdatesSummaryCache]);

  const generateDailyUpdatesSummary = useCallback(async () => {
    if (!selectedDateIso || dailyUpdatesSummaryLoading) return;
    setDailyUpdatesSummaryLoading(true);
    setDailyUpdatesSummaryError(null);
    try {
      const res = await fetch("/api/daily-updates/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: selectedDateIso }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || "Unable to generate daily update summary.");
      }

      const summary = String(json.summary || "").trim();
      if (!summary) {
        throw new Error("Summary was empty.");
      }

      setDailyUpdatesSummaryCache((prev) => ({
        ...prev,
        [selectedDateIso]: {
          summary,
          generatedAt: String(json.generatedAt || new Date().toISOString()),
        },
      }));
    } catch (err) {
      setDailyUpdatesSummaryError(
        err instanceof Error ? err.message : "Unable to generate daily update summary."
      );
    } finally {
      setDailyUpdatesSummaryLoading(false);
    }
  }, [dailyUpdatesSummaryLoading, selectedDateIso]);

  useEffect(() => {
    setDailyUpdatesSummaryError(null);
  }, [selectedDateIso]);

  useEffect(() => {
    if (!selectedDateIso) {
      setDailyUpdates([]);
      return;
    }

    let cancelled = false;
    const loadDailyUpdates = async () => {
      setDailyUpdatesLoading(true);
      setDailyUpdatesError(null);
      try {
        const res = await fetch(`/api/daily-updates?date=${encodeURIComponent(selectedDateIso)}`, {
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error || "Unable to load daily updates.");
        }
        if (!cancelled) {
          setDailyUpdates(Array.isArray(json.updates) ? json.updates : []);
        }
      } catch (err) {
        if (!cancelled) {
          setDailyUpdates([]);
          setDailyUpdatesError(
            err instanceof Error ? err.message : "Unable to load daily updates."
          );
        }
      } finally {
        if (!cancelled) {
          setDailyUpdatesLoading(false);
        }
      }
    };

    void loadDailyUpdates();
    return () => {
      cancelled = true;
    };
  }, [selectedDateIso]);

  const dayOverviewRecurring = useMemo(
    () => dayOverviewSummary?.recurringTasks ?? [],
    [dayOverviewSummary]
  );
  const dayOverviewOneOff = useMemo(
    () => dayOverviewSummary?.oneOffTasks ?? [],
    [dayOverviewSummary]
  );
  const dayOverviewAnalytics = useMemo(() => {
    if (!dayOverviewSummary) return null;
    const completionRate = dayOverviewSummary.total
      ? Math.round((dayOverviewSummary.completed / dayOverviewSummary.total) * 100)
      : 0;
    const recurringShare = dayOverviewSummary.total
      ? Math.round((dayOverviewSummary.recurringTasks.length / dayOverviewSummary.total) * 100)
      : 0;
    const commentTaskCount = dayOverviewSummary.tasks.filter(
      (task) => task.id && (taskCommentCache[task.id] || 0) > 0
    ).length;
    const totalCommentCount = dayOverviewSummary.tasks.reduce(
      (sum, task) => sum + (task.id ? taskCommentCache[task.id] || 0 : 0),
      0
    );
    return { completionRate, recurringShare, commentTaskCount, totalCommentCount };
  }, [dayOverviewSummary, taskCommentCache]);

  const yesterdayOpenRecurring = useMemo(() => {
    if (!yesterdayOverviewSummary) return [];
    return yesterdayOverviewSummary.recurringTasks.filter(
      (task) => task.status.toLowerCase() !== "completed"
    );
  }, [yesterdayOverviewSummary]);
  const yesterdayOpenOneOff = useMemo(() => {
    if (!yesterdayOverviewSummary) return [];
    return yesterdayOverviewSummary.oneOffTasks.filter(
      (task) => task.status.toLowerCase() !== "completed"
    );
  }, [yesterdayOverviewSummary]);

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

  const getSelectionRange = useCallback(
    (
      anchor: { person: string; slotId: string } | null,
      end: { person: string; slotId: string } | null
    ) => {
      if (!anchor || !end || !scheduleData) return null;
      const anchorCoord = findCoord(anchor.person, anchor.slotId, scheduleData);
      const endCoord = findCoord(end.person, end.slotId, scheduleData);
      if (!anchorCoord || !endCoord) return null;
      const startRow = Math.min(anchorCoord.row, endCoord.row);
      const endRow = Math.max(anchorCoord.row, endCoord.row);
      const startCol = Math.min(anchorCoord.col, endCoord.col);
      const endCol = Math.max(anchorCoord.col, endCoord.col);
      return { startRow, endRow, startCol, endCol };
    },
    [findCoord, scheduleData]
  );

  const selectedRange = useMemo(
    () => getSelectionRange(selectionAnchor, selectionEnd),
    [getSelectionRange, selectionAnchor, selectionEnd]
  );

  const presenceRanges = useMemo(() => {
    if (!scheduleData) return [];
    return Object.values(presenceSelections)
      .map((entry) => {
        const range = getSelectionRange(entry.anchor, entry.end);
        return range
          ? { initials: entry.initials, range, user: entry.user }
          : null;
      })
      .filter(Boolean) as Array<{
      initials: string;
      range: { startRow: number; endRow: number; startCol: number; endCol: number };
      user: string;
    }>;
  }, [getSelectionRange, presenceSelections, scheduleData]);

  const getPresenceLockForCoord = useCallback(
    (row: number, col: number) =>
      presenceRanges.find(
        (entry) =>
          row >= entry.range.startRow &&
          row <= entry.range.endRow &&
          col >= entry.range.startCol &&
          col <= entry.range.endCol
      ) || null,
    [presenceRanges]
  );

  const getPresenceLockForCell = useCallback(
    (person: string, slotId: string) => {
      if (!scheduleData) return null;
      const coord = findCoord(person, slotId, scheduleData);
      if (!coord) return null;
      return getPresenceLockForCoord(coord.row, coord.col);
    },
    [findCoord, getPresenceLockForCoord, scheduleData]
  );

  const selectedCells = useMemo(() => {
    if (!selectedRange || !scheduleData) return [];
    const cells: { person: string; slotId: string }[] = [];
    for (let row = selectedRange.startRow; row <= selectedRange.endRow; row += 1) {
      const person = scheduleData.people[row];
      scheduleData.slots.forEach((slot, colIdx) => {
        if (colIdx < selectedRange.startCol || colIdx > selectedRange.endCol) return;
        cells.push({ person, slotId: slot.id });
      });
    }
    return cells;
  }, [scheduleData, selectedRange]);

  const selectionInitials = useMemo(() => {
    if (!currentUserName) return "";
    const parts = currentUserName.trim().split(/\s+/);
    const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "");
    return initials.join("") || currentUserName.slice(0, 2).toUpperCase();
  }, [currentUserName]);

  useEffect(() => {
    if (typeof window === "undefined" || !currentUserName || isAfk) return;
    if (customTablesDateLabel) {
      void fetch("/api/schedule/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: currentUserName,
          initials: selectionInitials,
          dateLabel: customTablesDateLabel,
          anchor: selectionAnchor,
          end: selectionEnd,
        }),
      });
    }
    if (!("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel("admin-schedule-presence");
    const payload = {
      user: currentUserName,
      initials: selectionInitials,
      updatedAt: Date.now(),
      anchor: selectionAnchor,
      end: selectionEnd,
    };
    channel.postMessage(payload);
    channel.close();
  }, [
    currentUserName,
    customTablesDateLabel,
    isAfk,
    selectionAnchor,
    selectionEnd,
    selectionInitials,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel("admin-schedule-presence");
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as {
        user?: string;
        initials?: string;
        updatedAt?: number;
        anchor?: { person: string; slotId: string } | null;
        end?: { person: string; slotId: string } | null;
      };
      const user = typeof data?.user === "string" ? data.user : "";
      if (!user || user === currentUserName) return;
      setPresenceSelections((prev) => ({
        ...prev,
        [user]: {
          user,
          initials: data.initials || user.slice(0, 2).toUpperCase(),
          updatedAt: data.updatedAt || Date.now(),
          anchor: data.anchor ?? null,
          end: data.end ?? null,
        },
      }));
    };
    channel.addEventListener("message", handleMessage);
    return () => {
      channel.removeEventListener("message", handleMessage);
      channel.close();
    };
  }, [currentUserName]);

  useEffect(() => {
    if (!customTablesDateLabel || isAfk) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/schedule/presence?date=${encodeURIComponent(customTablesDateLabel)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const json = await res.json();
        const entries = Array.isArray(json.entries) ? json.entries : [];
        setPresenceSelections((prev) => {
          const next = { ...prev };
          entries.forEach((entry: any) => {
            if (!entry?.user || entry.user === currentUserName) return;
            next[entry.user] = {
              user: entry.user,
              initials: entry.initials || entry.user.slice(0, 2).toUpperCase(),
              updatedAt: entry.updatedAt || Date.now(),
              anchor: entry.anchor ?? null,
              end: entry.end ?? null,
            };
          });
          return next;
        });
      } catch (err) {
        console.warn("Failed to load presence", err);
      }
    }, 3_000);
    return () => clearInterval(interval);
  }, [currentUserName, customTablesDateLabel, isAfk]);

  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 20_000;
      setPresenceSelections((prev) => {
        const next: typeof prev = {};
        Object.values(prev).forEach((entry) => {
          if (entry.updatedAt >= cutoff) {
            next[entry.user] = entry;
          }
        });
        return next;
      });
    }, 5_000);
    return () => clearInterval(interval);
  }, []);

  const pushUndoEntry = useCallback((entry: UndoEntry) => {
    if (!entry.changes.length) return;
    setUndoStack((prev) => {
      const next = [...prev, entry];
      if (next.length <= MAX_UNDO_ENTRIES) return next;
      return next.slice(next.length - MAX_UNDO_ENTRIES);
    });
    setRedoStack([]);
  }, []);

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
      setHasUnpublishedChanges(true);
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

  const clearSchedule = useCallback(async () => {
    if (!scheduleData) {
      setMessage("Load a schedule before clearing it.");
      return;
    }
    const activeDate = selectedDate || scheduleData?.scheduleDate || "";
    if (scheduleMode === "page" && !activeDate) {
      setScheduleNote("Pick a schedule date before clearing.");
      return;
    }
    if (!window.confirm(`Clear every task and note for ${activeDate || "this day"}?`)) {
      return;
    }

    const changes: UndoChange[] = [];
    const nextCells = scheduleData.cells.map((row, rowIdx) =>
      row.map((cell, colIdx) => {
        const hasContent = cell.tasks.length > 0 || Boolean(cell.note);
        if (!hasContent) return cell;
        const nextContent: CellContent = { ...cell, tasks: [], note: "" };
        changes.push({
          person: scheduleData.people[rowIdx],
          slotId: scheduleData.slots[colIdx].id,
          previous: cloneCellContent(cell),
          next: nextContent,
        });
        return nextContent;
      })
    );

    if (!changes.length) {
      setScheduleNote("Schedule already cleared.");
      return;
    }

    pushUndoEntry({ label: `Clear schedule for ${activeDate || "this day"}`, changes });
    setScheduleData({ ...scheduleData, cells: nextCells });
    await Promise.all(
      changes.map((change) => persistCell(change.person, change.slotId, change.next))
    );
    setScheduleNote(`Cleared schedule for ${activeDate || "this day"}.`);
  }, [persistCell, pushUndoEntry, scheduleData, scheduleMode, selectedDate]);

  const clearCompletedOneOffTasks = useCallback(async () => {
    if (!scheduleData) {
      setMessage("Load a schedule before clearing one-off tasks.");
      return;
    }
    const activeDate = selectedDate || scheduleData?.scheduleDate || "";
    if (scheduleMode === "page" && !activeDate) {
      setScheduleNote("Pick a schedule date before clearing one-off tasks.");
      return;
    }
    const activeIso = formatLabelToInput(activeDate);
    if (
      !window.confirm(
        "Clear completed one-off tasks from this schedule day? Only completed one-offs will be removed."
      )
    ) {
      return;
    }

    const changes: UndoChange[] = [];
    const nextCells = scheduleData.cells.map((row, rowIdx) =>
      row.map((cell, colIdx) => {
        if (!cell.tasks.length) return cell;
        const nextTasks = cell.tasks.filter((task) => {
          const meta = taskMetaById.get(task.id);
          const isOneOff = meta ? !meta.recurring : false;
          const status = (meta?.status || "").toLowerCase();
          const matchesDate =
            !activeIso || !meta?.occurrenceDate || meta.occurrenceDate === activeIso;
          return !(isOneOff && status === "completed" && matchesDate);
        });
        if (nextTasks.length === cell.tasks.length) return cell;
        const nextContent: CellContent = { ...cell, tasks: nextTasks };
        changes.push({
          person: scheduleData.people[rowIdx],
          slotId: scheduleData.slots[colIdx].id,
          previous: cloneCellContent(cell),
          next: nextContent,
        });
        return nextContent;
      })
    );

    if (!changes.length) {
      setScheduleNote("No completed one-off tasks to clear.");
      return;
    }

    pushUndoEntry({ label: "Clear completed one-off tasks", changes });
    setScheduleData({ ...scheduleData, cells: nextCells });
    await Promise.all(
      changes.map((change) => persistCell(change.person, change.slotId, change.next))
    );
    setScheduleNote(`Cleared completed one-off tasks for ${activeDate || "this day"}.`);
  }, [
    formatLabelToInput,
    persistCell,
    pushUndoEntry,
    scheduleData,
    scheduleMode,
    selectedDate,
    taskMetaById,
  ]);

  const undoLastChange = useCallback(async () => {
    if (!scheduleData || !undoStack.length) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => {
      const next = [...prev, last];
      if (next.length <= MAX_UNDO_ENTRIES) return next;
      return next.slice(next.length - MAX_UNDO_ENTRIES);
    });
    const nextCells = scheduleData.cells.map((row) =>
      row.map((cell) => cloneCellContent(cell))
    );

    last.changes.forEach((change) => {
      const coord = findCoord(change.person, change.slotId, scheduleData);
      if (!coord) return;
      nextCells[coord.row][coord.col] = cloneCellContent(change.previous);
    });

    setScheduleData({ ...scheduleData, cells: nextCells });
    await Promise.all(
      last.changes.map((change) => persistCell(change.person, change.slotId, change.previous))
    );
  }, [findCoord, persistCell, scheduleData, undoStack]);

  const redoLastChange = useCallback(async () => {
    if (!scheduleData || !redoStack.length) return;
    const last = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => {
      const next = [...prev, last];
      if (next.length <= MAX_UNDO_ENTRIES) return next;
      return next.slice(next.length - MAX_UNDO_ENTRIES);
    });
    const nextCells = scheduleData.cells.map((row) =>
      row.map((cell) => cloneCellContent(cell))
    );

    last.changes.forEach((change) => {
      const coord = findCoord(change.person, change.slotId, scheduleData);
      if (!coord) return;
      nextCells[coord.row][coord.col] = cloneCellContent(change.next);
    });

    setScheduleData({ ...scheduleData, cells: nextCells });
    await Promise.all(
      last.changes.map((change) => persistCell(change.person, change.slotId, change.next))
    );
  }, [findCoord, persistCell, redoStack, scheduleData]);

  const createQuickTask = useCallback(async () => {
    if (!quickTaskName.trim() || !selectedDate) return;
    if (quickTaskName.includes(",")) {
      setMessage("Task name cannot include commas.");
      return;
    }
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
          created_by_name: currentUserName || null,
          task_help_references: [currentUserName || ""].filter(Boolean),
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
  }, [currentUserName, quickTaskDescription, quickTaskName, selectedDate, setMessage]);

  const createRecurringQuickTask = useCallback(async () => {
    if (!recurringQuickName.trim()) return;
    if (recurringQuickName.includes(",")) {
      setMessage("Task name cannot include commas.");
      return;
    }
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
          created_by_name: currentUserName || null,
          task_help_references: [currentUserName || ""].filter(Boolean),
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
    setMessage,
  ]);

  const resolveTaskEntry = useCallback(
    async (taskName: string): Promise<ScheduledTask | null> => {
      const trimmed = taskName.trim();
      if (!trimmed) return null;
      if (trimmed.includes(",")) {
        setMessage("Task name cannot include commas.");
        return null;
      }
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
    [oneOffTasks, recurringTasks, selectedDate, setMessage]
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

      const changeMap = new Map<string, UndoChange>();
      updates.forEach((update) => {
        const coord = findCoord(update.person, update.slotId, scheduleData);
        if (!coord) return;
        const key = `${update.person}-${update.slotId}`;
        const previous = cloneCellContent(scheduleData.cells[coord.row][coord.col]);
        const next = cloneCellContent(nextCells[coord.row][coord.col]);
        changeMap.set(key, {
          person: update.person,
          slotId: update.slotId,
          previous,
          next,
        });
      });

      pushUndoEntry({
        label: payload.fromPerson ? "Move task" : "Add task",
        changes: Array.from(changeMap.values()),
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
    [findCoord, persistCell, pushUndoEntry, scheduleData]
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
      const previous = cloneCellContent(scheduleData.cells[coord.row][coord.col]);
      content.tasks.splice(idx, 1);
      pushUndoEntry({
        label: "Remove task",
        changes: [
          {
            person: cell.person,
            slotId: cell.slotId,
            previous,
            next: cloneCellContent(content),
          },
        ],
      });
      setScheduleData({ ...scheduleData, cells: nextCells });
      persistCell(cell.person, cell.slotId, content);
    },
    [findCoord, persistCell, pushUndoEntry, scheduleData]
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
      const presenceLock = getPresenceLockForCell(person, slot.id);
      if (presenceLock) {
        setSaveLog({
          status: "error",
          message: `${presenceLock.user} is editing this cell right now.`,
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
      const modifierPressed = copyDragActive || e.ctrlKey || e.metaKey;
      e.dataTransfer.dropEffect = modifierPressed ? "copy" : "move";
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
        if (modifierPressed && parsed.fromPerson) {
          parsed = { taskId: parsed.taskId, taskName: parsed.taskName };
        }
        handleTaskMove(parsed, {
          person,
          slotId: slot.id,
          slotLabel: slot.label,
          targetIndex,
        });
        setPendingInsert(null);
      };

      void finalizeDrop();
    },
    [
      copyDragActive,
      handleTaskMove,
      getPresenceLockForCell,
      resolveTaskEntry,
      scheduleData,
      scheduleMode,
      selectedDate,
    ]
  );

  const handleDragOverEvent = useCallback(
    (e: React.DragEvent, person: string, slotId: string, index: number) => {
      e.preventDefault();
      e.stopPropagation();
      const modifierPressed = copyDragActive || e.ctrlKey || e.metaKey;
      const shouldCopy = modifierPressed || !draggingTask?.fromPerson;
      e.dataTransfer.dropEffect = shouldCopy ? "copy" : "move";
      setPendingInsert({ person, slotId, index });
    },
    [copyDragActive, draggingTask]
  );

  const getCellValue = (cell: { person: string; slotId: string } | null) => {
    if (!cell || !scheduleData) return null;
    const coord = findCoord(cell.person, cell.slotId, scheduleData);
    if (!coord) return null;
    const content = scheduleData.cells?.[coord.row]?.[coord.col];
    if (!content) return null;
    return { content };
  };

  const handleCopyCell = useCallback(() => {
    if (!selectedCell || !scheduleData) return;
    if (selectedRange) {
      const rows = selectedRange.endRow - selectedRange.startRow + 1;
      const cols = selectedRange.endCol - selectedRange.startCol + 1;
      const cells: CellContent[][] = [];
      for (let row = 0; row < rows; row += 1) {
        const rowItems: CellContent[] = [];
        for (let col = 0; col < cols; col += 1) {
          const person = scheduleData.people[selectedRange.startRow + row];
          const slot = scheduleData.slots[selectedRange.startCol + col];
          const coord = findCoord(person, slot.id, scheduleData);
          const content = coord
            ? scheduleData.cells?.[coord.row]?.[coord.col]
            : { tasks: [], note: "" };
          rowItems.push(cloneCellContent(content || { tasks: [], note: "" }));
        }
        cells.push(rowItems);
      }
      setCellClipboardRange({ rows, cols, cells });
      setCellClipboard(null);
      setMessage(`Copied ${rows}×${cols} cells.`);
      return;
    }
    const current = getCellValue(selectedCell);
    if (!current) return;
    setCellClipboard(cloneCellContent(current.content));
    setCellClipboardRange(null);
    setMessage("Cell copied.");
  }, [findCoord, getCellValue, scheduleData, selectedCell, selectedRange]);

  const applyCellContent = useCallback(
    (cell: { person: string; slotId: string }, nextContent: CellContent, label: string) => {
      if (!scheduleData) return;
      const presenceLock = getPresenceLockForCell(cell.person, cell.slotId);
      if (presenceLock) {
        setMessage(`${presenceLock.user} is editing this cell right now.`);
        return;
      }
      const coord = findCoord(cell.person, cell.slotId, scheduleData);
      if (!coord) return;
      const nextCells = scheduleData.cells.map((row) =>
        row.map((entry) => ({ ...entry, tasks: [...entry.tasks] }))
      );
      const previous = cloneCellContent(scheduleData.cells[coord.row][coord.col]);
      nextCells[coord.row][coord.col] = nextContent;
      pushUndoEntry({
        label,
        changes: [
          {
            person: cell.person,
            slotId: cell.slotId,
            previous,
            next: nextContent,
          },
        ],
      });
      setScheduleData({ ...scheduleData, cells: nextCells });
      persistCell(cell.person, cell.slotId, nextContent);
    },
    [findCoord, getPresenceLockForCell, persistCell, pushUndoEntry, scheduleData]
  );

  const applyCellRange = useCallback(
    (startCell: { person: string; slotId: string }, range: { rows: number; cols: number; cells: CellContent[][] }) => {
      if (!scheduleData) return;
      const startCoord = findCoord(startCell.person, startCell.slotId, scheduleData);
      if (!startCoord) return;
      const changes: UndoChange[] = [];
      const nextCells = scheduleData.cells.map((row) =>
        row.map((entry) => ({ ...entry, tasks: [...entry.tasks] }))
      );

      for (let row = 0; row < range.rows; row += 1) {
        const person = scheduleData.people[startCoord.row + row];
        if (!person) break;
        for (let col = 0; col < range.cols; col += 1) {
          const slot = scheduleData.slots[startCoord.col + col];
          if (!slot) break;
          const coord = findCoord(person, slot.id, scheduleData);
          if (!coord) continue;
          const presenceLock = getPresenceLockForCell(person, slot.id);
          if (presenceLock) continue;
          const nextContent = cloneCellContent(range.cells[row][col]);
          const previous = cloneCellContent(scheduleData.cells[coord.row][coord.col]);
          nextCells[coord.row][coord.col] = nextContent;
          changes.push({
            person,
            slotId: slot.id,
            previous,
            next: nextContent,
          });
        }
      }

      if (!changes.length) return;
      pushUndoEntry({ label: "Paste range", changes });
      setScheduleData({ ...scheduleData, cells: nextCells });
      changes.forEach((change) => {
        persistCell(change.person, change.slotId, change.next);
      });
    },
    [findCoord, getPresenceLockForCell, persistCell, pushUndoEntry, scheduleData]
  );

  const resolveSlotLabel = useCallback(
    (slotId: string) => scheduleData?.slots.find((slot) => slot.id === slotId)?.label || slotId,
    [scheduleData]
  );

  const handlePasteCell = useCallback(() => {
    if (!selectedCell || !scheduleData) return;
    if (cellClipboardRange) {
      applyCellRange(selectedCell, cellClipboardRange);
      return;
    }
    if (!cellClipboard) return;
    const nextContent = cloneCellContent(cellClipboard);
    applyCellContent(selectedCell, nextContent, "Paste cell");
  }, [applyCellContent, applyCellRange, cellClipboard, cellClipboardRange, scheduleData, selectedCell]);

  const normalizeClipboardContent = useCallback((value: unknown): CellContent | null => {
    if (!value || typeof value !== "object") return null;
    const tasks = Array.isArray((value as CellContent).tasks)
      ? (value as CellContent).tasks
          .map((task) =>
            task && typeof task.id === "string" && typeof task.name === "string"
              ? { id: task.id, name: task.name }
              : null
          )
          .filter((task): task is ScheduledTask => Boolean(task))
      : [];
    const note = typeof (value as CellContent).note === "string" ? (value as CellContent).note : "";
    const blocked = Boolean((value as CellContent).blocked);
    return { tasks, note, blocked };
  }, []);

  const handleClipboardCopy = useCallback(
    (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (!selectedCell || !scheduleData) return;
      if (selectedRange) {
        const rows = selectedRange.endRow - selectedRange.startRow + 1;
        const cols = selectedRange.endCol - selectedRange.startCol + 1;
        const cells: CellContent[][] = [];
        for (let row = 0; row < rows; row += 1) {
          const rowItems: CellContent[] = [];
          for (let col = 0; col < cols; col += 1) {
            const person = scheduleData.people[selectedRange.startRow + row];
            const slot = scheduleData.slots[selectedRange.startCol + col];
            const coord = findCoord(person, slot.id, scheduleData);
            const content = coord
              ? scheduleData.cells?.[coord.row]?.[coord.col]
              : { tasks: [], note: "" };
            rowItems.push(cloneCellContent(content || { tasks: [], note: "" }));
          }
          cells.push(rowItems);
        }
        const payload = { type: "range", rows, cols, cells };
        setCellClipboardRange(payload);
        setCellClipboard(null);
        event.clipboardData?.setData("application/json", JSON.stringify(payload));
        event.clipboardData?.setData("text/plain", `Copied ${rows}x${cols} cells`);
        event.preventDefault();
        setMessage(`Copied ${rows}×${cols} cells.`);
        return;
      }
      const current = getCellValue(selectedCell);
      if (!current) return;
      const payload = cloneCellContent(current.content);
      setCellClipboard(payload);
      setCellClipboardRange(null);
      event.clipboardData?.setData("application/json", JSON.stringify(payload));
      event.clipboardData?.setData(
        "text/plain",
        payload.tasks.map((task) => task.name).join(", ")
      );
      event.preventDefault();
      setMessage("Cell copied.");
    },
    [findCoord, getCellValue, scheduleData, selectedCell, selectedRange]
  );

  const handleClipboardPaste = useCallback(
    (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (!selectedCell) return;
      const raw = event.clipboardData?.getData("application/json");
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.type === "range" && Array.isArray(parsed.cells)) {
            const rangePayload = {
              rows: Number(parsed.rows) || parsed.cells.length,
              cols: Number(parsed.cols) || (parsed.cells?.[0]?.length || 0),
              cells: parsed.cells.map((row: any[]) =>
                Array.isArray(row)
                  ? row.map((cell) => normalizeClipboardContent(cell) || { tasks: [], note: "" })
                  : []
              ),
            };
            setCellClipboardRange(rangePayload);
            applyCellRange(selectedCell, rangePayload);
            event.preventDefault();
            return;
          }
          const normalized = normalizeClipboardContent(parsed);
          if (!normalized) return;
          applyCellContent(selectedCell, normalized, "Paste cell");
          event.preventDefault();
          return;
        } catch (err) {
          console.warn("Failed to parse clipboard payload", err);
        }
      }
      const textPayload = event.clipboardData?.getData("text/plain") || "";
      if (textPayload && selectedCell) {
        const rows = textPayload.split(/\r?\n/);
        const grid = rows.map((row) => row.split("\t"));
        const rangePayload = {
          rows: grid.length,
          cols: Math.max(...grid.map((row) => row.length)),
          cells: grid.map((row) =>
            row.map((cellText) => ({
              tasks: [],
              note: cellText.trim(),
            }))
          ),
        };
        const applyTextPaste = async () => {
          const resolvedCells: CellContent[][] = [];
          for (let rowIdx = 0; rowIdx < rangePayload.rows; rowIdx += 1) {
            const rowCells: CellContent[] = [];
            for (let colIdx = 0; colIdx < rangePayload.cols; colIdx += 1) {
              const cellValue = grid[rowIdx]?.[colIdx] || "";
              const taskLine = cellValue.split(/\r?\n/)[0] ?? "";
              const entries = taskLine
                .split(TASK_SEPARATOR_REGEX)
                .map((value) => value.trim())
                .filter(Boolean);
              const tasks: ScheduledTask[] = [];
              for (const entry of entries) {
                const resolved = await resolveTaskEntry(entry);
                if (resolved) {
                  tasks.push({ id: resolved.id, name: resolved.name });
                }
              }
              rowCells.push({ tasks, note: "" });
            }
            resolvedCells.push(rowCells);
          }
          const resolvedRange = {
            rows: rangePayload.rows,
            cols: rangePayload.cols,
            cells: resolvedCells,
          };
          setCellClipboardRange(resolvedRange);
          applyCellRange(selectedCell, resolvedRange);
        };
        void applyTextPaste();
        event.preventDefault();
        return;
      }
      if (cellClipboard) {
        handlePasteCell();
        event.preventDefault();
      }
    },
    [
      applyCellContent,
      applyCellRange,
      cellClipboard,
      handlePasteCell,
      normalizeClipboardContent,
      resolveTaskEntry,
      selectedCell,
    ]
  );

  useEffect(() => {
    window.addEventListener("copy", handleClipboardCopy);
    window.addEventListener("paste", handleClipboardPaste);
    return () => {
      window.removeEventListener("copy", handleClipboardCopy);
      window.removeEventListener("paste", handleClipboardPaste);
    };
  }, [handleClipboardCopy, handleClipboardPaste]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (selectedCell && matchesCustomKeybind(event, canvasCopyKeybind)) {
        handleCopyCell();
        event.preventDefault();
        return;
      }
      if (selectedCell && matchesCustomKeybind(event, canvasPasteKeybind)) {
        handlePasteCell();
        event.preventDefault();
        return;
      }
      const isMac =
        typeof navigator !== "undefined" &&
        /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey;
      if (!modifierPressed) return;
      if (key === "z") {
        if (event.shiftKey) {
          redoLastChange();
        } else {
          undoLastChange();
        }
        event.preventDefault();
        return;
      }
      if (key === "y") {
        redoLastChange();
        event.preventDefault();
        return;
      }
      if (key === "c" && selectedCell) {
        handleCopyCell();
        event.preventDefault();
        return;
      }
      if (key === "v" && selectedCell) {
        handlePasteCell();
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    canvasCopyKeybind,
    canvasPasteKeybind,
    cellClipboard,
    handleCopyCell,
    handlePasteCell,
    redoLastChange,
    selectedCell,
    undoLastChange,
  ]);

  const toggleBlackoutCell = useCallback(
    async (person: string, slot: Slot, nextBlocked: boolean) => {
      const activeDate = selectedDate || scheduleData?.scheduleDate || "";
      if (!activeDate) return;
      const existing = scheduleData
        ? findCoord(person, slot.id, scheduleData)
        : null;
      const previousContent =
        existing && scheduleData?.cells?.[existing.row]?.[existing.col]
          ? cloneCellContent(scheduleData.cells[existing.row][existing.col])
          : { tasks: [], note: "", blocked: false };
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
          pushUndoEntry({
            label: nextBlocked ? "Block cell" : "Unblock cell",
            changes: [
              {
                person,
                slotId: slot.id,
                previous: previousContent,
                next: { tasks: [], note: "", blocked: nextBlocked },
              },
            ],
          });
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
    [findCoord, pushUndoEntry, scheduleData, selectedDate]
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

  const commitCustomTask = useCallback(
    async (
      cell: { person: string; slotId: string; slotLabel?: string },
      taskName: string
    ) => {
      if (!taskName.trim()) return;
      if (taskName.includes(",")) {
        setMessage("Task name cannot include commas.");
        return;
      }
      const presenceLock = getPresenceLockForCell(cell.person, cell.slotId);
      if (presenceLock) {
        setMessage(`${presenceLock.user} is editing this cell right now.`);
        return;
      }
      const existing = getCellValue(cell)?.content.tasks.length || 0;
      const taskEntry = await resolveTaskEntry(taskName.trim());
      if (!taskEntry) {
        setMessage("Couldn't find or create that task yet.");
        return;
      }
      handleTaskMove(
        { taskId: taskEntry.id, taskName: taskEntry.name },
        {
          person: cell.person,
          slotId: cell.slotId,
          slotLabel: cell.slotLabel ?? resolveSlotLabel(cell.slotId),
          targetIndex: existing,
        }
      );
    },
    [getCellValue, getPresenceLockForCell, handleTaskMove, resolveSlotLabel, resolveTaskEntry]
  );

  const commitPendingCustomTask = useCallback(
    (nextCell: { person: string; slotId: string }) => {
      if (!selectedCell) return;
      if (selectedCell.person === nextCell.person && selectedCell.slotId === nextCell.slotId) {
        return;
      }
      if (!customTask.trim()) return;
      skipCustomTaskBlurRef.current = true;
      void commitCustomTask(selectedCell, customTask);
      setCustomTask("");
    },
    [commitCustomTask, customTask, selectedCell]
  );

  const selectCell = (
    person: string,
    slot: Slot,
    event?: React.MouseEvent<HTMLTableCellElement>
  ) => {
    const presenceLock = getPresenceLockForCell(person, slot.id);
    if (presenceLock) {
      setMessage(`${presenceLock.user} is editing this cell right now.`);
      return;
    }
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
      commitPendingCustomTask({ person, slotId: slot.id });
    }
    const nextSelection = { person, slotId: slot.id };
    if (event?.shiftKey && selectionAnchor) {
      setSelectionEnd(nextSelection);
    } else {
      setSelectionAnchor(nextSelection);
      setSelectionEnd(nextSelection);
    }
    setSelectedCell({ person, slotId: slot.id, slotLabel: slot.label });
  };

  useEffect(() => {
    if (!isSelectingRange) return;
    const stopSelection = () => setIsSelectingRange(false);
    window.addEventListener("mouseup", stopSelection);
    return () => window.removeEventListener("mouseup", stopSelection);
  }, [isSelectingRange]);

  const handleCustomAdd = async () => {
    if (!customTask.trim()) return;
    const targetCell = customTaskCellRef.current || selectedCell;
    if (!targetCell) return;
    await commitCustomTask(targetCell, customTask);
    setCustomTask("");
  };

  const loadTaskDetail = async (
    taskId: string,
    fallbackName?: string,
    options?: { preserveCurrentTask?: boolean }
  ) => {
    if (!taskId) return;
    setTaskDetailLoading(true);
    setTaskEditMessage(null);
    setPhotoMessage(null);
    setPendingPhotoFile(null);
    const preserveCurrentTask = Boolean(options?.preserveCurrentTask);
    try {
      const baseRes = await fetch(`/api/task?id=${encodeURIComponent(taskId)}`);
      const baseJson = await baseRes.json();
      if (!baseRes.ok) throw new Error(baseJson.error || "Failed to load task details");
      const baseName = String(baseJson.name || fallbackName || "Task").trim();
      const baseRecurring = Boolean(baseJson.recurring || baseJson.parentTaskId);

      let resolvedTaskId = String(baseJson.id || taskId);
      if (!preserveCurrentTask && !baseRecurring && baseName) {
        try {
          const lookup = new URLSearchParams({
            search: baseName,
            recurring: "false",
            includeOccurrences: "true",
          });
          const historyRes = await fetch(`/api/tasks?${lookup.toString()}`);
          const historyJson = await historyRes.json().catch(() => ({}));
          const candidates = Array.isArray(historyJson.tasks) ? historyJson.tasks : [];
          const exactNameCandidates = candidates.filter((task: any) =>
            String(task?.name || "").trim().toLowerCase() === baseName.toLowerCase()
          );
          const sameDay = exactNameCandidates.find(
            (task: any) => String(task?.occurrence_date || "") === selectedDate
          );
          const sortedByDate = [...exactNameCandidates]
            .filter((task: any) => String(task?.occurrence_date || "").trim())
            .sort((a: any, b: any) =>
              String(b.occurrence_date || "").localeCompare(String(a.occurrence_date || ""))
            );
          const mostRecent = sortedByDate[0];
          const preferred = sameDay || mostRecent;
          if (preferred?.id) {
            resolvedTaskId = String(preferred.id);
          }
        } catch (historyErr) {
          console.warn("Failed to resolve one-off task variant:", historyErr);
        }
      }

      const detailRes =
        resolvedTaskId === String(baseJson.id || taskId)
          ? baseRes
          : await fetch(`/api/task?id=${encodeURIComponent(resolvedTaskId)}`);
      const json =
        resolvedTaskId === String(baseJson.id || taskId)
          ? baseJson
          : await detailRes.json();
      if (!detailRes.ok) {
        throw new Error(json.error || "Failed to load task details");
      }

      const normalizedLinks = Array.isArray(json.links)
        ? json.links.map((link: any) => {
            if (typeof link === "string") {
              return { label: link, url: link };
            }
            return {
              label: String(link?.label || ""),
              url: String(link?.url || ""),
            };
          })
        : [];
      const detail = {
        id: json.id || resolvedTaskId,
        name: json.name || fallbackName || "Task",
        description: json.description || "",
        extraNotes: Array.isArray(json.extraNotes) ? json.extraNotes : [],
        personCount: json.personCount ?? null,
        status: json.status || "",
        priority: json.priority || "",
        taskType: json.taskType,
        links: normalizedLinks,
        recurring: json.recurring || false,
        recurrenceInterval: json.recurrenceInterval ?? null,
        recurrenceUnit: json.recurrenceUnit || null,
        recurrenceUntil: json.recurrenceUntil || null,
        occurrenceDate: json.occurrenceDate || null,
        parentTaskId: json.parentTaskId || null,
        createdByName: json.createdByName || null,
        taskHelpReferences: Array.isArray(json.taskHelpReferences)
          ? json.taskHelpReferences.map((entry: any) => String(entry || "").trim()).filter(Boolean)
          : [],
      };
      setTaskDetail(detail);
      const nextDraft = {
        name: detail.name || "",
        description: detail.description || "",
        extraNotes: buildNotesText(detail.extraNotes || []),
        personCount:
          detail.personCount === null || detail.personCount === undefined
            ? ""
            : String(detail.personCount),
        status: detail.status || "",
        priority: detail.priority || "",
        taskType: detail.taskType?.name || "",
        links: normalizedLinks,
        taskHelpReferences: Array.isArray(json.taskHelpReferences)
          ? json.taskHelpReferences.map((entry: any) => String(entry || "").trim()).filter(Boolean)
          : [],
      };
      setTaskEditDraft(nextDraft);
      setTaskEditApplyTo("single");
      setTaskEditFutureDate(detail.occurrenceDate || selectedDate || "");
      setExpandedOverviewTasks(new Set());
      taskEditLastSavedSignatureRef.current = getTaskEditSignature(nextDraft, detail.id);
      setTaskEditMessage("Saved");

      if (!detail.recurring && detail.name) {
        setTaskHistoryLoading(true);
        try {
          const params = new URLSearchParams({
            search: detail.name,
            recurring: "false",
            includeOccurrences: "true",
          });
          const historyRes = await fetch(`/api/tasks?${params.toString()}`);
          const historyJson = await historyRes.json().catch(() => ({}));
          const rows = Array.isArray(historyJson.tasks) ? historyJson.tasks : [];
          const snapshots = rows
            .filter((row: any) => String(row?.name || "").trim().toLowerCase() === detail.name.trim().toLowerCase())
            .map((row: any) => ({
              id: String(row.id || ""),
              name: String(row.name || detail.name),
              occurrenceDate: row.occurrence_date ? String(row.occurrence_date) : null,
              description: String(row.description || ""),
              extraNotes: Array.isArray(row.extra_notes) ? row.extra_notes.map((n: any) => String(n || "")).filter(Boolean) : [],
              personCount: row.person_count === null || row.person_count === undefined ? null : Number(row.person_count),
              status: String(row.status || ""),
              priority: String(row.priority || ""),
              taskTypeName: String(row?.task_type?.name || ""),
              links: Array.isArray(row.links)
                ? row.links.map((value: any) => {
                    const text = String(value || "");
                    return { label: text, url: text };
                  })
                : [],
            }))
            .filter((snapshot: TaskHistorySnapshot) => Boolean(snapshot.id))
            .sort((a: TaskHistorySnapshot, b: TaskHistorySnapshot) =>
              String(b.occurrenceDate || "").localeCompare(String(a.occurrenceDate || ""))
            );
          setTaskOneOffHistory(snapshots);
          setTaskHistoryPreview(null);
        } catch (historyErr) {
          console.error("Failed to load one-off task history", historyErr);
          setTaskOneOffHistory([]);
          setTaskHistoryPreview(null);
        } finally {
          setTaskHistoryLoading(false);
        }
      } else {
        setTaskOneOffHistory([]);
        setTaskHistoryPreview(null);
      }
    } catch (err) {
      console.error(err);
      const friendly = err instanceof Error ? err.message : "Unable to load that task right now.";
      setMessage(friendly);
      setTaskDetail(null);
      setTaskOneOffHistory([]);
      setTaskHistoryPreview(null);
      setTaskEditDraft({
        name: "",
        description: "",
        extraNotes: "",
        personCount: "",
        status: "",
        priority: "",
        taskType: "",
        links: [],
        taskHelpReferences: [],
      });
    } finally {
      setTaskDetailLoading(false);
    }
  };

  const copyHistorySnapshotToDraft = useCallback(
    (snapshot: TaskHistorySnapshot, field: "all" | "description" | "extraNotes" | "status" | "priority" | "personCount" | "taskType" | "links") => {
      setTaskEditDraft((prev) => {
        if (field === "all") {
          return {
            ...prev,
            description: snapshot.description || "",
            extraNotes: buildNotesText(snapshot.extraNotes || []),
            personCount:
              snapshot.personCount === null || snapshot.personCount === undefined
                ? ""
                : String(snapshot.personCount),
            status: snapshot.status || prev.status,
            priority: snapshot.priority || prev.priority,
            taskType: snapshot.taskTypeName || prev.taskType,
            links: snapshot.links.length ? snapshot.links : prev.links,
          };
        }
        if (field === "description") return { ...prev, description: snapshot.description || "" };
        if (field === "extraNotes") return { ...prev, extraNotes: buildNotesText(snapshot.extraNotes || []) };
        if (field === "status") return { ...prev, status: snapshot.status || prev.status };
        if (field === "priority") return { ...prev, priority: snapshot.priority || prev.priority };
        if (field === "personCount") {
          return {
            ...prev,
            personCount:
              snapshot.personCount === null || snapshot.personCount === undefined
                ? ""
                : String(snapshot.personCount),
          };
        }
        if (field === "taskType") return { ...prev, taskType: snapshot.taskTypeName || prev.taskType };
        if (field === "links") return { ...prev, links: snapshot.links.length ? snapshot.links : prev.links };
        return prev;
      });
      setTaskEditMessage("Loaded past values into current task draft");
    },
    []
  );

  const updateTaskMetadata = useCallback(
    (taskId: string, updates: Partial<TaskCatalogItem>) => {
      const applyUpdates = (task: TaskCatalogItem) =>
        task.id === taskId ? { ...task, ...updates } : task;
      setRecurringTasks((prev) => prev.map(applyUpdates));
      setOneOffTasks((prev) => prev.map(applyUpdates));
      setYesterdayRecurringTasks((prev) => prev.map(applyUpdates));
    },
    []
  );

  const getTaskEditSignature = useCallback(
    (draft: typeof taskEditDraft, detailId?: string | null) =>
      JSON.stringify({
        id: detailId || taskDetail?.id || "",
        name: draft.name.trim(),
        description: draft.description.trim(),
        extraNotes: draft.extraNotes.trim(),
        personCount: draft.personCount.trim(),
        status: draft.status,
        priority: draft.priority,
        taskType: draft.taskType,
        links: draft.links.map((link) => ({
          label: String(link.label || "").trim(),
          url: String(link.url || "").trim(),
        })),
        taskHelpReferences: Array.from(new Set((draft.taskHelpReferences || []).map((entry) => String(entry || "").trim()).filter(Boolean))).sort(),
      }),
    [taskDetail?.id]
  );

  const saveTaskEdits = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!taskDetail?.id) return false;
    setTaskEditSaving(true);
    if (!silent) {
      setTaskEditMessage("Auto-saving…");
    }
    try {
      const trimmedName = taskEditDraft.name.trim();
      const notesList = taskEditDraft.extraNotes
        .split("\n")
        .map((note) => note.trim())
        .filter(Boolean);
      const personCount =
        taskEditDraft.personCount.trim() === ""
          ? null
          : Number(taskEditDraft.personCount);
      const links = taskEditDraft.links
        .map((link) => ({
          label: String(link.label || "").trim(),
          url: String(link.url || "").trim(),
        }))
        .filter((link) => link.label || link.url);
      const linkValues = links
        .map((link) => link.url || link.label)
        .filter(Boolean);
      const taskTypeMatch = taskTypes.find(
        (type) => type.name === taskEditDraft.taskType
      );
      const defaultStatus =
        statusOptions.find((opt) => opt.name)?.name || "Not Started";
      const nextStatus =
        taskEditDraft.status || taskDetail.status || defaultStatus;
      const defaultPriority = "Medium";
      const nextPriority =
        taskEditDraft.priority || taskDetail.priority || defaultPriority;
      const normalizedTaskHelpReferences = Array.from(
        new Set(
          (taskEditDraft.taskHelpReferences || [])
            .map((entry) => String(entry || "").trim())
            .filter(Boolean)
        )
      );
      const taskHelpReferences = normalizedTaskHelpReferences.length
        ? normalizedTaskHelpReferences
        : [taskDetail.createdByName || currentUserName || ""].filter(Boolean);
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: taskDetail.id,
          applyTo:
            taskDetail.recurring || taskDetail.parentTaskId ? taskEditApplyTo : "single",
          occurrenceDate:
            taskEditApplyTo === "future"
              ? taskEditFutureDate || taskDetail.occurrenceDate || null
              : taskDetail.occurrenceDate || null,
          name: trimmedName || taskDetail.name,
          description: taskEditDraft.description.trim(),
          extra_notes: notesList,
          person_count: Number.isNaN(personCount) ? null : personCount,
          status: nextStatus,
          priority: nextPriority,
          task_type_id: taskTypeMatch?.id || null,
          links: linkValues,
          task_help_references: taskHelpReferences,
          recurrence_interval:
            taskDetail.recurring && taskDetail.recurrenceInterval
              ? Math.max(1, Number(taskDetail.recurrenceInterval) || 1)
              : undefined,
          recurrence_unit:
            taskDetail.recurring && taskDetail.recurrenceUnit
              ? taskDetail.recurrenceUnit
              : undefined,
          recurrence_until:
            taskDetail.recurring && taskDetail.recurrenceUntil
              ? taskDetail.recurrenceUntil
              : null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to update task");
      setTaskDetail({
        ...taskDetail,
        name: trimmedName || taskDetail.name,
        description: taskEditDraft.description.trim(),
        extraNotes: notesList,
        personCount: Number.isNaN(personCount) ? null : personCount,
        status: nextStatus || "",
        priority: nextPriority || "",
        taskType: taskTypeMatch
          ? { name: taskTypeMatch.name, color: taskTypeMatch.color }
          : taskDetail.taskType,
        links,
        taskHelpReferences,
      });
      updateTaskMetadata(taskDetail.id, {
        name: trimmedName || taskDetail.name,
        description: taskEditDraft.description.trim(),
        personCount: Number.isNaN(personCount) ? null : personCount,
        status: nextStatus || "",
        priority: nextPriority || "",
        type: taskTypeMatch?.name || taskDetail.taskType?.name || "",
        typeColor: taskTypeMatch?.color || taskDetail.taskType?.color || "default",
        taskHelpReferences,
      });
      if (trimmedName && trimmedName !== taskDetail.name && scheduleData) {
        setScheduleData((prev) => {
          if (!prev) return prev;
          const nextCells = prev.cells.map((row) =>
            row.map((cell) => ({
              ...cell,
              tasks: cell.tasks.map((task) =>
                task.id === taskDetail.id ? { ...task, name: trimmedName } : task
              ),
            }))
          );
          return { ...prev, cells: nextCells };
        });
      }
      taskEditLastSavedSignatureRef.current = getTaskEditSignature(taskEditDraft, taskDetail.id);
      setTaskEditMessage("Saved");
      return true;
    } catch (err) {
      console.error(err);
      const friendly = err instanceof Error ? err.message : "Failed to update task";
      setTaskEditMessage(friendly);
      return false;
    } finally {
      setTaskEditSaving(false);
    }
  };

  useEffect(() => {
    if (!taskDetail?.id) return;
    const signature = getTaskEditSignature(taskEditDraft, taskDetail.id);
    if (signature === taskEditLastSavedSignatureRef.current) return;
    setTaskEditMessage("Auto-saving…");
    if (taskEditAutoSaveTimerRef.current) {
      clearTimeout(taskEditAutoSaveTimerRef.current);
    }
    taskEditAutoSaveTimerRef.current = setTimeout(() => {
      void saveTaskEdits({ silent: true });
    }, 900);

    return () => {
      if (taskEditAutoSaveTimerRef.current) {
        clearTimeout(taskEditAutoSaveTimerRef.current);
      }
    };
  }, [getTaskEditSignature, saveTaskEdits, taskDetail?.id, taskEditDraft, taskEditApplyTo, taskEditFutureDate]);

  const updateTaskNameInState = useCallback((taskId: string, name: string) => {
    setScheduleData((prev) => {
      if (!prev) return prev;
      const nextCells = prev.cells.map((row) =>
        row.map((cell) => ({
          ...cell,
          tasks: cell.tasks.map((task) =>
            task.id === taskId ? { ...task, name } : task
          ),
        }))
      );
      return { ...prev, cells: nextCells };
    });
    setRecurringTasks((prev) =>
      prev.map((task) => (task.id === taskId ? { ...task, name } : task))
    );
    setOneOffTasks((prev) =>
      prev.map((task) => (task.id === taskId ? { ...task, name } : task))
    );
    setYesterdayRecurringTasks((prev) =>
      prev.map((task) => (task.id === taskId ? { ...task, name } : task))
    );
  }, []);

  const saveInlineTaskName = useCallback(
    async (taskId: string, name: string, reset = true) => {
      const trimmed = name.trim();
      if (!trimmed || editingTaskSaving) {
        if (reset) {
          setEditingTaskKey(null);
          setEditingTaskId(null);
        }
        return;
      }
      setEditingTaskSaving(true);
      try {
        const res = await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: taskId,
            applyTo: "single",
            name: trimmed,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error || "Failed to update task name.");
        }
        updateTaskNameInState(taskId, trimmed);
        setTaskEditMessage("Task name updated.");
      } catch (err) {
        console.error("Failed to update task name", err);
        const friendly =
          err instanceof Error ? err.message : "Failed to update task name.";
        setTaskEditMessage(friendly);
      } finally {
        setEditingTaskSaving(false);
        if (reset) {
          setEditingTaskKey(null);
          setEditingTaskId(null);
        }
      }
    },
    [editingTaskSaving, updateTaskNameInState]
  );

  const handlePhotoUpload = async (overrideFile?: File | null) => {
    if (!taskDetail?.id || !taskDetail?.name) {
      setPhotoMessage("Select a task before uploading a photo.");
      return;
    }
    const file = overrideFile || pendingPhotoFile || photoInputRef.current?.files?.[0];
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
      setPendingPhotoFile(null);
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
              `/api/schedule?date=${encodeURIComponent(selectedDate)}&staging=1`,
              { cache: "no-store" }
            )
          : await fetch("/api/schedule", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        setScheduleData(json);
        setMessage(null);
      }
      if (scheduleMode === "page") {
        const listRes = await fetch("/api/schedule/list", { cache: "no-store" });
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

  const sendVolunteerReminder = async () => {
    try {
      setMessage("Sending reminder notifications...");
      const res = await fetch("/api/push/remind", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to send reminders.");
      }
      setMessage("Reminder sent to volunteers.");
    } catch (err) {
      console.error("Reminder failed", err);
      setMessage("Unable to send reminder notifications.");
    }
  };

  const hasRecurringOccurrenceForDate = useCallback(
    (task: OverviewTaskEntry, targetIso: string) =>
      recurringTasks.some(
        (item) =>
          (item.parentTaskId || item.id) === (task.parentTaskId || task.id) &&
          (item.occurrenceDate || "") === targetIso
      ),
    [recurringTasks]
  );

  const handleCarryOverTask = useCallback(
    async (task: OverviewTaskEntry) => {
      if (!selectedDate) return;
      const targetIso = formatLabelToInput(selectedDate);
      if (!targetIso || !task.id) return;
      if (task.recurring) {
        if (hasRecurringOccurrenceForDate(task, targetIso)) {
          setMessage(`"${task.name}" already exists on ${selectedDate}.`);
          return;
        }
      }
      setCarryOverTaskId(task.id);
      try {
        if (task.recurring) {
          const res = await fetch("/api/tasks/occurrence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              seriesId: task.parentTaskId || task.id,
              occurrenceDate: targetIso,
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            throw new Error(json.error || "Failed to carry over recurring task.");
          }
          if (json?.task?.id) {
            setRecurringTasks((prev) => {
              if (prev.some((item) => item.id === json.task.id)) return prev;
              return [
                {
                  id: json.task.id,
                  name: json.task.name,
                  type: json.task.task_type?.name || "",
                  typeColor: json.task.task_type?.color || "default",
                  status: json.task.status || "",
                  priority: json.task.priority || "",
                  occurrenceDate: json.task.occurrence_date || targetIso,
                  recurring: Boolean(json.task.recurring),
                  parentTaskId: json.task.parent_task_id || null,
                  description: json.task.description || null,
                  personCount: json.task.person_count ?? null,
                  timeSlots: json.task.time_slots || [],
                  estimatedTime: json.task.estimated_time || null,
                },
                ...prev,
              ];
            });
          }
        } else {
          const cloned = await cloneOneOffTaskForDate(task.id, targetIso);
          setOneOffTasks((prev) => [
            {
              id: cloned.id,
              name: cloned.name,
              type: cloned.task_type?.name || "",
              typeColor: cloned.task_type?.color || "default",
              status: cloned.status || "",
              priority: cloned.priority || "",
              occurrenceDate: cloned.occurrence_date || targetIso,
              recurring: Boolean(cloned.recurring),
              parentTaskId: cloned.parent_task_id || null,
              description: cloned.description || null,
              personCount: cloned.person_count ?? null,
              timeSlots: cloned.time_slots || [],
              estimatedTime: cloned.estimated_time || null,
            },
            ...prev,
          ]);
        }
        setMessage(`${task.recurring ? "Moved" : "Copied"} "${task.name}" to ${selectedDate}.`);
        refreshSchedule();
      } catch (err) {
        console.error("Failed to carry over task", err);
        setMessage(`Unable to ${task.recurring ? "move" : "copy"} task to today.`);
      } finally {
        setCarryOverTaskId(null);
      }
    },
    [cloneOneOffTaskForDate, formatLabelToInput, hasRecurringOccurrenceForDate, refreshSchedule, selectedDate]
  );

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
      setHasUnpublishedChanges(false);
      setScheduleNote(`Published staging schedule for ${selectedDate}.`);
    } catch (err) {
      console.error("Failed to publish schedule", err);
      setScheduleNote("Unable to publish the schedule right now.");
    }
  };

  const acceptSuggestedOneOff = useCallback(
    async (person: string, slotId: string, suggestion: SuggestedOneOffTask) => {
      if (!selectedDate) return;
      const targetIso = formatLabelToInput(selectedDate);
      if (!targetIso) return;
      try {
        const cloned = await cloneOneOffTaskForDate(suggestion.sourceTaskId, targetIso);
        const entry: ScheduledTask = {
          id: String(cloned.id),
          name: String(cloned.name || suggestion.name),
        };
        const coord = findCoord(person, slotId, scheduleData);
        if (!coord || !scheduleData) return;
        const current = scheduleData.cells[coord.row][coord.col];
        if (current.tasks.some((task) => task.id === entry.id)) return;
        const next: CellContent = {
          ...current,
          tasks: [...current.tasks, entry],
        };
        setScheduleData((prev) => {
          if (!prev) return prev;
          const nextCells = prev.cells.map((row) => row.map((cell) => cloneCellContent(cell)));
          nextCells[coord.row][coord.col] = next;
          return { ...prev, cells: nextCells };
        });
        await persistCell(person, slotId, next);
        setOneOffTasks((prev) => [
          {
            id: cloned.id,
            name: cloned.name,
            type: cloned.task_type?.name || "",
            typeColor: cloned.task_type?.color || "default",
            status: cloned.status || "",
            priority: cloned.priority || "",
            occurrenceDate: cloned.occurrence_date || targetIso,
            recurring: false,
            parentTaskId: cloned.parent_task_id || null,
            description: cloned.description || null,
            personCount: cloned.person_count ?? null,
            timeSlots: cloned.time_slots || [],
            estimatedTime: cloned.estimated_time || null,
          },
          ...prev,
        ]);
        setSuggestedOneOffByCell((prev) => {
          const key = `${person}-${slotId}`;
          const nextItems = (prev[key] || []).filter((item) => item.id !== suggestion.id);
          return { ...prev, [key]: nextItems };
        });
      } catch (err) {
        console.error("Failed to accept suggested one-off", err);
        setMessage("Unable to duplicate suggested task.");
      }
    },
    [cloneOneOffTaskForDate, findCoord, formatLabelToInput, persistCell, scheduleData, selectedDate]
  );

  const unpublishSchedule = async () => {
    if (scheduleMode !== "page" || !selectedDate) return;
    const confirmed = window.confirm(`Remove the published schedule for ${selectedDate}? This keeps staging data.`);
    if (!confirmed) return;
    setUnpublishingSchedule(true);
    setScheduleNote(null);
    try {
      const res = await fetch("/api/schedule/publish", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateLabel: selectedDate }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to remove published schedule");
      setScheduleNote(`Removed published schedule for ${selectedDate}.`);
      await refreshScheduleList();
    } catch (err) {
      console.error("Failed to unpublish schedule", err);
      setScheduleNote("Unable to remove the published schedule right now.");
    } finally {
      setUnpublishingSchedule(false);
    }
  };

  const addCustomVolunteerRow = async () => {
    const name = newCustomVolunteer.trim();
    if (!name || !selectedDate || scheduleMode !== "page" || !scheduleData) return;
    setAddingCustomVolunteer(true);
    setScheduleNote(null);
    try {
      const res = await fetch("/api/schedule/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateLabel: selectedDate, name }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to add volunteer row");

      const rowExists = scheduleData.people.some(
        (person) => person.trim().toLowerCase() === name.toLowerCase()
      );
      if (!rowExists) {
        const newRow = scheduleData.slots.map(() => ({ tasks: [], note: "", blocked: false }));
        setScheduleData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            people: [...prev.people, name],
            cells: [...prev.cells, newRow],
          };
        });
      }

      setNewCustomVolunteer("");
      setHasUnpublishedChanges(true);
      setScheduleNote(`Added ${name} to the staging schedule.`);
    } catch (err) {
      console.error("Failed to add custom volunteer", err);
      setScheduleNote("Unable to add that volunteer row.");
    } finally {
      setAddingCustomVolunteer(false);
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
    setSuggestedOneOffByCell({});

    try {
      const res = await fetch(
        `/api/schedule?date=${encodeURIComponent(copySourceDate)}&staging=1`,
        { cache: "no-store" }
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

      const sourceIso = formatLabelToInput(copySourceDate);
      const targetIso = formatLabelToInput(copyTargetDate);
      const dayShift = Math.round(
        (new Date(targetIso).getTime() - new Date(sourceIso).getTime()) / (1000 * 60 * 60 * 24)
      );
      const [sourceRecurringRes, targetRecurringRes] = await Promise.all([
        fetch(
          `/api/tasks?recurring=true&includeOccurrences=true&start=${sourceIso}&end=${sourceIso}`
        ),
        fetch(
          `/api/tasks?recurring=true&includeOccurrences=true&start=${targetIso}&end=${targetIso}`
        ),
      ]);
      const sourceRecurringJson = sourceRecurringRes.ok
        ? await sourceRecurringRes.json()
        : { tasks: [] };
      const targetRecurringJson = targetRecurringRes.ok
        ? await targetRecurringRes.json()
        : { tasks: [] };
      const sourceRecurringTasks = Array.isArray(sourceRecurringJson.tasks)
        ? sourceRecurringJson.tasks
        : [];
      const targetRecurringTasks = Array.isArray(targetRecurringJson.tasks)
        ? targetRecurringJson.tasks
        : [];
      const sourceRecurringSeries = new Map<string, string>();
      sourceRecurringTasks.forEach((task: any) => {
        const taskId = String(task.id);
        const seriesId = String(task.parent_task_id ?? task.id);
        sourceRecurringSeries.set(taskId, seriesId);
      });
      const targetRecurringBySeries = new Map<string, string>();
      targetRecurringTasks.forEach((task: any) => {
        const seriesId = task.parent_task_id || task.id;
        if (!targetRecurringBySeries.has(seriesId)) {
          targetRecurringBySeries.set(seriesId, task.id);
        }
      });
      const sourceOneOffById = new Map<string, any>();
      if (suggestModeEnabled) {
        const sourceOneOffRes = await fetch(
          `/api/tasks?recurring=false&start=${sourceIso}&end=${sourceIso}`,
          { cache: "no-store" }
        );
        if (sourceOneOffRes.ok) {
          const sourceOneOffJson = await sourceOneOffRes.json().catch(() => ({ tasks: [] }));
          const sourceOneOffTasks = Array.isArray(sourceOneOffJson.tasks)
            ? sourceOneOffJson.tasks
            : [];
          sourceOneOffTasks.forEach((task: any) => {
            sourceOneOffById.set(String(task.id), task);
          });
        }
      }

      const updates: Promise<void>[] = [];
      sourceData.people.forEach((person, rowIdx) => {
        sourceData.slots.forEach((slot, colIdx) => {
          const cell = sourceData.cells?.[rowIdx]?.[colIdx];
          if (!cell) return;
          const mappedTasksPromise = Promise.resolve(
            cell.tasks
              .map((task) => {
                const seriesId = sourceRecurringSeries.get(String(task.id));
                if (!seriesId) return null;
                const targetTaskId = targetRecurringBySeries.get(seriesId);
                return targetTaskId || null;
              })
              .filter(Boolean) as string[]
          );

          if (!cell.tasks.length && !cell.note && !cell.blocked) return;
          updates.push(
            mappedTasksPromise.then(async (mappedTasks) => {
              if (!mappedTasks.length && !cell.note && !cell.blocked) return;
              const response = await fetch("/api/schedule/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  person,
                  slotId: slot.id,
                  tasks: mappedTasks,
                  note: cell.note,
                  blocked: cell.blocked,
                  dateLabel: copyTargetDate,
                  staging: true,
                }),
              });
              if (!response.ok) {
                const json = await response.json().catch(() => ({}));
                throw new Error(json.error || "Failed to copy schedule cell.");
              }
              if (suggestModeEnabled) {
                const suggestions = cell.tasks
                  .map((task) => {
                    const source = sourceOneOffById.get(String(task.id));
                    if (!source) return null;
                    return {
                      id: `suggest-${task.id}-${rowIdx}-${colIdx}`,
                      name: String(task.name || source.name || "Task"),
                      sourceTaskId: String(task.id),
                    };
                  })
                  .filter(Boolean) as SuggestedOneOffTask[];
                if (suggestions.length) {
                  const shiftedCol = Math.max(
                    0,
                    Math.min(scheduleData?.slots.length ? scheduleData.slots.length - 1 : colIdx, colIdx + dayShift)
                  );
                  const key = `${person}-${sourceData.slots[shiftedCol]?.id || slot.id}`;
                  setSuggestedOneOffByCell((prev) => ({
                    ...prev,
                    [key]: [...(prev[key] || []), ...suggestions],
                  }));
                }
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

  const loadCommentsForOverviewTask = useCallback(async (taskId: string) => {
    if (!taskId) return;
    if (dayOverviewCommentsByTask[taskId]) return;
    setDayOverviewCommentsLoading((prev) => new Set(prev).add(taskId));
    try {
      const res = await fetch(`/api/task?id=${encodeURIComponent(taskId)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load task comments");
      const comments = Array.isArray(json.comments)
        ? json.comments.map((comment: any) => ({
            id: String(comment.id || `${taskId}-${Math.random()}`),
            text: String(comment.text || ""),
            createdTime: String(comment.createdTime || ""),
            author: String(comment.author || "Unknown"),
          }))
        : [];
      setDayOverviewCommentsByTask((prev) => ({ ...prev, [taskId]: comments }));
    } catch (err) {
      console.error("Failed to load overview comments", err);
      setDayOverviewCommentsByTask((prev) => ({ ...prev, [taskId]: [] }));
    } finally {
      setDayOverviewCommentsLoading((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }, [dayOverviewCommentsByTask]);

  const taskDetailEditor = taskDetail ? (
    <div className="rounded-2xl border border-[#d0c9a4] bg-white/90 p-4 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-[#7a7f54]">
            Task detail
          </p>
          <h3 className="text-base font-semibold text-[#314123]">{taskDetail.name}</h3>
        </div>
        <div className="flex items-center gap-2">
          {taskDetailLoading && (
            <span className="text-[11px] text-[#6b6d4b]">Loading…</span>
          )}
          <button
            type="button"
            onClick={() => setTaskDetail(null)}
            className="rounded-full border border-[#d0c9a4] bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#4b5133]"
          >
            Close
          </button>
        </div>
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
      {taskEditSections.recurrence && (taskDetail.recurring || taskDetail.occurrenceDate) && (
        <div className="mt-2 space-y-1 text-[11px] text-[#6b6d4b]">
          <p>
            {taskDetail.recurring
              ? taskDetail.parentTaskId
                ? "Recurring series • this occurrence"
                : "Recurring series"
              : "One-off task"}
            {taskDetail.occurrenceDate ? ` • ${taskDetail.occurrenceDate}` : ""}
          </p>
          {taskDetail.recurring && (
            <>
              <p>Tip: update just this occurrence to avoid changing the full series.</p>
              <div className="rounded-lg border border-[#d8d3b4] bg-white px-3 py-2 text-[11px] text-[#4b5133]">
                <p className="font-semibold uppercase tracking-[0.1em] text-[10px]">Recurring timing</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1">
                    <span className="text-[10px] uppercase tracking-[0.1em]">Every</span>
                    <input
                      type="number"
                      min={1}
                      value={taskDetail.recurrenceInterval ?? 1}
                      onChange={(e) =>
                        setTaskDetail((prev) =>
                          prev
                            ? {
                                ...prev,
                                recurrenceInterval: Math.max(1, Number(e.target.value) || 1),
                              }
                            : prev
                        )
                      }
                      className="w-16 rounded border border-[#d0c9a4] bg-white px-2 py-1 text-[11px]"
                    />
                  </label>
                  <select
                    value={taskDetail.recurrenceUnit || "day"}
                    onChange={(e) =>
                      setTaskDetail((prev) =>
                        prev ? { ...prev, recurrenceUnit: e.target.value } : prev
                      )
                    }
                    className="rounded border border-[#d0c9a4] bg-white px-2 py-1 text-[11px]"
                  >
                    <option value="day">day(s)</option>
                    <option value="month">month(s)</option>
                    <option value="year">year(s)</option>
                  </select>
                  <label className="inline-flex items-center gap-1">
                    <span className="text-[10px] uppercase tracking-[0.1em]">Until</span>
                    <input
                      type="date"
                      value={taskDetail.recurrenceUntil || ""}
                      onChange={(e) =>
                        setTaskDetail((prev) =>
                          prev ? { ...prev, recurrenceUntil: e.target.value || null } : prev
                        )
                      }
                      className="rounded border border-[#d0c9a4] bg-white px-2 py-1 text-[11px]"
                    />
                  </label>
                </div>
              </div>
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                <p className="font-semibold">⚠️ Recurring task edit scope</p>
                <p className="mt-1 text-[10px]">Choose whether this edit should affect one task, all tasks, or all tasks after a date.</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <label className="inline-flex items-center gap-1">
                    <input type="radio" name="task-edit-scope" checked={taskEditApplyTo === "single"} onChange={() => setTaskEditApplyTo("single")} className="accent-[#8fae4c]" />
                    <span>Only this task</span>
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input type="radio" name="task-edit-scope" checked={taskEditApplyTo === "all"} onChange={() => setTaskEditApplyTo("all")} className="accent-[#8fae4c]" />
                    <span>All tasks</span>
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input type="radio" name="task-edit-scope" checked={taskEditApplyTo === "future"} onChange={() => setTaskEditApplyTo("future")} className="accent-[#8fae4c]" />
                    <span>All tasks after date</span>
                  </label>
                </div>
                {taskEditApplyTo === "future" && (
                  <label className="mt-2 inline-flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.12em]">From</span>
                    <input type="date" value={taskEditFutureDate} onChange={(e) => setTaskEditFutureDate(e.target.value)} className="rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px]" />
                  </label>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {!taskDetail.recurring && taskDetail.name && (
        <div className="mt-3 rounded-lg border border-[#d8d3b4] bg-white/80 p-3 text-[11px] text-[#4b5133]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a7f54]">
            One-off history for this task name
          </p>
          <p className="mt-1 text-[11px] text-[#6b6f4c]">
            Click a past date to review historical values, then copy any field into today&apos;s draft.
          </p>
          {taskHistoryLoading ? (
            <p className="mt-2 text-[11px] text-[#7a7f54]">Loading history…</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {taskOneOffHistory
                .filter((entry) => entry.occurrenceDate && entry.occurrenceDate !== taskDetail.occurrenceDate)
                .map((entry) => (
                  <button
                    key={`task-history-${entry.id}`}
                    type="button"
                    onClick={() => setTaskHistoryPreview(entry)}
                    className={`rounded-full border px-3 py-1 text-[10px] font-semibold ${taskHistoryPreview?.id === entry.id ? "border-[#8fae4c] bg-[#eef5dd] text-[#42502d]" : "border-[#d0c9a4] bg-white text-[#4b5133]"}`}
                  >
                    {entry.occurrenceDate}
                  </button>
                ))}
              {!taskOneOffHistory.filter((entry) => entry.occurrenceDate && entry.occurrenceDate !== taskDetail.occurrenceDate).length && (
                <p className="text-[11px] text-[#7a7f54]">No past one-off dates found.</p>
              )}
            </div>
          )}
          {taskHistoryPreview && (
            <div className="mt-3 rounded-md border border-[#e2d7b5] bg-[#f8f4e3] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">
                Loaded snapshot: {taskHistoryPreview.occurrenceDate || "No date"}
              </p>
              <p className="mt-1 text-[11px] text-[#4b5133] line-clamp-3">
                {taskHistoryPreview.description || "No description on that date."}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => copyHistorySnapshotToDraft(taskHistoryPreview, "all")} className="rounded-full border border-[#8fae4c] bg-[#8fae4c] px-3 py-1 text-[10px] font-semibold text-white">Copy all values</button>
                <button type="button" onClick={() => copyHistorySnapshotToDraft(taskHistoryPreview, "description")} className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-[10px] font-semibold text-[#4b5133]">Description</button>
                <button type="button" onClick={() => copyHistorySnapshotToDraft(taskHistoryPreview, "extraNotes")} className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-[10px] font-semibold text-[#4b5133]">Extra notes</button>
                <button type="button" onClick={() => copyHistorySnapshotToDraft(taskHistoryPreview, "status")} className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-[10px] font-semibold text-[#4b5133]">Status</button>
                <button type="button" onClick={() => copyHistorySnapshotToDraft(taskHistoryPreview, "priority")} className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-[10px] font-semibold text-[#4b5133]">Priority</button>
                <button type="button" onClick={() => copyHistorySnapshotToDraft(taskHistoryPreview, "personCount")} className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-[10px] font-semibold text-[#4b5133]">People needed</button>
                <button type="button" onClick={() => copyHistorySnapshotToDraft(taskHistoryPreview, "taskType")} className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-[10px] font-semibold text-[#4b5133]">Task type</button>
                <button type="button" onClick={() => copyHistorySnapshotToDraft(taskHistoryPreview, "links")} className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-[10px] font-semibold text-[#4b5133]">Links</button>
                <button type="button" onClick={() => taskHistoryPreview.id && loadTaskDetail(taskHistoryPreview.id, taskHistoryPreview.name, { preserveCurrentTask: true })} className="rounded-full border border-[#d0c9a4] bg-[#f7f4e5] px-3 py-1 text-[10px] font-semibold text-[#4b5133]">Open this date</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 rounded-lg border border-[#e2d7b5] bg-white/70 p-3 text-[11px] text-[#6a6c4d]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a7f54]">
          Toggle edit fields
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          {(
            [
              ["title", "Title"],
              ["description", "Description"],
              ["extraNotes", "Extra notes"],
              ["personCount", "People needed"],
              ["status", "Status"],
              ["priority", "Priority"],
              ["taskType", "Task type"],
              ["taskHelpReferences", "Task Help Reference"],
              ["links", "Links"],
              ["photos", "Photos"],
              ["recurrence", "Recurrence info"],
            ] as Array<[keyof typeof taskEditSections, string]>
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={taskEditSections[key]}
                onChange={() =>
                  setTaskEditSections((prev) => ({ ...prev, [key]: !prev[key] }))
                }
                className="accent-[#8fae4c]"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-3 text-sm text-[#4b5133]">
        {taskEditSections.title && (
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-[#5f5a3b]">Title</span>
            <input
              value={taskEditDraft.name}
              onChange={(e) =>
                setTaskEditDraft((prev) => ({ ...prev, name: e.target.value }))
              }
              className="w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
            />
          </label>
        )}
        {taskEditSections.description && (
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-[#5f5a3b]">
              Description
            </span>
            <textarea
              value={taskEditDraft.description}
              onChange={(e) =>
                setTaskEditDraft((prev) => ({ ...prev, description: e.target.value }))
              }
              className="min-h-[90px] w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
            />
          </label>
        )}
        {taskEditSections.extraNotes && (
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-[#5f5a3b]">
              Extra notes
            </span>
            <textarea
              value={taskEditDraft.extraNotes}
              onChange={(e) =>
                setTaskEditDraft((prev) => ({ ...prev, extraNotes: e.target.value }))
              }
              className="min-h-[80px] w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
              placeholder="One note per line"
            />
          </label>
        )}
        {taskEditSections.personCount && (
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-[#5f5a3b]">
              People needed
            </span>
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
        )}
        {taskEditSections.status && (
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-[#5f5a3b]">Status</span>
            <select
              value={taskEditDraft.status}
              onChange={(e) =>
                setTaskEditDraft((prev) => ({ ...prev, status: e.target.value }))
              }
              className="w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
            >
              <option value="">—</option>
              {statusOptions.map((opt) => (
                <option key={opt.name} value={opt.name}>
                  {opt.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {taskEditSections.priority && (
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-[#5f5a3b]">
              Priority
            </span>
            <select
              value={taskEditDraft.priority}
              onChange={(e) =>
                setTaskEditDraft((prev) => ({ ...prev, priority: e.target.value }))
              }
              className="w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
            >
              <option value="">—</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </label>
        )}
        {taskEditSections.taskType && (
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-[#5f5a3b]">
              Task type
            </span>
            <select
              value={taskEditDraft.taskType}
              onChange={(e) =>
                setTaskEditDraft((prev) => ({ ...prev, taskType: e.target.value }))
              }
              className="w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
            >
              <option value="">—</option>
              {taskTypes.map((opt) => (
                <option key={opt.name} value={opt.name}>
                  {opt.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {taskEditSections.taskHelpReferences && (
          <div className="space-y-1">
            <span className="text-[12px] font-semibold text-[#5f5a3b]">
              Task Help Reference
            </span>
            <ChecklistDropdown
              value={taskEditDraft.taskHelpReferences}
              options={activeSiteUsers}
              placeholder="Select people that can help with this task"
              onChange={(next) =>
                setTaskEditDraft((prev) => ({ ...prev, taskHelpReferences: next }))
              }
            />
            <p className="text-[11px] text-[#6b6d4b]">
              If none is selected, this defaults to the admin who created the task.
            </p>
          </div>
        )}
        {taskEditSections.links && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-[#5f5a3b]">Links</span>
              <button
                type="button"
                onClick={() =>
                  setTaskEditDraft((prev) => ({
                    ...prev,
                    links: [...prev.links, { label: "", url: "" }],
                  }))
                }
                className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#4b5133]"
              >
                Add link
              </button>
            </div>
            <div className="space-y-2">
              {taskEditDraft.links.length ? (
                taskEditDraft.links.map((link, idx) => (
                  <div key={`task-link-${idx}`} className="flex flex-wrap gap-2">
                    <input
                      value={link.label}
                      onChange={(e) =>
                        setTaskEditDraft((prev) => {
                          const nextLinks = [...prev.links];
                          nextLinks[idx] = { ...nextLinks[idx], label: e.target.value };
                          return { ...prev, links: nextLinks };
                        })
                      }
                      className="flex-1 rounded-md border border-[#d0c9a4] bg-white px-2 py-1 text-sm"
                      placeholder="Link label"
                    />
                    <input
                      value={link.url}
                      onChange={(e) =>
                        setTaskEditDraft((prev) => {
                          const nextLinks = [...prev.links];
                          nextLinks[idx] = { ...nextLinks[idx], url: e.target.value };
                          return { ...prev, links: nextLinks };
                        })
                      }
                      className="flex-[2] rounded-md border border-[#d0c9a4] bg-white px-2 py-1 text-sm"
                      placeholder="https://..."
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setTaskEditDraft((prev) => ({
                          ...prev,
                          links: prev.links.filter((_, linkIdx) => linkIdx !== idx),
                        }))
                      }
                      className="rounded-full border border-red-200 bg-white/80 px-2 py-1 text-[10px] font-semibold text-red-700"
                    >
                      ✕
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-[12px] text-[#6b6d4b]">
                  No links added yet. Tip: you can also embed links in descriptions
                  like <span className="font-semibold">(short text)[full link]</span>.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-[#4b5133]">
          {taskEditSaving ? "Auto-saving…" : taskEditMessage || "Saved"}
        </span>
        <Link
          href={`/hub/admin/tasks?search=${encodeURIComponent(taskDetail.name)}&taskId=${encodeURIComponent(taskDetail.id)}${taskDetail.occurrenceDate ? `&occurrenceDate=${encodeURIComponent(taskDetail.occurrenceDate)}` : ""}&autoOpen=1`}
          className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-[11px] font-semibold text-[#4b5133]"
        >
          Open in task editor
        </Link>
      </div>

      {taskEditSections.photos && (
        <div className="mt-4 space-y-2 rounded-lg border border-dashed border-[#d0c9a4] bg-[#f9f6e7] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">
            Upload task photo (150kb max)
          </p>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setPhotoDropActive(true);
            }}
            onDragLeave={() => setPhotoDropActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setPhotoDropActive(false);
              const file = event.dataTransfer.files?.[0];
              if (file) {
                setPendingPhotoFile(file);
                setPhotoMessage(`Ready to upload ${file.name}.`);
              }
            }}
            className={`rounded-md border-2 border-dashed px-3 py-4 text-center text-[12px] ${
              photoDropActive
                ? "border-[#8fae4c] bg-white text-[#4b5133]"
                : "border-[#d0c9a4] bg-white/80 text-[#7a7f54]"
            }`}
          >
            Drag & drop a photo here, or choose a file below.
          </div>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            onChange={(event) =>
              setPendingPhotoFile(event.target.files?.[0] || null)
            }
            className="w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
          />
          {pendingPhotoFile && (
            <p className="text-[12px] text-[#4b5133]">
              Selected: {pendingPhotoFile.name}
            </p>
          )}
          <button
            type="button"
            onClick={() => handlePhotoUpload()}
            disabled={photoUploading}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[#8fae4c] px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#f9f9ec] shadow-sm transition hover:bg-[#7e9c44] disabled:opacity-60"
          >
            {photoUploading ? "Uploading…" : "Upload photo"}
          </button>
          {photoMessage && <p className="text-[12px] text-[#4b5133]">{photoMessage}</p>}
        </div>
      )}
    </div>
  ) : null;

  if (!authorized) {
    return (
      <div className="mx-auto max-w-6xl px-2 py-10 text-center text-sm text-[#7a7f54]">
        {message || "Checking admin access…"}
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh w-full flex-col overflow-x-hidden bg-[#fdfbf4]">
      <div className="border-b border-[#e2d7b5] bg-[#f7f4e6] px-1 sm:px-2 py-3">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">Admin schedule</p>
            <h1 className="text-xl font-semibold text-[#314123]">{scheduleTitle}</h1>
            <p className="text-xs text-[#5f5a3b]">
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
                onClick={undoLastChange}
                disabled={!undoStack.length}
                className="rounded-md border border-[#d0c9a4] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8] disabled:opacity-60"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={redoLastChange}
                disabled={!redoStack.length}
                className="rounded-md border border-[#d0c9a4] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8] disabled:opacity-60"
              >
                Redo
              </button>
              <button
                type="button"
                onClick={publishSchedule}
                disabled={!selectedDate || scheduleMode !== "page"}
                className="rounded-md bg-[#8fae4c] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#f9f9ec] shadow-sm transition hover:bg-[#7e9c44] disabled:opacity-60"
              >
                Publish
              </button>
              <button
                type="button"
                onClick={() => setBlackoutMode((prev) => !prev)}
                className={`rounded-md border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] shadow-sm transition ${
                  blackoutMode
                    ? "border-[#22311b] bg-[#2f3b21] text-[#f9f9ec] hover:bg-[#25301b]"
                    : "border-[#d0c9a4] bg-white text-[#314123] hover:bg-[#f1edd8]"
                }`}
              >
                {blackoutMode ? "Blackout mode: On" : "Blackout mode"}
              </button>
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-md border border-[#d0c9a4] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8]">
                  More actions
                </summary>
                <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-[#d0c9a4] bg-white p-2 shadow-lg">
                  <button
                    type="button"
                    onClick={refreshSchedule}
                    className="w-full rounded-md px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-[#314123] hover:bg-[#f1edd8]"
                  >
                    🔄 Refresh
                  </button>
                  <button
                    type="button"
                    onClick={autoGenerateSchedule}
                    disabled={autoGenerating || !scheduleData}
                    className="mt-1 w-full rounded-md px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-[#314123] hover:bg-[#f1edd8] disabled:opacity-60"
                  >
                    {autoGenerating ? "✨ Auto-generating…" : "✨ Auto-generate"}
                  </button>
                  <button
                    type="button"
                    onClick={clearSchedule}
                    disabled={!scheduleData || (scheduleMode === "page" && !selectedDate)}
                    className="mt-1 w-full rounded-md px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-[#314123] hover:bg-[#f1edd8] disabled:opacity-60"
                  >
                    🧹 Clear schedule
                  </button>
                  <button
                    type="button"
                    onClick={clearCompletedOneOffTasks}
                    disabled={!scheduleData || (scheduleMode === "page" && !selectedDate)}
                    className="mt-1 w-full rounded-md px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-[#314123] hover:bg-[#f1edd8] disabled:opacity-60"
                  >
                    ✅ Clear completed one-offs
                  </button>
                  <button
                    type="button"
                    onClick={sendVolunteerReminder}
                    className="mt-1 w-full rounded-md px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-[#314123] hover:bg-[#f1edd8]"
                  >
                    🔔 Remind volunteers
                  </button>
                  <Link
                    href="/hub/admin/tasks"
                    className="mt-1 block rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#314123] hover:bg-[#f1edd8]"
                  >
                    🗂️ Task editor
                  </Link>
                  <Link
                    href="/hub/admin/shifts"
                    className="mt-1 block rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#314123] hover:bg-[#f1edd8]"
                  >
                    🧭 Shift editor
                  </Link>
                  <Link
                    href="/hub/admin"
                    className="mt-1 block rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#314123] hover:bg-[#f1edd8]"
                  >
                    🏡 Back to admin
                  </Link>
                  <div className="mt-2 border-t border-dashed border-[#d0c9a4] pt-2">
                    <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">
                      Indicator emojis
                    </p>
                    <div className="mt-2 space-y-2">
                      {indicatorRules.map((rule) => {
                        const statusChoices = statusOptions.length
                          ? statusOptions.map((opt) => opt.name)
                          : ["Not Started", "In Progress", "Completed"];
                        const priorityChoices = ["High", "Medium", "Low"];
                        const typeChoices = taskTypes.length
                          ? taskTypes.map((type) => type.name)
                          : ["Uncategorized"];
                        return (
                          <div
                            key={rule.id}
                            className="rounded-md border border-[#e2d7b5] bg-[#faf7eb] p-2 text-[10px] text-[#4b5133]"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                value={rule.emoji}
                                onChange={(e) =>
                                  updateIndicatorRule(rule.id, { emoji: e.target.value })
                                }
                                className="w-10 rounded-md border border-[#d0c9a4] bg-white px-2 py-1 text-center text-xs"
                                aria-label="Indicator emoji"
                              />
                              <input
                                value={rule.label}
                                onChange={(e) =>
                                  updateIndicatorRule(rule.id, { label: e.target.value })
                                }
                                className="min-w-0 flex-1 rounded-md border border-[#d0c9a4] bg-white px-2 py-1 text-xs"
                                placeholder="Label"
                              />
                              <button
                                type="button"
                                onClick={() => removeIndicatorRule(rule.id)}
                                className="rounded-full border border-[#d0c9a4] bg-white px-2 py-[2px] text-[10px] text-[#a05252] hover:bg-[#f7e3e3]"
                              >
                                ✕
                              </button>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <select
                                value={rule.type}
                                onChange={(e) =>
                                  updateIndicatorRule(rule.id, {
                                    type: e.target.value as IndicatorRuleType,
                                    value:
                                      e.target.value === "status"
                                        ? statusChoices[0]
                                        : e.target.value === "priority"
                                          ? priorityChoices[0]
                                          : e.target.value === "task_type"
                                            ? typeChoices[0]
                                            : "",
                                  })
                                }
                                className="rounded-md border border-[#d0c9a4] bg-white px-2 py-1 text-xs"
                              >
                                <option value="missing_description">Missing description</option>
                                <option value="status">Status equals</option>
                                <option value="priority">Priority equals</option>
                                <option value="task_type">Task type equals</option>
                                <option value="has_comments">Has comments</option>
                              </select>
                              {(rule.type === "status" || rule.type === "priority") && (
                                <select
                                  value={rule.value || ""}
                                  onChange={(e) =>
                                    updateIndicatorRule(rule.id, { value: e.target.value })
                                  }
                                  className="rounded-md border border-[#d0c9a4] bg-white px-2 py-1 text-xs"
                                >
                                  {(rule.type === "status" ? statusChoices : priorityChoices).map(
                                    (choice) => (
                                      <option key={choice} value={choice}>
                                        {choice}
                                      </option>
                                    )
                                  )}
                                </select>
                              )}
                              {rule.type === "task_type" && (
                                <select
                                  value={rule.value || ""}
                                  onChange={(e) =>
                                    updateIndicatorRule(rule.id, { value: e.target.value })
                                  }
                                  className="rounded-md border border-[#d0c9a4] bg-white px-2 py-1 text-xs"
                                >
                                  {typeChoices.map((choice) => (
                                    <option key={choice} value={choice}>
                                      {choice}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={addIndicatorRule}
                        className="w-full rounded-md border border-[#d0c9a4] bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#314123] hover:bg-[#f1edd8]"
                      >
                        ➕ Add indicator
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 border-t border-dashed border-[#d0c9a4] pt-2">
                    <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">
                      Status emojis
                    </p>
                    <div className="mt-2 space-y-2">
                      {(statusOptions.length
                        ? statusOptions.map((opt) => opt.name)
                        : ["Not Started", "In Progress", "Completed"]).map((status) => (
                        <div key={status} className="flex items-center gap-2">
                          <span className="min-w-[96px] text-[10px] text-[#4b5133]">
                            {status}
                          </span>
                          <input
                            value={statusEmojiMap[status.toLowerCase()] || ""}
                            onChange={(e) => updateStatusEmoji(status, e.target.value)}
                            className="w-12 rounded-md border border-[#d0c9a4] bg-white px-2 py-1 text-center text-xs"
                            aria-label={`${status} emoji`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </details>
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

      {(scheduleLoading || pendingCells.size > 0) && (
        <div className="rounded-xl border border-[#d0c9a4] bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#4b5133] shadow-sm">
          {scheduleLoading ? "Loading schedule data…" : "Saving updates… Please wait."}
        </div>
      )}

      {scheduleMode === "page" && hasUnpublishedChanges && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-base font-semibold text-red-700 shadow-sm">
          Unpublished changes: remember to publish this schedule.
        </div>
      )}

      {hoveredTaskTooltip && (
        <div
          className="fixed z-[99999] max-w-[240px] rounded-lg border border-[#5d7f3b] bg-[#2f3b21] px-3 py-2 text-[10px] text-white shadow-lg pointer-events-none"
          style={{
            left: hoveredTaskTooltip.x,
            top: hoveredTaskTooltip.y,
          }}
        >
          <div className="mb-1.5 font-semibold">{hoveredTaskTooltip.name}</div>
          <div className="space-y-0.5 text-[9px] text-gray-300">
            <div>
              <span className="text-gray-400">Type:</span> {hoveredTaskTooltip.type}
            </div>
            <div>
              <span className="text-gray-400">Status:</span> {hoveredTaskTooltip.status}
            </div>
            <div>
              <span className="text-gray-400">Assigned:</span>{" "}
              {hoveredTaskTooltip.assigned}/{hoveredTaskTooltip.needed}
            </div>
          </div>
        </div>
      )}

      {isAfk && (
        <button
          type="button"
          onClick={() => {
            lastActivityRef.current = Date.now();
            setIsAfk(false);
          }}
          className="fixed inset-0 z-[100000] flex flex-col items-center justify-center gap-2 bg-black/60 text-white"
          aria-label="Exit AFK mode"
        >
          <span className="text-3xl font-semibold tracking-[0.2em]">AFK MODE</span>
          <span className="text-xs uppercase tracking-[0.2em] text-white/70">
            Click anywhere to resume
          </span>
        </button>
      )}

      <div
        className={`flex min-w-0 flex-1 flex-col gap-3 px-1 py-3 pb-24 lg:flex-row lg:px-2 lg:pb-32 ${
          canvasExpanded ? "lg:min-h-[calc(100vh-12rem)]" : ""
        }`}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#d0c9a4] bg-white/90 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#4b5133] shadow-sm">
            <span>Custom Tables</span>
            <button
              type="button"
              onClick={() => toggleSectionVisibility("customTables")}
              className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#4b5133]"
            >
              {sectionVisibility.customTables ? "Hide" : "Show"}
            </button>
          </div>
          {sectionVisibility.customTables && (
            <CustomTablesEditor
              dateLabel={customTablesDateLabel}
              canEdit={authorized}
              userOptions={scheduleData?.people || []}
              taskNameOptions={taskNameOptions}
              currentUserName={currentUserName}
              showPastTables
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#d0c9a4] bg-white/90 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#4b5133] shadow-sm">
            <span>Schedule Canvas</span>
            <button
              type="button"
              onClick={() => toggleSectionVisibility("scheduleCanvas")}
              className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#4b5133]"
            >
              {sectionVisibility.scheduleCanvas ? "Hide" : "Show"}
            </button>
          </div>
          {sectionVisibility.scheduleCanvas && (
            <div
              className={`flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-[#d0c9a4] p-2 shadow-md ${
                canvasExpanded ? "bg-white lg:flex-[3.2]" : "bg-white/80 lg:flex-[2.4]"
              }`}
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
            {hiddenSlots.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a7f54]">
                  Hidden shifts:
                </span>
                {hiddenSlots.map((slot) => (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() =>
                      setHiddenSlotIds((prev) => {
                        const next = new Set(prev);
                        next.delete(slot.id);
                        return next;
                      })
                    }
                    className="rounded-full border border-[#d1d4aa] bg-white px-2 py-[2px] text-[10px] font-semibold text-[#4b5133] hover:bg-[#f7f4e6]"
                  >
                    Show {slot.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-[#d0c9a4] bg-white/80 px-3 py-2 text-xs text-[#4b5133]">
            <button
              type="button"
              onClick={publishSchedule}
              disabled={!selectedDate || scheduleMode !== "page"}
              className="h-8 rounded-md bg-[#8fae4c] px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#f9f9ec] shadow-sm transition hover:bg-[#7e9c44] disabled:opacity-60"
            >
              Publish
            </button>
            <button
              type="button"
              onClick={unpublishSchedule}
              disabled={unpublishingSchedule || !selectedDate || scheduleMode !== "page"}
              className="h-8 rounded-md border border-[#d0c9a4] bg-white px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#314123] shadow-sm disabled:opacity-60"
            >
              {unpublishingSchedule ? "Removing…" : "Remove published"}
            </button>
            <button
              type="button"
              onClick={() => setBlackoutMode((prev) => !prev)}
              className={`h-8 rounded-md border px-3 text-[10px] font-semibold uppercase tracking-[0.12em] shadow-sm ${
                blackoutMode
                  ? "border-[#22311b] bg-[#2f3b21] text-[#f9f9ec]"
                  : "border-[#d0c9a4] bg-white text-[#314123]"
              }`}
            >
              {blackoutMode ? "Blackout on" : "Blackout mode"}
            </button>
            <input
              type="date"
              value={copySourceDate ? formatLabelToInput(copySourceDate) : ""}
              onChange={(e) => setCopySourceDate(formatDateInput(e.target.value))}
              className="h-8 rounded-md border border-[#d0c9a4] bg-white px-2 text-xs"
              aria-label="Copy source date"
            />
            <input
              type="date"
              value={copyTargetDate ? formatLabelToInput(copyTargetDate) : ""}
              onChange={(e) => setCopyTargetDate(formatDateInput(e.target.value))}
              className="h-8 rounded-md border border-[#d0c9a4] bg-white px-2 text-xs"
              aria-label="Copy target date"
            />
            <button
              type="button"
              onClick={copySchedule}
              disabled={copyingSchedule || scheduleMode !== "page"}
              className="h-8 rounded-md bg-[#6f8f3d] px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white shadow-sm disabled:opacity-60"
            >
              {copyingSchedule ? "Copying…" : "Copy schedule"}
            </button>
            <label className="inline-flex h-8 items-center gap-2 rounded-md border border-[#d0c9a4] bg-white px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#4b5133]">
              <input
                type="checkbox"
                checked={suggestModeEnabled}
                onChange={(e) => setSuggestModeEnabled(e.target.checked)}
                className="accent-[#8fae4c]"
              />
              Suggest mode
            </label>
            <input
              type="date"
              value={blackoutRangeStart}
              onChange={(e) => setBlackoutRangeStart(e.target.value)}
              className="h-8 rounded-md border border-[#d0c9a4] bg-white px-2 text-xs"
              aria-label="Blackout start date"
            />
            <input
              type="date"
              value={blackoutRangeEnd}
              onChange={(e) => setBlackoutRangeEnd(e.target.value)}
              className="h-8 rounded-md border border-[#d0c9a4] bg-white px-2 text-xs"
              aria-label="Blackout end date"
            />
            <button
              type="button"
              onClick={applyBlackoutRange}
              disabled={blackoutApplying}
              className="h-8 rounded-md bg-[#2f3b21] px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white shadow-sm disabled:opacity-60"
            >
              {blackoutApplying ? "Applying…" : "Apply blackout"}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[#d0c9a4] bg-white/80 px-3 py-2 text-xs text-[#4b5133]">
            <input
              value={newCustomVolunteer}
              onChange={(event) => setNewCustomVolunteer(event.target.value)}
              placeholder="Custom volunteer name"
              className="h-8 min-w-[180px] rounded-md border border-[#d0c9a4] bg-white px-2 text-xs"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addCustomVolunteerRow();
                }
              }}
            />
            <button
              type="button"
              onClick={addCustomVolunteerRow}
              disabled={addingCustomVolunteer || !newCustomVolunteer.trim()}
              className="h-8 rounded-md border border-[#d0c9a4] bg-white px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#314123] shadow-sm disabled:opacity-60"
            >
              {addingCustomVolunteer ? "Adding…" : "Add volunteer row"}
            </button>
            {blackoutMode && (
              <span className="rounded-full bg-[#2f3b21] px-3 py-1 text-[10px] font-semibold text-white">
                Blackout mode active
              </span>
            )}
          </div>

          <details className="rounded-lg border border-dashed border-[#d0c9a4] bg-white/70 px-3 py-2 text-[11px] text-[#4b5133]">
            <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">
              Keybinds & shortcuts
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-[#4b5133]">
              <li>Drag a task card to move it to another cell.</li>
              <li>
                Hold <span className="font-semibold">Ctrl</span>/<span className="font-semibold">Cmd</span>{" "}
                while dragging to duplicate the task instead of moving it.
              </li>
              <li>Shift + click to select a range of cells.</li>
              <li>Double-click a task to rename it inline.</li>
              <li>Press Esc to cancel inline editing.</li>
              <li>Copy/Paste keybinds mirror Custom Tables settings (site-wide for canvas + custom tables).</li>
            </ul>
          </details>

          {scheduleLoading && (
            <p className="mt-2 text-xs text-[#7a7f54]">Loading schedule…</p>
          )}
          <div
            ref={scheduleContainerRef}
            className={`relative mt-3 min-w-0 flex-1 overflow-auto rounded-xl border border-[#e2d7b5] bg-[#faf7eb] shadow-inner ${
              scheduleLoading ? "pointer-events-none opacity-80" : ""
            } ${canvasExpanded ? "min-h-[70vh] lg:min-h-[calc(100vh-18rem)]" : ""}`}
          >
            {scheduleLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 text-sm font-semibold text-[#4b5133]">
                Loading schedule…
              </div>
            )}
            <table className="w-full table-fixed border-collapse text-[10px] sm:text-[11px]">
  <thead className="bg-[#e5e7c5]">
    <tr>
      <th className="w-[74px] sm:w-[96px] border border-[#d1d4aa] px-1 sm:px-1.5 py-1 text-left text-[8px] sm:text-[9px] font-semibold uppercase tracking-[0.14em] text-[#5d7f3b] sticky left-0 top-0 z-30 bg-[#e5e7c5]">
        Person
      </th>
      {visibleSlotsWithIndex.map(({ slot }) => (
 <th
  key={slot.id}
  className="relative border border-[#d1d4aa] px-1 sm:px-1.5 py-1 text-left text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5d7f3b] sticky top-0 z-10 bg-[#e5e7c5]"
  style={columnWidth ? { width: columnWidth, minWidth: columnWidth } : undefined}
>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div>{slot.label}</div>
              {slot.timeRange && (
                <div className="text-[9px] text-[#7a7f54] normal-case">{slot.timeRange}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() =>
                setHiddenSlotIds((prev) => {
                  const next = new Set(prev);
                  next.add(slot.id);
                  return next;
                })
              }
              className="rounded-full border border-[#c8d0a4] bg-white/80 px-2 py-[2px] text-[9px] font-semibold uppercase tracking-[0.08em] text-[#5d7f3b] hover:bg-white"
            >
              Hide
            </button>
            {slot.isMeal && <span className="text-lg">🍽️</span>}
          </div>
          <button
            type="button"
            aria-label="Resize schedule columns"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setColumnResizing({
                startX: event.clientX,
                startWidth: columnWidth ?? 240,
              });
            }}
            className="absolute right-0 top-0 h-full w-2 cursor-col-resize"
          />
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
        {visibleSlotsWithIndex.map(({ slot, index: colIdx }) => {
          const cell = scheduleData.cells?.[rowIdx]?.[colIdx] || { tasks: [], note: "" };
          const content = cell;
          const isSelected =
            selectedCell?.person === person && selectedCell?.slotId === slot.id;
          const isRangeSelected = selectedRange
            ? rowIdx >= selectedRange.startRow &&
              rowIdx <= selectedRange.endRow &&
              colIdx >= selectedRange.startCol &&
              colIdx <= selectedRange.endCol
            : false;
          const presenceLock = getPresenceLockForCoord(rowIdx, colIdx);
          const isPresenceLocked = Boolean(
            presenceLock && presenceLock.user && presenceLock.user !== currentUserName
          );
          const saving = pendingCells.has(`${person}-${slot.id}`);
          const cellExists = scheduleData.cellExists?.[rowIdx]?.[colIdx] ?? true;
          const isBlocked = Boolean(content.blocked);

          const dropLine = (index: number) =>
            isPresenceLocked ? null : (
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
              className={`h-1 rounded-full transition-all duration-150 ${
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
                isRangeSelected ? "bg-[#f0f4de] ring-2 ring-[#8fae4c]" : ""
              } ${saving ? "animate-pulse" : ""} ${cellExists ? "" : "opacity-60"} ${
                isBlocked ? "bg-[#2f3b21]/10" : ""
              } ${isPresenceLocked ? "cursor-not-allowed opacity-80 ring-2 ring-emerald-500/70 bg-emerald-50/60" : ""} relative`}
              style={columnWidth ? { width: columnWidth, minWidth: columnWidth } : undefined}
              title={
                isPresenceLocked && presenceLock ? `${presenceLock.user} is editing this cell.` : undefined
              }
              onClick={(event) => selectCell(person, slot, event)}
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                if (isPresenceLocked) return;
                commitPendingCustomTask({ person, slotId: slot.id });
                setIsSelectingRange(true);
                const nextSelection = { person, slotId: slot.id };
                setSelectionAnchor(nextSelection);
                setSelectionEnd(nextSelection);
                setSelectedCell({ person, slotId: slot.id, slotLabel: slot.label });
              }}
              onMouseEnter={() => {
                if (!isSelectingRange) return;
                if (isPresenceLocked) return;
                setSelectionEnd({ person, slotId: slot.id });
              }}
              onDragOver={(e) => {
                if (isPresenceLocked) return;
                if (isBlocked) return;
                handleDragOverEvent(e, person, slot.id, content.tasks.length);
              }}
              onDragEnter={(e) => {
                if (isPresenceLocked) return;
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
                if (isPresenceLocked) return;
                if (isBlocked) return;
                handleDropEvent(e, person, slot, content.tasks.length);
                setPendingInsert(null);
              }}
            >
              <div
                className="flex h-full w-full flex-col gap-0.5"
                onDragOver={(e) => {
                  if (isPresenceLocked) return;
                  if (isBlocked) return;
                  handleDragOverEvent(e, person, slot.id, content.tasks.length);
                }}
                onDragEnter={(e) => {
                  if (isPresenceLocked) return;
                  if (isBlocked) return;
                  handleDragOverEvent(e, person, slot.id, content.tasks.length);
                }}
                onDrop={(e) => {
                  if (isPresenceLocked) return;
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
                {isPresenceLocked && (
                  <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center rounded-md border-2 border-emerald-500/70 bg-emerald-50/70 text-emerald-800">
                    <span className="text-lg">✋</span>
                  </div>
                )}
                {isRangeSelected &&
                  selectionInitials &&
                  selectedRange &&
                  rowIdx === selectedRange.startRow &&
                  colIdx === selectedRange.startCol && (
                    <span className="absolute right-1 top-1 rounded-full bg-[#8fae4c] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">
                      {selectionInitials}
                    </span>
                  )}
                {!cellExists && (
                  <div className="rounded-md border border-dashed border-[#d0c9a4] bg-white/70 px-2 py-2 text-[11px] text-[#7a7f54]">
                    🔒 Cell not loaded yet. Please wait for the schedule to finish syncing.
                  </div>
                )}
                {isBlocked ? (
                  <div className="flex items-center justify-center rounded-md border border-dashed border-[#2f3b21]/40 bg-[#2f3b21]/10 px-2 py-1 text-center text-[11px] text-[#2f3b21]">
                    <span className="text-base">🛑</span>
                  </div>
                ) : (
                  <>
                    {dropLine(0)}
                    {content.tasks.map((task, idx) => {
                      const taskKey = `${person}-${slot.id}-${task.id}-${idx}`;
                      const meta = taskMetaById.get(task.id);
                      const isDraggingThis =
                        draggingTask?.taskId === task.id &&
                        draggingTask?.fromPerson === person &&
                        draggingTask?.fromSlotId === slot.id;
                      const isEditing = editingTaskKey === taskKey;
                      const assignedCount =
                        taskPeopleCountById.byId.get(task.id) ??
                        taskPeopleCountById.byName.get(task.name.trim().toLowerCase()) ??
                        0;
                      const neededCount = meta?.personCount ?? 0;
                      const hasEnoughPeople =
                        neededCount > 0 ? assignedCount >= neededCount : false;
                      const taskStatus = meta?.status || "Not Started";
                      const taskType = meta?.type || "Uncategorized";
                      const commentCount = meta?.commentCount ?? 0;
                      const cachedCommentCount = taskCommentCache[task.id] ?? 0;
                      const hasComments = commentCount > 0;
                      const hasNewComments = commentCount > cachedCommentCount;
                      const taskIndicators = getTaskIndicators(meta);

                      return (
                        <React.Fragment key={`${person}-${slot.id}-${task.id}-${idx}`}>
                          <div
                            role="button"
                            tabIndex={0}
                            draggable={!isEditing && !isPresenceLocked}
                            onDragStart={(e) => {
                              if (isPresenceLocked) {
                                e.preventDefault();
                                return;
                              }
                              if (isEditing) {
                                e.preventDefault();
                                return;
                              }
                              setDraggingTask({
                                taskId: task.id,
                                taskName: task.name,
                                fromPerson: person,
                                fromSlotId: slot.id,
                                fromIndex: idx,
                              });
                              e.dataTransfer.setData("text/task-name", task.name);
                              e.dataTransfer.setData("text/plain", task.name);
                              e.dataTransfer.setData(
                                DRAG_DATA_TYPE,
                                JSON.stringify({
                                  taskId: task.id,
                                  taskName: task.name,
                                  fromPerson: person,
                                  fromSlotId: slot.id,
                                  fromIndex: idx,
                                })
                              );
                              e.dataTransfer.effectAllowed = "copyMove";
                            }}
                            onDragEnd={() => {
                              setDraggingTask(null);
                              setPendingInsert(null);
                            }}
                            onClick={() => {
                              if (!isPresenceLocked) {
                                selectCell(person, slot);
                              }
                              loadTaskDetail(task.id, task.name);
                            }}
                            onMouseEnter={(event) => {
                              const offsetX = 12;
                              const offsetY = 12;
                              setHoveredTaskTooltip({
                                name: task.name,
                                status: taskStatus,
                                type: taskType,
                                assigned: assignedCount,
                                needed: neededCount,
                                x: event.clientX + offsetX,
                                y: event.clientY + offsetY,
                              });
                            }}
                            onMouseMove={(event) => {
                              if (!hoveredTaskTooltip) return;
                              const offsetX = 12;
                              const offsetY = 12;
                              setHoveredTaskTooltip((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      x: event.clientX + offsetX,
                                      y: event.clientY + offsetY,
                                    }
                                  : prev
                              );
                            }}
                            onMouseLeave={() => {
                              setHoveredTaskTooltip(null);
                            }}
                            onDoubleClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              if (isPresenceLocked) {
                                setMessage(`${presenceLock?.user || "Someone"} is editing this cell right now.`);
                                return;
                              }
                              setEditingTaskKey(taskKey);
                              setEditingTaskId(task.id);
                              setEditingTaskName(task.name);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                if (!isPresenceLocked) {
                                  selectCell(person, slot);
                                }
                                loadTaskDetail(task.id, task.name);
                              }
                            }}
                          className={`group relative flex w-full items-center justify-between gap-1 rounded-sm border px-1.5 py-0.5 text-left text-[9px] leading-snug shadow-sm transition duration-150 ease-out focus:outline-none focus:ring-2 focus:ring-[#8fae4c] sm:text-[10px] min-w-0 hover:z-[60] focus-within:z-[60]
    ${typeColorClasses(meta?.typeColor)}
    ${isDraggingThis ? "scale-[1.01] shadow-md ring-2 ring-[#c8d99a]" : "hover:-translate-y-[1px] hover:shadow-md"}
  `}
                          >
                            <div className="flex min-w-0 items-center gap-1 flex-1">
                              {/* Remove button: hidden until hover */}
                              <button
                                type="button"
                                draggable={false}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeTaskFromCell({ person, slotId: slot.id }, task, idx);
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="shrink-0 rounded-full border border-[#d1d4aa] bg-white/80 px-1 py-[0px] text-[9px] font-semibold text-[#a05252]
                                           opacity-0 pointer-events-none
                                           group-hover:opacity-100 group-hover:pointer-events-auto
                                           hover:bg-[#f7e3e3] transition"
                                title="Remove"
                              >
                                ✕
                              </button>

                              {/* Task name - truncated with ellipsis */}
                              {isEditing ? (
                                <input
                                  ref={editingTaskInputRef}
                                  value={editingTaskName}
                                  onChange={(e) => setEditingTaskName(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  onBlur={() => {
                                    if (editingTaskId) {
                                      void saveInlineTaskName(editingTaskId, editingTaskName, false);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter" && editingTaskId) {
                                      e.preventDefault();
                                      saveInlineTaskName(editingTaskId, editingTaskName);
                                    }
                                    if (e.key === "Escape") {
                                      e.preventDefault();
                                      setEditingTaskKey(null);
                                      setEditingTaskId(null);
                                    }
                                  }}
                                  className="min-w-0 flex-1 rounded-sm border border-[#d1d4aa] bg-white px-1 py-[1px] text-[10px] font-semibold text-[#2f3b21] focus:border-[#8fae4c] focus:outline-none"
                                />
                              ) : (
                                <span className="min-w-0 truncate font-semibold text-[#2f3b21] leading-tight">
                                  {task.name}
                                </span>
                              )}
                              {taskIndicators.map((indicator, indicatorIdx) => (
                                <span
                                  key={`${taskKey}-indicator-${indicatorIdx}`}
                                  className="text-[11px] text-amber-600"
                                  title={indicator.label}
                                >
                                  {indicator.emoji}
                                </span>
                              ))}
                              {hasComments && (
                                <span
                                  className="text-[11px] text-amber-500"
                                  title={hasNewComments ? "New comments added" : "Task has comments"}
                                >
                                  💬
                                </span>
                              )}
                            </div>

                            {/* Assignment counter and completion indicator */}
                            <div className="flex shrink-0 items-center gap-1">
                              {scheduleMode === "page" && hasUnpublishedChanges && (
                                <span
                                  className="h-2 w-2 rounded-full bg-red-500"
                                  aria-label="Unpublished changes"
                                />
                              )}
                              <span className="rounded-full bg-white/80 px-1.5 py-[1px] text-[9px] font-semibold text-[#2f3b21]">
                                {assignedCount}/{neededCount}
                              </span>
                              {hasEnoughPeople && (
                                <span className="text-[11px] text-emerald-600 shrink-0" title="Enough people assigned">
                                  ✅
                                </span>
                              )}
                            </div>

                          </div>

                          {dropLine(idx + 1)}
                        </React.Fragment>
                      );
                    })}

                    {content.note && (
                      <p className="text-[10px] text-[#4f4b33] opacity-90">{content.note}</p>
                    )}
                    {suggestModeEnabled && (visibleSuggestedOneOffByCell[`${person}-${slot.id}`] || []).length > 0 && (
                      <div className="mt-1 space-y-1 rounded-md border border-dashed border-[#d0c9a4] bg-[#f9f6e7] p-1">
                        {(visibleSuggestedOneOffByCell[`${person}-${slot.id}`] || []).map((suggestion) => (
                          <div
                            key={suggestion.id}
                            className="flex items-center justify-between gap-1 rounded border border-[#d7dbe8] bg-[#eef2ff]/70 px-1 py-[2px] text-[10px] text-[#314123]"
                          >
                            <span className="truncate italic opacity-80">👻 {suggestion.name}</span>
                            <button
                              type="button"
                              onClick={() => {
                                void acceptSuggestedOneOff(person, slot.id, suggestion);
                              }}
                              className="rounded-full border border-[#8fae4c] bg-[#f0f4de] px-1.5 py-[1px] text-[10px] font-semibold text-[#4b5133]"
                              title="Duplicate suggested one-off task into this schedule"
                            >
                              ➜
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {isSelected && cellExists && (
                      <div className="space-y-1">
                        <input
                          ref={customTaskInputRef}
                          list="task-options"
                          value={customTask}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const sanitized = stripTaskNameCommas(e.target.value);
                            if (sanitized !== e.target.value) {
                              setMessage("Task name cannot include commas.");
                            }
                            setCustomTask(sanitized);
                          }}
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
                            if (skipCustomTaskBlurRef.current) {
                              skipCustomTaskBlurRef.current = false;
                              return;
                            }
                            if (customTask.trim()) {
                              void handleCustomAdd();
                            }
                          }}
                          placeholder="Type task + Enter"
                          className="w-full rounded-full border border-[#d0c9a4] bg-white px-2 py-1 text-[10px] text-[#3f4630] focus:border-[#8fae4c] focus:outline-none"
                        />
                      </div>
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
          {taskDetailEditor && <div className="mt-3">{taskDetailEditor}</div>}
          </div>
          )}
          {(dayOverviewSummary || yesterdayOverviewSummary) && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#d0c9a4] bg-white/90 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#4b5133] shadow-sm">
                <span>Day Overviews</span>
                <button
                  type="button"
                  onClick={() => toggleSectionVisibility("dayOverviews")}
                  className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#4b5133]"
                >
                  {sectionVisibility.dayOverviews ? "Hide" : "Show"}
                </button>
              </div>
              {sectionVisibility.dayOverviews && (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {yesterdayOverviewSummary && (
                    <div className="rounded-xl border border-[#d0c9a4] bg-white/90 p-3 shadow-sm">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-[#314123]">Yesterday overview</h3>
                            <button
                              type="button"
                              onClick={() => setYesterdayOverviewVisible((prev) => !prev)}
                              className="rounded-full border border-[#d0c9a4] bg-white px-2 py-[2px] text-[9px] font-semibold uppercase tracking-[0.1em] text-[#4b5133]"
                            >
                              {yesterdayOverviewVisible ? "Collapse" : "Expand"}
                            </button>
                          </div>
                          <p className="text-[11px] text-[#6a6c4d]">
                            Outstanding tasks from {yesterdayLabel || "yesterday"}.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 text-[10px] text-[#4b5133]">
                          <span className="rounded-full border border-[#d0c9a4] bg-[#f6f1dd] px-2 py-1 font-semibold">
                            {yesterdayOverviewSummary.total} tasks
                          </span>
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 font-semibold text-amber-800">
                            {yesterdayOverviewSummary.open} open
                          </span>
                        </div>
                      </div>
                      {yesterdayOverviewVisible ? (
                        <div className="mt-3 flex flex-col gap-3">
                        {yesterdayLoading ? (
                          <p className="text-[11px] text-[#7a7f54]">Loading yesterday…</p>
                        ) : yesterdayOpenRecurring.length || yesterdayOpenOneOff.length ? (
                          <>
                            <div className="rounded-lg border border-dashed border-[#e2d7b5] bg-white/70 px-2 py-2">
                              <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6a6c4d]">
                                <span>Recurring tasks</span>
                                <span className="rounded-full border border-[#d0c9a4] bg-white px-2 py-[2px] text-[9px] text-[#4b5133]">
                                  {yesterdayOpenRecurring.length}
                                </span>
                              </div>
                              <div className="mt-2 flex flex-col gap-2">
                                {yesterdayOpenRecurring.length ? (
                                  yesterdayOpenRecurring.map((task) => {
                                    const alreadyScheduled = Boolean(
                                      task.recurring &&
                                        selectedDateIso &&
                                        hasRecurringOccurrenceForDate(task, selectedDateIso)
                                    );
                                    return (
                                      <div
                                        key={`${task.name}-recurring`}
                                        className="flex items-center justify-between gap-2 rounded-md border border-[#e2d7b5] bg-[#faf7eb] px-2 py-1 text-[12px] text-[#314123]"
                                      >
                                        <button
                                          type="button"
                                          onClick={() => task.id && loadTaskDetail(task.id, task.name)}
                                          className="truncate text-left font-semibold hover:underline"
                                        >
                                          {task.name}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleCarryOverTask(task)}
                                          disabled={
                                            !task.id ||
                                            carryOverTaskId === task.id ||
                                            alreadyScheduled
                                          }
                                          className="rounded-full border border-[#8fae4c] bg-[#f0f4de] px-2 py-[2px] text-[9px] font-semibold uppercase tracking-[0.08em] text-[#4b5133] disabled:opacity-60"
                                        >
                                          {carryOverTaskId === task.id
                                            ? "Moving…"
                                            : alreadyScheduled
                                              ? "Already on today"
                                              : "Move to today"}
                                        </button>
                                      </div>
                                    );
                                  })
                                ) : (
                                  <p className="text-[11px] text-[#7a7f54]">
                                    No recurring tasks outstanding.
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="rounded-lg border border-dashed border-[#e2d7b5] bg-white/70 px-2 py-2">
                              <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6a6c4d]">
                                <span>One-off tasks</span>
                                <span className="rounded-full border border-[#d0c9a4] bg-white px-2 py-[2px] text-[9px] text-[#4b5133]">
                                  {yesterdayOpenOneOff.length}
                                </span>
                              </div>
                              <div className="mt-2 flex flex-col gap-2">
                                {yesterdayOpenOneOff.length ? (
                                  yesterdayOpenOneOff.map((task) => (
                                    <div
                                      key={`${task.name}-oneoff`}
                                      className="flex items-center justify-between gap-2 rounded-md border border-[#e2d7b5] bg-[#faf7eb] px-2 py-1 text-[12px] text-[#314123]"
                                    >
                                      <button
                                        type="button"
                                        onClick={() => task.id && loadTaskDetail(task.id, task.name)}
                                        className="truncate text-left font-semibold hover:underline"
                                      >
                                        {task.name}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleCarryOverTask(task)}
                                        disabled={!task.id || carryOverTaskId === task.id}
                                        className="rounded-full border border-[#8fae4c] bg-[#f0f4de] px-2 py-[2px] text-[9px] font-semibold uppercase tracking-[0.08em] text-[#4b5133] disabled:opacity-60"
                                      >
                                        {carryOverTaskId === task.id ? "Moving…" : "Move to today"}
                                      </button>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-[11px] text-[#7a7f54]">
                                    No one-off tasks outstanding.
                                  </p>
                                )}
                              </div>
                            </div>
                          </>
                        ) : (
                          <p className="text-[11px] text-[#7a7f54]">
                            No outstanding tasks from yesterday.
                          </p>
                        )}
                      </div>
                      ) : (
                        <p className="mt-3 text-[11px] text-[#7a7f54]">Yesterday overview is collapsed. Use Expand to review carry-over tasks.</p>
                      )}
                    </div>
                  )}
                  {dayOverviewSummary && (
                    <div className="rounded-xl border border-[#d0c9a4] bg-white/90 p-3 shadow-sm">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-[#314123]">Day overview</h3>
                          <p className="text-[11px] text-[#6a6c4d]">
                            Tasks issued for {scheduleData?.scheduleDate || "this day"}.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 text-[10px] text-[#4b5133]">
                          <span className="rounded-full border border-[#d0c9a4] bg-[#f6f1dd] px-2 py-1 font-semibold">
                            {dayOverviewSummary.total} tasks
                          </span>
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 font-semibold text-emerald-800">
                            {dayOverviewSummary.completed} done
                          </span>
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 font-semibold text-amber-800">
                            {dayOverviewSummary.open} open
                          </span>
                        </div>
                      </div>
                      {dayOverviewAnalytics && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-4">
                          <div className="rounded-lg border border-[#d0c9a4] bg-[#f9f6e7] px-2 py-2 text-[10px] text-[#4b5133]">
                            <p className="uppercase tracking-[0.12em] text-[#7a7f54]">Completion</p>
                            <p className="mt-1 text-sm font-semibold text-[#314123]">{dayOverviewAnalytics.completionRate}%</p>
                          </div>
                          <div className="rounded-lg border border-[#d0c9a4] bg-[#f9f6e7] px-2 py-2 text-[10px] text-[#4b5133]">
                            <p className="uppercase tracking-[0.12em] text-[#7a7f54]">Recurring mix</p>
                            <p className="mt-1 text-sm font-semibold text-[#314123]">{dayOverviewAnalytics.recurringShare}% recurring</p>
                          </div>
                          <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 text-[10px] text-amber-900">
                            <p className="uppercase tracking-[0.12em]">Tasks w/ comments</p>
                            <p className="mt-1 text-sm font-semibold">{dayOverviewAnalytics.commentTaskCount}</p>
                          </div>
                          <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 text-[10px] text-amber-900">
                            <p className="uppercase tracking-[0.12em]">Total comments</p>
                            <p className="mt-1 text-sm font-semibold">{dayOverviewAnalytics.totalCommentCount}</p>
                          </div>
                        </div>
                      )}
                      <div className="mt-3 flex flex-col gap-3">
                        {dayOverviewSummary.tasks.length ? (
                          <>
                            <div className="rounded-lg border border-dashed border-[#e2d7b5] bg-white/70 px-2 py-2">
                              <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6a6c4d]">
                                <span>Recurring tasks</span>
                                <span className="rounded-full border border-[#d0c9a4] bg-white px-2 py-[2px] text-[9px] text-[#4b5133]">
                                  {dayOverviewRecurring.length}
                                </span>
                              </div>
                              <div className="mt-2 flex flex-col gap-2">
                                {dayOverviewRecurring.length ? (
                                  dayOverviewRecurring.map((task) => {
                                    const commentCount = task.id ? taskCommentCache[task.id] || 0 : 0;
                                    const isExpanded = task.id ? expandedOverviewTasks.has(task.id) : false;
                                    const comments = task.id ? dayOverviewCommentsByTask[task.id] || [] : [];
                                    const commentsLoading = task.id ? dayOverviewCommentsLoading.has(task.id) : false;
                                    return (
                                      <div key={`${task.name}-day-recurring`} className="rounded-md border border-[#e2d7b5] bg-[#faf7eb] px-2 py-1">
                                        <button
                                          type="button"
                                          onClick={() => task.id && loadTaskDetail(task.id, task.name)}
                                          className="flex w-full items-center justify-between gap-2 text-left text-[12px] text-[#314123] transition hover:text-[#243319]"
                                        >
                                          <div className="flex min-w-0 items-center gap-2">
                                            <span className="truncate font-semibold">{task.name}</span>
                                            {commentCount > 0 && (
                                              <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-[2px] text-[9px] font-bold uppercase text-amber-900">💬 {commentCount}</span>
                                            )}
                                          </div>
                                          <span className={`rounded-full border px-2 py-[2px] text-[9px] font-semibold uppercase ${statusBadgeClasses(task.status)}`}>
                                            {task.status || "Not Started"}
                                          </span>
                                        </button>
                                        {task.id && commentCount > 0 && (
                                          <div className="mt-1">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setExpandedOverviewTasks((prev) => {
                                                  const next = new Set(prev);
                                                  if (next.has(task.id!)) {
                                                    next.delete(task.id!);
                                                  } else {
                                                    next.add(task.id!);
                                                    void loadCommentsForOverviewTask(task.id!);
                                                  }
                                                  return next;
                                                });
                                              }}
                                              className="text-[10px] font-semibold text-[#3f5b23] underline"
                                            >
                                              {isExpanded ? "Hide" : "Show"} comments ({commentCount})
                                            </button>
                                            {isExpanded && (
                                              <div className="mt-1 space-y-1 rounded border border-[#d8d3b4] bg-white p-2 text-[10px] text-[#4b5133]">
                                                {commentsLoading ? (
                                                  <p>Loading comments…</p>
                                                ) : comments.length ? (
                                                  comments.map((comment) => (
                                                    <p key={comment.id}>
                                                      <span className="font-semibold">{comment.author}:</span> {comment.text}
                                                    </p>
                                                  ))
                                                ) : (
                                                  <p>No comments found.</p>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })
                                ) : (
                                  <p className="text-[11px] text-[#7a7f54]">
                                    No recurring tasks listed yet.
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="rounded-lg border border-dashed border-[#e2d7b5] bg-white/70 px-2 py-2">
                              <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6a6c4d]">
                                <span>One-off tasks</span>
                                <span className="rounded-full border border-[#d0c9a4] bg-white px-2 py-[2px] text-[9px] text-[#4b5133]">
                                  {dayOverviewOneOff.length}
                                </span>
                              </div>
                              <div className="mt-2 flex flex-col gap-2">
                                {dayOverviewOneOff.length ? (
                                  dayOverviewOneOff.map((task) => {
                                    const commentCount = task.id ? taskCommentCache[task.id] || 0 : 0;
                                    const isExpanded = task.id ? expandedOverviewTasks.has(task.id) : false;
                                    const comments = task.id ? dayOverviewCommentsByTask[task.id] || [] : [];
                                    const commentsLoading = task.id ? dayOverviewCommentsLoading.has(task.id) : false;
                                    return (
                                      <div key={`${task.name}-day-oneoff`} className="rounded-md border border-[#e2d7b5] bg-[#faf7eb] px-2 py-1">
                                        <button
                                          type="button"
                                          onClick={() => task.id && loadTaskDetail(task.id, task.name)}
                                          className="flex w-full items-center justify-between gap-2 text-left text-[12px] text-[#314123] transition hover:text-[#243319]"
                                        >
                                          <div className="flex min-w-0 items-center gap-2">
                                            <span className="truncate font-semibold">{task.name}</span>
                                            {commentCount > 0 && (
                                              <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-[2px] text-[9px] font-bold uppercase text-amber-900">💬 {commentCount}</span>
                                            )}
                                          </div>
                                          <span className={`rounded-full border px-2 py-[2px] text-[9px] font-semibold uppercase ${statusBadgeClasses(task.status)}`}>
                                            {task.status || "Not Started"}
                                          </span>
                                        </button>
                                        {task.id && commentCount > 0 && (
                                          <div className="mt-1">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setExpandedOverviewTasks((prev) => {
                                                  const next = new Set(prev);
                                                  if (next.has(task.id!)) {
                                                    next.delete(task.id!);
                                                  } else {
                                                    next.add(task.id!);
                                                    void loadCommentsForOverviewTask(task.id!);
                                                  }
                                                  return next;
                                                });
                                              }}
                                              className="text-[10px] font-semibold text-[#3f5b23] underline"
                                            >
                                              {isExpanded ? "Hide" : "Show"} comments ({commentCount})
                                            </button>
                                            {isExpanded && (
                                              <div className="mt-1 space-y-1 rounded border border-[#d8d3b4] bg-white p-2 text-[10px] text-[#4b5133]">
                                                {commentsLoading ? (
                                                  <p>Loading comments…</p>
                                                ) : comments.length ? (
                                                  comments.map((comment) => (
                                                    <p key={comment.id}>
                                                      <span className="font-semibold">{comment.author}:</span> {comment.text}
                                                    </p>
                                                  ))
                                                ) : (
                                                  <p>No comments found.</p>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })
                                ) : (
                                  <p className="text-[11px] text-[#7a7f54]">
                                    No one-off tasks listed yet.
                                  </p>
                                )}
                              </div>
                            </div>
                          </>
                        ) : (
                          <p className="text-[11px] text-[#7a7f54]">
                            No tasks listed for this day yet.
                          </p>
                        )}
                      </div>
                      {dayOverviewSummary.standaloneNotes.length > 0 && (
                        <div className="mt-3 rounded-lg border border-dashed border-[#d0c9a4] bg-[#f9f6e7] px-3 py-2 text-[11px] text-[#4b5133]">
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
              )}
            </>
          )}

          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#d0c9a4] bg-white/90 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#4b5133] shadow-sm">
              <span>Daily Updates</span>
              <button
                type="button"
                onClick={() => toggleSectionVisibility("dailyUpdates")}
                className="rounded-full border border-[#d0c9a4] bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#4b5133]"
              >
                {sectionVisibility.dailyUpdates ? "Hide" : "Show"}
              </button>
            </div>
            {sectionVisibility.dailyUpdates && (
              <div className="rounded-xl border border-[#d0c9a4] bg-white/90 p-3 shadow-sm">
                <p className="text-[11px] text-[#6a6c4d]">
                  Reports submitted by team members for {selectedDate || "the selected day"}.
                </p>
                <div className="mt-3 rounded-lg border border-[#d8d3b4] bg-[#f9f6e7] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6b6f4c]">
                      AI Admin Summary
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void generateDailyUpdatesSummary();
                      }}
                      disabled={!selectedDateIso || dailyUpdatesSummaryLoading}
                      className="rounded-full border border-[#c8be8d] bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#4b5133] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {dailyUpdatesSummaryLoading ? "Generating…" : "Generate summary"}
                    </button>
                  </div>
                  {dailyUpdatesSummaryError && (
                    <p className="mt-2 text-[11px] text-rose-700">{dailyUpdatesSummaryError}</p>
                  )}
                  {dailyUpdatesSummary && (
                    <div className="mt-2 rounded-md border border-[#ece4c5] bg-white/80 px-2 py-2">
                      <p className="mb-2 text-[10px] text-[#7a7f54]">
                        Cached {new Date(dailyUpdatesSummary.generatedAt).toLocaleString()}
                      </p>
                      <div className="prose prose-sm max-w-none whitespace-pre-wrap text-[#38412a]">
                        {dailyUpdatesSummary.summary}
                      </div>
                    </div>
                  )}
                </div>
                {dailyUpdatesLoading && (
                  <p className="mt-3 text-[11px] text-[#7a7f54]">Loading daily updates…</p>
                )}
                {!dailyUpdatesLoading && dailyUpdatesError && (
                  <p className="mt-3 text-[11px] text-rose-700">{dailyUpdatesError}</p>
                )}
                {!dailyUpdatesLoading && !dailyUpdatesError && dailyUpdates.length === 0 && (
                  <p className="mt-3 text-[11px] text-[#7a7f54]">No daily updates submitted yet.</p>
                )}
                {!dailyUpdatesLoading && !dailyUpdatesError && dailyUpdates.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {dailyUpdates.map((entry) => {
                      const completedCount = entry.task_statuses?.filter(
                        (row) => row.status.toLowerCase() === "completed"
                      ).length || 0;
                      const inProgressCount = entry.task_statuses?.filter(
                        (row) => row.status.toLowerCase() === "in progress"
                      ).length || 0;
                      const notStartedCount = entry.task_statuses?.filter(
                        (row) => row.status.toLowerCase() === "not started"
                      ).length || 0;

                      return (
                        <div key={entry.id} className="rounded-lg border border-[#e6dfbe] bg-[#faf8ee] px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-[#314123]">{entry.user_name}</p>
                            <span className="text-[10px] text-[#7a7f54]">
                              {new Date(entry.updated_at).toLocaleTimeString()}
                            </span>
                          </div>
                          {entry.summary && <p className="mt-1 text-xs text-[#4b5133]">{entry.summary}</p>}
                          <p className="mt-2 text-[11px] text-[#4f5730]">
                            {completedCount} completed · {inProgressCount} in progress · {notStartedCount} not started
                          </p>
                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            <div className="rounded-md border border-[#ece4c5] bg-white/70 px-2 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6b6f4c]">Extra notes</p>
                              <p className="mt-1 text-xs whitespace-pre-wrap text-[#4f5730]">{entry.extra_notes || "—"}</p>
                            </div>
                            <div className="rounded-md border border-[#ece4c5] bg-white/70 px-2 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6b6f4c]">Requests</p>
                              <p className="mt-1 text-xs whitespace-pre-wrap text-[#4f5730]">{entry.requests || "—"}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        </div>

        <div className="order-first w-full shrink-0 space-y-4 overflow-y-visible lg:order-none lg:h-0 lg:w-0 lg:flex-none lg:shrink-0">
          <div
            ref={dockRef}
            className={`relative hidden lg:flex lg:flex-col lg:overflow-hidden lg:rounded-2xl lg:border lg:border-[#d0c9a4] lg:bg-white/95 lg:shadow-lg lg:backdrop-blur ${
              canvasExpanded ? "lg:w-[240px]" : "lg:w-[320px]"
            }`}
            style={{
              left: dockPosition.x,
              top: dockPosition.y,
              position: "fixed",
              zIndex: 80,
              width: dockSize?.width ?? (canvasExpanded ? 240 : 320),
              height: desktopDockOpen ? dockSize?.height ?? 560 : undefined,
            }}
          >
            <div
              onMouseDown={(event) => {
                setDockDragging(true);
                setDockDragOffset({
                  x: event.clientX - dockPosition.x,
                  y: event.clientY - dockPosition.y,
                });
              }}
              className="flex cursor-move items-center justify-between rounded-t-2xl border-b border-[#e2d7b5] bg-[#f0f4de] px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#4b5133]"
            >
              <span>Task dock</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDesktopDockOpen((prev) => !prev)}
                  onMouseDown={(event) => event.stopPropagation()}
                  className="rounded-full border border-[#d0c9a4] bg-white px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#4b5133]"
                >
                  {desktopDockOpen ? "Minimize" : "Expand"}
                </button>
              </div>
            </div>

            {desktopDockOpen && (
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-[11px] text-[#4b5133]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#4b5133]">
                    {desktopDockTab === "recurring" ? "Recurring tasks" : "One-off tasks"}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDesktopDockTab("recurring")}
                      onMouseDown={(event) => event.stopPropagation()}
                      className={`rounded-full border px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.08em] ${
                        desktopDockTab === "recurring"
                          ? "border-[#5d7f3b] bg-[#f0f4de] text-[#314123]"
                          : "border-[#d0c9a4] bg-white text-[#4b5133]"
                      }`}
                    >
                      Recurring
                    </button>
                    <button
                      type="button"
                      onClick={() => setDesktopDockTab("oneOff")}
                      onMouseDown={(event) => event.stopPropagation()}
                      className={`rounded-full border px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.08em] ${
                        desktopDockTab === "oneOff"
                          ? "border-[#5d7f3b] bg-[#f0f4de] text-[#314123]"
                          : "border-[#d0c9a4] bg-white text-[#4b5133]"
                      }`}
                    >
                      One-off
                    </button>
                  </div>
                </div>

                {desktopDockTab === "recurring" && (
                  <>
                    <div className="flex items-center justify-between gap-2 rounded-md border border-[#d0c9a4] bg-white px-2 py-1 text-[10px] font-semibold text-[#4b5133]">
                      <span>{selectedDate || "Pick a date"}</span>
                      <button
                        type="button"
                        onClick={() => setRecurringDockExpanded((prev) => !prev)}
                        className="rounded-md border border-[#d0c9a4] bg-white px-2 py-[2px] text-[10px] font-semibold text-[#4b5133]"
                      >
                        {recurringDockExpanded ? "Collapse list" : "Expand list"}
                      </button>
                    </div>
                    <div className="space-y-2 text-sm">
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
                          onChange={(e) => {
                            const sanitized = stripTaskNameCommas(e.target.value);
                            if (sanitized !== e.target.value) {
                              setMessage("Task name cannot include commas.");
                            }
                            setRecurringQuickName(sanitized);
                          }}
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
                        recurringDockExpanded ? "max-h-none overflow-visible" : "max-h-52 overflow-y-auto"
                      }`}
                    >
                      {filteredRecurringTasks.map((task) => {
                        const taskHandled = isTaskHandled(task);
                        const commentCount = task.commentCount ?? 0;
                        const cachedCommentCount = taskCommentCache[task.id] ?? 0;
                        const hasComments = commentCount > 0;
                        const hasNewComments = commentCount > cachedCommentCount;
                        const isDraggingThis =
                          draggingTask?.taskId === task.id && !draggingTask?.fromPerson;
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
                            className={`group relative flex w-full items-center justify-between gap-1 rounded-md border px-1.5 py-0.5 text-left text-[9px] leading-snug shadow-sm transition duration-150 ease-out focus:outline-none focus:ring-2 focus:ring-[#8fae4c] sm:text-[10px] ${typeColorClasses(
                              task.typeColor
                            )} ${isDraggingThis ? "scale-[1.01] shadow-md ring-2 ring-[#c8d99a]" : "hover:-translate-y-[1px]"}`}
                          >
                            <div>
                              <div className="flex items-center gap-1 font-semibold">
                                <span className="truncate">{task.name}</span>
                                {hasComments && (
                                  <span
                                    className="text-[11px] text-amber-500"
                                    title={
                                      hasNewComments ? "New comments added" : "Task has comments"
                                    }
                                  >
                                    ⚠️
                                  </span>
                                )}
                              </div>
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
                  </>
                )}

                {desktopDockTab === "oneOff" && (
                  <>
                    <div className="flex items-center justify-between rounded-md border border-[#d0c9a4] bg-white px-2 py-1 text-[10px] font-semibold text-[#4b5133]">
                      <span>One-off task dock</span>
                      <button
                        type="button"
                        onClick={() => setOneOffDockExpanded((prev) => !prev)}
                        className="rounded-md border border-[#d0c9a4] bg-white px-2 py-[2px] text-[10px] font-semibold text-[#4b5133]"
                      >
                        {oneOffDockExpanded ? "Collapse list" : "Expand list"}
                      </button>
                    </div>
                    <div className="space-y-2 text-sm">
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
                          onChange={(e) => {
                            const sanitized = stripTaskNameCommas(e.target.value);
                            if (sanitized !== e.target.value) {
                              setMessage("Task name cannot include commas.");
                            }
                            setQuickTaskName(sanitized);
                          }}
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
                        oneOffDockExpanded ? "max-h-none overflow-visible" : "max-h-52 overflow-y-auto"
                      }`}
                    >
                      {filteredOneOffTasks.map((task) => {
                        const taskHandled = isTaskHandled(task);
                        const commentCount = task.commentCount ?? 0;
                        const cachedCommentCount = taskCommentCache[task.id] ?? 0;
                        const hasComments = commentCount > 0;
                        const hasNewComments = commentCount > cachedCommentCount;
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
                            className={`group relative flex w-full items-center justify-between gap-1 rounded-sm border px-1.5 py-0.5 text-left text-[9px] leading-snug text-[#2f3b21] shadow-sm transition duration-150 ease-out focus:outline-none focus:ring-2 focus:ring-[#8fae4c] sm:text-[10px] ${typeColorClasses(
                              task.typeColor
                            )} hover:-translate-y-[1px] hover:shadow-md`}
                          >
                            <div>
                              <div className="flex items-center gap-1 font-semibold">
                                <span className="truncate">{task.name}</span>
                                {hasComments && (
                                  <span
                                    className="text-[11px] text-amber-500"
                                    title={
                                      hasNewComments ? "New comments added" : "Task has comments"
                                    }
                                  >
                                    ⚠️
                                  </span>
                                )}
                              </div>
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
                  </>
                )}
              </div>
            )}
            <div
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const rect = dockRef.current?.getBoundingClientRect();
                setDockResizing({
                  axis: "x",
                  startX: event.clientX,
                  startY: event.clientY,
                  startWidth: rect?.width ?? dockSize?.width ?? 320,
                  startHeight: rect?.height ?? dockSize?.height ?? 560,
                });
              }}
              className="absolute right-0 top-0 h-full w-2 cursor-ew-resize"
            />
            <div
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const rect = dockRef.current?.getBoundingClientRect();
                setDockResizing({
                  axis: "y",
                  startX: event.clientX,
                  startY: event.clientY,
                  startWidth: rect?.width ?? dockSize?.width ?? 320,
                  startHeight: rect?.height ?? dockSize?.height ?? 560,
                });
              }}
              className="absolute bottom-0 left-0 h-2 w-full cursor-ns-resize"
            />
            <div
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const rect = dockRef.current?.getBoundingClientRect();
                setDockResizing({
                  axis: "both",
                  startX: event.clientX,
                  startY: event.clientY,
                  startWidth: rect?.width ?? dockSize?.width ?? 320,
                  startHeight: rect?.height ?? dockSize?.height ?? 560,
                });
              }}
              className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize"
            />
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
                        onChange={(e) => {
                          const sanitized = stripTaskNameCommas(e.target.value);
                          if (sanitized !== e.target.value) {
                            setMessage("Task name cannot include commas.");
                          }
                          setRecurringQuickName(sanitized);
                        }}
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
                        onChange={(e) => {
                          const sanitized = stripTaskNameCommas(e.target.value);
                          if (sanitized !== e.target.value) {
                            setMessage("Task name cannot include commas.");
                          }
                          setQuickTaskName(sanitized);
                        }}
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
                  const commentCount = task.commentCount ?? 0;
                  const cachedCommentCount = taskCommentCache[task.id] ?? 0;
                  const hasComments = commentCount > 0;
                  const hasNewComments = commentCount > cachedCommentCount;
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
                      className={`group relative mb-2 flex w-full items-center justify-between gap-1 rounded-sm border px-1.5 py-0.5 text-left text-[9px] leading-snug text-[#2f3b21] shadow-sm transition duration-150 ease-out focus:outline-none focus:ring-2 focus:ring-[#8fae4c] sm:text-[10px] ${typeColorClasses(
                        task.typeColor
                      )} hover:-translate-y-[1px] hover:shadow-md`}
                    >
                      <div>
                        <div className="flex items-center gap-1 font-semibold">
                          <span className="truncate">{task.name}</span>
                          {hasComments && (
                            <span
                              className="text-[11px] text-amber-500"
                              title={hasNewComments ? "New comments added" : "Task has comments"}
                            >
                              ⚠️
                            </span>
                          )}
                        </div>
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
