type SupabaseRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  prefer?: string;
};

type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
};

function getSupabaseConfig(): SupabaseConfig {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return { url, serviceRoleKey };
}

function buildQuery(query?: SupabaseRequestOptions["query"]) {
  const params = new URLSearchParams();
  if (!query) return params;
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    params.set(key, String(value));
  });
  return params;
}

export async function supabaseRequest<T>(
  table: string,
  options: SupabaseRequestOptions = {}
) {
  const { url, serviceRoleKey } = getSupabaseConfig();
  const { method = "GET", query, body, prefer } = options;

  const params = buildQuery(query);
  const endpoint = new URL(`${url}/rest/v1/${table}`);
  if ([...params.keys()].length) {
    endpoint.search = params.toString();
  }

  const res = await fetch(endpoint.toString(), {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(text || `Supabase request failed with ${res.status}`);
  }

  if (!text) {
    return null as T;
  }

  return JSON.parse(text) as T;
}
