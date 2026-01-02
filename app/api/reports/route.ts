import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const list = searchParams.get("list");
  const id = searchParams.get("id");

  if (list) {
    return NextResponse.json({ reports: [] });
  }

  if (id) {
    return NextResponse.json({ blocks: [] });
  }

  return NextResponse.json({ reports: [] });
}

export async function POST() {
  return NextResponse.json({ ok: true });
}
