"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loadSession } from "@/lib/session";

export default function MilkAllocationsPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession();
    if (!session?.name) {
      router.replace("/");
      return;
    }
    const userType = (session.userType || "").toLowerCase();
    const canAccess = userType === "admin" || userType === "volunteer";
    if (!canAccess) {
      setMessage("Admin or volunteer access required.");
      return;
    }
    setAuthorized(true);
  }, [router]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-3 py-6">
      <div className="rounded-3xl border border-[#d0c9a4] bg-white/80 p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">
              Milk distribution
            </p>
            <h1 className="text-2xl font-semibold text-[#314123]">Milk Allocations</h1>
            <p className="text-sm text-[#5f5a3b]">
              Track how milk is allocated across the farm and community.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/hub/admin/milk-production"
              className="rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8]"
            >
              Back to milk production
            </Link>
            <Link
              href="/hub/admin/milk-yields"
              className="rounded-md bg-[#7f9b5b] px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-white shadow-sm transition hover:bg-[#6f8b4d]"
            >
              Milk yields
            </Link>
          </div>
        </div>
        {message && (
          <p className="mt-4 text-sm font-semibold text-[#4b5133]">{message}</p>
        )}
      </div>

      {!authorized ? (
        <div className="rounded-2xl border border-[#e2d7b5] bg-[#f9f6e7] p-5 text-sm text-[#7a7f54]">
          You must be an admin or volunteer to access milk allocation reporting.
        </div>
      ) : (
        <div className="rounded-3xl border border-[#d0c9a4] bg-white/80 p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">
            Milk allocations
          </p>
          <h2 className="mt-2 text-lg font-semibold text-[#314123]">
            Allocation dashboard
          </h2>
          <p className="mt-2 text-sm text-[#5f5a3b]">
            Use this space to upload allocation logs, summarize recipients, or embed
            reporting tools.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[#e2d7b5] bg-[#faf7eb] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7a7f54]">
                Coming soon
              </p>
              <p className="mt-2 text-sm text-[#5f5a3b]">
                Add allocation summaries or connect a spreadsheet here.
              </p>
            </div>
            <div className="rounded-2xl border border-[#e2d7b5] bg-[#faf7eb] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7a7f54]">
                Quick notes
              </p>
              <p className="mt-2 text-sm text-[#5f5a3b]">
                Keep quick notes about delivery plans, pickup windows, or contacts.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
