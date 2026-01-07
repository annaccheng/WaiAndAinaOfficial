import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseRequest } from "@/lib/supabase";

function buildRangeFilter(start?: string, end?: string) {
  if (!start && !end) return {};
  const filter: Record<string, string> = {};
  if (start) filter.occurrence_date = `gte.${start}`;
  if (end) filter.occurrence_date = `lte.${end}`;
  return filter;
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
      "id,name,description,status,priority,estimated_time,recurring,recurrence_interval,recurrence_unit,recurrence_until,origin_date,occurrence_date,parent_task_id,person_count,links,comments,photos,time_slots,extra_notes,task_type:task_types(id,name,color)",
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
    return NextResponse.json({ tasks: data || [] });
  } catch (err: any) {
    const message = String(err?.message || "");
    if (message.includes("comments")) {
      const fallbackQuery = { ...query };
      fallbackQuery.select = fallbackQuery.select.replace(",comments", "");
      try {
        const data = await supabaseRequest<any[]>("tasks", { query: fallbackQuery });
        return NextResponse.json({ tasks: data || [] });
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
    const DEFAULT_OCCURRENCE_SPAN_DAYS = 90;
    const isRecurring = Boolean(body.recurring);
    const fallbackDate = new Date().toISOString().slice(0, 10);
    const originDate = body.origin_date || body.occurrence_date || fallbackDate;
    const interval = Number(body.recurrence_interval || 1);
    const unit = body.recurrence_unit || "day";
    const until = body.recurrence_until;

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

    const payload = buildPayload(body);
    const [parent] = await supabaseRequest<any[]>("tasks", {
      method: "POST",
      prefer: "return=representation",
      query: { select: "*" },
      body: payload,
    });

    if (parent?.id) {
      await createOccurrences(parent.id, body);
    }

    return NextResponse.json({ task: parent });
  } catch (err: any) {
    const message = String(err?.message || "");
    if (message.includes("comments")) {
      try {
        const fallbackBody = { ...body };
        delete fallbackBody.comments;
        const DEFAULT_OCCURRENCE_SPAN_DAYS = 90;
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
  const { id, applyTo = "single", occurrenceDate, deleteOccurrences } = body || {};

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const updates = { ...body };
  delete updates.id;
  delete updates.applyTo;
  delete updates.occurrenceDate;
  delete updates.deleteOccurrences;

  try {
    if (applyTo === "single") {
    try {
      await supabaseRequest("tasks", {
        method: "PATCH",
        query: { id: `eq.${id}` },
        body: updates,
      });
    } catch (err: any) {
      const message = String(err?.message || "");
      if (message.includes("comments")) {
        const fallbackUpdates = { ...updates };
        delete (fallbackUpdates as Record<string, unknown>).comments;
        await supabaseRequest("tasks", {
          method: "PATCH",
          query: { id: `eq.${id}` },
          body: fallbackUpdates,
        });
      } else {
        throw err;
      }
    }

      if (updates.recurring === false && deleteOccurrences) {
        await supabaseRequest("tasks", {
          method: "DELETE",
          query: { parent_task_id: `eq.${id}` },
        });
      }

      return NextResponse.json({ ok: true });
    }

    const seriesData = await supabaseRequest<any[]>("tasks", {
      query: { select: "id,parent_task_id,occurrence_date", id: `eq.${id}`, limit: 1 },
    });
    const target = seriesData?.[0];
    if (!target) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const seriesRoot = target.parent_task_id || target.id;
    const compareDate = occurrenceDate || target.occurrence_date;

    const filters: Record<string, string> = {};
    if (applyTo === "all") {
      filters.or = `id.eq.${seriesRoot},parent_task_id.eq.${seriesRoot}`;
    } else if (applyTo === "future") {
      filters.or = `id.eq.${seriesRoot},parent_task_id.eq.${seriesRoot}`;
      if (compareDate) {
        filters.occurrence_date = `gte.${compareDate}`;
      }
    } else {
      filters.id = `eq.${id}`;
    }

    try {
      await supabaseRequest("tasks", {
        method: "PATCH",
        query: filters,
        body: updates,
      });
    } catch (err: any) {
      const message = String(err?.message || "");
      if (message.includes("comments")) {
        const fallbackUpdates = { ...updates };
        delete (fallbackUpdates as Record<string, unknown>).comments;
        await supabaseRequest("tasks", {
          method: "PATCH",
          query: filters,
          body: fallbackUpdates,
        });
      } else {
        throw err;
      }
    }

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
  const { id, applyTo = "single", occurrenceDate } = body || {};

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
      query: { select: "id,parent_task_id,occurrence_date", id: `eq.${id}`, limit: 1 },
    });
    const target = seriesData?.[0];
    if (!target) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const seriesRoot = target.parent_task_id || target.id;
    const compareDate = occurrenceDate || target.occurrence_date;

    const filters: Record<string, string> = {};
    if (applyTo === "all") {
      filters.or = `id.eq.${seriesRoot},parent_task_id.eq.${seriesRoot}`;
    } else {
      filters.parent_task_id = `eq.${seriesRoot}`;
      if (compareDate) {
        filters.occurrence_date = `gte.${compareDate}`;
      }
    }

    await supabaseRequest("tasks", {
      method: "DELETE",
      query: filters,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete task:", err);
    return NextResponse.json({ error: "Unable to delete task" }, { status: 500 });
  }
}
