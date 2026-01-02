"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  clearSession,
  getHubLandingPath,
  loadSession,
  saveSession,
  UserSession,
} from "@/lib/session";

const allowedWorkTypes = ["admin", "volunteer", "external volunteer"];
function formatSession(session: UserSession | null): UserSession | null {
  if (!session) return null;
  const type = session.userType?.toLowerCase();
  return {
    ...session,
    userType: type || null,
  };
}

export default function HomePage() {
  const router = useRouter();
  const [session, setSession] = useState<UserSession | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const [users, setUsers] = useState<{ name: string; number: string }[]>([]);
  const [usersLoading, setUsersLoading] = useState<boolean>(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  // Selected user + login form
  const [selectedName, setSelectedName] = useState<string>("");
  const [number, setNumber] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const existing = formatSession(loadSession());
    if (existing) setSession(existing);
  }, []);

  const canAccessWork = useMemo(() => {
    if (!session?.userType) return false;
    return allowedWorkTypes.includes(session.userType.toLowerCase());
  }, [session?.userType]);
  const shouldAutoRouteToSchedule = useMemo(() => {
    if (!session?.userType) return false;
    return ["admin", "volunteer", "external volunteer"].includes(
      session.userType.toLowerCase()
    );
  }, [session?.userType]);

  useEffect(() => {
    if (!shouldAutoRouteToSchedule) return;
    router.replace("/hub");
  }, [router, shouldAutoRouteToSchedule]);

  function handleLogout() {
    clearSession();
    setSession(null);
  }

  // Fetch users for login dropdown
  useEffect(() => {
    async function loadUsersList() {
      setUsersLoading(true);
      setUsersError(null);

      try {
        const res = await fetch("/api/users");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        const parsed = Array.isArray(data.users)
          ? data.users
              .map((entry: any) => ({
                name: entry?.name ?? "",
                number: entry?.number ?? "",
              }))
              .filter((entry: any) => entry.name)
          : [];

        setUsers(parsed);
      } catch (err) {
        console.error("Failed to load users:", err);
        setUsersError("Unable to load users. Please refresh or try again later.");
      } finally {
        setUsersLoading(false);
      }
    }

    loadUsersList();
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if ((!selectedName && !number) || !password) {
      setLoginError("Please choose your name or enter your number, then enter a passcode.");
      return;
    }

    setIsSubmitting(true);
    setLoginError(null);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selectedName || undefined,
          number: number || undefined,
          password,
        }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          setLoginError("Incorrect passcode for that user.");
        } else {
          setLoginError("Login failed. Please try again.");
        }
        return;
      }

      const data = await res.json();
      const nextSession: UserSession = {
        name: data.name || selectedName,
        userType: data.userType || null,
        userTypeColor: data.userTypeColor || null,
      };
      saveSession(nextSession);
      setSession(formatSession(nextSession));
      setShowLogin(false);
      router.push(getHubLandingPath(data.userType));
    } catch (err) {
      console.error("Login error:", err);
      setLoginError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function heroButton(label: string, href: string, primary = false) {
    return (
      <Link
        href={href}
        className={`inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition shadow-sm ${
          primary
            ? "bg-[#a0b764] text-white hover:bg-[#8ba450]"
            : "bg-white/80 text-[#3b4224] hover:bg-white"
        }`}
      >
        {label}
        <span aria-hidden>→</span>
      </Link>
    );
  }

  return (
      <main className="min-h-screen bg-[#f8f4e3] text-[#3b4224] flex flex-col">
      {/* Top navigation */}
      <header className="sticky top-0 z-20 w-full bg-white/90 backdrop-blur shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden inline-flex items-center justify-center rounded-full border border-[#d0c9a4] bg-white h-10 w-10 text-lg shadow-sm"
              onClick={() => setShowMobileMenu(true)}
              aria-label="Open menu"
            >
              ☰
            </button>
            <div className="h-10 w-10 rounded-full bg-[#f1e4b5] flex items-center justify-center shadow">
              <span className="text-xl">🐐</span>
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-[0.16em] uppercase text-[#5d7f3b]">
                Wai &amp; Aina
              </span>
              <span className="text-[11px] text-[#7a7f54]">Sustainable living &amp; care</span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-3 text-sm font-semibold">
            <Link href="#home" className="rounded-full px-3 py-1.5 hover:bg-[#eef2d9]">
              Home
            </Link>
            <Link href="#about" className="rounded-full px-3 py-1.5 hover:bg-[#eef2d9]">
              About Us
            </Link>
            <div className="relative group">
              <button className="rounded-full px-3 py-1.5 hover:bg-[#eef2d9] inline-flex items-center gap-2">
                Farm Information <span className="text-xs">▾</span>
              </button>
              <div className="absolute right-0 mt-2 min-w-[200px] rounded-xl bg-white border border-[#d0c9a4] shadow-lg opacity-0 group-hover:opacity-100 group-hover:translate-y-0 translate-y-1 transition">
                <div className="flex flex-col divide-y divide-[#f0ead4]">
                  <Link href="/hub/guides/animalpedia" className="px-4 py-2.5 hover:bg-[#f8f4e3]">
                    Animalpedia
                  </Link>
                  <Link href="/hub/guides/farm-map" className="px-4 py-2.5 hover:bg-[#f8f4e3]">
                    Farm Map
                  </Link>
                  <Link href="/hub/guides/how-to" className="px-4 py-2.5 hover:bg-[#f8f4e3]">
                    Guides
                  </Link>
                </div>
              </div>
            </div>
            {canAccessWork && (
              <Link href="/hub/dashboard" className="rounded-full px-3 py-1.5 hover:bg-[#eef2d9]">
                Work Dashboard
              </Link>
            )}
            {session && (
              <Link href="/hub/settings" className="rounded-full px-3 py-1.5 hover:bg-[#eef2d9]">
                Settings
              </Link>
            )}
          </nav>

          <div className="flex items-center gap-2">
            {session?.name && (
              <span className="hidden sm:inline text-xs text-[#56652f] font-semibold">
                Hi, {session.name.split(" ")[0]}
              </span>
            )}
            <button
              onClick={() => setShowLogin(true)}
              className="inline-flex items-center rounded-full border border-[#c8cba0] bg-white px-3 py-2 text-xs font-semibold hover:bg-[#f1edd8] shadow-sm"
            >
              {session ? "Switch user" : "Login"}
            </button>
            {session && (
              <button
                onClick={handleLogout}
                className="inline-flex items-center rounded-full bg-[#e4e4d0] text-[#4a4f2f] px-3 py-2 text-xs font-semibold shadow hover:bg-[#d7d9c0]"
              >
                Logout
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile menu */}
      {showMobileMenu && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden" onClick={() => setShowMobileMenu(false)}>
          <div
            className="absolute left-0 top-0 h-full w-72 bg-[#f8f4e3] border-r border-[#d0c9a4] shadow-2xl p-4 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-[#f1e4b5] flex items-center justify-center shadow">
                  <span className="text-xl">🐐</span>
                </div>
                <div className="leading-tight">
                  <p className="text-sm font-semibold text-[#3b4224]">Wai &amp; Aina</p>
                  <p className="text-[11px] text-[#7a7f54]">Farm hub</p>
                </div>
              </div>
              <button
                className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-[#4a4f2f] border border-[#d0c9a4]"
                onClick={() => setShowMobileMenu(false)}
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>

            <nav className="flex flex-col gap-2 text-sm font-semibold text-[#3b4224]">
              <Link href="#home" onClick={() => setShowMobileMenu(false)} className="rounded-lg px-3 py-2 hover:bg-white">
                Home
              </Link>
              <Link href="#about" onClick={() => setShowMobileMenu(false)} className="rounded-lg px-3 py-2 hover:bg-white">
                About Us
              </Link>
              <div className="rounded-lg bg-white px-3 py-2 shadow-inner">
                <p className="text-xs uppercase tracking-[0.18em] text-[#7a7f54] mb-2">Farm Information</p>
                <div className="flex flex-col gap-1 font-medium">
                  <Link
                    href="/hub/guides/animalpedia"
                    onClick={() => setShowMobileMenu(false)}
                    className="rounded-md px-2 py-2 hover:bg-[#f1edd8]"
                  >
                    Animalpedia
                  </Link>
                  <Link
                    href="/hub/guides/farm-map"
                    onClick={() => setShowMobileMenu(false)}
                    className="rounded-md px-2 py-2 hover:bg-[#f1edd8]"
                  >
                    Farm Map
                  </Link>
                  <Link
                    href="/hub/guides/how-to"
                    onClick={() => setShowMobileMenu(false)}
                    className="rounded-md px-2 py-2 hover:bg-[#f1edd8]"
                  >
                    Guides
                  </Link>
                </div>
              </div>
              {canAccessWork && (
                <Link
                  href="/hub/dashboard"
                  onClick={() => setShowMobileMenu(false)}
                  className="rounded-lg px-3 py-2 hover:bg-white"
                >
                  Work Dashboard
                </Link>
              )}
              {session && (
                <Link
                  href="/hub/settings"
                  onClick={() => setShowMobileMenu(false)}
                  className="rounded-lg px-3 py-2 hover:bg-white"
                >
                  Settings
                </Link>
              )}
            </nav>

            <div className="mt-auto flex items-center justify-between">
              {session?.name ? (
                <div className="text-xs text-[#56652f]">
                  Hi, {session.name.split(" ")[0]}
                </div>
              ) : (
                <div className="text-xs text-[#7a7f54]">Welcome!</div>
              )}
              <button
                onClick={() => {
                  setShowMobileMenu(false);
                  setShowLogin(true);
                }}
                className="inline-flex items-center rounded-full border border-[#c8cba0] bg-white px-3 py-2 text-xs font-semibold hover:bg-[#f1edd8] shadow-sm"
              >
                {session ? "Switch user" : "Login"}
              </button>
            </div>
          </div>
        </div>
      )}

        {/* Hero */}
        <section
          id="home"
          className="relative w-full overflow-hidden"
          style={{
            backgroundImage:
              "linear-gradient(120deg, rgba(240,237,217,0.9), rgba(201,221,183,0.9)), url('https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=80')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="pointer-events-none absolute -left-10 top-10 h-40 w-40 rounded-full bg-white/50 blur-3xl" />
          <div className="pointer-events-none absolute right-0 bottom-0 h-56 w-56 rounded-full bg-[#b8d29b]/50 blur-3xl" />
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16 grid md:grid-cols-2 gap-10 items-center">
            <div className="space-y-5 bg-white/70 backdrop-blur rounded-2xl border border-white/60 shadow-lg p-6">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#5d7f3b] shadow-sm">
                🐐 Since 2023
              </div>
              <h1 className="text-3xl sm:text-4xl font-semibold text-[#2f331d] leading-tight drop-shadow-sm">
                Sustainable Living, Ag Education, Conservation
              </h1>
              <p className="text-[#4b5133] text-sm leading-relaxed">
                Step into Wai &amp; Aina’s world of regenerative farming, joyful animals, and hands-on learning. 🌿 Explore the land, peek at our guides, and hop into the work dashboard when you’re signed in.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                {heroButton("Explore the Farm", "#about", true)}
                {heroButton("Open Guides", "/hub/guides/how-to")}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-white/70 bg-white/70 p-3 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#7a7f54]">Daily Flow</p>
                  <p className="font-semibold text-[#3b4224]">❤️ Community-first</p>
                </div>
                <div className="rounded-xl border border-white/70 bg-white/70 p-3 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#7a7f54]">Field Notes</p>
                  <p className="font-semibold text-[#3b4224]">✨ Guided &amp; playful</p>
                </div>
              </div>
            </div>
            <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-[#d0c9a4] bg-white/85 backdrop-blur">
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/20 to-white/70" />
              <div className="h-48 sm:h-64 bg-[url('https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1200&q=80')] bg-cover bg-center" />
              <div className="p-6 space-y-3 relative z-10">
                <p className="text-xs uppercase tracking-[0.22em] text-[#7a7f54]">Farm vibes</p>
                <p className="text-sm text-[#4b5133] leading-relaxed">
                  Fresh milk, happy goats, and a team that cares. We craft experiences that feel wholesome and a little bit magical—perfect for volunteers, friends, and curious visitors.
                </p>
                <Link href="#about" className="inline-flex items-center gap-2 text-sm font-semibold text-[#3b6e2c] underline underline-offset-4">
                  Meet the herd →
                </Link>
              </div>
            </div>
          </div>
        </section>

      {/* About */}
      <section id="about" className="max-w-6xl mx-auto px-4 sm:px-6 py-12 space-y-8">
        <div className="grid md:grid-cols-2 gap-8 items-start">
          <div className="space-y-4">
            <p className="text-xs uppercase tracking-[0.22em] text-[#7a7f54]">Just starting out…</p>
            <h2 className="text-3xl font-semibold text-[#3b4224]">Farm fresh produce</h2>
            <p className="text-sm text-[#4b5133] leading-relaxed">
              We grow papaya, dragonfruit, mango, ulu, coffee, cacao, lilikoi, starfruit, rollinia, lychee, and oranges. With a focus on regenerative agriculture and wildlife friendly practices, the farm will continue to expand with sustainable projects, agroforestry, and organic orchard spaces.
            </p>
            <p className="text-sm text-[#4b5133] leading-relaxed">
              Future projects include developing programs for sustainable meat, eggs, and vegetable sources for both internal and external demand.
            </p>
          </div>
          <div className="rounded-2xl border border-[#d0c9a4] bg-white shadow-md overflow-hidden">
            <div className="h-48 bg-[url('https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1200&q=80')] bg-cover bg-center" />
            <div className="p-6 space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[#7a7f54]">Get involved</p>
                <p className="text-sm text-[#4b5133] leading-relaxed">
                  Visit, volunteer, and learn alongside our team. We prioritize organic practices, thoughtful animal care, and collaborative stewardship of the land.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-sm font-semibold text-[#5d7f3b]">
                <span className="inline-flex items-center gap-2 rounded-full bg-[#eef2d9] px-3 py-1">🌿 Conservation</span>
                <span className="inline-flex items-center gap-2 rounded-full bg-[#eef2d9] px-3 py-1">🐄 Animal care</span>
                <span className="inline-flex items-center gap-2 rounded-full bg-[#eef2d9] px-3 py-1">📚 Education</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Farm information */}
      <section className="bg-[#f1edd8] py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-6">
          <div className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-[0.2em] text-[#7a7f54]">Farm information</p>
            <h3 className="text-2xl font-semibold text-[#3b4224]">Know your way around Wai &amp; Aina</h3>
            <p className="text-sm text-[#4b5133]">Maps, animal notes, and how-to guides to support every visitor.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              {
                title: "Animalpedia",
                description: "Care tips, feeding notes, and health checks for every animal friend.",
                href: "/hub/guides/animalpedia",
                icon: "🐾",
              },
              {
                title: "Farm Map",
                description: "Navigate paddocks, orchards, gardens, and key resources at a glance.",
                href: "/hub/guides/farm-map",
                icon: "🗺️",
              },
              {
                title: "Guides",
                description: "Step-by-step walkthroughs for tasks, safety, and daily routines.",
                href: "/hub/guides/how-to",
                icon: "📘",
              },
            ].map((item) => (
              <Link
                key={item.title}
                href={item.href}
                className="group rounded-2xl border border-[#d0c9a4] bg-white p-5 shadow-sm hover:-translate-y-0.5 transition"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{item.icon}</span>
                  <h4 className="text-lg font-semibold text-[#3b4224]">{item.title}</h4>
                </div>
                <p className="mt-3 text-sm text-[#4b5133] leading-relaxed">{item.description}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#5d7f3b] underline underline-offset-4">
                  Open {item.title} →
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Contact footer */}
      <footer className="bg-[#f1edd8] border-t border-[#d0c9a4] py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row md:items-center md:justify-between gap-6 text-sm text-[#4b5133]">
          <div className="space-y-1">
            <p>543 Kualono Pl</p>
            <p>Kapaa, HI 96746</p>
            <p>(808) 555-8884</p>
            <p>waiandaina@gmail.com</p>
          </div>
          <div className="flex flex-col items-start md:items-end gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-[#7a7f54]">Since 2023</span>
            <p className="text-lg font-semibold text-[#3b4224]">Wai &amp; Aina</p>
            <p className="text-xs text-[#7a7f54]">Sustainable living · Ag education · Conservation</p>
          </div>
        </div>
      </footer>

      {/* Login modal */}
      {showLogin && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="w-full max-w-lg rounded-2xl bg-[#f7f4e6] border border-[#d0c9a4] shadow-2xl overflow-hidden">
            <div className="bg-[#a0b764] text-white px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔐</span>
                <span className="text-sm font-semibold uppercase tracking-[0.18em]">Login</span>
              </div>
              <button
                onClick={() => setShowLogin(false)}
                className="rounded-full bg-white/20 px-2 py-1 text-xs hover:bg-white/30"
                aria-label="Close login"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleLogin} className="p-6 space-y-4 text-[#3b4224]">
              <div className="space-y-1">
                <label htmlFor="name" className="text-sm font-semibold text-[#4f5730]">
                  Select your name
                </label>
                <select
                  id="name"
                  value={selectedName}
                  onChange={(e) => setSelectedName(e.target.value)}
                  disabled={usersLoading || !!usersError || users.length === 0}
                  className="w-full rounded-md border border-[#c8cba0] bg-white px-4 py-3 text-sm font-medium text-[#3b4224] shadow-inner focus:outline-none focus:ring-2 focus:ring-[#8fae4c] focus:border-[#8fae4c] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {usersLoading && <option value="">Loading users...</option>}
                  {!usersLoading && usersError && <option value="">Error loading users</option>}
                  {!usersLoading && !usersError && users.length === 0 && (
                    <option value="">No users found</option>
                  )}
                  {!usersLoading && !usersError && users.length > 0 && (
                    <>
                      <option value="">Choose an option...</option>
                      {users.map((user) => (
                        <option key={user.name} value={user.name}>
                          {user.name}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="number" className="text-sm font-semibold text-[#4f5730]">
                  Or enter your number
                </label>
                <input
                  id="number"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  className="w-full rounded-md border border-[#c8cba0] bg-white px-4 py-3 text-sm font-medium text-[#3b4224] shadow-inner focus:outline-none focus:ring-2 focus:ring-[#8fae4c] focus:border-[#8fae4c]"
                  placeholder="Phone or member number"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="password" className="text-sm font-semibold text-[#4f5730]">
                  Passcode
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-[#c8cba0] bg-[#f1edd8] px-3 py-2 text-sm text-[#3b4224] shadow-inner focus:outline-none focus:ring-2 focus:ring-[#8fae4c] focus:border-[#8fae4c]"
                  placeholder="Enter your passcode"
                />
                <p className="text-[11px] text-[#7a7f54]">Your passcode is set by a site admin.</p>
              </div>

              {loginError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{loginError}</div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setShowLogin(false)}
                  className="rounded-full border border-[#c8cba0] bg-white px-4 py-2 text-sm font-semibold text-[#3b4224] hover:bg-[#f1edd8]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-full bg-[#a0b764] text-white px-5 py-2.5 text-sm font-semibold shadow hover:bg-[#8ba450] disabled:opacity-60"
                >
                  {isSubmitting ? "Signing in..." : "Login"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
