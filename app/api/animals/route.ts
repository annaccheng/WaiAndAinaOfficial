import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    animals: [],
    filters: { types: [], genders: [] },
    hasMore: false,
    nextCursor: null,
  });
}
