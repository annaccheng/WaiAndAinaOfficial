import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REQUIRED_ENV = [
  "SUPABASE_MANAGEMENT_TOKEN",
  "SUPABASE_PROJECT_REF",
] as const;

function getRequiredEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }

  return {
    token: process.env.SUPABASE_MANAGEMENT_TOKEN as string,
    projectRef: process.env.SUPABASE_PROJECT_REF as string,
  };
}

export async function POST() {
  try {
    const { token, projectRef } = getRequiredEnv();
    const schemaPath = path.join(process.cwd(), "supabase", "schema.sql");
    const sql = await readFile(schemaPath, "utf-8");

    const res = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: text || "Failed to apply schema" },
        { status: res.status }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Supabase bootstrap failed:", err);
    return NextResponse.json(
      { error: "Unable to apply schema" },
      { status: 500 }
    );
  }
}
