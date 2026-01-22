import { NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabase";

const DEFAULT_PASSCODE = "WAIANDAINA";

async function resolveRoleId(roleName?: string | null) {
  if (!roleName) return null;
  const data = await supabaseRequest<any[]>("user_roles", {
    query: { select: "id", name: `eq.${roleName}`, limit: 1 },
  });
  return data?.[0]?.id ?? null;
}

export async function GET() {
  try {
    const data = await supabaseRequest<any[]>("users", {
      query: {
        select:
          "id,display_name,phone_number,active,user_role:user_roles(name),user_capabilities:user_capabilities(capability:capabilities(id,name))",
        active: "eq.true",
        order: "display_name.asc",
      },
    });

    const users =
      data?.map((user) => ({
        id: user.id,
        name: user.display_name,
        number: user.phone_number ?? "",
        userType: user.user_role?.name ?? "",
        active: Boolean(user.active),
        capabilities: (user.user_capabilities || [])
          .map((entry: any) => entry.capability)
          .filter(Boolean),
      })) ?? [];

    return NextResponse.json({ users });
  } catch (err) {
    console.error("Failed to load users:", err);
    return NextResponse.json({ error: "Unable to load users" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { name, userType, number } = body || {};

  if (!name) {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  try {
    const roleId = await resolveRoleId(userType);
    const data = await supabaseRequest<any[]>("users", {
      method: "POST",
      prefer: "return=representation",
      query: { select: "id" },
      body: {
        display_name: name.trim(),
        user_role_id: roleId,
        phone_number: number?.trim() || null,
        passcode: DEFAULT_PASSCODE,
        active: true,
      },
    });

    return NextResponse.json({ success: true, id: data?.[0]?.id });
  } catch (err) {
    console.error("Failed to create user:", err);
    return NextResponse.json({ error: "Unable to create user" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const { id, userType, name, password, number, active, capabilityIds } = body || {};

  if (!id) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  try {
    const updates: Record<string, unknown> = {};
    const normalizedCapabilities = Array.isArray(capabilityIds)
      ? capabilityIds.map((capabilityId: string) => String(capabilityId)).filter(Boolean)
      : null;

    if (typeof name === "string") {
      updates.display_name = name.trim();
    }

    if (typeof number === "string") {
      updates.phone_number = number.trim() || null;
    }

    if (typeof password === "string" && password.trim()) {
      updates.passcode = password.trim();
    }

    if (userType !== undefined) {
      const roleId = await resolveRoleId(userType);
      updates.user_role_id = roleId;
    }

    if (typeof active === "boolean") {
      updates.active = active;
    }

    if (Object.keys(updates).length === 0) {
      if (normalizedCapabilities) {
        await supabaseRequest("user_capabilities", {
          method: "DELETE",
          query: { user_id: `eq.${id}` },
        });

        if (normalizedCapabilities.length) {
          await supabaseRequest("user_capabilities", {
            method: "POST",
            body: normalizedCapabilities.map((capabilityId) => ({
              user_id: id,
              capability_id: capabilityId,
            })),
          });
        }
      }

      return NextResponse.json({ success: true });
    }

    await supabaseRequest("users", {
      method: "PATCH",
      query: { id: `eq.${id}` },
      body: updates,
    });

    if (normalizedCapabilities) {
      await supabaseRequest("user_capabilities", {
        method: "DELETE",
        query: { user_id: `eq.${id}` },
      });

      if (normalizedCapabilities.length) {
        await supabaseRequest("user_capabilities", {
          method: "POST",
          body: normalizedCapabilities.map((capabilityId) => ({
            user_id: id,
            capability_id: capabilityId,
          })),
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to update user:", err);
    return NextResponse.json({ error: "Unable to update user" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const { id } = body || {};

  if (!id) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  try {
    await supabaseRequest("users", {
      method: "DELETE",
      query: { id: `eq.${id}` },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to delete user:", err);
    return NextResponse.json({ error: "Unable to delete user" }, { status: 500 });
  }
}
