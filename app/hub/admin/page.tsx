"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadSession } from "@/lib/session";

export default function AdminPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <div className="rounded-3xl border border-[#d0c9a4] bg-white/80 p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">Admin hub</p>
            <h1 className="text-2xl font-semibold text-[#314123]">Admin Control Room</h1>
            <p className="text-sm text-[#5f5a3b]">
              Jump into schedules, tasks, and user management from one place.
            </p>
          </div>
          <Link
            href="/hub"
            className="rounded-md border border-[#d0c9a4] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8]"
          >
            View live schedule
          </Link>
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
        <div className="grid gap-5 md:grid-cols-3">
          <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
            <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">Schedule</p>
            <h2 className="text-lg font-semibold text-[#314123]">Admin schedule</h2>
            <p className="mt-2 text-sm text-[#5f5a3b]">
              Edit the staging schedule, drag tasks, and publish updates.
            </p>
            <Link
              href="/hub/admin/schedule"
              className="mt-4 inline-flex items-center justify-center rounded-md bg-[#8fae4c] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#f9f9ec] shadow-md transition hover:bg-[#7e9c44]"
            >
              Open schedule editor
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
              className="mt-4 inline-flex items-center justify-center rounded-md bg-[#6f8f3d] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#f9f9ec] shadow-md transition hover:bg-[#5f7f35]"
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
              className="mt-4 inline-flex items-center justify-center rounded-md border border-[#d0c9a4] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8]"
            >
              Open user management
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
