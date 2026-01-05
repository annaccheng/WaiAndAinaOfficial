"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadSession } from "@/lib/session";

type Shift = { id: string; label: string; timeRange?: string };

export default function AdminShiftEditorPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [newShift, setNewShift] = useState({ label: "", timeRange: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const session = loadSession();
    if (!session?.name) {
      router.replace("/");
      return;
    }
    const isAdmin = (session.userType || "").toLowerCase() === "admin";
    if (!isAdmin) {
      setMessage("Admin access required.");
      return;
    }
    setAuthorized(true);
  }, [router]);

  const loadShifts = useCallback(async () => {
    try {
      const res = await fetch("/api/shifts");
      const json = await res.json();
      setShifts(json.shifts || []);
    } catch (err) {
      console.error("Failed to load shifts", err);
      setMessage("Unable to load shifts.");
    }
  }, []);

  useEffect(() => {
    if (!authorized) return;
    loadShifts();
  }, [authorized, loadShifts]);

  const moveShift = (fromIndex: number, direction: "up" | "down") => {
    setShifts((prev) => {
      const updated = [...prev];
      const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
      if (toIndex < 0 || toIndex >= updated.length) return prev;
      [updated[fromIndex], updated[toIndex]] = [updated[toIndex], updated[fromIndex]];
      return updated;
    });
  };

  const saveShifts = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/shifts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shifts }),
      });
      if (!res.ok) throw new Error("Failed to save shifts.");
      setMessage("Shifts updated.");
    } catch (err: any) {
      setMessage(err?.message || "Unable to save shifts.");
    } finally {
      setSaving(false);
    }
  };

  const addShift = async () => {
    if (!newShift.label.trim()) {
      setMessage("Shift name is required.");
      return;
    }
    try {
      const res = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newShift.label.trim(),
          timeRange: newShift.timeRange.trim(),
        }),
      });
      if (!res.ok) throw new Error("Failed to add shift.");
      const json = await res.json();
      setShifts(json.shifts || []);
      setNewShift({ label: "", timeRange: "" });
    } catch (err: any) {
      setMessage(err?.message || "Unable to add shift.");
    }
  };

  if (!authorized) {
    return (
      <div className="mx-auto max-w-4xl p-6 text-sm text-[#7a7f54]">
        {message || "Checking access..."}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="rounded-3xl border border-[#d0c9a4] bg-white/80 p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">Admin</p>
            <h1 className="text-2xl font-semibold text-[#314123]">Shift Editor</h1>
            <p className="text-sm text-[#5f5a3b]">
              Reorder schedule shifts, rename them, or add new ones.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveShifts}
              disabled={saving}
              className="rounded-md bg-[#8fae4c] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#f9f9ec] shadow-md transition hover:bg-[#7e9c44] disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save order"}
            </button>
            <Link
              href="/hub/admin/schedule"
              className="rounded-md border border-[#d0c9a4] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8]"
            >
              Back to schedule
            </Link>
          </div>
        </div>
        {message && <p className="mt-3 text-sm font-semibold text-[#4b5133]">{message}</p>}
      </div>

      <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-[#314123]">Shift list</h2>
        <div className="mt-3 space-y-3">
          {shifts.map((shift, index) => (
            <div
              key={shift.id}
              className="flex flex-col gap-3 rounded-xl border border-[#e2d7b5] bg-white/90 p-4 shadow-sm md:flex-row md:items-center md:justify-between"
            >
              <div className="grid flex-1 gap-2 md:grid-cols-[2fr_1fr]">
                <input
                  value={shift.label}
                  onChange={(e) =>
                    setShifts((prev) =>
                      prev.map((item) =>
                        item.id === shift.id ? { ...item, label: e.target.value } : item
                      )
                    )
                  }
                  className="w-full rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-sm"
                />
                <input
                  value={shift.timeRange || ""}
                  onChange={(e) =>
                    setShifts((prev) =>
                      prev.map((item) =>
                        item.id === shift.id ? { ...item, timeRange: e.target.value } : item
                      )
                    )
                  }
                  className="w-full rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-sm"
                  placeholder="Time range (optional)"
                />
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => moveShift(index, "up")}
                  className="rounded-md border border-[#d0c9a4] bg-white px-3 py-2 font-semibold uppercase text-[#4f5730] shadow-sm"
                >
                  Up
                </button>
                <button
                  type="button"
                  onClick={() => moveShift(index, "down")}
                  className="rounded-md border border-[#d0c9a4] bg-white px-3 py-2 font-semibold uppercase text-[#4f5730] shadow-sm"
                >
                  Down
                </button>
              </div>
            </div>
          ))}
          {!shifts.length && (
            <p className="text-sm text-[#7a7f54]">No shifts loaded.</p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-[#314123]">Add a shift</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr_auto]">
          <input
            value={newShift.label}
            onChange={(e) => setNewShift((prev) => ({ ...prev, label: e.target.value }))}
            className="w-full rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-sm"
            placeholder="Shift name"
          />
          <input
            value={newShift.timeRange}
            onChange={(e) => setNewShift((prev) => ({ ...prev, timeRange: e.target.value }))}
            className="w-full rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-sm"
            placeholder="Time range (optional)"
          />
          <button
            type="button"
            onClick={addShift}
            className="rounded-md bg-[#8fae4c] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-white shadow-md"
          >
            Add shift
          </button>
        </div>
      </div>
    </div>
  );
}
