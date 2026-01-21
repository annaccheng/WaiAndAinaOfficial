import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

function buildRangeFilter(start?: string, end?: string) {
  if (!start && !end) return {};
  const filter: Record<string, string> = {};
  if (start) filter.occurrence_date = `gte.${start}`;
  if (end) filter.occurrence_date = `lte.${end}`;
  return filter;
}

function normalizeCapabilityIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((id) => String(id)).filter(Boolean);
}

async function syncTaskCapabilities(taskIds: string[], capabilityIds: string[]) {
  if (!taskIds.length) return;

  const uniqueTaskIds = Array.from(new Set(taskIds));
  const uniqueCapabilityIds = Array.from(new Set(capabilityIds));

  await supabaseRequest("task_capabilities", {
    method: "DELETE",
    query: { task_id: `in.(${uniqueTaskIds.join(",")})` },
  });

  if (!uniqueCapabilityIds.length) return;

  await supabaseRequest("task_capabilities", {
    method: "POST",
    body: uniqueCapabilityIds.flatMap((capabilityId) =>
      uniqueTaskIds.map((taskId) => ({
        task_id: taskId,
        capability_id: capabilityId,
      }))
    ),
  });
}

export async function GET(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { tasks: [], error: "Supabase is not configured for tasks yet." },
      { status: 503 }
    );
  }
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "";
  const type = searchParams.get("type") || "";
  const priority = searchParams.get("priority") || "";
  const recurring = searchParams.get("recurring") || "";
  const search = searchParams.get("search") || "";
  const start = searchParams.get("start") || "";
  const end = searchParams.get("end") || "";
  const includeOccurrences = searchParams.get("includeOccurrences") !== "false";

  const query: Record<string, string> = {
    select:
      "id,name,description,status,priority,estimated_time,recurring,recurrence_interval,recurrence_unit,recurrence_until,origin_date,occurrence_date,parent_task_id,person_count,links,comments,photos,time_slots,extra_notes,task_type:task_types(id,name,color),task_capabilities:task_capabilities(capability:capabilities(id,name))",
    order: "created_at.desc",
    ...buildRangeFilter(start, end),
  };

  if (status) query.status = `eq.${status}`;
  if (priority) query.priority = `eq.${priority}`;
  if (type) query["task_type_id"] = `eq.${type}`;
  if (recurring) query.recurring = `eq.${recurring === "true" ? "true" : "false"}`;
  if (search) query.name = `ilike.%${search}%`;
  if (!includeOccurrences) query.parent_task_id = "is.null";

  try {
    const data = await supabaseRequest<any[]>("tasks", { query });
    const tasks =
      data?.map((task) => ({
        ...task,
        capabilities: (task.task_capabilities || [])
          .map((entry: any) => entry.capability)
          .filter(Boolean),
      })) ?? [];
    return NextResponse.json({ tasks });
  } catch (err: any) {
    const message = String(err?.message || "");
    if (message.includes("comments")) {
      const fallbackQuery = { ...query };
      fallbackQuery.select = fallbackQuery.select.replace(",comments", "");
      try {
        const data = await supabaseRequest<any[]>("tasks", { query: fallbackQuery });
        const tasks =
          data?.map((task) => ({
            ...task,
            capabilities: (task.task_capabilities || [])
              .map((entry: any) => entry.capability)
              .filter(Boolean),
          })) ?? [];
        return NextResponse.json({ tasks });
      } catch (fallbackErr) {
        console.error("Failed to load tasks (fallback):", fallbackErr);
      }
    }
    console.error("Failed to load tasks:", err);
    return NextResponse.json({ tasks: [] });
  }
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for tasks yet." },
      { status: 503 }
    );
  }
  const body = await req.json().catch(() => null);
  if (!body?.name) {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  try {
    const capabilityIds = normalizeCapabilityIds(body?.capabilityIds);
    const DEFAULT_OCCURRENCE_SPAN_DAYS = 90;
    const isRecurring = Boolean(body.recurring);
    const fallbackDate = new Date().toISOString().slice(0, 10);
    const originDate = body.origin_date || body.occurrence_date || fallbackDate;
    const interval = Number(body.recurrence_interval || 1);
    const unit = body.recurrence_unit || "day";
    const until = body.recurrence_until;
    const sanitizedBody = { ...body };
    delete (sanitizedBody as Record<string, unknown>).capabilityIds;

    const buildPayload = (payloadBody: Record<string, unknown>) => ({
      ...payloadBody,
      origin_date: originDate,
      occurrence_date: originDate,
      recurring: isRecurring,
    });

    const createOccurrences = async (parentId: string, payloadBody: Record<string, unknown>) => {
      if (!isRecurring || !originDate || interval <= 0 || !unit) return;
      const occurrences: Record<string, unknown>[] = [];
      const startDate = new Date(originDate);
      const endDate = until
        ? new Date(until)
        : new Date(
            startDate.getFullYear(),
            startDate.getMonth(),
            startDate.getDate() + DEFAULT_OCCURRENCE_SPAN_DAYS
          );
      const nextDate = new Date(startDate);

      while (true) {
        if (unit === "day") {
          nextDate.setDate(nextDate.getDate() + interval);
        } else if (unit === "month") {
          nextDate.setMonth(nextDate.getMonth() + interval);
        } else if (unit === "year") {
          nextDate.setFullYear(nextDate.getFullYear() + interval);
        }

        if (nextDate > endDate) break;

        occurrences.push({
          ...payloadBody,
          origin_date: originDate,
          occurrence_date: nextDate.toISOString().slice(0, 10),
          parent_task_id: parentId,
          recurring: true,
        });
      }

      if (occurrences.length) {
        await supabaseRequest("tasks", {
          method: "POST",
          prefer: "return=minimal",
          body: occurrences,
        });
      }
    };

    const payload = buildPayload(sanitizedBody);
    const [parent] = await supabaseRequest<any[]>("tasks", {
      method: "POST",
      prefer: "return=representation",
      query: { select: "*" },
      body: payload,
    });

    if (parent?.id) {
      await createOccurrences(parent.id, sanitizedBody);
      if (capabilityIds.length) {
        const seriesTasks = await supabaseRequest<any[]>("tasks", {
          query: {
            select: "id",
            or: `id.eq.${parent.id},parent_task_id.eq.${parent.id}`,
          },
        });
        const taskIds = (seriesTasks || []).map((task) => task.id).filter(Boolean);
        await syncTaskCapabilities(taskIds.length ? taskIds : [parent.id], capabilityIds);
      }
    }

    return NextResponse.json({ task: parent });
  } catch (err: any) {
    const message = String(err?.message || "");
    if (message.includes("comments")) {
      try {
        const fallbackBody = { ...body };
        delete (fallbackBody as Record<string, unknown>).capabilityIds;
        delete fallbackBody.comments;
        const DEFAULT_OCCURRENCE_SPAN_DAYS = 90;
        const capabilityIds = normalizeCapabilityIds(body?.capabilityIds);
        const isRecurring = Boolean(fallbackBody.recurring);
        const fallbackDate = new Date().toISOString().slice(0, 10);
        const originDate =
          (fallbackBody.origin_date as string) ||
          (fallbackBody.occurrence_date as string) ||
          fallbackDate;
        const interval = Number(fallbackBody.recurrence_interval || 1);
        const unit = (fallbackBody.recurrence_unit as string) || "day";
        const until = fallbackBody.recurrence_until as string | undefined;
        const createOccurrences = async (parentId: string) => {
          if (!isRecurring || !originDate || interval <= 0 || !unit) return;
          const occurrences: Record<string, unknown>[] = [];
          const startDate = new Date(originDate);
          const endDate = until
            ? new Date(until)
            : new Date(
                startDate.getFullYear(),
                startDate.getMonth(),
                startDate.getDate() + DEFAULT_OCCURRENCE_SPAN_DAYS
              );
          const nextDate = new Date(startDate);

          while (true) {
            if (unit === "day") {
              nextDate.setDate(nextDate.getDate() + interval);
            } else if (unit === "month") {
              nextDate.setMonth(nextDate.getMonth() + interval);
            } else if (unit === "year") {
              nextDate.setFullYear(nextDate.getFullYear() + interval);
            }

            if (nextDate > endDate) break;

            occurrences.push({
              ...fallbackBody,
              origin_date: originDate,
              occurrence_date: nextDate.toISOString().slice(0, 10),
              parent_task_id: parentId,
              recurring: true,
            });
          }

          if (occurrences.length) {
            await supabaseRequest("tasks", {
              method: "POST",
              prefer: "return=minimal",
              body: occurrences,
            });
          }
        };
        const [parent] = await supabaseRequest<any[]>("tasks", {
          method: "POST",
          prefer: "return=representation",
          query: { select: "*" },
          body: {
            ...fallbackBody,
            origin_date: originDate,
            occurrence_date: originDate,
            recurring: isRecurring,
          },
        });
        if (parent?.id) {
          await createOccurrences(parent.id);
          if (capabilityIds.length) {
            const seriesTasks = await supabaseRequest<any[]>("tasks", {
              query: {
                select: "id",
                or: `id.eq.${parent.id},parent_task_id.eq.${parent.id}`,
              },
            });
            const taskIds = (seriesTasks || []).map((task) => task.id).filter(Boolean);
            await syncTaskCapabilities(taskIds.length ? taskIds : [parent.id], capabilityIds);
          }
        }
        return NextResponse.json({ task: parent });
      } catch (fallbackErr) {
        console.error("Failed to create task (fallback):", fallbackErr);
      }
    }
    console.error("Failed to create task:", err);
    return NextResponse.json({ error: "Unable to create task" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for tasks yet." },
      { status: 503 }
    );
  }
  const body = await req.json().catch(() => null);
  const { id, applyTo = "single", occurrenceDate, deleteOccurrences, capabilityIds } = body || {};

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const updates = { ...body };
  delete updates.id;
  delete updates.applyTo;
  delete updates.occurrenceDate;
  delete updates.deleteOccurrences;
  delete (updates as Record<string, unknown>).capabilityIds;
  const normalizedCapabilities = Array.isArray(capabilityIds)
    ? normalizeCapabilityIds(capabilityIds)
    : null;

  const applyUpdates = async (query: Record<string, string>) => {
    try {
      await supabaseRequest("tasks", {
        method: "PATCH",
        query,
        body: updates,
      });
    } catch (err: any) {
      const message = String(err?.message || "");
      if (message.includes("comments")) {
        const fallbackUpdates = { ...updates };
        delete (fallbackUpdates as Record<string, unknown>).comments;
        await supabaseRequest("tasks", {
          method: "PATCH",
          query,
          body: fallbackUpdates,
        });
      } else {
        throw err;
      }
    }
  };

  try {
    if (applyTo === "single") {
      await applyUpdates({ id: `eq.${id}` });

      if (updates.recurring === false && deleteOccurrences) {
        await supabaseRequest("tasks", {
          method: "DELETE",
          query: { parent_task_id: `eq.${id}` },
        });
      }

      if (normalizedCapabilities) {
        await syncTaskCapabilities([id], normalizedCapabilities);
      }

      return NextResponse.json({ ok: true });
    }

    const seriesData = await supabaseRequest<any[]>("tasks", {
      query: { select: "id,parent_task_id,occurrence_date,origin_date", id: `eq.${id}`, limit: 1 },
    });
    const target = seriesData?.[0];
    if (!target) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const seriesRoot = target.parent_task_id || target.id;
    const compareDate = occurrenceDate || target.occurrence_date || target.origin_date;
    if (applyTo === "future" && !compareDate) {
      return NextResponse.json(
        { error: "Missing occurrence date for future edits." },
        { status: 400 }
      );
    }

    const occurrenceFilters: Record<string, string> = {
      parent_task_id: `eq.${seriesRoot}`,
    };
    if (applyTo === "future" && compareDate) {
      occurrenceFilters.occurrence_date = `gte.${compareDate}`;
    }

    await applyUpdates({ id: `eq.${seriesRoot}` });
    await applyUpdates(occurrenceFilters);

    if (updates.recurring === false && deleteOccurrences) {
      const deleteFilters: Record<string, string> = {};
      if (applyTo === "all") {
        deleteFilters.or = `id.eq.${seriesRoot},parent_task_id.eq.${seriesRoot}`;
      } else {
        deleteFilters.parent_task_id = `eq.${seriesRoot}`;
        if (applyTo === "future" && compareDate) {
          deleteFilters.occurrence_date = `gte.${compareDate}`;
        }
      }

      await supabaseRequest("tasks", {
        method: "DELETE",
        query: deleteFilters,
      });
    }

    if (normalizedCapabilities) {
      const occurrenceQuery: Record<string, string> = {
        select: "id",
        parent_task_id: `eq.${seriesRoot}`,
      };
      if (applyTo === "future" && compareDate) {
        occurrenceQuery.occurrence_date = `gte.${compareDate}`;
      }
      const occurrences = await supabaseRequest<any[]>("tasks", {
        query: occurrenceQuery,
      });
      const taskIds = Array.from(
        new Set(
          [seriesRoot, ...(occurrences || []).map((task) => task.id)].filter(Boolean)
        )
      );
      await syncTaskCapabilities(taskIds, normalizedCapabilities);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update task:", err);
    return NextResponse.json({ error: "Unable to update task" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured for tasks yet." },
      { status: 503 }
    );
  }
  const body = await req.json().catch(() => null);
  const url = new URL(req.url);
  const id = body?.id || url.searchParams.get("id");
  const applyTo = body?.applyTo || url.searchParams.get("applyTo") || "single";
  const occurrenceDate =
    body?.occurrenceDate || url.searchParams.get("occurrenceDate");

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    if (applyTo === "single") {
      await supabaseRequest("tasks", {
        method: "DELETE",
        query: { id: `eq.${id}` },
      });
      return NextResponse.json({ ok: true });
    }

    const seriesData = await supabaseRequest<any[]>("tasks", {
      query: {
        select: "id,parent_task_id,occurrence_date,origin_date",
        id: `eq.${id}`,
        limit: 1,
      },
    });
    const target = seriesData?.[0];
    if (!target) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const seriesRoot = target.parent_task_id || target.id;
    const compareDate =
      occurrenceDate || target.occurrence_date || target.origin_date;

    if (applyTo === "future" && !compareDate) {
      return NextResponse.json(
        { error: "Missing occurrence date for future deletes." },
        { status: 400 }
      );
    }

    const occurrenceFilters: Record<string, string> = {
      parent_task_id: `eq.${seriesRoot}`,
    };
    if (applyTo === "future" && compareDate) {
      occurrenceFilters.occurrence_date = `gte.${compareDate}`;
    }

    await supabaseRequest("tasks", {
      method: "DELETE",
      query: occurrenceFilters,
    });

    if (
      applyTo === "all" ||
      (applyTo === "future" &&
        compareDate &&
        target.occurrence_date &&
        compareDate <= target.occurrence_date)
    ) {
      await supabaseRequest("tasks", {
        method: "DELETE",
        query: { id: `eq.${seriesRoot}` },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete task:", err);
    return NextResponse.json({ error: "Unable to delete task" }, { status: 500 });
  }
}
