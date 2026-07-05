"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadSession } from "@/lib/session";
import {
  RecurrenceSelector,
  type RecurrenceConfig,
  DEFAULT_RECURRENCE,
} from "@/components/RecurrenceSelector";

// ─── Types ────────────────────────────────────────────────────────────────────

type Shift = { id: string; label: string; timeRange?: string; isMeal: boolean };

type Assignment = {
  id: string;
  userName: string;
  status: string;
  completedAt: string | null;
  completionNotes: string | null;
};

type ScheduleTask = {
  id: string;          // schedule_tasks.id
  taskId: string;      // tasks.id
  taskName: string;
  taskDescription: string | null;
  shiftId: string | null;
  slotsNeeded: number;
  isRecurring: boolean;
  overrideNotes: string | null;
  assignments: Assignment[];
  activeAssignments: number; // count of assignments whose user is currently active
};

type ScheduleData = {
  shifts: Shift[];
  people: string[];
  activeVolunteers?: string[]; // subset of people who are currently active
  scheduleTasks: ScheduleTask[];
  scheduleId?: string;
  scheduleDate: string;
  message?: string;
};

type LibraryTask = {
  id: string;
  name: string;
  description?: string | null;
  person_count: number;
  recurring: boolean;
  task_type?: { id: string; name: string; color: string } | null;
};

// Full task definition (returned by GET /api/tasks?id=)
type FullTask = {
  id: string;
  name: string;
  description: string | null;
  priority: string | null;
  recurring: boolean;
  recurrence_interval: number | null;
  recurrence_unit: string | null;
  recurrence_days: number[] | null;
  recurrence_end_type: string | null;
  recurrence_until: string | null;
  recurrence_count: number | null;
  person_count: number;
  extra_notes: unknown[];
  task_type?: { id: string; name: string; color: string } | null;
};

type TaskType = { id: string; name: string; color: string };

type ActiveCell = { person: string; shiftId: string };

type CtxMenu =
  | { type: "chip";  x: number; y: number; task: ScheduleTask; person: string }
  | { type: "cell";  x: number; y: number; person: string; shiftId: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoToLabel(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatDisplayDate(iso: string) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function getTodayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Honolulu" }).format(new Date());
}

function fullTaskToRecurrenceConfig(task: FullTask): RecurrenceConfig {
  return {
    recurring: task.recurring,
    recurrence_interval: task.recurrence_interval ?? 1,
    recurrence_unit: task.recurrence_unit ?? "week",
    recurrence_days: task.recurrence_days ?? [],
    recurrence_end_type: task.recurrence_end_type ?? "never",
    recurrence_until: task.recurrence_until ?? "",
    recurrence_count: task.recurrence_count ?? null,
  };
}

// ─── Local patch helpers ──────────────────────────────────────────────────────
// Pure functions that update ScheduleData locally, avoiding a full GET reload.

type LocalPatch = (data: ScheduleData, activeVols: Set<string>) => ScheduleData;

function mkAssign(scheduleTaskId: string, userName: string): LocalPatch {
  return (data, activeVols) => ({
    ...data,
    scheduleTasks: data.scheduleTasks.map(st => {
      if (st.id !== scheduleTaskId) return st;
      if (st.assignments.some(a => a.userName === userName)) return st;
      const next = [...st.assignments, { id: `local-${Date.now()}`, userName, status: "Not Started", completedAt: null, completionNotes: null }];
      return { ...st, assignments: next, activeAssignments: next.filter(a => activeVols.has(a.userName)).length };
    }),
  });
}

function mkUnassign(scheduleTaskId: string, userName: string): LocalPatch {
  return (data, activeVols) => ({
    ...data,
    scheduleTasks: data.scheduleTasks.map(st => {
      if (st.id !== scheduleTaskId) return st;
      const next = st.assignments.filter(a => a.userName !== userName);
      return { ...st, assignments: next, activeAssignments: next.filter(a => activeVols.has(a.userName)).length };
    }),
  });
}

function mkRemoveTask(scheduleTaskId: string): LocalPatch {
  return (data) => ({ ...data, scheduleTasks: data.scheduleTasks.filter(st => st.id !== scheduleTaskId) });
}

function mkSetShift(scheduleTaskId: string, shiftId: string | null): LocalPatch {
  return (data) => ({
    ...data,
    scheduleTasks: data.scheduleTasks.map(st => st.id === scheduleTaskId ? { ...st, shiftId } : st),
  });
}

function mkStatus(scheduleTaskId: string, userName: string, status: string): LocalPatch {
  return (data) => ({
    ...data,
    scheduleTasks: data.scheduleTasks.map(st => {
      if (st.id !== scheduleTaskId) return st;
      return { ...st, assignments: st.assignments.map(a => a.userName === userName ? { ...a, status } : a) };
    }),
  });
}

function mkAddTask(
  scheduleTaskId: string,
  task: LibraryTask,
  shiftId: string | null,
  userName: string | null,
): LocalPatch {
  return (data, activeVols) => {
    const existing = data.scheduleTasks.find(st => st.id === scheduleTaskId);
    if (existing) {
      return {
        ...data,
        scheduleTasks: data.scheduleTasks.map(st => {
          if (st.id !== scheduleTaskId) return st;
          const alreadyAssigned = !userName || st.assignments.some(a => a.userName === userName);
          const next = alreadyAssigned
            ? st.assignments
            : [...st.assignments, { id: `local-${Date.now()}`, userName: userName!, status: "Not Started", completedAt: null, completionNotes: null }];
          return { ...st, shiftId: shiftId ?? st.shiftId, assignments: next, activeAssignments: next.filter(a => activeVols.has(a.userName)).length };
        }),
      };
    }
    const newTask: ScheduleTask = {
      id: scheduleTaskId,
      taskId: task.id,
      taskName: task.name,
      taskDescription: task.description ?? null,
      shiftId,
      slotsNeeded: task.person_count ?? 1,
      isRecurring: task.recurring,
      overrideNotes: null,
      assignments: userName
        ? [{ id: `local-${Date.now()}`, userName, status: "Not Started", completedAt: null, completionNotes: null }]
        : [],
      activeAssignments: (userName && activeVols.has(userName)) ? 1 : 0,
    };
    return { ...data, scheduleTasks: [...data.scheduleTasks, newTask] };
  };
}

// ─── TaskChip ─────────────────────────────────────────────────────────────────

function TaskChip({
  task,
  person,
  onClick,
  onContextMenu,
  onDragStart,
  onUnassign,
}: {
  task: ScheduleTask;
  person: string;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent) => void;
  onUnassign?: () => void;
}) {
  const assignment  = task.assignments.find(a => a.userName === person);
  const slotsFilled = task.activeAssignments;
  const badgeFull   = slotsFilled >= task.slotsNeeded;

  return (
    <div
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      className={`group relative ${onDragStart ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <button
        onClick={onClick}
        onContextMenu={onContextMenu ? e => { e.preventDefault(); onContextMenu(e); } : undefined}
        className="flex w-full items-center gap-1.5 rounded-md border border-[#d0c9a4] bg-white px-2 py-1 pr-5 text-left text-xs shadow-sm hover:border-[#8fae4c] hover:bg-[#f9f9f3] transition-all"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${task.isRecurring ? "bg-sky-400" : "bg-amber-400"}`} />
        <span className="flex-1 truncate font-medium text-[#314123]">{task.taskName}</span>
        {task.slotsNeeded > 1 && (
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
            badgeFull ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
          }`}>
            {slotsFilled}/{task.slotsNeeded}
          </span>
        )}
        {assignment && (
          <span title={assignment.status} className={`shrink-0 h-1.5 w-1.5 rounded-full ${
            assignment.status === "Completed"   ? "bg-green-500" :
            assignment.status === "In Progress" ? "bg-blue-400"  : "bg-gray-300"
          }`} />
        )}
      </button>
      {onUnassign && (
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onUnassign(); }}
          title="Remove from this person"
          className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center justify-center h-3.5 w-3.5 rounded-full bg-[#e8e4d0] text-[#7a7f54] hover:bg-red-100 hover:text-red-500 text-[9px] leading-none transition-colors"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ─── UnassignedChip ───────────────────────────────────────────────────────────

function UnassignedChip({
  task,
  onClick,
  onContextMenu,
  onDragStart,
}: {
  task: ScheduleTask;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const slotsFilled = task.activeAssignments;
  const badgeFull   = slotsFilled >= task.slotsNeeded;

  return (
    <div
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onContextMenu={onContextMenu ? e => { e.preventDefault(); onContextMenu(e); } : undefined}
      className={`group flex items-center gap-1.5 rounded-md border border-amber-300 bg-white/80 px-2 py-1 text-xs shadow-sm hover:border-amber-500 ${onDragStart ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <span className="text-amber-400 text-[10px] leading-none select-none">⠿</span>
      <button onClick={onClick} className="flex items-center gap-1.5 focus:outline-none">
        <span className={`h-2 w-2 shrink-0 rounded-full ${task.isRecurring ? "bg-sky-400" : "bg-amber-400"}`} />
        <span className="font-medium text-amber-800 max-w-[120px] truncate">{task.taskName}</span>
      </button>
      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
        badgeFull ? "bg-green-100 text-green-700" : "bg-amber-200 text-amber-800"
      }`}>
        {slotsFilled}/{task.slotsNeeded}
      </span>
      {task.shiftId === null && (
        <span className="text-[9px] text-amber-400 font-medium">no shift</span>
      )}
    </div>
  );
}

// ─── CellSearchDropdown ───────────────────────────────────────────────────────

function CellSearchDropdown({
  anchor,
  libraryTasks,
  existingTaskIds,
  onSelect,
  onCreateNew,
  onClose,
}: {
  anchor: DOMRect;
  libraryTasks: LibraryTask[];
  existingTaskIds: Set<string>;
  onSelect: (task: LibraryTask) => void;
  onCreateNew: (query: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Position below the cell; flip above if near the viewport bottom
  const dropW = 256;
  const dropH = 340;
  const gap   = 4;
  const vw    = typeof window !== "undefined" ? window.innerWidth  : 1200;
  const vh    = typeof window !== "undefined" ? window.innerHeight : 800;
  let left = anchor.left;
  if (left + dropW > vw - 8) left = vw - dropW - 8;
  if (left < 8) left = 8;
  let top = anchor.bottom + gap;
  if (top + dropH > vh - 8) top = anchor.top - dropH - gap;
  if (top < 8) top = 8;

  const filtered  = libraryTasks.filter(t => t.name.toLowerCase().includes(query.toLowerCase())).slice(0, 15);
  const recurring = filtered.filter(t => t.recurring);
  const oneOff    = filtered.filter(t => !t.recurring);

  return (
    <div
      className="fixed z-50 w-64 rounded-xl border border-[#d0c9a4] bg-white shadow-xl"
      style={{ left, top }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div className="p-2 border-b border-[#ece8d5]">
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
          placeholder="Search tasks…"
          className="w-full rounded-md border border-[#d0c9a4] px-2.5 py-1.5 text-sm focus:border-[#8fae4c] focus:outline-none"
        />
      </div>
      <div className="max-h-56 overflow-y-auto py-1">
        {filtered.length === 0 && <p className="px-3 py-2 text-xs text-[#7a7f54]">No tasks found</p>}
        {recurring.length > 0 && (
          <>
            <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#7a7f54]">Recurring</p>
            {recurring.map(task => (
              <button key={task.id} onClick={() => onSelect(task)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[#f3f0e4]">
                <span className="h-2 w-2 shrink-0 rounded-full bg-sky-400" />
                <span className="flex-1 truncate text-[#314123]">{task.name}</span>
                {existingTaskIds.has(task.id) && <span className="text-[10px] text-[#8fae4c] font-semibold">✓</span>}
              </button>
            ))}
          </>
        )}
        {oneOff.length > 0 && (
          <>
            <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#7a7f54]">One-off</p>
            {oneOff.map(task => (
              <button key={task.id} onClick={() => onSelect(task)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[#f3f0e4]">
                <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                <span className="flex-1 truncate text-[#314123]">{task.name}</span>
                {existingTaskIds.has(task.id) && <span className="text-[10px] text-[#8fae4c] font-semibold">✓</span>}
              </button>
            ))}
          </>
        )}
      </div>
      <div className="border-t border-[#ece8d5] p-1">
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={() => onCreateNew(query)}
          className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-[#8fae4c] hover:bg-[#f3f0e4]"
        >
          <span>＋</span> Create new task{query.trim() ? ` "${query.trim()}"` : ""}
        </button>
      </div>
    </div>
  );
}

// ─── ContextMenu ─────────────────────────────────────────────────────────────

function ContextMenu({
  menu,
  hasPaste,
  onClose,
  onCopy,
  onPaste,
  onEdit,
  onConvertType,
  onRemoveFromToday,
  onDeleteTask,
}: {
  menu: CtxMenu;
  hasPaste: boolean;
  onClose: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onEdit?: () => void;
  onConvertType?: () => void;
  onRemoveFromToday?: () => void;
  onDeleteTask?: () => void;
}) {
  useEffect(() => {
    const handler = () => onClose();
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  type Item =
    | { label: string; action: () => void; danger?: boolean }
    | { separator: true };

  const items: Item[] = menu.type === "chip"
    ? [
        ...(onCopy    ? [{ label: "Copy task",              action: onCopy }] : []),
        ...(onEdit    ? [{ label: "Edit task definition…",  action: onEdit }] : []),
        ...(onConvertType ? [{ label: `Convert to ${menu.task.isRecurring ? "one-off" : "recurring"}`, action: onConvertType }] : []),
        { separator: true as const },
        ...(onRemoveFromToday ? [{ label: "Remove from today", action: onRemoveFromToday, danger: true }] : []),
        ...(onDeleteTask      ? [{ label: "Delete task",        action: onDeleteTask, danger: true }] : []),
      ]
    : [
        ...(hasPaste && onPaste ? [{ label: "Paste task here", action: onPaste }] : []),
        ...(!hasPaste ? [{ label: "No task copied", action: () => {} }] : []),
      ];

  return (
    <div
      className="fixed z-50 min-w-[180px] rounded-xl border border-[#d0c9a4] bg-white py-1 shadow-2xl"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={e => e.stopPropagation()}
    >
      {items.map((item, i) =>
        "separator" in item ? (
          <div key={i} className="my-1 border-t border-[#ece8d5]" />
        ) : (
          <button
            key={i}
            onClick={() => { item.action(); onClose(); }}
            disabled={item.label === "No task copied"}
            className={`flex w-full px-3 py-1.5 text-left text-sm transition-colors disabled:opacity-40 ${
              item.danger ? "text-red-600 hover:bg-red-50" : "text-[#314123] hover:bg-[#f3f0e4]"
            }`}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

// ─── TaskDetailPopover ────────────────────────────────────────────────────────

function TaskDetailPopover({
  task,
  shifts,
  activeVols,
  isPast,
  onClose,
  onRemoveTask,
  onUnassign,
  onAssign,
  onStatusChange,
  onEditDefinition,
  onDeleteTask,
  initialPos,
}: {
  task: ScheduleTask;
  shifts: Shift[];
  activeVols: Set<string>;
  isPast: boolean;
  onClose: () => void;
  onRemoveTask: (id: string) => void;
  onUnassign: (stId: string, userName: string) => void;
  onAssign: (stId: string, userName: string) => void;
  onStatusChange: (stId: string, userName: string, status: string) => void;
  onEditDefinition: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  initialPos: { x: number; y: number };
}) {
  const shift = shifts.find(s => s.id === task.shiftId);
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [descValue,     setDescValue]     = useState(task.taskDescription ?? "");
  const [descSaving,    setDescSaving]    = useState(false);
  const [personQuery,   setPersonQuery]   = useState("");
  const [showDrop,      setShowDrop]      = useState(false);
  const personInputRef = useRef<HTMLInputElement>(null);

  const descDirty = descValue !== (task.taskDescription ?? "");

  async function saveDescription() {
    setDescSaving(true);
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.taskId, description: descValue }),
      });
    } finally {
      setDescSaving(false);
    }
  }
  const [pos, setPos] = useState(initialPos);
  const isDragging  = useRef(false);
  const dragOrigin  = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  function startDrag(e: React.MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    isDragging.current = true;
    dragOrigin.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    function onMove(me: MouseEvent) {
      if (!isDragging.current) return;
      setPos({
        x: dragOrigin.current.px + me.clientX - dragOrigin.current.mx,
        y: dragOrigin.current.py + me.clientY - dragOrigin.current.my,
      });
    }
    function onUp() {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    <div
      className="fixed z-50 w-72 rounded-2xl border border-[#d0c9a4] bg-[#fdfaf1] shadow-2xl overflow-hidden"
      style={{ left: pos.x, top: pos.y }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Header — drag handle */}
      <div
        onMouseDown={startDrag}
        className="flex items-start justify-between gap-2 px-4 pt-4 pb-3 cursor-grab active:cursor-grabbing select-none border-b border-[#ece8d5]"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${task.isRecurring ? "bg-sky-400" : "bg-amber-400"}`} />
            <h3 className="font-semibold text-[#314123] text-sm leading-tight truncate">{task.taskName}</h3>
          </div>
          <p className="text-xs text-[#7a7f54]">
            {shift ? `${shift.label}${shift.timeRange ? ` · ${shift.timeRange}` : ""}` : "No shift assigned"}
            {" · "}{task.isRecurring ? "Recurring" : "One-off"}
          </p>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onClose(); }}
          onMouseDown={e => e.stopPropagation()}
          className="shrink-0 text-[#7a7f54] hover:text-[#314123] text-xs leading-none mt-0.5"
        >✕</button>
      </div>

      {/* Content */}
      <div className="p-4 pt-3">
        {/* Description — editable on staging, read-only on published past records */}
        <div className="mb-3">
          <textarea
            value={descValue}
            onChange={isPast ? undefined : e => setDescValue(e.target.value)}
            readOnly={isPast}
            placeholder={isPast ? "" : "Add instructions / notes…"}
            rows={3}
            className={`w-full rounded-md border border-[#d0c9a4] px-2.5 py-2 text-xs text-[#4b5133] resize-none ${
              isPast
                ? "bg-[#f3f0e4] text-[#6b6f4c] cursor-default"
                : "bg-[#f8f6ec] placeholder:text-[#b0ac90] focus:border-[#8fae4c] focus:bg-white focus:outline-none"
            }`}
          />
          {!isPast && descDirty && (
            <div className="flex justify-end mt-1">
              <button
                onClick={saveDescription}
                disabled={descSaving}
                className="rounded-md bg-[#8fae4c] px-3 py-1 text-xs font-semibold text-white disabled:opacity-60 hover:bg-[#7e9c44]"
              >
                {descSaving ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>
        {task.overrideNotes && (
          <p className="mb-3 text-xs italic text-[#7a7f54]">Override note: {task.overrideNotes}</p>
        )}

        {/* Assignments */}
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#6b6f4c]">
            Assigned ({task.activeAssignments}/{task.slotsNeeded})
          </p>
          <div className="space-y-1.5">
            {(isPast ? task.assignments : task.assignments.filter(a => activeVols.has(a.userName))).map(a => (
              <div key={a.id} className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm text-[#314123]">{a.userName}</span>
                {isPast ? (
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    a.status === "Completed"   ? "bg-green-100 text-green-700" :
                    a.status === "In Progress" ? "bg-blue-100 text-blue-700"  :
                    "bg-gray-100 text-gray-500"
                  }`}>{a.status}</span>
                ) : (
                  <>
                    <select value={a.status} onChange={e => onStatusChange(task.id, a.userName, e.target.value)}
                      className="rounded border border-[#d0c9a4] bg-white px-1.5 py-0.5 text-xs text-[#314123]">
                      <option>Not Started</option>
                      <option>In Progress</option>
                      <option>Completed</option>
                    </select>
                    <button title="Remove" onClick={() => onUnassign(task.id, a.userName)}
                      className="shrink-0 text-[#7a7f54] hover:text-red-500 text-xs leading-none">✕</button>
                  </>
                )}
              </div>
            ))}
            {(isPast ? task.assignments : task.assignments.filter(a => activeVols.has(a.userName))).length === 0 && (
              <p className="text-xs text-[#7a7f54]">No one assigned yet</p>
            )}
          </div>

          {/* Quick-assign search — only on live/staging schedules */}
          {!isPast && (() => {
            const assigned = new Set(task.assignments.map(a => a.userName));
            const suggestions = [...activeVols]
              .filter(v => !assigned.has(v))
              .filter(v => v.toLowerCase().includes(personQuery.toLowerCase()))
              .sort();
            return (
              <div className="relative mt-2">
                <input
                  ref={personInputRef}
                  value={personQuery}
                  onChange={e => { setPersonQuery(e.target.value); setShowDrop(true); }}
                  onFocus={() => setShowDrop(true)}
                  onBlur={() => setTimeout(() => setShowDrop(false), 150)}
                  onKeyDown={e => {
                    if (e.key === "Escape") { setShowDrop(false); setPersonQuery(""); }
                    if (e.key === "Enter" && suggestions.length > 0) {
                      e.preventDefault();
                      onAssign(task.id, suggestions[0]);
                      setPersonQuery("");
                      setShowDrop(false);
                    }
                  }}
                  placeholder="Add person…"
                  className="w-full rounded-md border border-[#d0c9a4] bg-white px-2.5 py-1.5 text-xs placeholder:text-[#aaa] focus:border-[#8fae4c] focus:outline-none"
                />
                {showDrop && suggestions.length > 0 && (
                  <div className="absolute z-10 mt-0.5 w-full rounded-lg border border-[#d0c9a4] bg-white shadow-lg max-h-36 overflow-y-auto">
                    {suggestions.map(v => (
                      <button
                        key={v}
                        type="button"
                        onMouseDown={() => {
                          onAssign(task.id, v);
                          setPersonQuery("");
                          setShowDrop(false);
                        }}
                        className="flex w-full items-center px-3 py-1.5 text-xs text-[#314123] hover:bg-[#f3f0e4]"
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Actions */}
        <div className="border-t border-[#ece8d5] pt-2 space-y-0.5">
          <button onClick={() => onEditDefinition(task.taskId)}
            className="w-full rounded-md px-3 py-1.5 text-left text-xs font-medium text-[#314123] hover:bg-[#f3f0e4]">
            {isPast ? "View task definition" : "More options…"}
          </button>

          {!isPast && (
            <>
              {removeConfirm ? (
                <div className="flex items-center gap-2 px-3 py-1">
                  <span className="flex-1 text-xs text-red-600">Remove from today?</span>
                  <button onClick={() => onRemoveTask(task.id)}
                    className="rounded-md bg-red-500 px-2 py-1 text-xs font-semibold text-white">Yes</button>
                  <button onClick={() => setRemoveConfirm(false)} className="text-xs text-[#7a7f54]">No</button>
                </div>
              ) : (
                <button onClick={() => setRemoveConfirm(true)}
                  className="w-full rounded-md px-3 py-1.5 text-left text-xs font-medium text-amber-600 hover:bg-amber-50">
                  Remove from today
                </button>
              )}

              {deleteConfirm ? (
                <div className="flex items-center gap-2 px-3 py-1">
                  <span className="flex-1 text-xs text-red-600">Delete this task permanently?</span>
                  <button onClick={() => onDeleteTask(task.taskId)}
                    className="rounded-md bg-red-500 px-2 py-1 text-xs font-semibold text-white">Delete</button>
                  <button onClick={() => setDeleteConfirm(false)} className="text-xs text-[#7a7f54]">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setDeleteConfirm(true)}
                  className="w-full rounded-md px-3 py-1.5 text-left text-xs font-medium text-red-500 hover:bg-red-50">
                  Delete task from library
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── TaskEditorModal ──────────────────────────────────────────────────────────

function TaskEditorModal({
  taskId,
  shifts,
  onClose,
  onSaved,
}: {
  taskId: string;
  shifts: Shift[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [task,    setTask]    = useState<FullTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Form state
  const [name,        setName]        = useState("");
  const [description, setDescription] = useState("");
  const [slots,       setSlots]       = useState(1);
  const [shiftId,     setShiftId]     = useState<string>("");
  const [priority,    setPriority]    = useState<string>("Medium");
  const [taskTypeId,  setTaskTypeId]  = useState<string>("");
  const [taskTypes,   setTaskTypes]   = useState<TaskType[]>([]);
  const [recurrence,  setRecurrence]  = useState<RecurrenceConfig>(DEFAULT_RECURRENCE);

  useEffect(() => {
    Promise.all([
      fetch(`/api/tasks?id=${taskId}`).then(r => r.json()),
      fetch("/api/task-types").then(r => r.json()),
    ]).then(([taskJson, typesJson]) => {
      setTaskTypes(typesJson.types ?? []);
      const t = (taskJson.tasks ?? [])[0] as FullTask | undefined;
      if (!t) { setError("Task not found."); setLoading(false); return; }
      setTask(t);
      setName(t.name);
      setDescription(
        Array.isArray(t.extra_notes) && t.extra_notes.length > 0
          ? String(t.extra_notes[0])
          : (t.description ?? "")
      );
      setSlots(t.person_count);
      setPriority(t.priority ?? "Medium");
      setTaskTypeId(t.task_type?.id ?? "");
      setRecurrence(fullTaskToRecurrenceConfig(t));
    })
    .catch(() => setError("Failed to load task."))
    .finally(() => setLoading(false));
  }, [taskId]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: taskId,
          name: name.trim(),
          description,
          person_count: slots,
          priority,
          task_type_id: taskTypeId || null,
          recurring:            recurrence.recurring,
          recurrence_interval:  recurrence.recurrence_interval,
          recurrence_unit:      recurrence.recurrence_unit,
          recurrence_days:      recurrence.recurrence_days,
          recurrence_end_type:  recurrence.recurrence_end_type,
          recurrence_until:     recurrence.recurrence_until || null,
          recurrence_count:     recurrence.recurrence_count,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed.");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-[#fdfaf1] shadow-2xl overflow-hidden"
        onMouseDown={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#d0c9a4] px-5 py-3">
          <h2 className="font-semibold text-[#314123]">Edit task</h2>
          <button onClick={onClose} className="text-[#7a7f54] hover:text-[#314123]">✕</button>
        </div>

        {loading && <div className="px-5 py-8 text-center text-sm text-[#7a7f54]">Loading…</div>}
        {!loading && !task && <div className="px-5 py-8 text-center text-sm text-red-600">{error}</div>}

        {!loading && task && (
          <div className="px-5 py-4 space-y-4 overflow-y-auto max-h-[70vh]">
            {error && <p className="text-xs text-red-600">{error}</p>}

            {/* Name */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#6b6f4c] mb-1">Name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                className="w-full rounded-lg border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none" />
            </div>

            {/* Category + Priority */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-semibold uppercase tracking-wide text-[#6b6f4c] mb-1">Category</label>
                <select value={taskTypeId} onChange={e => setTaskTypeId(e.target.value)}
                  className="w-full rounded-lg border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none">
                  <option value="">— None —</option>
                  {taskTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold uppercase tracking-wide text-[#6b6f4c] mb-1">Priority</label>
                <select value={priority} onChange={e => setPriority(e.target.value)}
                  className="w-full rounded-lg border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none">
                  <option>Low</option>
                  <option>Medium</option>
                  <option>High</option>
                </select>
              </div>
            </div>

            {/* Instructions */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#6b6f4c] mb-1">Instructions / notes</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
                className="w-full rounded-lg border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none resize-none" />
            </div>

            {/* Slots + Default shift */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-semibold uppercase tracking-wide text-[#6b6f4c] mb-1">Slots needed</label>
                <input type="number" min={1} value={slots} onChange={e => setSlots(Number(e.target.value) || 1)}
                  className="w-full rounded-lg border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none" />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold uppercase tracking-wide text-[#6b6f4c] mb-1">Default shift</label>
                <select value={shiftId} onChange={e => setShiftId(e.target.value)}
                  className="w-full rounded-lg border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none">
                  <option value="">— Any —</option>
                  {shifts.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
            </div>

            {/* Recurrence */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#6b6f4c] mb-1">Recurrence</label>
              <RecurrenceSelector key={taskId} value={recurrence} onChange={setRecurrence} />
            </div>

            <p className="text-[10px] text-[#7a7f54]">
              Changes to recurrence affect future auto-population only — today&apos;s schedule is unchanged.
            </p>
          </div>
        )}

        {!loading && task && (
          <div className="flex justify-end gap-2 border-t border-[#d0c9a4] px-5 py-3">
            <button onClick={onClose}
              className="rounded-lg border border-[#d0c9a4] px-4 py-1.5 text-sm text-[#4b5133] hover:bg-[#f3f0e4]">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || !name.trim()}
              className="rounded-lg bg-[#8fae4c] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60 hover:bg-[#7e9c44]">
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CreateTaskModal ──────────────────────────────────────────────────────────

function CreateTaskModal({
  initialName,
  initialShiftId,
  initialPerson,
  volunteers,
  shifts,
  onClose,
  onCreated,
}: {
  initialName: string;
  initialShiftId: string;
  initialPerson: string;
  volunteers: string[];
  shifts: Shift[];
  onClose: () => void;
  onCreated: (taskId: string, shiftId: string, assignees: string[], libraryTask: LibraryTask) => void;
}) {
  const [name,        setName]        = useState(initialName);
  const [description, setDescription] = useState("");
  const [slots,       setSlots]       = useState(1);
  const [shiftId,     setShiftId]     = useState(initialShiftId);
  const [recurrence,  setRecurrence]  = useState<RecurrenceConfig>(DEFAULT_RECURRENCE);
  const [assignees,   setAssignees]   = useState<string[]>(initialPerson ? [initialPerson] : []);
  const [personQuery, setPersonQuery] = useState("");
  const [showDrop,    setShowDrop]    = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const nameRef        = useRef<HTMLInputElement>(null);
  const personInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const suggestions = volunteers
    .filter(v => !assignees.includes(v))
    .filter(v => v.toLowerCase().includes(personQuery.toLowerCase()));

  function addPerson(name: string) {
    setAssignees(a => [...a, name]);
    setPersonQuery("");
    setShowDrop(false);
    personInputRef.current?.focus();
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description || null,
          person_count: slots,
          recurring:           recurrence.recurring,
          recurrence_interval: recurrence.recurrence_interval,
          recurrence_unit:     recurrence.recurrence_unit,
          recurrence_days:     recurrence.recurrence_days,
          recurrence_end_type: recurrence.recurrence_end_type,
          recurrence_until:    recurrence.recurrence_until || null,
          recurrence_count:    recurrence.recurrence_count,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Create failed.");
      const task: LibraryTask = {
        id: json.task.id,
        name: json.task.name ?? name.trim(),
        description: (json.task.description ?? description) || null,
        person_count: json.task.person_count ?? slots,
        recurring: json.task.recurring ?? recurrence.recurring,
        task_type: json.task.task_type ?? null,
      };
      onCreated(task.id, shiftId, assignees, task);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-[#fdfaf1] shadow-2xl overflow-hidden"
        onMouseDown={e => e.stopPropagation()}>

        <div className="flex items-center justify-between border-b border-[#d0c9a4] px-5 py-3">
          <h2 className="font-semibold text-[#314123]">New task</h2>
          <button onClick={onClose} className="text-[#7a7f54] hover:text-[#314123]">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto max-h-[70vh]">
          {error && <p className="text-xs text-red-600">{error}</p>}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#6b6f4c] mb-1">Name</label>
            <input ref={nameRef} value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !saving) handleSave(); }}
              className="w-full rounded-lg border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none" />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#6b6f4c] mb-1">Instructions / notes</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              placeholder="Optional"
              className="w-full rounded-lg border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none resize-none" />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#6b6f4c] mb-1">Slots needed</label>
              <input type="number" min={1} value={slots} onChange={e => setSlots(Number(e.target.value) || 1)}
                className="w-full rounded-lg border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#6b6f4c] mb-1">Shift</label>
              <select value={shiftId} onChange={e => setShiftId(e.target.value)}
                className="w-full rounded-lg border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none">
                <option value="">— None —</option>
                {shifts.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {/* People */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#6b6f4c] mb-1.5">Assign people</label>
            {assignees.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {assignees.map(person => (
                  <span key={person} className="flex items-center gap-1 rounded-full bg-[#e8f0d4] px-2.5 py-1 text-xs font-medium text-[#314123]">
                    {person}
                    <button
                      type="button"
                      onClick={() => setAssignees(a => a.filter(p => p !== person))}
                      className="text-[#7a7f54] hover:text-red-500 leading-none ml-0.5"
                    >×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <input
                ref={personInputRef}
                value={personQuery}
                onChange={e => { setPersonQuery(e.target.value); setShowDrop(true); }}
                onFocus={() => setShowDrop(true)}
                onBlur={() => setTimeout(() => setShowDrop(false), 150)}
                onKeyDown={e => {
                  if (e.key === "Escape") { setShowDrop(false); setPersonQuery(""); }
                  if (e.key === "Enter" && suggestions.length > 0) { e.preventDefault(); addPerson(suggestions[0]); }
                }}
                placeholder="Search volunteers…"
                className="w-full rounded-lg border border-[#d0c9a4] px-3 py-1.5 text-sm focus:border-[#8fae4c] focus:outline-none"
              />
              {showDrop && suggestions.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-[#d0c9a4] bg-white shadow-lg max-h-40 overflow-y-auto">
                  {suggestions.map(v => (
                    <button
                      key={v}
                      type="button"
                      onMouseDown={() => addPerson(v)}
                      className="flex w-full items-center px-3 py-2 text-sm text-[#314123] hover:bg-[#f3f0e4]"
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#6b6f4c] mb-1">Recurrence</label>
            <RecurrenceSelector value={recurrence} onChange={setRecurrence} />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[#d0c9a4] px-5 py-3">
          <button onClick={onClose}
            className="rounded-lg border border-[#d0c9a4] px-4 py-1.5 text-sm text-[#4b5133] hover:bg-[#f3f0e4]">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            className="rounded-lg bg-[#8fae4c] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60 hover:bg-[#7e9c44]">
            {saving ? "Creating…" : "Create & add to schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CopyFromDayModal ─────────────────────────────────────────────────────────

function CopyFromDayModal({
  currentDate,
  onClose,
  onCopy,
}: {
  currentDate: string;
  onClose: () => void;
  onCopy: (sourceDate: string) => void;
}) {
  const [source, setSource] = useState(addDays(currentDate, -1));
  const [copying, setCopying] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-[#fdfaf1] shadow-2xl overflow-hidden"
        onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#d0c9a4] px-5 py-3">
          <h2 className="font-semibold text-[#314123]">Copy from another day</h2>
          <button onClick={onClose} className="text-[#7a7f54] hover:text-[#314123]">✕</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-[#7a7f54]">
            Replaces today&apos;s staging schedule with all tasks from the selected day. Assignments are copied where the person is still active; otherwise the task goes to unassigned.
          </p>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#6b6f4c] mb-1">Source date</label>
            <input type="date" value={source} max={addDays(currentDate, -1)}
              onChange={e => e.target.value && setSource(e.target.value)}
              className="w-full rounded-lg border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none" />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#d0c9a4] px-5 py-3">
          <button onClick={onClose}
            className="rounded-lg border border-[#d0c9a4] px-4 py-1.5 text-sm text-[#4b5133] hover:bg-[#f3f0e4]">
            Cancel
          </button>
          <button
            disabled={copying || !source}
            onClick={() => { setCopying(true); onCopy(source); }}
            className="rounded-lg bg-[#8fae4c] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60 hover:bg-[#7e9c44]">
            {copying ? "Copying…" : "Copy tasks"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const PERSON_COL = 164;
const SHIFT_COL  = 192;

export default function SchedulePage() {
  const router = useRouter();
  const [authorized,   setAuthorized]   = useState(false);
  const [accessError,  setAccessError]  = useState<string | null>(null);

  const [date,         setDate]         = useState(getTodayIso);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const [libraryTasks, setLibraryTasks] = useState<LibraryTask[]>([]);
  const [activeCell,     setActiveCell]     = useState<ActiveCell | null>(null);
  const [activeCellRect, setActiveCellRect] = useState<DOMRect | null>(null);
  const [popoverTask,  setPopoverTask]  = useState<ScheduleTask | null>(null);
  const popoverTaskIdRef               = useRef<string | null>(null);

  const [contextMenu,      setContextMenu]      = useState<CtxMenu | null>(null);
  const [clipboardTaskId,  setClipboardTaskId]  = useState<string | null>(null);
  const [editingTaskId,     setEditingTaskId]     = useState<string | null>(null);
  const [createTaskContext, setCreateTaskContext] = useState<{ name: string; shiftId: string; person: string } | null>(null);
  const [showCopyModal,     setShowCopyModal]     = useState(false);

  // Drag state — ref avoids stale closures in drop handlers
  const dragTaskRef   = useRef<ScheduleTask | null>(null);
  const dragPersonRef = useRef<string | null>(null); // null = dragging from unassigned row
  const [dragOverCell, setDragOverCell] = useState<ActiveCell | null>(null);

  const [publishing,  setPublishing]   = useState(false);
  const [publishNote, setPublishNote]  = useState<string | null>(null);
  const [popoverPos,  setPopoverPos]   = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  function openPopover(task: ScheduleTask, clickX: number, clickY: number) {
    const popW = 288 + 2; // w-72 + border
    const popH = 380;     // rough height estimate
    const vw   = window.innerWidth;
    const vh   = window.innerHeight;
    const gap  = 14;
    let x = clickX + gap;
    if (x + popW > vw - 8) x = clickX - popW - gap;
    if (x < 8) x = 8;
    let y = clickY - 8;
    if (y + popH > vh - 8) y = vh - popH - 8;
    if (y < 8) y = 8;
    setPopoverPos({ x, y });
    setPopoverTask(task);
  }

  // Keep ref in sync so loadSchedule can refresh the popover without stale closures
  useEffect(() => { popoverTaskIdRef.current = popoverTask?.id ?? null; }, [popoverTask]);

  // Auth
  useEffect(() => {
    const session = loadSession();
    if (!session?.name) { router.replace("/"); return; }
    if ((session.userType ?? "").toLowerCase() !== "admin") {
      setAccessError("Admin access required.");
      return;
    }
    setAuthorized(true);
  }, [router]);

  // Load library tasks
  useEffect(() => {
    if (!authorized) return;
    fetch("/api/tasks?includeOccurrences=false")
      .then(r => r.json())
      .then(j => setLibraryTasks(j.tasks ?? []))
      .catch(console.error);
  }, [authorized]);

  async function loadSchedule(iso: string, opts: { skipAutoPopulate?: boolean } = {}) {
    setLoading(true);
    setError(null);
    try {
      // Past dates show the published live record; today/future show staging.
      const pastDate = iso < getTodayIso();
      let url = pastDate
        ? `/api/schedule?date=${iso}`
        : `/api/schedule?date=${iso}&staging=1`;
      if (opts.skipAutoPopulate) url += "&skipAutoPopulate=1";
      const res  = await fetch(url);
      const json = await res.json();
      setScheduleData(json);
    } catch {
      setError("Failed to load schedule.");
    } finally {
      setLoading(false);
    }
  }

  // Keep the open popover in sync whenever schedule data changes (local patches or reloads)
  useEffect(() => {
    const pid = popoverTaskIdRef.current;
    if (!pid || !scheduleData) return;
    const refreshed = scheduleData.scheduleTasks.find(st => st.id === pid);
    setPopoverTask(refreshed ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleData]);

  useEffect(() => {
    if (!authorized) return;
    setPublishNote(null);
    loadSchedule(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, date]);

  // Apply a local patch to scheduleData without a network reload
  function applyPatch(patch: LocalPatch) {
    const snap = activeVols; // capture current active set
    setScheduleData(prev => (prev ? patch(prev, snap) : prev));
  }

  // Generic schedule mutation — applies a local patch if provided, otherwise full reload
  async function mutate(body: Record<string, unknown>, patch?: LocalPatch) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Update failed.");
      if (patch) {
        applyPatch(patch);
      } else {
        await loadSchedule(date);
      }
    } catch (err) {
      await loadSchedule(date); // revert to server truth on error
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  }

  // Batch mutations: run sequentially, apply patches without reload
  async function mutateBatch(actions: Record<string, unknown>[], patches: LocalPatch[]) {
    setSaving(true);
    setError(null);
    try {
      for (const body of actions) {
        const res = await fetch("/api/schedule/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Update failed.");
      }
      const snap = activeVols;
      setScheduleData(prev => {
        if (!prev) return prev;
        let data = prev;
        for (const patch of patches) data = patch(data, snap);
        return data;
      });
    } catch (err) {
      await loadSchedule(date); // revert on error
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleAddTask(task: LibraryTask) {
    if (!activeCell) return;
    const cell = activeCell;
    setActiveCell(null);
    setActiveCellRect(null);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_task", dateLabel: date, taskId: task.id, shiftId: cell.shiftId, userName: cell.person }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Update failed.");
      const { scheduleTaskId } = await res.json();
      applyPatch(mkAddTask(scheduleTaskId, task, cell.shiftId, cell.person));
    } catch (err) {
      await loadSchedule(date);
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  }

  function handleOpenCreateTask(query: string) {
    if (!activeCell) return;
    const { shiftId, person } = activeCell;
    setActiveCell(null);
    setActiveCellRect(null);
    setCreateTaskContext({ name: query, shiftId, person });
  }

  async function handleTaskCreated(taskId: string, shiftId: string, assignees: string[], libraryTask?: LibraryTask) {
    setCreateTaskContext(null);
    setSaving(true);
    setError(null);
    try {
      // add_task creates the schedule_task row + optionally one assignment
      const res = await fetch("/api/schedule/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_task",
          dateLabel: date,
          taskId,
          shiftId: shiftId || null,
          userName: assignees[0] ?? null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add task.");
      const { scheduleTaskId } = await res.json();

      // Assign any additional people
      for (const userName of assignees.slice(1)) {
        const r = await fetch("/api/schedule/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "assign", scheduleTaskId, userName }),
        });
        if (!r.ok) throw new Error((await r.json()).error ?? "Failed to assign.");
      }

      if (libraryTask) {
        // Patch local state — no reload needed
        let patch = mkAddTask(scheduleTaskId, libraryTask, shiftId || null, assignees[0] ?? null);
        const snap = activeVols;
        setScheduleData(prev => {
          if (!prev) return prev;
          let data = patch(prev, snap);
          // Patch in remaining assignees
          for (const userName of assignees.slice(1)) {
            data = mkAssign(scheduleTaskId, userName)(data, snap);
          }
          return data;
        });
      } else {
        await loadSchedule(date);
      }

      // Refresh the library so the new task appears in future searches
      fetch("/api/tasks?parent_task_id=is.null")
        .then(r => r.json())
        .then(j => setLibraryTasks(j.tasks ?? []))
        .catch(() => {});
    } catch (err) {
      await loadSchedule(date);
      setError(err instanceof Error ? err.message : "Failed to create task.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveTask(scheduleTaskId: string) {
    setPopoverTask(null);
    await mutate({ action: "remove_task", scheduleTaskId }, mkRemoveTask(scheduleTaskId));
  }

  async function handleUnassign(scheduleTaskId: string, userName: string) {
    const task = scheduleData?.scheduleTasks.find(st => st.id === scheduleTaskId);
    // For one-off tasks: removing the last active assignee means nobody needs to do this task
    // today — delete the schedule_tasks row entirely rather than leaving it in the unassigned row.
    if (task && !task.isRecurring) {
      const remainingActive = task.assignments.filter(
        a => a.userName !== userName && activeVols.has(a.userName)
      ).length;
      if (remainingActive === 0) {
        await mutate({ action: "remove_task", scheduleTaskId }, mkRemoveTask(scheduleTaskId));
        return;
      }
    }
    await mutate({ action: "unassign", scheduleTaskId, userName }, mkUnassign(scheduleTaskId, userName));
  }

  async function handleAssign(scheduleTaskId: string, userName: string) {
    await mutate({ action: "assign", scheduleTaskId, userName }, mkAssign(scheduleTaskId, userName));
  }

  async function handleStatusChange(scheduleTaskId: string, userName: string, status: string) {
    await mutate({ action: "status", scheduleTaskId, userName, status }, mkStatus(scheduleTaskId, userName, status));
  }

  async function handleDeleteTask(taskId: string) {
    setPopoverTask(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Delete failed.");
      await loadSchedule(date);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  async function handleConvertType(task: ScheduleTask) {
    setContextMenu(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.taskId, recurring: !task.isRecurring }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Convert failed.");
      await loadSchedule(date);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Convert failed.");
    }
  }

  async function handlePaste(person: string, shiftId: string) {
    if (!clipboardTaskId) return;
    setContextMenu(null);
    const pastedTaskId = clipboardTaskId;
    const libraryTask = libraryTasks.find(t => t.id === pastedTaskId);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_task", dateLabel: date, taskId: pastedTaskId, shiftId, userName: person }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Update failed.");
      const { scheduleTaskId } = await res.json();
      if (libraryTask) {
        applyPatch(mkAddTask(scheduleTaskId, libraryTask, shiftId, person));
      } else {
        await loadSchedule(date);
      }
    } catch (err) {
      await loadSchedule(date);
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyFromDay(sourceDate: string) {
    setShowCopyModal(false);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "copy_day", sourceDate, targetDate: date }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Copy failed.");
      await loadSchedule(date, { skipAutoPopulate: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed.");
    } finally {
      setSaving(false);
    }
  }

  // Drop handler — works for both unassigned chips and already-placed chips
  async function handleDrop(toPerson: string, toShiftId: string) {
    const task       = dragTaskRef.current;
    const fromPerson = dragPersonRef.current; // null if dragged from unassigned row
    dragTaskRef.current   = null;
    dragPersonRef.current = null;
    setDragOverCell(null);
    if (!task) return;

    const sameShift  = task.shiftId === toShiftId;
    const samePerson = fromPerson === toPerson;
    if (samePerson && sameShift) return; // dropped on same cell, nothing to do

    const actions: Record<string, unknown>[] = [];
    const patches: LocalPatch[] = [];
    if (!sameShift) {
      actions.push({ action: "set_shift", scheduleTaskId: task.id, shiftId: toShiftId });
      patches.push(mkSetShift(task.id, toShiftId));
    }
    if (!samePerson) {
      if (fromPerson) {
        actions.push({ action: "unassign", scheduleTaskId: task.id, userName: fromPerson });
        patches.push(mkUnassign(task.id, fromPerson));
      }
      actions.push({ action: "assign", scheduleTaskId: task.id, userName: toPerson });
      patches.push(mkAssign(task.id, toPerson));
    }

    if (actions.length === 1) await mutate(actions[0], patches[0]);
    else await mutateBatch(actions, patches);
  }

  async function handlePublish() {
    setPublishing(true);
    setPublishNote(null);
    try {
      const res = await fetch("/api/schedule/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateLabel: isoToLabel(date) }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Publish failed.");
      setPublishNote("Published — volunteers notified.");
    } catch (err) {
      setPublishNote(err instanceof Error ? err.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  }

  // Close overlays when clicking outside
  function handleBackdropClick() {
    setActiveCell(null);
    setActiveCellRect(null);
    setPopoverTask(null);
    setContextMenu(null);
  }

  // Keyboard shortcuts: Ctrl+C/X on open popover chip, Ctrl+V into open cell dropdown
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      if (date < getTodayIso()) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "c" && popoverTask) {
        e.preventDefault();
        setClipboardTaskId(popoverTask.taskId);
      } else if (e.key === "x" && popoverTask) {
        e.preventDefault();
        setClipboardTaskId(popoverTask.taskId);
        handleRemoveTask(popoverTask.id);
      } else if (e.key === "v" && clipboardTaskId && activeCell) {
        e.preventDefault();
        handlePaste(activeCell.person, activeCell.shiftId);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [date, popoverTask, clipboardTaskId, activeCell]);

  if (accessError) return <div className="p-6 text-sm text-[#7a7f54]">{accessError}</div>;
  if (!authorized) return null;

  const shifts        = scheduleData?.shifts        ?? [];
  const people        = scheduleData?.people        ?? [];
  const scheduleTasks = scheduleData?.scheduleTasks ?? [];
  const activeVols    = new Set(scheduleData?.activeVolunteers ?? people);

  // Past dates: show only the people who were actually assigned — exactly as saved.
  // Current / future dates: show all active volunteers (plus any deactivated who are
  // still assigned to this staging schedule).
  const isPast = date < getTodayIso();

  const assignedOnThisSchedule = new Set(
    scheduleTasks.flatMap(st => st.assignments.map(a => a.userName))
  );
  const displayPeople = isPast
    ? [...assignedOnThisSchedule].sort()     // historical: only who was there
    : people.filter(p => activeVols.has(p)); // live/future: active volunteers only

  // Unassigned: for past schedules use the raw assignment count (historical accuracy);
  // for current/future use only active-volunteer assignments so deactivated slots show as open.
  const unassignedTasks = scheduleTasks.filter(st =>
    st.shiftId === null ||
    (isPast ? st.assignments.length : st.activeAssignments) < st.slotsNeeded
  );
  const existingTaskIds = new Set(scheduleTasks.map(st => st.taskId));

  function tasksForCell(person: string, shiftId: string) {
    return scheduleTasks.filter(
      st => st.shiftId === shiftId && st.assignments.some(a => a.userName === person)
    );
  }

  const totalWidth = PERSON_COL + shifts.length * SHIFT_COL;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#faf8f0]">
      {/* Backdrop — closes dropdowns/popovers/context menu on outside click */}
      {(activeCell || popoverTask || contextMenu) && (
        <div className="fixed inset-0 z-20" onMouseDown={handleBackdropClick} />
      )}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-[#d0c9a4] bg-[#fdfaf1] px-4 py-2.5 z-10">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7a7f54]">Admin · Schedule</p>
            <h1 className="text-base font-semibold text-[#314123] leading-tight">{formatDisplayDate(date)}</h1>
          </div>

          <div className="flex items-center gap-1">
            <button onClick={() => setDate(d => addDays(d, -1))}
              className="rounded border border-[#d0c9a4] px-2 py-1 text-sm text-[#4b5133] hover:bg-[#f3f0e4]">←</button>
            <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)}
              className="rounded border border-[#d0c9a4] px-2 py-1 text-sm text-[#314123]" />
            <button onClick={() => setDate(d => addDays(d, 1))}
              className="rounded border border-[#d0c9a4] px-2 py-1 text-sm text-[#4b5133] hover:bg-[#f3f0e4]">→</button>
            <button onClick={() => setDate(getTodayIso())}
              className="rounded border border-[#d0c9a4] px-2 py-1 text-xs text-[#7a7f54] hover:bg-[#f3f0e4]">Today</button>
          </div>

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {saving && <span className="text-xs text-[#7a7f54]">Saving…</span>}
            {error   && <span className="text-xs text-red-600">{error}</span>}
            {publishNote && (
              <span className={`text-xs ${publishNote.includes("fail") || publishNote.includes("error") ? "text-red-600" : "text-green-700"}`}>
                {publishNote}
              </span>
            )}
            {isPast ? (
              <span className="rounded border border-[#d0c9a4] px-2.5 py-1.5 text-xs text-[#7a7f54] bg-[#f3f0e4]">
                Published record · Read only
              </span>
            ) : (
              <>
                <button onClick={() => setShowCopyModal(true)}
                  className="rounded border border-[#d0c9a4] px-2.5 py-1.5 text-xs text-[#4b5133] hover:bg-[#f3f0e4]">
                  Copy from…
                </button>
                <button onClick={handlePublish} disabled={publishing || loading}
                  className="rounded-md bg-[#8fae4c] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-60 hover:bg-[#7e9c44]">
                  {publishing ? "Publishing…" : "Publish"}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Schedule grid ────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-auto">
        {loading && (
          <div className="flex h-32 items-center justify-center text-sm text-[#7a7f54]">Loading…</div>
        )}

        {!loading && scheduleData?.message && isPast && (
          <div className="flex h-32 items-center justify-center text-sm text-[#7a7f54]">
            No schedule was published for this date.
          </div>
        )}

        {!loading && scheduleData && !scheduleData.message && (
          <div className="overflow-x-auto">
            <div style={{ minWidth: totalWidth }}>

              {/* ── Column headers ─────────────────────────────────────── */}
              <div className="flex sticky top-0 z-10 bg-[#f0edd8] border-b border-[#d0c9a4]">
                <div style={{ width: PERSON_COL, minWidth: PERSON_COL }}
                  className="shrink-0 border-r border-[#d0c9a4] px-3 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6b6f4c]">Person</span>
                </div>
                {shifts.map(shift => (
                  <div key={shift.id} style={{ width: SHIFT_COL, minWidth: SHIFT_COL }}
                    className="shrink-0 border-r border-[#d0c9a4] px-3 py-2">
                    <p className="text-xs font-semibold text-[#314123] leading-tight">{shift.label}</p>
                    {shift.timeRange && <p className="text-[10px] text-[#7a7f54]">{shift.timeRange}</p>}
                  </div>
                ))}
              </div>

              {/* ── Unassigned row — always visible ─────────────────────── */}
              <div className="flex border-b border-amber-200 bg-amber-50 min-h-[44px]">
                <div style={{ width: PERSON_COL, minWidth: PERSON_COL }}
                  className="shrink-0 border-r border-amber-200 px-3 py-2 flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                  <span className="text-xs font-semibold text-amber-700">Unassigned</span>
                </div>
                <div className="flex-1 flex flex-wrap gap-1.5 px-2 py-1.5 items-start">
                  {unassignedTasks.length === 0 ? (
                    <span className="text-xs text-amber-400 italic self-center">All tasks are fully staffed</span>
                  ) : (
                    unassignedTasks.map(task => (
                      <UnassignedChip
                        key={task.id}
                        task={task}
                        onClick={e => { e.stopPropagation(); setContextMenu(null); setActiveCell(null); openPopover(task, e.clientX, e.clientY); }}
                        onContextMenu={isPast ? undefined : e => {
                          e.stopPropagation();
                          setPopoverTask(null);
                          setContextMenu({ type: "chip", x: e.clientX, y: e.clientY, task, person: "" });
                        }}
                        onDragStart={isPast ? undefined : e => {
                          e.stopPropagation();
                          dragTaskRef.current   = task;
                          dragPersonRef.current = null;
                          e.dataTransfer.effectAllowed = "move";
                        }}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* ── Person rows ────────────────────────────────────────── */}
              {displayPeople.map((person, pIdx) => {
                // Only flag deactivated on current/future schedules — past schedules
                // show people exactly as they appeared when the schedule was published.
                const isDeactivated = !isPast && !activeVols.has(person);
                const rowBg  = pIdx % 2 === 0 ? "bg-[#fdfaf1]" : "bg-[#f5f3e8]";
                const cellBg = pIdx % 2 === 0 ? "bg-white"     : "bg-[#fdfcf6]";

                return (
                  <div key={person} className={`flex border-b border-[#d0c9a4] ${rowBg} ${isDeactivated ? "opacity-60" : ""}`}>
                    {/* Person name */}
                    <div style={{ width: PERSON_COL, minWidth: PERSON_COL }}
                      className={`shrink-0 border-r border-[#d0c9a4] px-3 py-2 flex items-center gap-1.5 ${rowBg}`}>
                      <span className={`truncate text-sm font-medium ${isDeactivated ? "text-[#7a7f54] line-through" : "text-[#314123]"}`}>{person}</span>
                      {isDeactivated && <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-[#a09870] bg-[#ece8d5] rounded px-1">inactive</span>}
                    </div>

                    {/* Shift cells */}
                    {shifts.map(shift => {
                      const chips    = tasksForCell(person, shift.id);
                      const isActive = activeCell?.person === person && activeCell?.shiftId === shift.id;
                      const isDragOver = dragOverCell?.person === person && dragOverCell?.shiftId === shift.id;

                      return (
                        <div
                          key={shift.id}
                          style={{ width: SHIFT_COL, minWidth: SHIFT_COL }}
                          onMouseDown={isPast ? undefined : e => {
                            if ((e.target as Element).closest("button,a,select")) return;
                            e.stopPropagation();
                            setPopoverTask(null);
                            setContextMenu(null);
                            if (isActive) {
                              setActiveCell(null);
                              setActiveCellRect(null);
                            } else {
                              setActiveCell({ person, shiftId: shift.id });
                              setActiveCellRect((e.currentTarget as HTMLElement).getBoundingClientRect());
                            }
                          }}
                          onContextMenu={isPast ? undefined : e => {
                            e.preventDefault();
                            e.stopPropagation();
                            setActiveCell(null);
                            setContextMenu({ type: "cell", x: e.clientX, y: e.clientY, person, shiftId: shift.id });
                          }}
                          onDragOver={isPast ? undefined : e => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            setDragOverCell({ person, shiftId: shift.id });
                          }}
                          onDragLeave={isPast ? undefined : () => setDragOverCell(null)}
                          onDrop={isPast ? undefined : e => { e.preventDefault(); handleDrop(person, shift.id); }}
                          className={`relative shrink-0 border-r border-[#d0c9a4] px-2 py-1.5 min-h-[48px] transition-colors ${cellBg} ${
                            isPast     ? "" :
                            isDragOver ? "ring-2 ring-inset ring-[#8fae4c] bg-[#f0f4e8] cursor-pointer" :
                            isActive   ? "ring-1 ring-inset ring-[#8fae4c] bg-[#f0f4e8] cursor-pointer" :
                            "hover:bg-[#f3f0e4] cursor-pointer"
                          }`}
                        >
                          <div className="flex flex-col gap-1">
                            {chips.map(task => (
                              <TaskChip
                                key={task.id}
                                task={task}
                                person={person}
                                onClick={e => {
                                  e.stopPropagation();
                                  setActiveCell(null);
                                  setContextMenu(null);
                                  openPopover(task, e.clientX, e.clientY);
                                }}
                                onContextMenu={isPast ? undefined : e => {
                                  e.stopPropagation();
                                  setPopoverTask(null);
                                  setActiveCell(null);
                                  setContextMenu({ type: "chip", x: e.clientX, y: e.clientY, task, person });
                                }}
                                onDragStart={isPast ? undefined : e => {
                                  e.stopPropagation();
                                  dragTaskRef.current   = task;
                                  dragPersonRef.current = person;
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                                onUnassign={isPast ? undefined : () => handleUnassign(task.id, person)}
                              />
                            ))}
                          </div>

                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Legend */}
        {!loading && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3 text-xs text-[#7a7f54]">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-400" />Recurring</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" />One-off</span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-gray-300" />Not started</span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-blue-400" />In progress</span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-green-500" />Completed</span>
            {isPast
              ? <span className="text-[#bbb] ml-auto">Published record — read only · Click a chip to view details</span>
              : <span className="text-[#bbb] ml-auto">Click cell to assign · Right-click chip for options · Drag unassigned chip to assign</span>
            }
          </div>
        )}
      </main>

      {/* ── Cell search dropdown ────────────────────────────────────────── */}
      {activeCell && activeCellRect && (
        <CellSearchDropdown
          anchor={activeCellRect}
          libraryTasks={libraryTasks}
          existingTaskIds={existingTaskIds}
          onSelect={handleAddTask}
          onCreateNew={handleOpenCreateTask}
          onClose={() => { setActiveCell(null); setActiveCellRect(null); }}
        />
      )}

      {/* ── Task detail popover ──────────────────────────────────────────── */}
      {popoverTask && (
        <TaskDetailPopover
          key={popoverTask.id}
          task={popoverTask}
          shifts={shifts}
          activeVols={activeVols}
          isPast={isPast}
          initialPos={popoverPos}
          onClose={() => setPopoverTask(null)}
          onRemoveTask={handleRemoveTask}
          onUnassign={handleUnassign}
          onAssign={handleAssign}
          onStatusChange={handleStatusChange}
          onEditDefinition={id => { setPopoverTask(null); setEditingTaskId(id); }}
          onDeleteTask={handleDeleteTask}
        />
      )}

      {/* ── Context menu ────────────────────────────────────────────────── */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          hasPaste={!!clipboardTaskId}
          onClose={() => setContextMenu(null)}
          onCopy={contextMenu.type === "chip" ? () => {
            setClipboardTaskId(contextMenu.task.taskId);
            setContextMenu(null);
          } : undefined}
          onPaste={contextMenu.type === "cell" ? () =>
            handlePaste(contextMenu.person, contextMenu.shiftId) : undefined}
          onEdit={contextMenu.type === "chip" ? () => {
            setEditingTaskId(contextMenu.task.taskId);
            setContextMenu(null);
          } : undefined}
          onConvertType={contextMenu.type === "chip" ? () =>
            handleConvertType(contextMenu.task) : undefined}
          onRemoveFromToday={contextMenu.type === "chip" ? () => {
            handleRemoveTask(contextMenu.task.id);
            setContextMenu(null);
          } : undefined}
          onDeleteTask={contextMenu.type === "chip" ? () => {
            handleDeleteTask(contextMenu.task.taskId);
            setContextMenu(null);
          } : undefined}
        />
      )}

      {/* ── Task editor modal ────────────────────────────────────────────── */}
      {editingTaskId && (
        <TaskEditorModal
          taskId={editingTaskId}
          shifts={shifts}
          onClose={() => setEditingTaskId(null)}
          onSaved={() => { setEditingTaskId(null); loadSchedule(date); }}
        />
      )}

      {/* ── Create task modal ───────────────────────────────────────────── */}
      {createTaskContext && (
        <CreateTaskModal
          initialName={createTaskContext.name}
          initialShiftId={createTaskContext.shiftId}
          initialPerson={createTaskContext.person}
          volunteers={scheduleData?.activeVolunteers ?? []}
          shifts={shifts}
          onClose={() => setCreateTaskContext(null)}
          onCreated={handleTaskCreated}
        />
      )}

      {/* ── Copy from another day modal ──────────────────────────────────── */}
      {showCopyModal && (
        <CopyFromDayModal
          currentDate={date}
          onClose={() => setShowCopyModal(false)}
          onCopy={handleCopyFromDay}
        />
      )}
    </div>
  );
}
