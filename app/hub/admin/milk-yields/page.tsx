"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loadSession } from "@/lib/session";

export default function MilkYieldsPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-3 py-6">
      <div className="rounded-3xl border border-[#d0c9a4] bg-white/80 p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">
              Milk production
            </p>
            <h1 className="text-2xl font-semibold text-[#314123]">Milk Yields</h1>
            <p className="text-sm text-[#5f5a3b]">
              Submit and review daily milk yields through the embedded form.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/hub/admin"
              className="rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8]"
            >
              Back to admin
            </Link>
            <Link
              href="/hub/admin/milk-allocations"
              className="rounded-md bg-[#7f9b5b] px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-white shadow-sm transition hover:bg-[#6f8b4d]"
            >
              Milk allocations
            </Link>
          </div>
        </div>
        {message && (
          <p className="mt-4 text-sm font-semibold text-[#4b5133]">{message}</p>
        )}
      </div>

      {!authorized ? (
        <div className="rounded-2xl border border-[#e2d7b5] bg-[#f9f6e7] p-5 text-sm text-[#7a7f54]">
          You must be an admin to access milk yield reporting.
        </div>
      ) : (
        <div className="rounded-3xl border border-[#d0c9a4] bg-white/80 p-4 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">
                Embedded form
              </p>
              <h2 className="text-lg font-semibold text-[#314123]">
                Daily milk yield form
              </h2>
              <p className="text-sm text-[#5f5a3b]">
                The form scales with your screen. Scroll inside the form to reach
                all fields.
              </p>
            </div>
            <span className="rounded-full border border-[#d0c9a4] bg-[#f6f1dd] px-3 py-1 text-xs font-semibold text-[#4b5133]">
              Updated live
            </span>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-[#e2d7b5] bg-white">
            <iframe
              title="Milk yield form"
              src="https://docs.google.com/forms/d/e/1FAIpQLSfqOaHXBz8MzoHB4LT4oaC9QHqyLXjNVE8-lEE8V7rEDlcYSA/viewform?embedded=true"
              className="h-[80vh] min-h-[900px] w-full md:h-[calc(100vh-16rem)] md:min-h-[1200px]"
              style={{ border: "0" }}
              loading="lazy"
            >
              Loading…
            </iframe>
          </div>
        </div>
      )}
    </div>
  );
}
