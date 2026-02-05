import { NextResponse } from "next/server";
import { sendPushNotifications } from "@/lib/push";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { authorName, tasks, comments } = body || {};

  if (!authorName) {
    return NextResponse.json(
      { error: "Missing author name." },
      { status: 400 }
    );
  }

  const taskList = Array.isArray(tasks)
    ? tasks.map((task) => String(task).trim()).filter(Boolean)
    : String(tasks || "")
        .split(",")
        .map((task) => task.trim())
        .filter(Boolean);
  const notes = String(comments || "").trim();

  if (!taskList.length && !notes) {
    return NextResponse.json(
      { error: "Missing updates to share." },
      { status: 400 }
    );
  }

  const taskSummary = taskList.length ? taskList.join(", ") : "Shared updates.";
  const bodyText = notes
    ? `Update from ${authorName}: ${taskSummary}. Notes: ${notes}`
    : `Update from ${authorName}: ${taskSummary}.`;

  try {
    await Promise.all([
      sendPushNotifications({
        roleContains: "volunteer",
        excludeUserNames: [authorName],
        payload: {
          title: "Volunteer update",
          body: bodyText,
          url: "/hub",
          tag: "end-of-day-update",
        },
      }),
      sendPushNotifications({
        userRoles: ["Admin"],
        excludeUserNames: [authorName],
        payload: {
          title: "Volunteer update",
          body: bodyText,
          url: "/hub/admin/schedule",
          tag: "end-of-day-update",
        },
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to send end of day update", err);
    return NextResponse.json(
      { error: "Unable to send end of day update." },
      { status: 500 }
    );
  }
}
