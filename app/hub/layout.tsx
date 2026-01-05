"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, loadSession } from "@/lib/session";
import { HubAssistantChat } from "@/components/HubAssistantChat";

function labelColorToClasses(color?: string | null) {
  const map: Record<string, string> = {
    default: "bg-slate-100 text-slate-800 border-slate-200",
    gray: "bg-slate-100 text-slate-800 border-slate-200",
    brown: "bg-amber-100 text-amber-900 border-amber-200",
    orange: "bg-orange-100 text-orange-900 border-orange-200",
    yellow: "bg-amber-100 text-amber-900 border-amber-200",
    green: "bg-emerald-100 text-emerald-900 border-emerald-200",
    blue: "bg-sky-100 text-sky-900 border-sky-200",
    purple: "bg-violet-100 text-violet-900 border-violet-200",
    pink: "bg-pink-100 text-pink-900 border-pink-200",
    red: "bg-rose-100 text-rose-900 border-rose-200",
  };

  return map[color || "default"] || map.default;
}

export default function HubLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [name, setName] = useState<string>("");
  const [userType, setUserType] = useState<string | null>(null);
  const [userTypeColor, setUserTypeColor] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopGuidesOpen, setDesktopGuidesOpen] = useState(false);
  const [mobileGuidesOpen, setMobileGuidesOpen] = useState(false);
  const [desktopWorkOpen, setDesktopWorkOpen] = useState(false);
  const [mobileWorkOpen, setMobileWorkOpen] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [newlyOnline, setNewlyOnline] = useState<Record<string, boolean>>({});

  const normalizedType = (userType || "").toLowerCase();
  const isExternalVolunteer = normalizedType === "external volunteer";
  const isInactiveVolunteer = normalizedType === "inactive volunteer";
  const isAdmin = normalizedType === "admin";

  useEffect(() => {
    const session = loadSession();
    if (!session || !session.name) {
      router.replace("/");
      return;
    }
    setName(session.name);
    setUserType(session.userType ?? null);
    setUserTypeColor(session.userTypeColor ?? null);
  }, [router]);

  useEffect(() => {
    if (isInactiveVolunteer && pathname.startsWith("/hub") && pathname !== "/hub/goat") {
      router.replace("/hub/goat");
    }
  }, [isInactiveVolunteer, pathname, router]);

  function isActive(path: string) {
    return pathname === path;
  }

  const guideLinks = useMemo(
    () => [
      { href: "/hub/guides/farm-map", label: "Farm Map", icon: "🗺️" },
      { href: "/hub/guides/animalpedia", label: "Animalpedia", icon: "🐾" },
      { href: "/hub/guides/how-to", label: "How To Guides", icon: "📘" },
    ],
    []
  );
  const canAccessWork = useMemo(() => {
    if (!userType) return false;
    return [
      "admin",
      "volunteer",
      "external volunteer",
      "inactive volunteer",
    ].includes(normalizedType);
  }, [normalizedType, userType]);

  const workLinks = useMemo(() => {
    const links = [
      { href: "/hub/dashboard", label: "Dashboard", icon: "🧭" },
      { href: "/hub", label: "Schedule", icon: "📆" },
      { href: "/hub/request", label: "Requests", icon: "📝" },
      { href: "/hub/goat", label: "Arcade", icon: "🐐" },
    ];

    if (isAdmin) {
      links.push({ href: "/hub/admin/schedule", label: "Admin Schedule", icon: "🗂️" });
      links.push({ href: "/hub/admin", label: "Admin", icon: "🛠️" });
    }

    if (isExternalVolunteer) {
      return links.filter((link) => link.href === "/hub");
    }
    if (isInactiveVolunteer) {
      return links.filter((link) => link.href === "/hub/goat");
    }

    return links;
  }, [isAdmin, isExternalVolunteer]);

  const workLinkHrefs = useMemo(
    () => workLinks.map((link) => link.href),
    [workLinks]
  );
  const showAssistant = false;

  function handleLogout() {
    clearSession();
    router.replace("/");
  }

  useEffect(() => {
    // Close any open menus when navigating
    setMobileMenuOpen(false);
    setDesktopGuidesOpen(false);
    setMobileGuidesOpen(false);
    setDesktopWorkOpen(false);
    setMobileWorkOpen(false);
  }, [pathname]);

  // Heartbeat to keep users marked online across all hub pages
  useEffect(() => {
    if (!name) return undefined;

    let cancelled = false;

    const ping = async (offline = false) => {
      try {
        await fetch("/api/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, offline }),
        });
      } catch (err) {
        if (!cancelled) console.error("Heartbeat failed:", err);
      }
    };

    ping();
    const interval = setInterval(() => ping(false), 15_000);

    return () => {
      cancelled = true;
      clearInterval(interval);

      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        try {
          const blob = new Blob([
            JSON.stringify({ name, offline: true }),
          ], { type: "application/json" });
          navigator.sendBeacon("/api/heartbeat", blob);
        } catch (err) {
          console.error("Failed to send final heartbeat:", err);
        }
      } else {
        ping(true);
      }
    };
  }, [name]);

  // Auto-generate reports once the configured Hawaii-time clock hits
  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;

    const tick = async () => {
      try {
        await fetch("/api/reports");
      } catch (err) {
        if (!cancelled) console.error("Auto-report check failed", err);
      }
    };

    tick();
    const interval = setInterval(() => tick(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isAdmin]);

  // Poll online roster using heartbeat timestamps
  useEffect(() => {
    let cancelled = false;

    const loadOnline = async () => {
      try {
        const res = await fetch("/api/online");
        if (!res.ok) return;
        const json = await res.json();
        const baseNames = ((json.onlineUsers as string[]) || [])
          .map((n) => (n || "").split(/\s+/)[0] || n)
          .filter(Boolean);
        const nextOnline = Array.from(new Set(baseNames));

        setOnlineUsers((prev) => {
          const isSameLength = prev.length === (nextOnline?.length || 0);
          const isSameOrder =
            isSameLength && nextOnline?.every((n: string, i: number) => n === prev[i]);
          if (isSameOrder && nextOnline) return prev;

          const newly = (nextOnline || []).filter((n) => !prev.includes(n));
          if (newly.length) {
            setNewlyOnline((prevMap) => {
              const filteredEntries = Object.entries(prevMap).filter(([key]) =>
                (nextOnline || []).includes(key)
              );
              const cleaned = Object.fromEntries(filteredEntries) as Record<string, boolean>;

              newly.forEach((n) => {
                cleaned[n] = true;
                setTimeout(() => {
                  setNewlyOnline((current) => {
                    const next = { ...current };
                    delete next[n];
                    return next;
                  });
                }, 1200);
              });

              return cleaned;
            });
          }

          return nextOnline || [];
        });
      } catch (err) {
        if (!cancelled) console.error("Failed to load online users:", err);
      }
    };

    loadOnline();
    const interval = setInterval(loadOnline, 20_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const showOnlineRibbon =
    canAccessWork &&
    workLinkHrefs.some(
      (href) => pathname === href || pathname.startsWith(`${href}/`)
    );
  const assistantContext = useMemo(() => {
    const workLabels = workLinks.map((link) => link.label).join(", ");
    return `Hub path: ${pathname}. User type: ${userType || "unknown"}. Work links available: ${workLabels}.`;
  }, [pathname, userType, workLinks]);

  return (
    <>
      <main className="min-h-screen flex flex-col bg-[#f8f4e3] text-[#3b4224]">
        {/* Header bar */}
        <header className="w-full bg-[#a0b764] text-[#f9f9ec] shadow-md relative">
          <div className="max-w-6xl mx-auto px-3 sm:px-4 py-2 sm:py-3 flex flex-col gap-2 sm:gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Top row on mobile: logo + toggles */}
            <div className="flex items-center justify-between gap-3 w-full">
              <div className="flex items-center gap-2 sm:hidden">
                <button
                  onClick={() => setMobileMenuOpen(true)}
                  className="rounded-md border border-[#e5eacc]/60 bg-[#f4f7de]/90 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#56652f] hover:bg-white transition-colors shadow-sm"
                  aria-label="Open navigation"
                >
                  ☰
                </button>
              </div>

              {/* Center: logo + title */}
              <div className="flex items-center gap-3 flex-1 sm:flex-none sm:justify-center">
                <div className="h-9 w-9 rounded-full bg-[#f1e4b5] flex items-center justify-center shadow-sm">
                  <span className="text-xl">🐐</span>
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-xs sm:text-sm font-semibold tracking-[0.16em] uppercase">
                    Wai &amp; Aina Homeapp
                  </span>
                  <span className="text-[10px] sm:text-[11px] text-[#f5f7eb]/90">
                    Daily life &amp; schedule hub
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:hidden">
                <button
                  onClick={handleLogout}
                  className="rounded-md border border-[#e5eacc]/60 bg-[#f4f7de]/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#56652f] hover:bg-white transition-colors"
                >
                  Logout
                </button>
              </div>
            </div>

          {/* Desktop nav */}
          <nav className="hidden sm:block relative">
            <div className="flex items-center gap-2 sm:gap-4 px-0 pb-1 sm:pb-0">
              <HubLink href="/" active={false}>
                Home
              </HubLink>
              {canAccessWork && workLinks.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setDesktopWorkOpen((v) => !v)}
                    className={`whitespace-nowrap rounded-full px-3 sm:px-4 py-1.5 text-[11px] sm:text-sm transition-colors ${
                      pathname.startsWith("/hub") || desktopWorkOpen
                        ? "bg-[#f4f7de] text-[#485926] shadow-sm"
                        : "text-[#f5f7eb]/90 hover:bg-[#b2c677] hover:text-white"
                    }`}
                  >
                    Work Dashboard
                  </button>
                  <div
                    className={`absolute left-0 mt-2 min-w-[230px] rounded-xl bg-[#f7f4e6] border border-[#d0c9a4] shadow-lg overflow-hidden transition-all duration-200 origin-top ${
                      desktopWorkOpen
                        ? "opacity-100 translate-y-0 scale-100"
                        : "opacity-0 -translate-y-1 scale-95 pointer-events-none"
                    }`}
                  >
                    <div className="flex flex-col divide-y divide-[#e7dfc0]">
                      {workLinks.map((link) => (
                        <Link
                          key={link.href}
                          href={link.href}
                          className={`flex items-center gap-2 px-4 py-2.5 text-[12px] transition-colors ${
                            pathname === link.href
                              ? "bg-[#e5efc8] text-[#3b4224]"
                              : "hover:bg-[#f0ead4] text-[#485926]"
                          }`}
                        >
                          <span>{link.icon}</span>
                          <span className="font-semibold tracking-[0.08em] uppercase">{link.label}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {name && (
                <HubLink href="/hub/settings" active={pathname === "/hub/settings"}>
                  Settings
                </HubLink>
              )}
              <div className="relative">
                <button
                  onClick={() => setDesktopGuidesOpen((v) => !v)}
                  className={`whitespace-nowrap rounded-full px-3 sm:px-4 py-1.5 text-[11px] sm:text-sm transition-colors ${
                    pathname.startsWith("/hub/guides") || desktopGuidesOpen
                      ? "bg-[#f4f7de] text-[#485926] shadow-sm"
                      : "text-[#f5f7eb]/90 hover:bg-[#b2c677] hover:text-white"
                  }`}
                >
                  Guides
                </button>
                <div
                  className={`absolute left-0 mt-2 min-w-[230px] rounded-xl bg-[#f7f4e6] border border-[#d0c9a4] shadow-lg overflow-hidden transition-all duration-200 origin-top ${
                    desktopGuidesOpen
                      ? "opacity-100 translate-y-0 scale-100"
                      : "opacity-0 -translate-y-1 scale-95 pointer-events-none"
                  }`}
                >
                  <div className="flex flex-col divide-y divide-[#e7dfc0]">
                    {guideLinks.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className={`flex items-center gap-2 px-4 py-2.5 text-[12px] transition-colors ${
                          pathname === link.href
                            ? "bg-[#e5efc8] text-[#3b4224]"
                            : "hover:bg-[#f0ead4] text-[#485926]"
                        }`}
                      >
                        <span>{link.icon}</span>
                        <span className="font-semibold tracking-[0.08em] uppercase">
                          {link.label}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </nav>

          {/* Right: user + logout (desktop / tablet) */}
          <div className="hidden sm:flex items-center gap-3">
            {name && (
              <div className="flex flex-col items-end gap-1 text-right">
                <span className="text-[11px] uppercase tracking-[0.16em]">
                  Logged in as <span className="font-semibold">{name}</span>
                </span>
                {userType && (
                  <span
                    className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-[2px] text-[10px] font-semibold uppercase tracking-[0.14em] ${labelColorToClasses(
                      userTypeColor
                    )}`}
                  >
                    {userType}
                  </span>
                )}
              </div>
            )}
            <button
              onClick={handleLogout}
              className="rounded-md border border-[#e5eacc]/60 bg-[#f4f7de]/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#56652f] hover:bg-white transition-colors"
            >
              Logout
            </button>
          </div>

          {/* Logged in label on very small screens (optional) */}
          {name && (
            <div className="sm:hidden text-[10px] uppercase tracking-[0.16em] text-[#f5f7eb]/90 flex flex-col gap-1">
              <span>
                Logged in as <span className="font-semibold">{name}</span>
              </span>
              {userType && (
                <span
                  className={`inline-flex items-center gap-1 self-start rounded-full border px-2 py-[2px] text-[9px] font-semibold tracking-[0.14em] text-[#2f2f21] ${labelColorToClasses(
                    userTypeColor
                  )}`}
                >
                  {userType}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Mobile slide-out nav */}
        <div
          className={`sm:hidden fixed inset-0 z-50 transition ${
            mobileMenuOpen ? "pointer-events-auto" : "pointer-events-none"
          }`}
          aria-hidden={!mobileMenuOpen}
        >
          <div
            className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-200 ${
              mobileMenuOpen ? "opacity-100" : "opacity-0"
            }`}
            onClick={() => setMobileMenuOpen(false)}
          />
          <div
            className={`absolute left-0 top-0 h-full w-64 bg-[#f7f4e6] shadow-2xl border-r border-[#d0c9a4] transform transition-transform duration-200 ease-out ${
              mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#e7dfc0] bg-[#f0ead4]">
              <div className="flex items-center gap-2 text-[#485926]">
                <span className="text-lg">📋</span>
                <span className="text-xs font-semibold uppercase tracking-[0.14em]">
                  Quick Menu
                </span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-full bg-white text-[#3b4224] h-8 w-8 flex items-center justify-center shadow hover:shadow-md transition"
                aria-label="Close navigation"
              >
                ✕
              </button>
            </div>

            <div className="relative h-full">
              <div className="flex flex-col gap-1 px-3 py-4 text-[#485926] overflow-y-auto max-h-[calc(100vh-140px)]">
                <MobileLink href="/" active={false}>
                  Home
                </MobileLink>

                {canAccessWork && workLinks.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => setMobileWorkOpen((v) => !v)}
                      className="flex items-center justify-between rounded-lg px-3 py-3 text-sm font-semibold uppercase tracking-[0.14em] bg-white hover:bg-[#f3edd8]"
                    >
                      <span className="flex items-center gap-2">
                        <span>🧭</span> Work Dashboard
                      </span>
                      <span className={`transform transition ${mobileWorkOpen ? "rotate-90" : ""}`}>
                        ▶
                      </span>
                    </button>

                    <div
                      className={`overflow-hidden transition-all duration-200 ${
                        mobileWorkOpen ? "max-h-64 opacity-100" : "max-h-0 opacity-0"
                      }`}
                    >
                      <div className="mt-1 ml-2 rounded-lg border border-[#e7dfc0] bg-white shadow-inner max-h-56 overflow-y-auto">
                        <div className="flex flex-col divide-y divide-[#f0ead4]">
                          {workLinks.map((link) => (
                            <Link
                              key={link.href}
                              href={link.href}
                              className={`flex items-center gap-2 px-4 py-3 text-[13px] transition-colors ${
                                pathname === link.href
                                  ? "bg-[#e5efc8] text-[#3b4224]"
                                  : "hover:bg-[#f8f4e3] text-[#485926]"
                              }`}
                            >
                              <span>{link.icon}</span>
                              <span className="font-semibold tracking-[0.12em] uppercase">{link.label}</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {name && (
                  <MobileLink href="/hub/settings" active={pathname === "/hub/settings"}>
                    Settings
                  </MobileLink>
                )}

                <button
                  onClick={() => setMobileGuidesOpen((v) => !v)}
                  className={`flex items-center justify-between rounded-lg px-3 py-3 text-sm font-semibold uppercase tracking-[0.14em] transition ${
                    pathname.startsWith("/hub/guides") || mobileGuidesOpen
                      ? "bg-[#e5efc8] text-[#3b4224]"
                      : "bg-white hover:bg-[#f3edd8]"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span>📚</span> Guides
                  </span>
                  <span className={`transform transition ${mobileGuidesOpen ? "rotate-90" : ""}`}>
                    ▶
                  </span>
                </button>

                <div
                  className={`overflow-hidden transition-all duration-200 ${
                    mobileGuidesOpen ? "max-h-64 opacity-100" : "max-h-0 opacity-0"
                  }`}
                >
                  <div className="mt-2 ml-2 rounded-lg border border-[#e7dfc0] bg-white shadow-inner max-h-56 overflow-y-auto">
                    <div className="flex flex-col divide-y divide-[#f0ead4]">
                      {guideLinks.map((link) => (
                        <Link
                          key={link.href}
                          href={link.href}
                          className={`flex items-center gap-2 px-4 py-3 text-[13px] transition-colors ${
                            pathname === link.href
                              ? "bg-[#e5efc8] text-[#3b4224]"
                              : "hover:bg-[#f8f4e3] text-[#485926]"
                          }`}
                        >
                          <span>{link.icon}</span>
                          <span className="font-semibold tracking-[0.12em] uppercase">
                            {link.label}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {showOnlineRibbon && onlineUsers.length > 0 && (
        <div className="bg-[#eef2d9]/70 border-b border-[#d7d0ad]">
          <div className="max-w-6xl mx-auto px-3 sm:px-4 py-1.5 flex items-center gap-2 overflow-x-auto no-scrollbar text-[#405124]">
            <span className="inline-flex items-center gap-1 rounded-full bg-[#f7f4e6] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] border border-[#d0c9a4] shadow-sm">
              <span className="relative inline-flex h-2 w-2 items-center justify-center">
                <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-600" />
              </span>
              Online
            </span>
            <div className="flex items-center gap-2 text-xs">
              {onlineUsers.map((person) => (
                <span
                  key={person}
                  className={`inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 border border-[#d6d9b9] shadow-sm transition ${
                    newlyOnline[person] ? "ring-2 ring-emerald-200" : ""
                  }`}
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-inner" />
                  <span className="font-semibold text-[#3f4a28]">{person}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {canAccessWork && workLinks.length > 0 && (
        <div className="bg-[#f7f4e6] border-b border-[#d0c9a4]">
          <div className="max-w-6xl mx-auto px-3 sm:px-4 py-2 flex flex-wrap gap-2">
            {workLinks.map((link) => (
              <WorkNavLink key={link.href} href={link.href} active={pathname === link.href}>
                {link.label}
              </WorkNavLink>
            ))}
          </div>
        </div>
      )}

      {/* Page body */}
      <section className="flex-1">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
          {children}
        </div>
      </section>
      </main>

      {canAccessWork && showAssistant && (
        <HubAssistantChat
          variant="floating"
          title="Hub AI assistant"
          subtitle="Ask about guides, schedules, and data across the hub"
          contextHint={assistantContext}
          placeholder="Ask the assistant about schedules, guides, or requests"
        />
      )}
    </>
  );
}

function HubLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`whitespace-nowrap rounded-full px-3 sm:px-4 py-1.5 text-[11px] sm:text-sm transition-colors ${
        active
          ? "bg-[#f4f7de] text-[#485926] shadow-sm"
          : "text-[#f5f7eb]/90 hover:bg-[#b2c677] hover:text-white"
      }`}
    >
      {children}
    </Link>
  );
}

function MobileLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-3 text-sm font-semibold uppercase tracking-[0.14em] transition flex items-center gap-2 ${
        active ? "bg-[#e5efc8] text-[#3b4224]" : "bg-white hover:bg-[#f3edd8] text-[#485926]"
      }`}
    >
      <span className="h-2 w-2 rounded-full bg-[#8fae4c]" />
      {children}
    </Link>
  );
}

function WorkNavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 sm:px-4 py-1.5 text-[11px] sm:text-sm font-semibold uppercase tracking-[0.12em] transition shadow-sm border ${
        active
          ? "bg-[#a0b764] text-white border-[#8fae4c]"
          : "bg-white text-[#485926] border-[#d0c9a4] hover:bg-[#f4f7de]"
      }`}
    >
      {children}
    </Link>
  );
}
