"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadSession } from "@/lib/session";
import {
  RecurrenceSelector,
  recurrenceSummary,
  DEFAULT_RECURRENCE,
  type RecurrenceConfig,
} from "@/components/RecurrenceSelector";

type TaskType = { id: string; name: string; color: string };
type Capability = { id: string; name: string };
type Task = {
  id: string;
  name: string;
  description?: string | null;
  priority: string;
  person_count?: number | null;
  recurring: boolean;
  recurrence_interval?: number | null;
  recurrence_unit?: string | null;
  recurrence_days?: number[] | null;
  recurrence_end_type?: string | null;
  recurrence_until?: string | null;
  recurrence_count?: number | null;
  task_type?: TaskType | null;
  task_type_id?: string | null;
  estimated_time?: string | null;
  capabilities?: Capability[];
};

type DraftTask = {
  name: string;
  description: string;
  priority: string;
  person_count: number;
  task_type_id: string;
  estimated_time: string;
  capability_ids: string[];
} & RecurrenceConfig;

const EMPTY_DRAFT: DraftTask = {
  name: "",
  description: "",
  priority: "Medium",
  person_count: 1,
  task_type_id: "",
  estimated_time: "",
  capability_ids: [],
  ...DEFAULT_RECURRENCE,
};

const PRIORITY_OPTIONS = ["Low", "Medium", "High"];

function taskToRecurrenceConfig(task: Task): RecurrenceConfig {
  return {
    recurring:            task.recurring,
    recurrence_interval:  task.recurrence_interval ?? 1,
    recurrence_unit:      task.recurrence_unit ?? "week",
    recurrence_days:      task.recurrence_days ?? [],
    recurrence_end_type:  task.recurrence_end_type ?? "never",
    recurrence_until:     task.recurrence_until ?? "",
    recurrence_count:     task.recurrence_count ?? null,
  };
}

function TypeDot({ recurring }: { recurring: boolean }) {
  return (
    <span
      className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${recurring ? "bg-sky-400" : "bg-amber-400"}`}
      title={recurring ? "Recurring" : "One-off"}
    />
  );
}

export default function TaskLibraryPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [types, setTypes] = useState<TaskType[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [recurringFilter, setRecurringFilter] = useState<"" | "recurring" | "one_off">("");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftTask>(EMPTY_DRAFT);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    const session = loadSession();
    if (!session?.name) { router.replace("/"); return; }
    if ((session.userType || "").toLowerCase() !== "admin") {
      setMessage("Admin access required.");
      return;
    }
    setAuthorized(true);
  }, [router]);

  useEffect(() => {
    if (!authorized) return;
    fetch("/api/task-types")
      .then(r => r.json())
      .then(j => setTypes(j.types ?? []))
      .catch(console.error);
    fetch("/api/capabilities")
      .then(r => r.json())
      .then(j => setCapabilities(j.capabilities ?? []))
      .catch(console.error);
  }, [authorized]);

  async function loadTasks() {
    setLoading(true);
    const params = new URLSearchParams({ includeOccurrences: "false" });
    if (search) params.set("search", search);
    if (typeFilter) params.set("type", typeFilter);
    if (recurringFilter) params.set("recurring", recurringFilter === "recurring" ? "true" : "false");
    try {
      const res = await fetch(`/api/tasks?${params}`);
      const json = await res.json();
      setTasks(json.tasks ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authorized) return;
    const t = setTimeout(loadTasks, 200);
    return () => clearTimeout(t);
  }, [authorized, search, typeFilter, recurringFilter]);

  function openNew() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setDeleteConfirm(false);
    setMessage(null);
    setEditorOpen(true);
  }

  function openEdit(task: Task) {
    setEditingId(task.id);
    setDraft({
      name:          task.name,
      description:   task.description ?? "",
      priority:      task.priority,
      person_count:  task.person_count ?? 1,
      task_type_id:  task.task_type?.id ?? task.task_type_id ?? "",
      estimated_time: task.estimated_time ?? "",
      capability_ids: (task.capabilities ?? []).map(c => c.id),
      ...taskToRecurrenceConfig(task),
    });
    setDeleteConfirm(false);
    setMessage(null);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditingId(null);
    setDeleteConfirm(false);
  }

  function setRecurrence(cfg: RecurrenceConfig) {
    setDraft(prev => ({ ...prev, ...cfg }));
  }

  async function handleSave() {
    if (!draft.name.trim()) { setMessage("Task name is required."); return; }
    setSaving(true);
    setMessage(null);
    const payload = {
      name:                draft.name.trim(),
      description:         draft.description || null,
      priority:            draft.priority,
      person_count:        draft.person_count,
      task_type_id:        draft.task_type_id || null,
      estimated_time:      draft.estimated_time || null,
      capabilityIds:       draft.capability_ids,
      recurring:           draft.recurring,
      recurrence_interval: draft.recurring ? draft.recurrence_interval : null,
      recurrence_unit:     draft.recurring ? draft.recurrence_unit : null,
      recurrence_days:     draft.recurring ? draft.recurrence_days : null,
      recurrence_end_type: draft.recurring ? draft.recurrence_end_type : null,
      recurrence_until:    draft.recurring && draft.recurrence_end_type === "on_date" ? draft.recurrence_until : null,
      recurrence_count:    draft.recurring && draft.recurrence_end_type === "after_count" ? draft.recurrence_count : null,
    };
    try {
      const res = await fetch("/api/tasks", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...payload } : payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Save failed");
      }
      closeEditor();
      await loadTasks();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Unable to save task.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editingId) return;
    setSaving(true);
    try {
      await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId }),
      });
      closeEditor();
      await loadTasks();
    } catch (err) {
      console.error(err);
      setMessage("Unable to delete task.");
    } finally {
      setSaving(false);
    }
  }

  const recurrenceConfig: RecurrenceConfig = {
    recurring:            draft.recurring,
    recurrence_interval:  draft.recurrence_interval,
    recurrence_unit:      draft.recurrence_unit,
    recurrence_days:      draft.recurrence_days,
    recurrence_end_type:  draft.recurrence_end_type,
    recurrence_until:     draft.recurrence_until,
    recurrence_count:     draft.recurrence_count,
  };

  const filteredTasks = useMemo(() => tasks, [tasks]);

  if (!authorized) {
    return <div className="p-6 text-sm text-[#7a7f54]">{message ?? "Checking access…"}</div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-3 py-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-[#7a7f54]">Admin</p>
          <h1 className="text-2xl font-semibold text-[#314123]">Task Library</h1>
          <p className="text-xs text-[#5f5a3b]">All reusable task definitions. Recurring tasks auto-populate the schedule.</p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="rounded-md bg-[#8fae4c] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-sm hover:bg-[#7e9c44]"
        >
          + New task
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tasks…"
          className="min-w-48 flex-1 rounded-md border border-[#d0c9a4] px-3 py-1.5 text-sm"
        />
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="rounded-md border border-[#d0c9a4] px-3 py-1.5 text-sm"
        >
          <option value="">All categories</option>
          {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div className="flex rounded-md border border-[#d0c9a4] overflow-hidden text-xs font-semibold">
          {(["", "recurring", "one_off"] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setRecurringFilter(v)}
              className={`px-3 py-1.5 transition ${
                recurringFilter === v
                  ? "bg-[#8fae4c] text-white"
                  : "bg-white text-[#4b5133] hover:bg-[#f3f0e4]"
              }`}
            >
              {v === "" ? (
                "All"
              ) : v === "recurring" ? (
                <span className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${recurringFilter === "recurring" ? "bg-white/80" : "bg-sky-400"}`} />
                  Recurring
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${recurringFilter === "one_off" ? "bg-white/80" : "bg-amber-400"}`} />
                  One-off
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Task list */}
      <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-4 text-sm text-[#7a7f54]">Loading…</p>
        ) : filteredTasks.length === 0 ? (
          <p className="p-4 text-sm text-[#7a7f54]">No tasks found.</p>
        ) : (
          <ul className="divide-y divide-[#ece8d5]">
            {filteredTasks.map(task => (
              <li
                key={task.id}
                onClick={() => openEdit(task)}
                className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-[#fafaf3] transition"
              >
                <TypeDot recurring={task.recurring} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#314123]">{task.name}</p>
                  <p className="text-xs text-[#7a7f54]">{recurrenceSummary(taskToRecurrenceConfig(task))}</p>
                </div>
                {task.task_type && (
                  <span className="shrink-0 rounded-full bg-[#f0edd8] px-2 py-0.5 text-[10px] font-semibold text-[#4b5133]">
                    {task.task_type.name}
                  </span>
                )}
                <span className="shrink-0 text-xs text-[#7a7f54]">
                  {task.person_count ?? 1} {(task.person_count ?? 1) === 1 ? "person" : "people"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Editor modal */}
      {editorOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-3 py-6">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-[#d0c9a4] bg-[#fdfaf1] p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3 mb-5">
              <h2 className="text-lg font-semibold text-[#314123]">
                {editingId ? "Edit task" : "New task"}
              </h2>
              <button type="button" onClick={closeEditor} className="text-sm text-[#7a7f54] hover:text-[#314123]">
                ✕
              </button>
            </div>

            {message && (
              <p className="mb-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {message}
              </p>
            )}

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-[#6b6f4c]">Task name</label>
                <input
                  value={draft.name}
                  onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                  placeholder="e.g. Morning animal feed"
                />
              </div>

              {/* Recurrence */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-[#6b6f4c]">Recurrence</label>
                <RecurrenceSelector key={editingId ?? "new"} value={recurrenceConfig} onChange={setRecurrence} />
              </div>

              {/* Category + Slots */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-[#6b6f4c]">Category</label>
                  <select
                    value={draft.task_type_id}
                    onChange={e => setDraft(p => ({ ...p, task_type_id: e.target.value }))}
                    className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                  >
                    <option value="">Unassigned</option>
                    {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-[#6b6f4c]">People needed</label>
                  <input
                    type="number"
                    min={1}
                    value={draft.person_count}
                    onChange={e => setDraft(p => ({ ...p, person_count: Math.max(1, Number(e.target.value)) }))}
                    className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Priority + Estimated time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-[#6b6f4c]">Priority</label>
                  <select
                    value={draft.priority}
                    onChange={e => setDraft(p => ({ ...p, priority: e.target.value }))}
                    className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                  >
                    {PRIORITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-[#6b6f4c]">Estimated time</label>
                  <input
                    value={draft.estimated_time}
                    onChange={e => setDraft(p => ({ ...p, estimated_time: e.target.value }))}
                    placeholder="e.g. 1 hour"
                    className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Instructions */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-[#6b6f4c]">Instructions / notes</label>
                <textarea
                  value={draft.description}
                  onChange={e => setDraft(p => ({ ...p, description: e.target.value }))}
                  rows={3}
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm resize-none focus:border-[#8fae4c] focus:outline-none"
                  placeholder="Steps, safety notes, what to watch for…"
                />
              </div>

              {/* Capabilities */}
              {capabilities.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-[#6b6f4c]">Required capabilities</label>
                  <div className="flex flex-wrap gap-2">
                    {capabilities.map(cap => {
                      const selected = draft.capability_ids.includes(cap.id);
                      return (
                        <button
                          key={cap.id}
                          type="button"
                          onClick={() =>
                            setDraft(p => ({
                              ...p,
                              capability_ids: selected
                                ? p.capability_ids.filter(id => id !== cap.id)
                                : [...p.capability_ids, cap.id],
                            }))
                          }
                          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                            selected
                              ? "border-[#8fae4c] bg-[#eef4d4] text-[#4b5133]"
                              : "border-[#d0c9a4] bg-white text-[#6b6d4b]"
                          }`}
                        >
                          {cap.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="mt-6 flex items-center justify-between gap-2">
              {editingId && (
                <div>
                  {deleteConfirm ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-600">Delete this task?</span>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={saving}
                        className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        {saving ? "Deleting…" : "Confirm"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(false)}
                        className="text-xs text-[#7a7f54]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(true)}
                      className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                    >
                      Delete task
                    </button>
                  )}
                </div>
              )}
              <div className="flex gap-2 ml-auto">
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-md border border-[#d0c9a4] px-3 py-1.5 text-xs font-semibold text-[#4f5730]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-md bg-[#8fae4c] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60 hover:bg-[#7e9c44]"
                >
                  {saving ? "Saving…" : editingId ? "Save changes" : "Create task"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
