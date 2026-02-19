import { NextResponse } from "next/server";

const REQUEST_TYPES = [
  { name: "App Request", color: "blue" },
  { name: "Item Request", color: "green" },
  { name: "Task Request", color: "orange" },
  { name: "Other", color: "gray" },
];

const STATUSES = [
  { name: "In Progress", color: "yellow" },
  { name: "Approved", color: "green" },
  { name: "Denied", color: "red" },
];

export async function GET() {
  return NextResponse.json({ requestTypes: REQUEST_TYPES, statuses: STATUSES });
}
