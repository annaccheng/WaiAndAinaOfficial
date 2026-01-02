import { NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabase";


export async function POST(req: Request) {
  let body: { name?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { name, password, number } = body as {
    name?: string;
    number?: string;
    password?: string;
  };

  if ((!name && !number) || !password) {
    return NextResponse.json(
      { error: "Missing name or number, or password" },
      { status: 400 }
    );
  }

  try {
    const normalizedPass = password.trim();
    const normalizedName = name?.trim() ?? "";
    const normalizedNumber = number?.trim() ?? "";

    const queryFilter = normalizedName
      ? { display_name: `ilike.${normalizedName}` }
      : { phone_number: `eq.${normalizedNumber}` };

    const data = await supabaseRequest<any[]>("users", {
      query: {
        select: "id,display_name,passcode,phone_number,active,user_role:user_roles(name)",
        limit: 1,
        ...queryFilter,
      },
    });

    const user = data?.[0];
    if (!user || !user.active || user.passcode !== normalizedPass) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    await supabaseRequest("users", {
      method: "PATCH",
      query: { id: `eq.${user.id}` },
      body: { last_online: new Date().toISOString() },
    });

    return NextResponse.json({
      ok: true,
      name: user.display_name,
      userType: user.user_role?.name ?? null,
      userTypeColor: null,
    });
  } catch (err) {
    console.error("Login check failed:", err);
    return NextResponse.json(
      { error: "Failed to verify credentials" },
      { status: 500 }
    );
  }
}
