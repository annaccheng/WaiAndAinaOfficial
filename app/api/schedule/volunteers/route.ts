import { NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabase";

type UserRow = {
  display_name: string;
  active: boolean;
  user_role?: { name?: string | null };
};

export async function GET() {
  try {
    const users = await supabaseRequest<UserRow[]>("users", {
      query: {
        select: "display_name,active,user_role:user_roles(name)",
        order: "display_name.asc",
      },
    });
    const volunteers =
      users
        ?.filter(
          (user) =>
            user.active &&
            (user.user_role?.name || "")
              .toLowerCase()
              .includes("volunteer")
        )
        .map((user) => user.display_name) || [];

    return NextResponse.json({ volunteers });
  } catch (err) {
    console.error("Failed to load volunteers", err);
    return NextResponse.json(
      { error: "Unable to load volunteers" },
      { status: 500 }
    );
  }
}
