"use client";

import { useEffect, useMemo, useState } from "react";
import { loadSession } from "@/lib/session";

type RequestItem = {
  id: string;
  title: string;
  details: string;
  user: string;
  requestType: string;
  status: "In Progress" | "Approved" | "Denied";
  urgent: boolean;
  shareable: boolean;
  reviewNote?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdTime: string;
  updatedTime: string;
};

type Suggestion = {
  id: string;
  author: string;
  content: string;
  removed: boolean;
  removedBy?: string | null;
  removedAt?: string | null;
  createdTime: string;
};

type RequestDetail = RequestItem & {
  suggestions: Suggestion[];
};

const REQUEST_TYPES = ["App Request", "Item Request", "Task Request", "Other"];
const STATUS_OPTIONS: Array<RequestItem["status"]> = ["In Progress", "Approved", "Denied"];

function statusTagClasses(status: RequestItem["status"]) {
  if (status === "Approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "Denied") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function typeTagClasses(type: string) {
  if (type === "App Request") return "border-sky-200 bg-sky-50 text-sky-700";
  if (type === "Item Request") return "border-violet-200 bg-violet-50 text-violet-700";
  if (type === "Task Request") return "border-lime-200 bg-lime-50 text-lime-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default function HubRequestPage() {
  const [sessionName, setSessionName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [createOverlayOpen, setCreateOverlayOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [requestType, setRequestType] = useState(REQUEST_TYPES[0]);
  const [urgent, setUrgent] = useState(false);
  const [shareable, setShareable] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [onlyMine, setOnlyMine] = useState(false);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [shareableOnly, setShareableOnly] = useState(false);
  const [search, setSearch] = useState("");

  const [active, setActive] = useState<RequestDetail | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);

  const [suggestionDraft, setSuggestionDraft] = useState("");
  const [suggestionBusy, setSuggestionBusy] = useState(false);

  const [reviewDecision, setReviewDecision] = useState<"Approved" | "Denied">("Approved");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    const session = loadSession();
    if (!session?.name) return;
    setSessionName(session.name);
    setIsAdmin((session.userType || "").toLowerCase() === "admin");
    void loadRequests();
  }, []);

  async function loadRequests() {
    setLoading(true);
    try {
      const res = await fetch("/api/request", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Unable to load requests");
      setRequests(Array.isArray(json.requests) ? json.requests : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function openRequest(id: string) {
    setActiveLoading(true);
    try {
      const res = await fetch(`/api/request?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Unable to load request");
      setActive(json as RequestDetail);
      setReviewNote("");
    } catch (err) {
      console.error(err);
    } finally {
      setActiveLoading(false);
    }
  }

  async function submitRequest() {
    if (!sessionName || !title.trim() || !details.trim()) {
      setCreateMessage("Please add a title and details.");
      return;
    }
    setCreateBusy(true);
    setCreateMessage(null);
    try {
      const res = await fetch("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          details: details.trim(),
          user: sessionName,
          requestType,
          urgent,
          shareable,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Unable to submit request");
      setTitle("");
      setDetails("");
      setUrgent(false);
      setShareable(false);
      setCreateMessage("Request submitted.");
      setCreateOverlayOpen(false);
      await loadRequests();
    } catch (err) {
      setCreateMessage(err instanceof Error ? err.message : "Unable to submit request");
    } finally {
      setCreateBusy(false);
    }
  }

  async function submitSuggestion() {
    if (!active || !active.shareable || !suggestionDraft.trim() || !sessionName) return;
    setSuggestionBusy(true);
    try {
      const res = await fetch("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "suggestion",
          id: active.id,
          user: sessionName,
          content: suggestionDraft.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Unable to submit suggestion");
      setSuggestionDraft("");
      await openRequest(active.id);
    } catch (err) {
      console.error(err);
    } finally {
      setSuggestionBusy(false);
    }
  }

  async function removeSuggestion(suggestionId: string) {
    if (!active || !sessionName) return;
    try {
      const res = await fetch("/api/request", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove-suggestion",
          id: active.id,
          suggestionId,
          user: sessionName,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Unable to remove suggestion");
      await openRequest(active.id);
    } catch (err) {
      console.error(err);
    }
  }

  async function submitReview() {
    if (!active || !isAdmin || !reviewNote.trim()) return;
    setReviewBusy(true);
    try {
      const res = await fetch("/api/request", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "review",
          id: active.id,
          reviewedBy: sessionName,
          decision: reviewDecision,
          reviewNote: reviewNote.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Unable to review request");
      setActive((prev) => (prev ? { ...prev, ...json.request } : prev));
      await loadRequests();
    } catch (err) {
      console.error(err);
    } finally {
      setReviewBusy(false);
    }
  }

  async function deleteRequest() {
    if (!active || !sessionName || !isAdmin || deleteBusy) return;
    const confirmed = window.confirm(`Delete request "${active.title}"? This cannot be undone.`);
    if (!confirmed) return;

    setDeleteBusy(true);
    try {
      const res = await fetch(
        `/api/request?id=${encodeURIComponent(active.id)}&actor=${encodeURIComponent(sessionName)}`,
        { method: "DELETE" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Unable to delete request");
      setActive(null);
      await loadRequests();
    } catch (err) {
      console.error(err);
    } finally {
      setDeleteBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...requests]
      .sort((a, b) => +new Date(b.updatedTime) - +new Date(a.updatedTime))
      .filter((entry) => {
        if (typeFilter !== "All" && entry.requestType !== typeFilter) return false;
        if (statusFilter !== "All" && entry.status !== statusFilter) return false;
        if (onlyMine && entry.user.trim().toLowerCase() !== sessionName.trim().toLowerCase()) return false;
        if (urgentOnly && !entry.urgent) return false;
        if (shareableOnly && !entry.shareable) return false;
        if (!needle) return true;
        return (
          entry.title.toLowerCase().includes(needle) ||
          entry.details.toLowerCase().includes(needle) ||
          entry.user.toLowerCase().includes(needle)
        );
      });
  }, [requests, typeFilter, statusFilter, onlyMine, urgentOnly, shareableOnly, search, sessionName]);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#d4cea8] bg-gradient-to-br from-white via-[#f9f6e7] to-[#eef3d8] p-5 sm:p-6 shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8fae4c]">Requests</p>
            <h1 className="text-xl sm:text-2xl font-bold text-[#2a3618] mt-0.5">Work Requests</h1>
            <p className="mt-1 text-xs sm:text-sm text-[#5a6140]">All requests are public and visible to the team.</p>
          </div>
          <button
            onClick={() => {
              setCreateMessage(null);
              setCreateOverlayOpen(true);
            }}
            className="rounded-lg bg-[#8fae4c] px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-[#7e9c44] hover:shadow-lg"
          >
            + New Request
          </button>
        </div>
      </div>

      <section className="rounded-xl border border-[#d4cea8] bg-white/90 p-4 space-y-3 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg border border-[#d4cea8] px-3 py-2 text-sm shadow-sm focus:border-[#8fae4c] focus:outline-none focus:ring-1 focus:ring-[#8fae4c]/30">
            <option value="All">All types</option>
            {REQUEST_TYPES.map((entry) => (
              <option key={entry} value={entry}>{entry}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-[#d4cea8] px-3 py-2 text-sm shadow-sm focus:border-[#8fae4c] focus:outline-none focus:ring-1 focus:ring-[#8fae4c]/30">
            <option value="All">All statuses</option>
            {STATUS_OPTIONS.map((entry) => (
              <option key={entry} value={entry}>{entry}</option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title/details/user"
            className="min-w-[220px] flex-1 rounded-lg border border-[#d4cea8] px-3 py-2 text-sm shadow-sm focus:border-[#8fae4c] focus:outline-none focus:ring-1 focus:ring-[#8fae4c]/30"
          />
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-[#4b5133]">
          <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="accent-[#8fae4c]" /> Only mine</label>
          <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={urgentOnly} onChange={(e) => setUrgentOnly(e.target.checked)} className="accent-[#8fae4c]" /> Urgent only</label>
          <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={shareableOnly} onChange={(e) => setShareableOnly(e.target.checked)} className="accent-[#8fae4c]" /> Shareable only</label>
        </div>
      </section>

      <section className="rounded-xl border border-[#d4cea8] bg-white/90 p-4 shadow-sm">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8fae4c]">All Requests</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {filtered.map((entry) => (
            <button
              key={entry.id}
              onClick={() => openRequest(entry.id)}
              className="rounded-xl border border-[#e2dbc0] bg-gradient-to-br from-[#fdfbf4] to-[#f6f4e6] p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:border-[#c8d0a4]"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-[#314123]">{entry.title}</p>
                {entry.urgent && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">Urgent</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <span className={`rounded-full border px-2 py-0.5 font-semibold ${typeTagClasses(entry.requestType)}`}>{entry.requestType}</span>
                <span className={`rounded-full border px-2 py-0.5 font-semibold ${statusTagClasses(entry.status)}`}>{entry.status}</span>
                {entry.shareable && (
                <span className="rounded-full border border-[#d7d0ae] bg-[#f6f2de] px-2 py-0.5 font-semibold text-[#5e643f]">
                  Shareable
                </span>
                )}
              </div>
              <p className="mt-2 text-sm text-[#4f5730] line-clamp-3 whitespace-pre-wrap">{entry.details}</p>
              <p className="mt-2 text-[11px] text-[#7a7f54]">By {entry.user}</p>
            </button>
          ))}
          {!filtered.length && (
            <div className="text-sm text-[#7a7f54]">{loading ? "Loading requests..." : "No requests match your filters."}</div>
          )}
        </div>
      </section>

      {createOverlayOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setCreateOverlayOpen(false)}>
          <section className="w-full max-w-2xl rounded-2xl border border-[#d0c9a4] bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[#314123]">New Public Request</h3>
              <button onClick={() => setCreateOverlayOpen(false)} className="rounded-md border border-[#d0c9a4] px-3 py-1 text-sm text-[#4b5133]">Close</button>
            </div>
            <p className="mt-1 text-sm text-[#5a6140]">Your request is visible to everyone on the team.</p>
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Request title" className="rounded-md border border-[#d0c9a4] px-3 py-2 text-sm" />
                <select value={requestType} onChange={(e) => setRequestType(e.target.value)} className="rounded-md border border-[#d0c9a4] px-3 py-2 text-sm">
                  {REQUEST_TYPES.map((entry) => <option key={entry}>{entry}</option>)}
                </select>
              </div>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder={"Describe request details. Bullets supported:\n- item 1\n- item 2"}
                rows={6}
                className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm whitespace-pre-wrap"
              />
              <div className="flex flex-wrap gap-4 text-sm text-[#4b5133]">
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent</label>
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={shareable} onChange={(e) => setShareable(e.target.checked)} /> Shareable (allow suggestions)</label>
              </div>
              <div className="flex items-center justify-between gap-3">
                {createMessage && <p className="text-sm text-[#4b5133]">{createMessage}</p>}
                <button onClick={submitRequest} disabled={createBusy} className="ml-auto rounded-md bg-[#8fae4c] px-4 py-2 text-sm font-semibold text-white">
                  {createBusy ? "Submitting..." : "Submit request"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {(activeLoading || active) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => !activeLoading && setActive(null)}>
          <section
            className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[#d0c9a4] bg-white/95 p-4 space-y-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[#314123]">Request details</h3>
              <button onClick={() => setActive(null)} className="rounded-md border border-[#d0c9a4] px-3 py-1 text-sm text-[#4b5133]">Close</button>
            </div>

            {activeLoading && <p className="text-sm text-[#7a7f54]">Loading request…</p>}
            {active && (
              <>
                <h4 className="text-lg font-semibold text-[#314123]">{active.title}</h4>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span className={`rounded-full border px-2 py-0.5 font-semibold ${typeTagClasses(active.requestType)}`}>{active.requestType}</span>
                  <span className={`rounded-full border px-2 py-0.5 font-semibold ${statusTagClasses(active.status)}`}>{active.status}</span>
                  {active.urgent && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-semibold text-rose-700">Urgent</span>}
                  {active.shareable && (
                  <span className="rounded-full border border-[#d7d0ae] bg-[#f6f2de] px-2 py-0.5 font-semibold text-[#5e643f]">
                    Shareable
                  </span>
                  )}
                </div>
                <p className="text-sm text-[#4b5133] whitespace-pre-wrap">{active.details}</p>

                {isAdmin && (
                  <div className="rounded-lg border border-[#e6dfbe] bg-[#faf8ee] p-3 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">Admin review</p>
                    <div className="flex gap-3 text-sm">
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="radio"
                          checked={reviewDecision === "Approved"}
                          onChange={() => setReviewDecision("Approved")}
                        />
                        Approve
                      </label>
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="radio"
                          checked={reviewDecision === "Denied"}
                          onChange={() => setReviewDecision("Denied")}
                        />
                        Deny
                      </label>
                    </div>
                    <textarea
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      placeholder="Required note for approval/denial"
                      rows={3}
                      className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={submitReview}
                        disabled={reviewBusy || !reviewNote.trim()}
                        className="rounded-md bg-[#8fae4c] px-3 py-2 text-sm font-semibold text-white"
                      >
                        {reviewBusy ? "Saving..." : "Save review"}
                      </button>
                      <button
                        onClick={deleteRequest}
                        disabled={deleteBusy}
                        className="rounded-md bg-rose-600 px-3 py-2 text-sm font-semibold text-white"
                      >
                        {deleteBusy ? "Deleting..." : "Delete request"}
                      </button>
                    </div>
                    {active.reviewNote && (
                      <p className="text-xs text-[#4f5730]">
                        Last review by {active.reviewedBy || "Admin"}: {active.reviewNote}
                      </p>
                    )}
                  </div>
                )}

                <div className="rounded-lg border border-[#e6dfbe] bg-[#faf8ee] p-3 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">Suggestions</p>
                  {active.suggestions.length === 0 && (
                    <p className="text-sm text-[#7a7f54]">No suggestions yet.</p>
                  )}
                  {active.suggestions.map((item) => (
                    <div key={item.id} className="rounded border border-[#ece4c5] bg-white/80 p-2">
                      <div className="flex items-center justify-between gap-2 text-xs text-[#6b6f4c]">
                        <span>{item.author}</span>
                        <span>{new Date(item.createdTime).toLocaleString()}</span>
                      </div>
                      <p className={`mt-1 text-sm whitespace-pre-wrap ${item.removed ? "line-through text-[#8a8f71]" : "text-[#4f5730]"}`}>
                        {item.content}
                      </p>
                      {item.removed && (
                        <p className="text-[11px] text-[#8a8f71]">Removed by {item.removedBy || "author"}</p>
                      )}
                      {!item.removed && active.user.trim().toLowerCase() === sessionName.trim().toLowerCase() && (
                        <button
                          onClick={() => removeSuggestion(item.id)}
                          className="mt-1 text-[11px] text-rose-700 underline"
                        >
                          Remove suggestion (strikethrough)
                        </button>
                      )}
                    </div>
                  ))}
                  {active.shareable ? (
                    <div className="pt-2 space-y-2">
                      <textarea
                        value={suggestionDraft}
                        onChange={(e) => setSuggestionDraft(e.target.value)}
                        placeholder={"Add suggestion (supports bullets)\n- suggestion 1"}
                        rows={3}
                        className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                      />
                      <button
                        onClick={submitSuggestion}
                        disabled={suggestionBusy || !suggestionDraft.trim()}
                        className="rounded-md bg-[#8fae4c] px-3 py-2 text-sm font-semibold text-white"
                      >
                        {suggestionBusy ? "Posting..." : "Add suggestion"}
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-[#7a7f54]">Suggestions are disabled for this request.</p>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
