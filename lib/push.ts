import webpush from "web-push";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
};

type PushSubscriptionRow = {
  id: string;
  user_name: string | null;
  user_role: string | null;
  device_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type SendPushParams = {
  userNames?: string[];
  userRoles?: string[];
  roleContains?: string;
  excludeDeviceId?: string;
  excludeUserNames?: string[];
  payload: PushPayload;
};

let webPushConfigured = false;

function configureWebPush() {
  if (webPushConfigured) return true;
  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

  if (!publicKey || !privateKey) {
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  webPushConfigured = true;
  return true;
}

async function ensureVapidFromDatabase() {
  if (!isSupabaseConfigured()) return null;
  const rows = await supabaseRequest<any[]>("push_config", {
    query: {
      select: "public_key,private_key",
      order: "created_at.desc",
      limit: 1,
    },
  });
  const entry = rows?.[0];
  if (!entry?.public_key || !entry?.private_key) return null;
  return {
    publicKey: String(entry.public_key),
    privateKey: String(entry.private_key),
  };
}

function buildInFilter(values: string[]) {
  const escaped = values
    .map((value) => value.replace(/"/g, '""'))
    .map((value) => `"${value}"`)
    .join(",");
  return `in.(${escaped})`;
}

async function fetchSubscriptions(params: SendPushParams) {
  if (!isSupabaseConfigured()) return [];
  if (!configureWebPush()) {
    const stored = await ensureVapidFromDatabase();
    if (!stored) {
      console.warn("Missing VAPID keys; push notifications are disabled.");
      return [];
    }
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:admin@example.com",
      stored.publicKey,
      stored.privateKey
    );
    webPushConfigured = true;
  }

  const { userNames, userRoles, roleContains } = params;
  const query: Record<string, string> = {
    select: "id,user_name,user_role,device_id,endpoint,p256dh,auth",
  };

  if (userNames?.length) {
    query.user_name = buildInFilter(userNames);
  } else if (userRoles?.length) {
    query.user_role = buildInFilter(userRoles);
  } else if (roleContains) {
    query.user_role = `ilike.*${roleContains}*`;
  } else {
    return [];
  }

  return (
    (await supabaseRequest<PushSubscriptionRow[]>("push_subscriptions", {
      query,
    })) || []
  );
}

async function removeSubscription(id: string) {
  if (!isSupabaseConfigured()) return;
  await supabaseRequest("push_subscriptions", {
    method: "DELETE",
    query: { id: `eq.${id}` },
  });
}

export async function sendPushNotifications(params: SendPushParams) {
  const { excludeDeviceId, excludeUserNames, payload } = params;
  const subscriptions = await fetchSubscriptions(params);
  if (!subscriptions.length) return;

  let filtered = excludeDeviceId
    ? subscriptions.filter((sub) => sub.device_id !== excludeDeviceId)
    : subscriptions;
  if (excludeUserNames?.length) {
    const excludeSet = new Set(
      excludeUserNames.map((name) => name.trim().toLowerCase())
    );
    filtered = filtered.filter(
      (sub) => !excludeSet.has((sub.user_name || "").trim().toLowerCase())
    );
  }

  await Promise.all(
    filtered.map(async (subscription) => {
      const webPushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      };

      try {
        await webpush.sendNotification(
          webPushSubscription,
          JSON.stringify(payload)
        );
      } catch (err: any) {
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await removeSubscription(subscription.id);
          return;
        }
        console.error("Failed to send push notification", err);
      }
    })
  );
}
