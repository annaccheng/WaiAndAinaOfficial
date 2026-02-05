import { NextResponse } from "next/server";
import { sendPushNotifications } from "@/lib/push";

export async function POST() {
  try {
    await sendPushNotifications({
      roleContains: "volunteer",
      payload: {
        title: "Task status reminder",
        body: "Reminder to update all your task statuses.",
        url: "/hub",
        tag: "task-reminder",
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to send reminder notification", err);
    return NextResponse.json(
      { error: "Unable to send reminder notification" },
      { status: 500 }
    );
  }
}
