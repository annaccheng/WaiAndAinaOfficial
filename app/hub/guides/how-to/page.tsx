"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { loadSession } from "@/lib/session";

type GuideSummary = {
  id: string;
  title: string;
  lastEdited: string;
  restricted?: boolean;
};

export default function HowToGuidesPage() {
  const [guides, setGuides] = useState<GuideSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [sessionUserType, setSessionUserType] = useState<string>("");
  const [creatingGuide, setCreatingGuide] = useState(false);

  useEffect(() => {
    const session = loadSession();
    const userType = (session?.userType || "").toLowerCase();
    setIsAdmin(userType === "admin");
    setSessionUserType(userType);
  }, []);

  useEffect(() => {
    const loadGuides = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/guides");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch guides");
        setGuides(data.guides || []);
      } catch (err) {
        console.error(err);
        setError("Unable to load guides right now. Please try again soon.");
      } finally {
        setLoading(false);
      }
    };

    loadGuides();
  }, []);


  async function createGuide() {
    if (!isAdmin || creatingGuide) return;
    setCreatingGuide(true);
    try {
      const res = await fetch("/api/guides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userType: sessionUserType,
          title: "Untitled Guide",
          content: "# Untitled Guide\n\nStart writing here...",
          restricted: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create guide");
      if (data?.guide?.id) {
        window.location.href = `/hub/guides/how-to/${data.guide.id}`;
      }
    } catch (err) {
      console.error(err);
      setError("Unable to create a new guide right now.");
    } finally {
      setCreatingGuide(false);
    }
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const visibleGuides = guides.filter((g) => isAdmin || !g.restricted);
    if (!term) return visibleGuides;
    return visibleGuides.filter((g) => g.title.toLowerCase().includes(term));
  }, [guides, isAdmin, search]);

  return (
    <div className="space-y-4">
      <header className="rounded-xl bg-[#a0b764] text-white px-4 py-3 shadow">
        <h1 className="text-2xl font-semibold tracking-[0.14em] uppercase">
          How To Guides
        </h1>
        <p className="text-sm text-white/90">
          Search practical walkthroughs for farm tasks and jump straight into
          the guide you need.
        </p>
      </header>

      <div className="rounded-xl border border-[#d0c9a4] bg-[#f8f4e3] p-4 shadow-sm space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {isAdmin && (
            <button
              type="button"
              onClick={createGuide}
              disabled={creatingGuide}
              className="rounded-full border border-[#cdd7ab] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#4b522d] shadow-sm hover:bg-[#f1edd8] disabled:opacity-60"
            >
              {creatingGuide ? "Creating..." : "+ New Guide Page"}
            </button>
          )}
          <p className="text-sm text-[#4b522d] max-w-2xl">
            Browse every published guide below. Use the search box to quickly
            filter by keyword, then tap a guide to open its dedicated page and
            copy the link anywhere in the hub.
          </p>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search guides..."
            className="w-full sm:w-64 rounded-full border border-[#cdd7ab] bg-white px-4 py-2 text-sm text-[#374220] shadow-inner focus:outline-none focus:ring-2 focus:ring-[#8da55a]"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((guide) => (
            <Link
              key={guide.id}
              href={`/hub/guides/how-to/${guide.id}`}
              className="group rounded-lg border border-[#d5d7bc] bg-white/80 p-4 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-lg font-semibold text-[#3b4224] group-hover:text-[#5d7f3b] transition-colors">
                  {guide.title}
                </h3>
                <span className="rounded-full bg-[#eef2e0] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7348]">
                  Guide
                </span>
              </div>
              <p className="mt-2 text-xs uppercase tracking-[0.12em] text-[#7a7f54]">
                Updated {new Date(guide.lastEdited).toLocaleDateString()}
              </p>
            </Link>
          ))}
          {!filtered.length && !loading && (
            <div className="col-span-full rounded-lg border border-dashed border-[#d5d7bc] bg-white/70 p-6 text-center text-sm text-[#737b54]">
              {guides.length === 0
                ? "No guides available yet."
                : "No guides match your search."}
            </div>
          )}
          {loading && (
            <div className="col-span-full rounded-lg border border-dashed border-[#d5d7bc] bg-white/70 p-6 text-center text-sm text-[#737b54]">
              Loading guides...
            </div>
          )}
          {error && (
            <div className="col-span-full rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
