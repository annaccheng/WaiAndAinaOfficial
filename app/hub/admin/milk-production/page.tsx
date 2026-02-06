"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loadSession } from "@/lib/session";

export default function MilkProductionPage() {
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-3 py-6">
      <div className="rounded-3xl border border-[#d0c9a4] bg-white/80 p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">
              Milk production
            </p>
            <h1 className="text-2xl font-semibold text-[#314123]">Milk reporting</h1>
            <p className="text-sm text-[#5f5a3b]">
              Choose where to log yields or track allocations.
            </p>
          </div>
          <Link
            href="/hub"
            className="rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8]"
          >
            Back to dashboard
          </Link>
        </div>
        {message && (
          <p className="mt-4 text-sm font-semibold text-[#4b5133]">{message}</p>
        )}
      </div>

      {!authorized ? (
        <div className="rounded-2xl border border-[#e2d7b5] bg-[#f9f6e7] p-5 text-sm text-[#7a7f54]">
          You must be an admin or volunteer to access milk production reporting.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
            <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">
              Milk yields
            </p>
            <h2 className="text-lg font-semibold text-[#314123]">Daily yield form</h2>
            <p className="mt-2 text-sm text-[#5f5a3b]">
              Submit production totals and observations through the shared Google form.
            </p>
            <Link
              href="/hub/admin/milk-yields"
              className="mt-4 inline-flex items-center justify-center rounded-md bg-[#7f9b5b] px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-white shadow-md transition hover:bg-[#6f8b4d]"
            >
              Open milk yields
            </Link>
          </div>

          <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
            <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">
              Milk allocations
            </p>
            <h2 className="text-lg font-semibold text-[#314123]">
              Distribution tracker
            </h2>
            <p className="mt-2 text-sm text-[#5f5a3b]">
              Review allocation plans, delivery notes, and distribution summaries.
            </p>
            <Link
              href="/hub/admin/milk-allocations"
              className="mt-4 inline-flex items-center justify-center rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8]"
            >
              Open allocations
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
