"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadSession } from "@/lib/session";

type TaskType = { id: string; name: string; color: string };
type TaskItem = {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  priority: string;
  estimated_time?: string | null;
  recurring: boolean;
  recurrence_interval?: number | null;
  recurrence_unit?: string | null;
  recurrence_until?: string | null;
  origin_date?: string | null;
  occurrence_date?: string | null;
  person_count?: number | null;
  links?: string[] | null;
  comments?: string[] | null;
  photos?: string[] | null;
  time_slots?: string[] | null;
  extra_notes?: string[] | null;
  task_type?: TaskType | null;
  task_type_id?: string | null;
};

const STATUS_OPTIONS = ["Not Started", "In Progress", "Completed"];
const PRIORITY_OPTIONS = ["Low", "Medium", "High"];
const RECURRENCE_UNITS = ["day", "month", "year"];
const COLOR_OPTIONS = [
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
  "emerald",
];

export default function TaskEditorPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [types, setTypes] = useState<TaskType[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [filters, setFilters] = useState({
    search: "",
    status: "",
    type: "",
    priority: "",
    recurring: "",
    start: "",
    end: "",
    includeOccurrences: "true",
  });

  const [editorOpen, setEditorOpen] = useState(false);
  const [applyTo, setApplyTo] = useState<"single" | "future" | "all">("single");
  const [futureFromDate, setFutureFromDate] = useState("");
  const [deletePrompt, setDeletePrompt] = useState<{
    task: TaskItem | null;
    mode: "single" | "future" | "all";
    occurrenceDate?: string | null;
  }>({ task: null, mode: "single", occurrenceDate: null });
  const [deleteOccurrences, setDeleteOccurrences] = useState(false);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const [draft, setDraft] = useState<TaskItem>({
    id: "",
    name: "",
    description: "",
    status: "Not Started",
    priority: "Medium",
    estimated_time: "",
    recurring: false,
    recurrence_interval: null,
    recurrence_unit: "day",
    recurrence_until: "",
    origin_date: "",
    occurrence_date: "",
    person_count: null,
    links: [],
    comments: [],
    photos: [],
    time_slots: [],
    extra_notes: [],
    task_type_id: "",
  });

  const [typeEditor, setTypeEditor] = useState({ name: "", color: "default" });
  const [taskTypeOpen, setTaskTypeOpen] = useState(false);

  useEffect(() => {
    const session = loadSession();
    if (!session?.name) {
      router.replace("/");
      return;
    }
    const isAdmin = (session.userType || "").toLowerCase() === "admin";
    if (!isAdmin) {
      setMessage("Admin access required to edit tasks.");
      return;
    }
    setAuthorized(true);
  }, [router]);

  async function loadTaskTypes() {
    try {
      const res = await fetch("/api/task-types");
      const json = await res.json();
      setTypes(json.types || []);
    } catch (err) {
      console.error("Failed to load task types", err);
    }
  }

  async function loadTasks() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const res = await fetch(`/api/tasks?${params.toString()}`);
      const json = await res.json();
      setTasks(json.tasks || []);
    } catch (err) {
      console.error("Failed to load tasks", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authorized) return;
    loadTaskTypes();
    loadTasks();
  }, [authorized]);

  useEffect(() => {
    if (!authorized) return;
    const timeout = setTimeout(() => loadTasks(), 200);
    return () => clearTimeout(timeout);
  }, [filters, authorized]);

  function openEditor(task?: TaskItem) {
    if (task) {
      setEditing(task);
      setDraft({
        ...task,
        task_type_id: task.task_type?.id || task.task_type_id || "",
        recurrence_interval: task.recurrence_interval ?? null,
        recurrence_unit: task.recurrence_unit ?? "day",
      });
    } else {
      setEditing(null);
      setDraft({
        id: "",
        name: "",
        description: "",
        status: "Not Started",
        priority: "Medium",
        estimated_time: "",
        recurring: false,
        recurrence_interval: null,
        recurrence_unit: "day",
        recurrence_until: "",
        origin_date: "",
        occurrence_date: "",
        person_count: null,
        links: [],
        comments: [],
        photos: [],
        time_slots: [],
        extra_notes: [],
        task_type_id: "",
      });
    }
    setApplyTo("single");
    setFutureFromDate("");
    setDeleteOccurrences(false);
    setEditorOpen(true);
  }

  async function handleSave() {
    if (!draft.name.trim()) {
      setMessage("Task name is required.");
      return;
    }
    setSaving(true);
    setMessage(null);

    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      description: draft.description || null,
      status: draft.status,
      priority: draft.priority,
      task_type_id: draft.task_type_id || null,
      estimated_time: draft.estimated_time || null,
      recurring: draft.recurring,
      recurrence_interval: draft.recurring ? Number(draft.recurrence_interval || 1) : null,
      recurrence_unit: draft.recurring ? draft.recurrence_unit || "day" : null,
      recurrence_until: draft.recurring ? draft.recurrence_until || null : null,
      origin_date: draft.origin_date || null,
      occurrence_date: draft.occurrence_date || null,
      person_count: draft.person_count ?? null,
      links: draft.links || [],
      comments: draft.comments || [],
      photos: draft.photos || [],
      time_slots: draft.time_slots || [],
      extra_notes: draft.extra_notes || [],
    };

    try {
      if (editing?.id) {
        await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editing.id,
            applyTo,
            occurrenceDate: futureFromDate || editing.occurrence_date,
            deleteOccurrences,
            ...payload,
          }),
        });
        setMessage("Task updated.");
      } else {
        await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setMessage("Task created.");
      }
      setEditorOpen(false);
      await loadTasks();
    } catch (err) {
      console.error("Failed to save task", err);
      setMessage("Unable to save task.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateType() {
    if (!typeEditor.name.trim()) return;
    try {
      await fetch("/api/task-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(typeEditor),
      });
      setTypeEditor({ name: "", color: "default" });
      await loadTaskTypes();
    } catch (err) {
      console.error("Failed to create type", err);
    }
  }

  async function handleUpdateType(type: TaskType) {
    try {
      await fetch("/api/task-types", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(type),
      });
      await loadTaskTypes();
    } catch (err) {
      console.error("Failed to update type", err);
    }
  }

  async function handleDeleteTask() {
    if (!deletePrompt.task) return;
    setSaving(true);
    try {
      await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: deletePrompt.task.id,
          applyTo: deletePrompt.mode,
          occurrenceDate: deletePrompt.occurrenceDate,
        }),
      });
      setMessage("Task deleted.");
      setDeletePrompt({ task: null, mode: "single", occurrenceDate: null });
      await loadTasks();
    } catch (err) {
      console.error("Failed to delete task", err);
      setMessage("Unable to delete task.");
    } finally {
      setSaving(false);
    }
  }

  const filteredTasks = useMemo(() => tasks, [tasks]);

  if (!authorized) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-[#7a7f54]">
        {message || "Checking access..."}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <div className="rounded-2xl border border-[#d0c9a4] bg-white/70 p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">Admin</p>
            <h1 className="text-2xl font-semibold text-[#314123]">Task Editor</h1>
            <p className="text-sm text-[#5f5a3b]">
              Manage tasks, recurrence rules, and task types for the schedule system.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openEditor()}
            className="rounded-md bg-[#8fae4c] px-4 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-[#f9f9ec] shadow-md transition hover:bg-[#7e9c44]"
          >
            New task
          </button>
        </div>

        {message && <p className="mt-3 text-sm font-semibold text-[#4b5133]">{message}</p>}
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl border border-[#d0c9a4] bg-white/70 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[#314123]">Filters</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
              placeholder="Search tasks"
            />
            <select
              value={filters.status}
              onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
              className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select
              value={filters.type}
              onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
              className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
            >
              <option value="">All types</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
            <select
              value={filters.priority}
              onChange={(e) => setFilters((prev) => ({ ...prev, priority: e.target.value }))}
              className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
            >
              <option value="">All priorities</option>
              {PRIORITY_OPTIONS.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
            <select
              value={filters.recurring}
              onChange={(e) => setFilters((prev) => ({ ...prev, recurring: e.target.value }))}
              className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
            >
              <option value="">Any recurrence</option>
              <option value="true">Recurring only</option>
              <option value="false">One-off only</option>
            </select>
            <select
              value={filters.includeOccurrences}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, includeOccurrences: e.target.value }))
              }
              className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
            >
              <option value="true">Show occurrences</option>
              <option value="false">Hide occurrences</option>
            </select>
            <div className="flex gap-2">
              <input
                type="date"
                value={filters.start}
                onChange={(e) => setFilters((prev) => ({ ...prev, start: e.target.value }))}
                className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={filters.end}
                onChange={(e) => setFilters((prev) => ({ ...prev, end: e.target.value }))}
                className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="mt-4">
            {loading ? (
              <p className="text-sm text-[#7a7f54]">Loading tasks…</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[960px] space-y-2">
                  <div className="grid grid-cols-[2.2fr_2.5fr_1.4fr_1.2fr_1.2fr_0.8fr_0.8fr] gap-2 rounded-md bg-[#eef2d9] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#556036]">
                    <div>Name</div>
                    <div>Description</div>
                    <div>Instance date</div>
                    <div>Status</div>
                    <div>Priority</div>
                    <div>Type</div>
                    <div>Actions</div>
                  </div>
                  {filteredTasks.map((task) => (
                    <div
                      key={task.id}
                      className="grid grid-cols-[2.2fr_2.5fr_1.4fr_1.2fr_1.2fr_0.8fr_0.8fr] gap-2 rounded-md border border-[#e2d7b5] bg-white/90 px-3 py-2 text-sm"
                    >
                      <input
                        value={task.name}
                        onChange={(e) =>
                          setTasks((prev) =>
                            prev.map((t) => (t.id === task.id ? { ...t, name: e.target.value } : t))
                          )
                        }
                        className="rounded-md border border-[#d0c9a4] px-2 py-1 text-sm"
                      />
                      <input
                        value={task.description || ""}
                        onChange={(e) =>
                          setTasks((prev) =>
                            prev.map((t) =>
                              t.id === task.id ? { ...t, description: e.target.value } : t
                            )
                          )
                        }
                        className="rounded-md border border-[#d0c9a4] px-2 py-1 text-sm"
                      />
                      <input
                        type="date"
                        value={task.occurrence_date || ""}
                        onChange={(e) =>
                          setTasks((prev) =>
                            prev.map((t) =>
                              t.id === task.id ? { ...t, occurrence_date: e.target.value } : t
                            )
                          )
                        }
                        className="rounded-md border border-[#d0c9a4] px-2 py-1 text-sm"
                      />
                      <select
                        value={task.status}
                        onChange={(e) =>
                          setTasks((prev) =>
                            prev.map((t) =>
                              t.id === task.id ? { ...t, status: e.target.value } : t
                            )
                          )
                        }
                        className="rounded-md border border-[#d0c9a4] px-2 py-1 text-sm"
                      >
                        {STATUS_OPTIONS.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                      <select
                        value={task.priority}
                        onChange={(e) =>
                          setTasks((prev) =>
                            prev.map((t) =>
                              t.id === task.id ? { ...t, priority: e.target.value } : t
                            )
                          )
                        }
                        className="rounded-md border border-[#d0c9a4] px-2 py-1 text-sm"
                      >
                        {PRIORITY_OPTIONS.map((priority) => (
                          <option key={priority} value={priority}>
                            {priority}
                          </option>
                        ))}
                      </select>
                      <div className="text-xs text-[#6b6d4b]">
                        {task.task_type?.name || "—"}
                      </div>
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            setSaving(true);
                            try {
                              await fetch("/api/tasks", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  id: task.id,
                                  name: task.name,
                                  description: task.description || null,
                                  occurrence_date: task.occurrence_date || null,
                                  status: task.status,
                                  priority: task.priority,
                                }),
                              });
                              setMessage("Task updated.");
                            } catch (err) {
                              console.error("Failed to update task", err);
                              setMessage("Unable to update task.");
                            } finally {
                              setSaving(false);
                            }
                          }}
                          className="rounded-md bg-[#a0b764] px-2 py-1 text-[11px] font-semibold uppercase text-white"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDeletePrompt({
                              task,
                              mode: "single",
                              occurrenceDate: task.occurrence_date || null,
                            })
                          }
                          className="rounded-md border border-red-200 px-2 py-1 text-[11px] font-semibold uppercase text-red-700"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditor(task)}
                          className="rounded-md border border-[#d0c9a4] px-2 py-1 text-[11px] font-semibold uppercase text-[#4f5730]"
                        >
                          Details
                        </button>
                      </div>
                    </div>
                  ))}
                  {!filteredTasks.length && (
                    <p className="text-sm text-[#7a7f54]">No tasks found.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[#d0c9a4] bg-white/70 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#314123]">Task type editor</h2>
          <button
            type="button"
            onClick={() => setTaskTypeOpen((prev) => !prev)}
            className="rounded-md border border-[#d0c9a4] bg-white px-3 py-1 text-xs font-semibold uppercase text-[#4f5730]"
          >
            {taskTypeOpen ? "Collapse" : "Expand"}
          </button>
        </div>

        {taskTypeOpen && (
          <>
            <div className="mt-3 space-y-3">
              {types.map((type) => (
                <div key={type.id} className="flex items-center gap-2">
                  <input
                    value={type.name}
                    onChange={(e) =>
                      setTypes((prev) =>
                        prev.map((t) => (t.id === type.id ? { ...t, name: e.target.value } : t))
                      )
                    }
                    className="flex-1 rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                  />
                  <select
                    value={type.color}
                    onChange={(e) =>
                      setTypes((prev) =>
                        prev.map((t) => (t.id === type.id ? { ...t, color: e.target.value } : t))
                      )
                    }
                    className="rounded-md border border-[#d0c9a4] px-2 py-2 text-sm"
                  >
                    {COLOR_OPTIONS.map((color) => (
                      <option key={color} value={color}>
                        {color}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handleUpdateType(type)}
                    className="rounded-md bg-[#a0b764] px-3 py-2 text-xs font-semibold uppercase text-white"
                  >
                    Save
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-lg border border-[#e2d7b5] bg-[#f9f6e7] p-4">
              <h3 className="text-sm font-semibold text-[#314123]">Add new type</h3>
              <div className="mt-2 flex gap-2">
                <input
                  value={typeEditor.name}
                  onChange={(e) => setTypeEditor((prev) => ({ ...prev, name: e.target.value }))}
                  className="flex-1 rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                  placeholder="Type name"
                />
                <select
                  value={typeEditor.color}
                  onChange={(e) => setTypeEditor((prev) => ({ ...prev, color: e.target.value }))}
                  className="rounded-md border border-[#d0c9a4] px-2 py-2 text-sm"
                >
                  {COLOR_OPTIONS.map((color) => (
                    <option key={color} value={color}>
                      {color}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleCreateType}
                  className="rounded-md bg-[#8fae4c] px-3 py-2 text-xs font-semibold uppercase text-white"
                >
                  Add
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {editorOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#d0c9a4] bg-[#fdfaf1] p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[#314123]">
                {editing ? "Edit task" : "New task"}
              </h2>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="text-sm font-semibold text-[#4b5133]"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-[#6b6f4c]">Task name</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-[#6b6f4c]">Task type</label>
                <select
                  value={draft.task_type_id || ""}
                  onChange={(e) => setDraft((prev) => ({ ...prev, task_type_id: e.target.value }))}
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-[#6b6f4c]">Status</label>
                <select
                  value={draft.status}
                  onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value }))}
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-[#6b6f4c]">Priority</label>
                <select
                  value={draft.priority}
                  onChange={(e) => setDraft((prev) => ({ ...prev, priority: e.target.value }))}
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                >
                  {PRIORITY_OPTIONS.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-[#6b6f4c]">Estimated time</label>
                <input
                  value={draft.estimated_time || ""}
                  onChange={(e) => setDraft((prev) => ({ ...prev, estimated_time: e.target.value }))}
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-[#6b6f4c]">People needed</label>
                <input
                  type="number"
                  value={draft.person_count ?? ""}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      person_count: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <label className="text-xs font-semibold uppercase text-[#6b6f4c]">Description</label>
              <textarea
                value={draft.description || ""}
                onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                rows={3}
              />
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-[#6b6f4c]">Origin date</label>
                <input
                  type="date"
                  value={draft.origin_date || ""}
                  onChange={(e) => setDraft((prev) => ({ ...prev, origin_date: e.target.value }))}
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-[#6b6f4c]">
                  Instance date (this task)
                </label>
                <input
                  type="date"
                  value={draft.occurrence_date || ""}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, occurrence_date: e.target.value }))
                  }
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-[#e2d7b5] bg-[#f9f6e7] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase text-[#6b6f4c]">Recurrence</p>
                  <p className="text-[11px] text-[#6f754f]">
                    Define how this task repeats over time.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold text-[#4b5133]">
                  <input
                    type="checkbox"
                    checked={draft.recurring}
                    onChange={(e) => setDraft((prev) => ({ ...prev, recurring: e.target.checked }))}
                  />
                  Recurring
                </label>
              </div>
              {draft.recurring && (
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <label className="text-[11px] uppercase text-[#6b6f4c]">Every</label>
                    <input
                      type="number"
                      min={1}
                      value={draft.recurrence_interval ?? 1}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          recurrence_interval: Number(e.target.value),
                        }))
                      }
                      className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] uppercase text-[#6b6f4c]">Unit</label>
                    <select
                      value={draft.recurrence_unit || "day"}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, recurrence_unit: e.target.value }))
                      }
                      className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                    >
                      {RECURRENCE_UNITS.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] uppercase text-[#6b6f4c]">Until</label>
                    <input
                      type="date"
                      value={draft.recurrence_until || ""}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, recurrence_until: e.target.value }))
                      }
                      className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              )}
            </div>

            {editing?.recurring && (
              <div className="mt-4 rounded-lg border border-[#d0c9a4] bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase text-[#6b6f4c]">
                  Apply edits to
                </p>
                <div className="mt-2">
                  <label className="text-[11px] uppercase text-[#6b6f4c]">
                    Future edits start from
                  </label>
                  <input
                    type="date"
                    value={futureFromDate}
                    onChange={(e) => setFutureFromDate(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {["single", "future", "all"].map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setApplyTo(option as "single" | "future" | "all")}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                        applyTo === option
                          ? "border-[#8fae4c] bg-[#a0b764] text-white"
                          : "border-[#d0c9a4] bg-white text-[#4f5730]"
                      }`}
                    >
                      {option === "single"
                        ? "Just this task"
                        : option === "future"
                          ? "This + future"
                          : "All in series"}
                    </button>
                  ))}
                </div>
                {!draft.recurring && (
                  <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-[#4b5133]">
                    <input
                      type="checkbox"
                      checked={deleteOccurrences}
                      onChange={(e) => setDeleteOccurrences(e.target.checked)}
                    />
                    Remove occurrences when disabling recurrence
                  </label>
                )}
              </div>
            )}

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-[#6b6f4c]">Time slots</label>
                <input
                  value={(draft.time_slots || []).join(", ")}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      time_slots: e.target.value
                        .split(",")
                        .map((slot) => slot.trim())
                        .filter(Boolean),
                    }))
                  }
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                  placeholder="Morning, Afternoon"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-[#6b6f4c]">Links</label>
                <input
                  value={(draft.links || []).join(", ")}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      links: e.target.value
                        .split(",")
                        .map((link) => link.trim())
                        .filter(Boolean),
                    }))
                  }
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                  placeholder="https://example.com"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-[#6b6f4c]">Comments</label>
                <input
                  value={(draft.comments || []).join(", ")}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      comments: e.target.value
                        .split(",")
                        .map((comment) => comment.trim())
                        .filter(Boolean),
                    }))
                  }
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                  placeholder="Internal notes, follow ups"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-[#6b6f4c]">Extra notes</label>
                <input
                  value={(draft.extra_notes || []).join(", ")}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      extra_notes: e.target.value
                        .split(",")
                        .map((note) => note.trim())
                        .filter(Boolean),
                    }))
                  }
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                  placeholder="Bring gloves, water"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-[#6b6f4c]">Photos</label>
                <input
                  value={(draft.photos || []).join(", ")}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      photos: e.target.value
                        .split(",")
                        .map((photo) => photo.trim())
                        .filter(Boolean),
                    }))
                  }
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                  placeholder="Image URLs"
                />
              </div>
            </div>

              <div className="mt-5 flex items-center justify-end gap-2">
                {editing && (
                  <button
                    type="button"
                    onClick={() =>
                      setDeletePrompt({
                        task: editing,
                        mode: "single",
                        occurrenceDate: editing.occurrence_date || null,
                      })
                    }
                    className="rounded-md border border-red-200 px-4 py-2 text-xs font-semibold uppercase text-red-700"
                  >
                    Delete task
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  className="rounded-md border border-[#d0c9a4] bg-white px-4 py-2 text-xs font-semibold uppercase text-[#4f5730]"
                >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-md bg-[#8fae4c] px-4 py-2 text-xs font-semibold uppercase text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save task"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deletePrompt.task && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-md rounded-2xl border border-[#d0c9a4] bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-[#314123]">Delete task</h3>
            <p className="mt-1 text-sm text-[#5f5a3b]">
              Choose which tasks to delete for{" "}
              <span className="font-semibold">{deletePrompt.task.name}</span>.
            </p>
            <div className="mt-4 space-y-2 text-sm">
              {deletePrompt.task.recurring ? (
                <>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={deletePrompt.mode === "single"}
                      onChange={() =>
                        setDeletePrompt((prev) => ({ ...prev, mode: "single" }))
                      }
                    />
                    Just this task
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={deletePrompt.mode === "future"}
                      onChange={() =>
                        setDeletePrompt((prev) => ({ ...prev, mode: "future" }))
                      }
                    />
                    This task and future occurrences
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={deletePrompt.mode === "all"}
                      onChange={() => setDeletePrompt((prev) => ({ ...prev, mode: "all" }))}
                    />
                    All tasks in the series
                  </label>
                </>
              ) : (
                <p className="text-sm text-[#6b6d4b]">This task is not recurring.</p>
              )}
            </div>
            {deletePrompt.mode === "future" && (
              <div className="mt-4">
                <label className="text-[11px] uppercase text-[#6b6f4c]">
                  Delete starting from
                </label>
                <input
                  type="date"
                  value={deletePrompt.occurrenceDate || ""}
                  onChange={(e) =>
                    setDeletePrompt((prev) => ({ ...prev, occurrenceDate: e.target.value }))
                  }
                  className="mt-1 w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                />
              </div>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletePrompt({ task: null, mode: "single", occurrenceDate: null })}
                className="rounded-md border border-[#d0c9a4] px-4 py-2 text-xs font-semibold uppercase text-[#4f5730]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteTask}
                disabled={saving}
                className="rounded-md bg-red-500 px-4 py-2 text-xs font-semibold uppercase text-white disabled:opacity-60"
              >
                {saving ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
