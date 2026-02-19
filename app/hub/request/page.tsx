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

export default function HubRequestPage() {
  const [sessionName, setSessionName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [requestType, setRequestType] = useState(REQUEST_TYPES[0]);
  const [urgent, setUrgent] = useState(false);
  const [shareable, setShareable] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);

  const [active, setActive] = useState<RequestDetail | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);

  const [suggestionDraft, setSuggestionDraft] = useState("");
  const [suggestionBusy, setSuggestionBusy] = useState(false);

  const [reviewDecision, setReviewDecision] = useState<"Approved" | "Denied">("Approved");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);

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

  const sorted = useMemo(
    () => [...requests].sort((a, b) => +new Date(b.updatedTime) - +new Date(a.updatedTime)),
    [requests]
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-[#3b4224]">Work Requests</h1>

      <section className="rounded-xl border border-[#d0c9a4] bg-white/90 p-4 space-y-3">
        <p className="text-sm text-[#4b5133]">Create a public request. Status always starts as In Progress.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Request title"
            className="rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
          />
          <select
            value={requestType}
            onChange={(e) => setRequestType(e.target.value)}
            className="rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
          >
            {REQUEST_TYPES.map((entry) => (
              <option key={entry}>{entry}</option>
            ))}
          </select>
        </div>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder={"Describe request details. Bullets supported:\n- item 1\n- item 2"}
          rows={5}
          className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm whitespace-pre-wrap"
        />
        <div className="flex flex-wrap gap-4 text-sm text-[#4b5133]">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={shareable} onChange={(e) => setShareable(e.target.checked)} /> Shareable (allow suggestions)
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={submitRequest}
            disabled={createBusy}
            className="rounded-md bg-[#8fae4c] px-4 py-2 text-sm font-semibold text-white"
          >
            {createBusy ? "Submitting..." : "Submit request"}
          </button>
          {createMessage && <p className="text-sm text-[#4b5133]">{createMessage}</p>}
        </div>
      </section>

      <section className="rounded-xl border border-[#d0c9a4] bg-white/90 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#6a6c4d]">All Requests</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {sorted.map((entry) => (
            <button
              key={entry.id}
              onClick={() => openRequest(entry.id)}
              className="rounded-lg border border-[#e6dfbe] bg-[#faf8ee] p-3 text-left"
            >
              <div className="flex items-center gap-2">
                <p className="font-semibold text-[#314123]">{entry.title}</p>
                {entry.urgent && <span className="text-xs text-rose-700">🚨 urgent</span>}
              </div>
              <p className="mt-1 text-xs text-[#6b6f4c]">
                {entry.requestType} · {entry.status} · {entry.shareable ? "Shareable" : "Private"}
              </p>
              <p className="mt-2 text-sm text-[#4f5730] line-clamp-3 whitespace-pre-wrap">{entry.details}</p>
              <p className="mt-2 text-[11px] text-[#7a7f54]">By {entry.user}</p>
            </button>
          ))}
          {!sorted.length && (
            <div className="text-sm text-[#7a7f54]">{loading ? "Loading requests..." : "No requests yet."}</div>
          )}
        </div>
      </section>

      {(activeLoading || active) && (
        <section className="rounded-xl border border-[#d0c9a4] bg-white/95 p-4 space-y-3">
          {activeLoading && <p className="text-sm text-[#7a7f54]">Loading request…</p>}
          {active && (
            <>
              <h3 className="text-lg font-semibold text-[#314123]">{active.title}</h3>
              <p className="text-sm text-[#4b5133] whitespace-pre-wrap">{active.details}</p>
              <p className="text-xs text-[#6b6f4c]">
                {active.requestType} · {active.status} {active.urgent ? "· Urgent" : ""} {active.shareable ? "· Shareable" : ""}
              </p>

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
                  <button
                    onClick={submitReview}
                    disabled={reviewBusy || !reviewNote.trim()}
                    className="rounded-md bg-[#8fae4c] px-3 py-2 text-sm font-semibold text-white"
                  >
                    {reviewBusy ? "Saving..." : "Save review"}
                  </button>
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
      )}
    </div>
  );
}
