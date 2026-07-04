"use client";

import { useRef, useState, useEffect } from "react";

const DAY_LABELS  = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES   = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type RecurrenceConfig = {
  recurring: boolean;
  recurrence_interval: number;
  recurrence_unit: string;       // 'day' | 'week' | 'month' | 'year'
  recurrence_days: number[];     // 0=Sun … 6=Sat, used when unit='week'
  recurrence_end_type: string;   // 'never' | 'on_date' | 'after_count'
  recurrence_until: string;
  recurrence_count: number | null;
};

export const DEFAULT_RECURRENCE: RecurrenceConfig = {
  recurring: false,
  recurrence_interval: 1,
  recurrence_unit: "week",
  recurrence_days: [],
  recurrence_end_type: "never",
  recurrence_until: "",
  recurrence_count: null,
};

type Preset = "none" | "daily" | "weekly" | "weekdays" | "monthly" | "annually" | "custom";

function sortedEqual(a: number[], b: number[]) {
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

function detectPreset(v: RecurrenceConfig): Preset {
  if (!v.recurring) return "none";
  const n = v.recurrence_interval;
  const u = v.recurrence_unit;
  const d = v.recurrence_days ?? [];
  if (u === "day"   && n === 1) return "daily";
  if (u === "week"  && n === 1 && sortedEqual(d, [1, 2, 3, 4, 5])) return "weekdays";
  if (u === "week"  && n === 1 && d.length === 1) return "weekly";
  if (u === "month" && n === 1) return "monthly";
  if (u === "year"  && n === 1) return "annually";
  return "custom";
}

function applyPreset(preset: Preset, baseDay: number, current: RecurrenceConfig): RecurrenceConfig {
  const ends = {
    recurrence_end_type: current.recurrence_end_type || "never",
    recurrence_until: current.recurrence_until || "",
    recurrence_count: current.recurrence_count ?? null,
  };
  const base = { ...current, ...ends, recurring: true, recurrence_interval: 1 };
  switch (preset) {
    case "none":
      return { ...current, recurring: false, recurrence_days: [], recurrence_end_type: "never", recurrence_until: "", recurrence_count: null };
    case "daily":
      return { ...base, recurrence_unit: "day", recurrence_days: [] };
    case "weekly":
      return { ...base, recurrence_unit: "week", recurrence_days: [baseDay] };
    case "weekdays":
      return { ...base, recurrence_unit: "week", recurrence_days: [1, 2, 3, 4, 5] };
    case "monthly":
      return { ...base, recurrence_unit: "month", recurrence_days: [] };
    case "annually":
      return { ...base, recurrence_unit: "year", recurrence_days: [] };
    case "custom":
      return {
        ...base,
        recurrence_unit: current.recurrence_unit || "week",
        recurrence_days: current.recurrence_days?.length ? current.recurrence_days : [baseDay],
      };
  }
}

export function recurrenceSummary(cfg: RecurrenceConfig): string {
  if (!cfg.recurring) return "One-off";
  const preset = detectPreset(cfg);
  const days = cfg.recurrence_days ?? [];
  switch (preset) {
    case "daily":    return "Daily";
    case "weekly":   return `Weekly on ${DAY_NAMES[days[0]] ?? ""}`;
    case "weekdays": return "Every weekday";
    case "monthly":  return "Monthly";
    case "annually": return "Annually";
    case "custom": {
      const n = cfg.recurrence_interval;
      const u = cfg.recurrence_unit;
      const plural = n !== 1 ? "s" : "";
      if (u === "week" && days.length > 0)
        return `Every${n > 1 ? ` ${n}` : ""} week${plural} on ${days.map(d => DAY_SHORT[d]).join("/")}`;
      return `Every ${n} ${u}${plural}`;
    }
    default: return "Recurring";
  }
}

type Props = {
  value: RecurrenceConfig;
  onChange: (next: RecurrenceConfig) => void;
  baseDay?: number;
};

export function RecurrenceSelector({ value, onChange, baseDay = new Date().getDay() }: Props) {
  // Track preset as state so "Custom…" stays visible even when the config would
  // otherwise snap back to a named preset (e.g. 1 week / 1 day = "weekly").
  const [preset, setPreset] = useState<Preset>(() => detectPreset(value));

  // When the parent swaps the value entirely (switching tasks in the editor),
  // re-derive the preset. The selfSet ref prevents our own onChange from
  // triggering this re-derivation.
  const selfSet = useRef(false);
  useEffect(() => {
    if (selfSet.current) { selfSet.current = false; return; }
    setPreset(detectPreset(value));
  }, [value]);

  function handlePresetChange(p: Preset) {
    setPreset(p);
    selfSet.current = true;
    onChange(applyPreset(p, baseDay, value));
  }

  function toggleDay(day: number) {
    const days = value.recurrence_days ?? [];
    const next = days.includes(day)
      ? days.filter(d => d !== day)
      : [...days, day].sort((a, b) => a - b);
    onChange({ ...value, recurrence_days: next.length ? next : days });
  }

  return (
    <div className="space-y-3">
      {/* Preset dropdown */}
      <select
        value={preset}
        onChange={e => handlePresetChange(e.target.value as Preset)}
        className="w-full rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-sm text-[#314123]"
      >
        <option value="none">Does not repeat</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly on {DAY_NAMES[baseDay]}</option>
        <option value="weekdays">Every weekday (Mon–Fri)</option>
        <option value="monthly">Monthly</option>
        <option value="annually">Annually</option>
        <option value="custom">Custom…</option>
      </select>

      {/* Custom fields */}
      {preset === "custom" && (
        <div className="rounded-lg border border-[#e2d7b5] bg-[#f9f6e7] p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-[#4b5133]">Repeat every</span>
            <input
              type="number"
              min={1}
              value={value.recurrence_interval}
              onChange={e => onChange({ ...value, recurrence_interval: Math.max(1, Number(e.target.value)) })}
              className="w-16 rounded-md border border-[#d0c9a4] px-2 py-1.5 text-sm text-center"
            />
            <select
              value={value.recurrence_unit}
              onChange={e =>
                onChange({
                  ...value,
                  recurrence_unit: e.target.value,
                  recurrence_days: e.target.value !== "week" ? [] : value.recurrence_days,
                })
              }
              className="rounded-md border border-[#d0c9a4] px-2 py-1.5 text-sm"
            >
              {["day", "week", "month", "year"].map(u => (
                <option key={u} value={u}>
                  {u}{value.recurrence_interval !== 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </div>

          {value.recurrence_unit === "week" && (
            <div>
              <p className="mb-2 text-xs font-medium text-[#6b6f4c]">Repeat on</p>
              <div className="flex gap-1.5">
                {DAY_LABELS.map((label, idx) => {
                  const selected = (value.recurrence_days ?? []).includes(idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => toggleDay(idx)}
                      className={`h-8 w-8 rounded-full text-xs font-semibold transition ${
                        selected
                          ? "bg-[#8fae4c] text-white"
                          : "border border-[#d0c9a4] bg-white text-[#4b5133]"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ends — shown for all recurring tasks */}
      {value.recurring && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#6b6f4c]">Ends</p>
          <div className="space-y-2">
            {(["never", "on_date", "after_count"] as const).map(opt => (
              <label key={opt} className="flex items-center gap-3 text-sm text-[#4b5133]">
                <input
                  type="radio"
                  checked={value.recurrence_end_type === opt}
                  onChange={() => onChange({ ...value, recurrence_end_type: opt })}
                  className="accent-[#8fae4c]"
                />
                <span className="w-14 shrink-0">
                  {opt === "never" ? "Never" : opt === "on_date" ? "On" : "After"}
                </span>
                {opt === "on_date" && (
                  <input
                    type="date"
                    value={value.recurrence_until || ""}
                    disabled={value.recurrence_end_type !== "on_date"}
                    onChange={e => onChange({ ...value, recurrence_until: e.target.value, recurrence_end_type: "on_date" })}
                    className="rounded-md border border-[#d0c9a4] px-2 py-1 text-sm disabled:opacity-40"
                  />
                )}
                {opt === "after_count" && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={value.recurrence_count ?? ""}
                      disabled={value.recurrence_end_type !== "after_count"}
                      onChange={e =>
                        onChange({ ...value, recurrence_count: Number(e.target.value) || null, recurrence_end_type: "after_count" })
                      }
                      className="w-16 rounded-md border border-[#d0c9a4] px-2 py-1 text-sm text-center disabled:opacity-40"
                    />
                    <span className="text-[#6b6d4b]">occurrences</span>
                  </div>
                )}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
