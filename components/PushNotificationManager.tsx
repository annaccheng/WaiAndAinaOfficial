"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getOrCreateDeviceId } from "@/lib/pushClient";

const HOMESCREEN_DISMISS_KEY = "waianda_homescreen_dismissed";
const NOTIFICATION_DISMISS_KEY = "waianda_notification_dismissed";

type PushNotificationManagerProps = {
  userName: string;
  userRole: string | null;
};

function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isAndroidDevice() {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent);
}

function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  return Boolean((navigator as any)?.standalone);
}

function supportsPush() {
  if (typeof window === "undefined") return false;
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function decodeBase64Url(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export function PushNotificationManager({
  userName,
  userRole,
}: PushNotificationManagerProps) {
  const [showHomescreenGuide, setShowHomescreenGuide] = useState(false);
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<NotificationPermission | "">("");
  const installed = useMemo(() => isStandaloneDisplay(), []);
  const ios = useMemo(() => isIosDevice(), []);
  const android = useMemo(() => isAndroidDevice(), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = localStorage.getItem(HOMESCREEN_DISMISS_KEY);
    if (!installed && !dismissed) {
      setShowHomescreenGuide(true);
    }
  }, [installed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!installed) return;
    if (!supportsPush()) return;
    const dismissed = localStorage.getItem(NOTIFICATION_DISMISS_KEY);
    const permission = Notification.permission;
    setPermissionState(permission);
    if (permission === "default" && !dismissed) {
      setShowNotificationPrompt(true);
    }
  }, [installed]);

  useEffect(() => {
    if (!supportsPush()) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed", err);
    });
  }, []);

  const subscribeForPush = useCallback(async () => {
    if (!supportsPush()) {
      setStatusMessage("Push notifications are not supported on this device.");
      return;
    }
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      setStatusMessage("Push notifications are not configured yet.");
      return;
    }
    if (!userName) {
      setStatusMessage("Log in to enable notifications.");
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      setPermissionState(permission);
      if (permission !== "granted") {
        setStatusMessage("Notifications were not enabled.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeBase64Url(publicKey),
        }));
      const deviceId = getOrCreateDeviceId();
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userName,
          userRole,
          deviceId,
          subscription: subscription.toJSON(),
        }),
      });
      setStatusMessage("Notifications are enabled.");
      setShowNotificationPrompt(false);
    } catch (err) {
      console.error("Failed to enable push notifications", err);
      setStatusMessage("Unable to enable notifications. Please try again.");
    }
  }, [userName, userRole]);

  useEffect(() => {
    if (!supportsPush()) return;
    if (!userName) return;
    if (!installed) return;
    if (Notification.permission !== "granted") return;
    const syncSubscription = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) return;
        const deviceId = getOrCreateDeviceId();
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userName,
            userRole,
            deviceId,
            subscription: subscription.toJSON(),
          }),
        });
      } catch (err) {
        console.error("Failed to sync push subscription", err);
      }
    };
    syncSubscription();
  }, [installed, userName, userRole]);

  const dismissHomescreenGuide = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(HOMESCREEN_DISMISS_KEY, "1");
    }
    setShowHomescreenGuide(false);
  };

  const dismissNotificationPrompt = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(NOTIFICATION_DISMISS_KEY, "1");
    }
    setShowNotificationPrompt(false);
  };

  return (
    <>
      {showHomescreenGuide && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-[#314123]">
              Add Wai &amp; Aina to your Home Screen
            </h2>
            <p className="mt-2 text-sm text-[#5b5f3f]">
              Install the web app so you can open it like a native app and receive push
              notifications.
            </p>
            <ol className="mt-3 space-y-2 text-sm text-[#4b5133]">
              {ios && (
                <>
                  <li>1. Tap the share icon in Safari.</li>
                  <li>2. Choose “Add to Home Screen.”</li>
                  <li>3. Open the app from the new Home Screen icon.</li>
                </>
              )}
              {android && (
                <>
                  <li>1. Tap the browser menu in Chrome.</li>
                  <li>2. Select “Add to Home screen.”</li>
                  <li>3. Open the app from your launcher.</li>
                </>
              )}
              {!ios && !android && (
                <>
                  <li>1. Open your browser menu or share panel.</li>
                  <li>2. Choose “Add to Home Screen.”</li>
                  <li>3. Launch the app from the new shortcut.</li>
                </>
              )}
            </ol>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={dismissHomescreenGuide}
                className="rounded-full border border-[#d0c9a4] px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#314123]"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {showNotificationPrompt && (
        <div className="fixed bottom-4 right-4 z-40 w-full max-w-sm rounded-2xl border border-[#d0c9a4] bg-white p-4 shadow-xl">
          <p className="text-sm font-semibold text-[#314123]">
            Enable schedule notifications?
          </p>
          <p className="mt-1 text-xs text-[#5b5f3f]">
            You opened the Home Screen app. Turn on notifications so we can alert you
            about schedule updates.
          </p>
          {statusMessage && (
            <p className="mt-2 text-xs text-[#6b7050]">{statusMessage}</p>
          )}
          {permissionState !== "granted" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={subscribeForPush}
                className="rounded-full bg-[#8fae4c] px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white"
              >
                Enable
              </button>
              <button
                type="button"
                onClick={dismissNotificationPrompt}
                className="rounded-full border border-[#d0c9a4] px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#314123]"
              >
                Not now
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
