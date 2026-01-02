"use client";

import { useEffect, useState } from "react";
import { loadSession, saveSession } from "@/lib/session";

export default function HubSettingsPage() {
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);

  // form state
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [newName, setNewName] = useState("");

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [cacheStatus, setCacheStatus] = useState<string | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);

  // Load current user from session
  useEffect(() => {
    const session = loadSession();
    if (session?.name) {
      setCurrentUserName(session.name);
    }
  }, []);

  const passwordsMismatch =
    newPass.length > 0 && confirmPass.length > 0 && newPass !== confirmPass;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!currentUserName) {
      setFormError("You must be logged in to change settings.");
      return;
    }

    if (!currentPass) {
      setFormError("Please enter your current passcode.");
      return;
    }

    if (newPass && passwordsMismatch) {
      setFormError("New passcode and confirmation do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/user-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: currentUserName,
          currentPassword: currentPass,
          newPassword: newPass || null, // null → do not change
          newName: newName || null,
        }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          setFormError("Current passcode is incorrect.");
        } else {
          const data = await res.json().catch(() => null);
          setFormError(
            data?.error || "Unable to update settings. Please try again."
          );
        }
        return;
      }

      setFormSuccess("Settings updated.");
      setCurrentPass("");
      setNewPass("");
      setConfirmPass("");
      if (newName.trim().length > 0) {
        setCurrentUserName(newName.trim());
        const existing = loadSession();
        if (existing) {
          saveSession({ ...existing, name: newName.trim() });
        }
        setNewName("");
      }
    } catch (err) {
      console.error("Settings update failed:", err);
      setFormError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleClearCache() {
    setCacheStatus(null);
    setCacheBusy(true);

    try {
      if (typeof window === "undefined") return;

      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations.map((registration) => registration.unregister())
        );
      }

      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }

      setCacheStatus("Cache cleared. Reloading…");
      window.location.reload();
    } catch (err) {
      console.error("Failed to clear cached data:", err);
      setCacheStatus("Unable to clear cached data right now.");
    } finally {
      setCacheBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-[0.18em] uppercase text-[#5d7f3b]">
        Settings
      </h1>
      <p className="text-sm text-[#7a7f54]">
        Update your display name and passcode for your account.
      </p>

      <div className="mt-4 rounded-lg bg-[#d3d6b0] px-6 py-6 text-[#4f5730] text-sm shadow-sm border border-[#c8cba0]/70">
        {currentUserName && (
          <div className="mb-4 text-xs text-[#666242]">
            Logged in as{" "}
            <span className="font-semibold">{currentUserName}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Current passcode */}
          <div className="space-y-1.5">
            <label
              htmlFor="currentPass"
              className="block text-sm font-medium text-[#4f5730]"
            >
              Current passcode
            </label>
            <div className="relative">
              <input
                id="currentPass"
                type={showCurrent ? "text" : "password"}
                value={currentPass}
                onChange={(e) => setCurrentPass(e.target.value)}
                className="w-full rounded-md border border-[#c8cba0] bg-[#f1edd8] px-3 py-2 text-sm text-[#3b4224] shadow-inner focus:outline-none focus:ring-2 focus:ring-[#8fae4c] focus:border-[#8fae4c] pr-16"
                placeholder="Enter current passcode"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute inset-y-0 right-0 px-3 text-[11px] text-[#6b6b4a] hover:text-[#4f5730]"
              >
                {showCurrent ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {/* New passcode */}
          <div className="space-y-1.5">
            <label
              htmlFor="newPass"
              className="block text-sm font-medium text-[#4f5730]"
            >
              New passcode
            </label>
            <div className="relative">
              <input
                id="newPass"
                type={showNew ? "text" : "password"}
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                className="w-full rounded-md border border-[#c8cba0] bg-[#f1edd8] px-3 py-2 text-sm text-[#3b4224] shadow-inner focus:outline-none focus:ring-2 focus:ring-[#8fae4c] focus:border-[#8fae4c] pr-16"
                placeholder="Leave blank to keep current"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute inset-y-0 right-0 px-3 text-[11px] text-[#6b6b4a] hover:text-[#4f5730]"
              >
                {showNew ? "Hide" : "Show"}
              </button>
            </div>
            <p className="text-[11px] text-[#8e875d]">
              If you leave this empty, your passcode will not be changed.
            </p>
          </div>

          {/* Confirm new passcode */}
          <div className="space-y-1.5">
            <label
              htmlFor="confirmPass"
              className="block text-sm font-medium text-[#4f5730]"
            >
              Confirm new passcode
            </label>
            <div className="relative">
              <input
                id="confirmPass"
                type={showConfirm ? "text" : "password"}
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                className="w-full rounded-md border border-[#c8cba0] bg-[#f1edd8] px-3 py-2 text-sm text-[#3b4224] shadow-inner focus:outline-none focus:ring-2 focus:ring-[#8fae4c] focus:border-[#8fae4c] pr-16"
                placeholder="Re-enter new passcode"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute inset-y-0 right-0 px-3 text-[11px] text-[#6b6b4a] hover:text-[#4f5730]"
              >
                {showConfirm ? "Hide" : "Show"}
              </button>
            </div>
            {passwordsMismatch && (
              <p className="text-[11px] text-red-700">
                New passcode and confirmation do not match.
              </p>
            )}
          </div>

          {/* New display name */}
          <div className="space-y-1.5">
            <label
              htmlFor="newName"
              className="block text-sm font-medium text-[#4f5730]"
            >
              New display name
            </label>
            <input
              id="newName"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full rounded-md border border-[#c8cba0] bg-[#f1edd8] px-3 py-2 text-sm text-[#3b4224] shadow-inner focus:outline-none focus:ring-2 focus:ring-[#8fae4c] focus:border-[#8fae4c]"
              placeholder="Optional — leave blank to keep current"
            />
            <p className="text-[11px] text-[#8e875d]">
              Update your display name for the login list.
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-[#d0c9a4] bg-white/80 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6b6f4c]">
                  Cached data
                </p>
                <p className="text-[12px] text-[#6f754f]">
                  If the hub looks out of date, clear cached data to force a fresh reload.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={handleClearCache}
                disabled={cacheBusy}
                className="rounded-md border border-[#d0c9a4] bg-[#f1edd8] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#4f5730] shadow-sm hover:bg-[#e6dfc2] disabled:opacity-60"
              >
                {cacheBusy ? "Clearing…" : "Clear cached data"}
              </button>
              {cacheStatus && (
                <span className="text-[11px] text-[#6f754f]">{cacheStatus}</span>
              )}
            </div>
          </div>

          {/* Messages */}
          {formError && (
            <div className="rounded-md border border-red-500/80 bg-red-500/10 px-3 py-2 text-xs text-red-800">
              {formError}
            </div>
          )}
          {formSuccess && (
            <div className="rounded-md border border-[#8fae4c] bg-[#e2f0c8] px-3 py-2 text-xs text-[#476524]">
              {formSuccess}
            </div>
          )}

          {/* Submit */}
          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting || !currentUserName}
              className="rounded-md bg-[#a0b764] px-5 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#f9f9ec] shadow-md hover:bg-[#95ad5e] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
