"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadSession } from "@/lib/session";

export default function AdminPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Array<{ id: string; name: string }>>([]);
  const [capabilityName, setCapabilityName] = useState("");
  const [capabilityMessage, setCapabilityMessage] = useState<string | null>(null);

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
      setMessage("You need admin access to view admin tools.");
    }
  }, [router]);

  useEffect(() => {
    if (!authorized) return;
    const loadCapabilities = async () => {
      try {
        const res = await fetch("/api/capabilities");
        const json = await res.json();
        setCapabilities(json.capabilities || []);
      } catch (err) {
        console.error("Failed to load capabilities", err);
      }
    };
    loadCapabilities();
  }, [authorized]);

  const handleCreateCapability = async () => {
    const trimmed = capabilityName.trim();
    if (!trimmed) return;
    setCapabilityMessage(null);
    try {
      const res = await fetch("/api/capabilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error("Failed to add capability");
      setCapabilityName("");
      const refreshed = await fetch("/api/capabilities");
      const json = await refreshed.json();
      setCapabilities(json.capabilities || []);
      setCapabilityMessage("Capability added.");
    } catch (err: any) {
      console.error("Failed to add capability", err);
      setCapabilityMessage(err?.message || "Could not add capability.");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-2 py-6">
      <div className="rounded-3xl border border-[#d0c9a4] bg-white/80 p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">Admin hub</p>
            <h1 className="text-2xl font-semibold text-[#314123]">Admin Control Room</h1>
            <p className="text-sm text-[#5f5a3b]">
              Jump into schedules, tasks, and user management from one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/hub"
              className="rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8]"
            >
              View live schedule
            </Link>
            <Link
              href="/hub/admin/milk-production"
              className="rounded-md bg-[#7f9b5b] px-2 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-white shadow-sm transition hover:bg-[#6f8b4d]"
            >
              Milk production
            </Link>
          </div>
        </div>

        {message ? (
          <p className="mt-4 text-sm font-semibold text-[#4b5133]">{message}</p>
        ) : null}

        {!authorized && (
          <div className="mt-4 rounded-xl border border-[#e2d7b5] bg-[#f9f6e7] p-4 text-sm text-[#7a7f54]">
            Only administrators can access admin tools. If you need access, please contact a site admin.
          </div>
        )}
      </div>

      {authorized && (
        <>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">Schedule</p>
              <h2 className="text-lg font-semibold text-[#314123]">Admin schedule</h2>
              <p className="mt-2 text-sm text-[#5f5a3b]">
                Edit the staging schedule, drag tasks, and publish updates.
              </p>
              <Link
                href="/hub/admin/schedule"
                className="mt-4 inline-flex items-center justify-center rounded-md bg-[#8fae4c] px-2 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#f9f9ec] shadow-md transition hover:bg-[#7e9c44]"
              >
                Open schedule editor
              </Link>
            </div>

            <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">Shifts</p>
              <h2 className="text-lg font-semibold text-[#314123]">Shift editor</h2>
              <p className="mt-2 text-sm text-[#5f5a3b]">
                Update shift names, times, and ordering in one place.
              </p>
              <Link
                href="/hub/admin/shifts"
                className="mt-4 inline-flex items-center justify-center rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8]"
              >
                Open shift editor
              </Link>
            </div>

            <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">Tasks</p>
              <h2 className="text-lg font-semibold text-[#314123]">Task editor</h2>
              <p className="mt-2 text-sm text-[#5f5a3b]">
                Organize recurring tasks, update statuses, and tune task types.
              </p>
              <Link
                href="/hub/admin/tasks"
                className="mt-4 inline-flex items-center justify-center rounded-md bg-[#6f8f3d] px-2 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#f9f9ec] shadow-md transition hover:bg-[#5f7f35]"
              >
                Open task editor
              </Link>
            </div>

            <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">People</p>
              <h2 className="text-lg font-semibold text-[#314123]">User management</h2>
              <p className="mt-2 text-sm text-[#5f5a3b]">
                Add new teammates, edit roles, and manage access in one view.
              </p>
              <Link
                href="/hub/admin/users"
                className="mt-4 inline-flex items-center justify-center rounded-md border border-[#d0c9a4] bg-white px-2 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8]"
              >
                Open user management
              </Link>
            </div>

            <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">Analytics</p>
              <h2 className="text-lg font-semibold text-[#314123]">Admin analytics</h2>
              <p className="mt-2 text-sm text-[#5f5a3b]">
                Review daily and weekly workload trends across the farm.
              </p>
              <Link
                href="/hub/admin/analytics"
                className="mt-4 inline-flex items-center justify-center rounded-md bg-[#7f9b5b] px-2 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-white shadow-md transition hover:bg-[#6f8b4d]"
              >
                Open analytics
              </Link>
            </div>

            <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">
                Milk production
              </p>
              <h2 className="text-lg font-semibold text-[#314123]">Milk reporting</h2>
              <p className="mt-2 text-sm text-[#5f5a3b]">
                Log milk yields and track distribution plans in one place.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/hub/admin/milk-production"
                  className="inline-flex items-center justify-center rounded-md bg-[#7f9b5b] px-2 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-white shadow-md transition hover:bg-[#6f8b4d]"
                >
                  Open milk production
                </Link>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">Tags</p>
                <h2 className="text-lg font-semibold text-[#314123]">Capability tags</h2>
                <p className="text-sm text-[#5f5a3b]">
                  Add and review shared capability tags for tasks and users.
                </p>
              </div>
            </div>
            {capabilityMessage && (
              <p className="mt-3 text-sm font-semibold text-[#4b5133]">{capabilityMessage}</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <input
                value={capabilityName}
                onChange={(e) => setCapabilityName(e.target.value)}
                className="flex-1 rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                placeholder="Add new capability"
              />
              <button
                type="button"
                onClick={handleCreateCapability}
                className="rounded-md bg-[#8fae4c] px-2 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#f9f9ec] shadow-md transition hover:bg-[#7e9c44]"
              >
                Add tag
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#4f5730]">
              {capabilities.length ? (
                capabilities.map((capability) => (
                  <span
                    key={capability.id}
                    className="rounded-full border border-[#d0c9a4] bg-[#f6f1dd] px-2 py-[2px] font-semibold"
                  >
                    {capability.name}
                  </span>
                ))
              ) : (
                <span className="text-xs text-[#7a7f54]">No capability tags yet.</span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
