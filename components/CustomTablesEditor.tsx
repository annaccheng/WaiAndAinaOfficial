"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type CustomTable = {
  id: string;
  title: string;
  scheduleDate?: string;
  visibleStart?: string | null;
  visibleEnd?: string | null;
  columnHeaders: string[];
  rowHeaders: string[];
  cells: string[][];
  rowHeaderType: "user" | "task" | "text";
  columnHeaderType: "user" | "task" | "text";
  cellType: "user" | "task" | "text";
};

type DraggingAxis = { tableId: string; index: number } | null;

type CustomTablesEditorProps = {
  dateLabel: string | null;
  canEdit: boolean;
  userOptions: string[];
  taskNameOptions: string[];
  currentUserName?: string | null;
};

type MultiSelectChecklistProps = {
  value: string;
  options: string[];
  placeholder: string;
  onChange: (nextValue: string) => void;
};

const parseMultiValue = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const formatMultiValue = (values: string[]) => values.join(", ");

function MultiSelectChecklist({ value, options, placeholder, onChange }: MultiSelectChecklistProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const selectedValues = useMemo(() => new Set(parseMultiValue(value)), [value]);
  const filteredOptions = useMemo(() => {
    const lower = filter.trim().toLowerCase();
    if (!lower) return options;
    return options.filter((opt) => opt.toLowerCase().includes(lower));
  }, [filter, options]);

  const toggleValue = (option: string) => {
    const next = new Set(selectedValues);
    if (next.has(option)) {
      next.delete(option);
    } else {
      next.add(option);
    }
    onChange(formatMultiValue(Array.from(next)));
  };

  const handleAddCustom = () => {
    const trimmed = filter.trim();
    if (!trimmed) return;
    const next = new Set(selectedValues);
    next.add(trimmed);
    onChange(formatMultiValue(Array.from(next)));
    setFilter("");
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full rounded-md border border-[#d0c9a4] bg-white/90 px-2 py-1 text-left text-[11px] font-semibold text-[#3b4224]"
      >
        {value || placeholder}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-56 rounded-md border border-[#d0c9a4] bg-white p-2 shadow-lg">
          <div className="flex gap-1">
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAddCustom();
                }
              }}
              placeholder="Search or add..."
              className="w-full rounded-md border border-[#d0c9a4] px-2 py-1 text-[11px]"
            />
            <button
              type="button"
              onClick={handleAddCustom}
              className="rounded-md border border-[#d0c9a4] bg-[#f7f4e5] px-2 text-[11px] font-semibold text-[#4b5133]"
            >
              +
            </button>
          </div>
          <div className="mt-2 max-h-40 overflow-y-auto space-y-1 text-[11px]">
            {filteredOptions.length ? (
              filteredOptions.map((option) => (
                <label key={option} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedValues.has(option)}
                    onChange={() => toggleValue(option)}
                  />
                  <span>{option}</span>
                </label>
              ))
            ) : (
              <p className="text-[#7a7f54]">No matches.</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-2 w-full rounded-md border border-[#d0c9a4] bg-[#f7f4e5] px-2 py-1 text-[11px] font-semibold text-[#4b5133]"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function toIsoDateLabel(dateLabel?: string | null) {
  if (!dateLabel) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateLabel)) return dateLabel;
  if (!dateLabel.includes("/")) return null;
  const [month, day, year] = dateLabel.split("/");
  if (!month || !day || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function reorderList<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return list;
  const next = [...list];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function CustomTablesEditor({
  dateLabel,
  canEdit,
  userOptions,
  taskNameOptions,
  currentUserName,
}: CustomTablesEditorProps) {
  const [customTables, setCustomTables] = useState<CustomTable[]>([]);
  const [customTablesLoading, setCustomTablesLoading] = useState(false);
  const [customTablesError, setCustomTablesError] = useState<string | null>(null);
  const [customTablesDirty, setCustomTablesDirty] = useState<Record<string, boolean>>({});
  const [customTablesSaving, setCustomTablesSaving] = useState<Record<string, boolean>>({});
  const [customTablesDeleting, setCustomTablesDeleting] = useState<string | null>(null);
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null);
  const [draggingColumn, setDraggingColumn] = useState<DraggingAxis>(null);
  const [draggingRow, setDraggingRow] = useState<DraggingAxis>(null);

  const headerTypeOptions = [
    { value: "user", label: "User" },
    { value: "task", label: "Task" },
    { value: "text", label: "Custom text" },
  ] as const;

  const scheduleDateIso = useMemo(
    () => (dateLabel ? toIsoDateLabel(dateLabel) || dateLabel : ""),
    [dateLabel]
  );

  const normalizeCustomTable = useCallback((table: any): CustomTable => {
    const columnHeaders = Array.isArray(table?.columnHeaders)
      ? table.columnHeaders
      : Array.isArray(table?.column_headers)
        ? table.column_headers
        : [];
    const rowHeaders = Array.isArray(table?.rowHeaders)
      ? table.rowHeaders
      : Array.isArray(table?.row_headers)
        ? table.row_headers
        : [];
    const rawCells = Array.isArray(table?.cells) ? table.cells : [];
    const sanitizedColumns = columnHeaders.map((value: any) => String(value ?? ""));
    const sanitizedRows = rowHeaders.map((value: any) => String(value ?? ""));
    const normalizedCells = sanitizedRows.map((_label: string, rowIdx: number) => {
      const row = Array.isArray(rawCells[rowIdx]) ? rawCells[rowIdx] : [];
      return sanitizedColumns.map((_header: string, colIdx: number) => String(row[colIdx] ?? ""));
    });
    const hasVisibilityDates =
      table?.visibleStart !== undefined ||
      table?.visibleEnd !== undefined ||
      table?.visible_start_date !== undefined ||
      table?.visible_end_date !== undefined;
    const fallbackDate = String(table?.scheduleDate ?? table?.schedule_date ?? "");
    const visibleStart = hasVisibilityDates
      ? String(table?.visibleStart ?? table?.visible_start_date ?? "")
      : fallbackDate;
    const visibleEnd = hasVisibilityDates
      ? String(table?.visibleEnd ?? table?.visible_end_date ?? "")
      : fallbackDate;

    return {
      id: String(table?.id ?? ""),
      title: String(table?.title ?? "Custom Table"),
      scheduleDate: String(table?.scheduleDate ?? table?.schedule_date ?? ""),
      visibleStart,
      visibleEnd,
      columnHeaders: sanitizedColumns,
      rowHeaders: sanitizedRows,
      cells: normalizedCells,
      rowHeaderType:
        table?.rowHeaderType === "user" ||
        table?.rowHeaderType === "task" ||
        table?.rowHeaderType === "text"
          ? table.rowHeaderType
          : table?.row_header_type === "user" ||
              table?.row_header_type === "task" ||
              table?.row_header_type === "text"
            ? table.row_header_type
            : "text",
      columnHeaderType:
        table?.columnHeaderType === "user" ||
        table?.columnHeaderType === "task" ||
        table?.columnHeaderType === "text"
          ? table.columnHeaderType
          : table?.column_header_type === "user" ||
              table?.column_header_type === "task" ||
              table?.column_header_type === "text"
            ? table.column_header_type
            : "text",
      cellType:
        table?.cellType === "user" ||
        table?.cellType === "task" ||
        table?.cellType === "text"
          ? table.cellType
          : table?.cell_type === "user" ||
              table?.cell_type === "task" ||
              table?.cell_type === "text"
            ? table.cell_type
            : "user",
    };
  }, []);

  const visibleCustomTables = useMemo(() => {
    if (!scheduleDateIso) return customTables;
    return customTables.filter((table) => {
      const start = table.visibleStart || "";
      const end = table.visibleEnd || "";
      if (start && scheduleDateIso < start) return false;
      if (end && scheduleDateIso > end) return false;
      return true;
    });
  }, [customTables, scheduleDateIso]);

  const loadCustomTables = useCallback(
    async (dateValue?: string | null) => {
      if (!dateValue) return;
      const isoDate = toIsoDateLabel(dateValue) || dateValue;
      setCustomTablesLoading(true);
      setCustomTablesError(null);
      try {
        const res = await fetch(
          `/api/schedule/custom-tables?date=${encodeURIComponent(isoDate)}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const tables = Array.isArray(json.tables) ? json.tables : [];
        const normalized = tables.map(normalizeCustomTable);
        setCustomTables(normalized);
        setCustomTablesDirty({});
      } catch (err) {
        console.error("Failed to load custom tables:", err);
        setCustomTablesError("Unable to load custom tables.");
      } finally {
        setCustomTablesLoading(false);
      }
    },
    [normalizeCustomTable]
  );

  const updateCustomTableState = useCallback(
    (tableId: string, updater: (table: CustomTable) => CustomTable) => {
      setCustomTables((prev) => prev.map((table) => (table.id === tableId ? updater(table) : table)));
      setCustomTablesDirty((prev) => ({ ...prev, [tableId]: true }));
    },
    []
  );

  const moveCustomTable = useCallback((fromId: string, toId: string) => {
    setCustomTables((prev) => {
      const fromIndex = prev.findIndex((table) => table.id === fromId);
      const toIndex = prev.findIndex((table) => table.id === toId);
      if (fromIndex === -1 || toIndex === -1) return prev;
      return reorderList(prev, fromIndex, toIndex);
    });
    setCustomTablesDirty((prev) => ({ ...prev, [fromId]: true, [toId]: true }));
  }, []);

  const handleSaveCustomTable = useCallback(
    async (table: CustomTable) => {
      setCustomTablesSaving((prev) => ({ ...prev, [table.id]: true }));
      setCustomTablesError(null);
      try {
        const res = await fetch("/api/schedule/custom-tables", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: table.id,
            title: table.title,
            scheduleDate: table.scheduleDate,
            visibleStart: table.visibleStart || null,
            visibleEnd: table.visibleEnd || null,
            rowHeaders: table.rowHeaders,
            columnHeaders: table.columnHeaders,
            cells: table.cells,
            rowHeaderType: table.rowHeaderType,
            columnHeaderType: table.columnHeaderType,
            cellType: table.cellType,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setCustomTablesDirty((prev) => ({ ...prev, [table.id]: false }));
      } catch (err) {
        console.error("Failed to save custom table:", err);
        setCustomTablesError("Unable to save custom table.");
      } finally {
        setCustomTablesSaving((prev) => ({ ...prev, [table.id]: false }));
      }
    },
    []
  );

  const handleDeleteCustomTable = useCallback(async (tableId: string) => {
    const confirmed = window.confirm("Delete this custom table? This cannot be undone.");
    if (!confirmed) return;
    setCustomTablesDeleting(tableId);
    setCustomTablesError(null);
    try {
      const res = await fetch(`/api/schedule/custom-tables?id=${encodeURIComponent(tableId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCustomTables((prev) => prev.filter((table) => table.id !== tableId));
      setCustomTablesDirty((prev) => {
        const next = { ...prev };
        delete next[tableId];
        return next;
      });
      setCustomTablesSaving((prev) => {
        const next = { ...prev };
        delete next[tableId];
        return next;
      });
    } catch (err) {
      console.error("Failed to delete custom table:", err);
      setCustomTablesError("Unable to delete custom table.");
    } finally {
      setCustomTablesDeleting(null);
    }
  }, []);

  const canEditCustomTables = canEdit;

  const reloadTables = useCallback(() => {
    if (!dateLabel) return;
    void loadCustomTables(dateLabel);
  }, [dateLabel, loadCustomTables]);

  useEffect(() => {
    if (!dateLabel) return;
    void loadCustomTables(dateLabel);
  }, [dateLabel, loadCustomTables]);

  return (
    <section className="mt-10 rounded-lg border border-[#d0c9a4] bg-white/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[#3b4224]">Custom Tables</h3>
          <p className="text-xs text-[#7a7f54]">
            Review custom sections with editable headers and volunteer selections.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={reloadTables}
            className="rounded-full border border-[#d0c9a4] bg-white/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#4a5b2a] shadow-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      {customTablesLoading && (
        <p className="mt-3 text-sm text-[#7a7f54]">Loading custom tables…</p>
      )}
      {customTablesError && (
        <p className="mt-3 text-sm text-red-700">{customTablesError}</p>
      )}
      {!customTablesLoading && visibleCustomTables.length === 0 && (
        <p className="mt-3 text-sm text-[#7a7f54]">
          No custom tables available for this date.
        </p>
      )}

      <div className="mt-4 space-y-4">
        {visibleCustomTables.map((table) => {
          const isSaving = Boolean(customTablesSaving[table.id]);
          const isDirty = Boolean(customTablesDirty[table.id]);
          const isDeleting = customTablesDeleting === table.id;
          const rowHeaderType = table.rowHeaderType;
          const columnHeaderType = table.columnHeaderType;
          const cellType = table.cellType;
          const normalizedUserName = currentUserName?.toLowerCase() || "";
          return (
            <div
              key={table.id}
              className="rounded-lg border border-[#d0c9a4] bg-[#f8f4e3] p-4 shadow-sm"
              onDragOver={(event) => {
                if (!canEditCustomTables || !draggingTableId) return;
                event.preventDefault();
              }}
              onDrop={(event) => {
                if (!canEditCustomTables || !draggingTableId) return;
                event.preventDefault();
                if (draggingTableId === table.id) return;
                moveCustomTable(draggingTableId, table.id);
                setDraggingTableId(null);
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                {canEditCustomTables ? (
                  <div className="flex flex-1 items-center gap-2">
                    <button
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        setDraggingTableId(table.id);
                      }}
                      onDragEnd={() => setDraggingTableId(null)}
                      className="rounded-full border border-[#d0c9a4] bg-white/80 px-2 py-1 text-xs font-semibold text-[#4b5133] shadow-sm"
                      aria-label="Drag to reorder table"
                    >
                      ☰
                    </button>
                    <input
                      value={table.title}
                      onChange={(event) =>
                        updateCustomTableState(table.id, (prev) => ({
                          ...prev,
                          title: event.target.value,
                        }))
                      }
                      className="min-w-[200px] flex-1 rounded-md border border-[#d0c9a4] bg-white/90 px-3 py-2 text-sm font-semibold text-[#3b4224]"
                      placeholder="Custom table title"
                    />
                  </div>
                ) : (
                  <h4 className="text-base font-semibold text-[#3b4224]">{table.title}</h4>
                )}
                {canEditCustomTables && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        updateCustomTableState(table.id, (prev) => ({
                          ...prev,
                          rowHeaders: [
                            ...prev.rowHeaders,
                            `Row ${prev.rowHeaders.length + 1}`,
                          ],
                          cells: [
                            ...prev.cells,
                            Array(prev.columnHeaders.length).fill(""),
                          ],
                        }))
                      }
                      className="rounded-full border border-[#d0c9a4] bg-white/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#4a5b2a] shadow-sm"
                    >
                      Add Row
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateCustomTableState(table.id, (prev) => ({
                          ...prev,
                          columnHeaders: [
                            ...prev.columnHeaders,
                            `Column ${prev.columnHeaders.length + 1}`,
                          ],
                          cells: prev.cells.map((row) => [...row, ""]),
                        }))
                      }
                      className="rounded-full border border-[#d0c9a4] bg-white/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#4a5b2a] shadow-sm"
                    >
                      Add Column
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveCustomTable(table)}
                      disabled={!isDirty || isSaving}
                      className="rounded-full border border-[#8fae4c] bg-[#8fae4c] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSaving ? "Saving…" : isDirty ? "Save Table" : "Saved"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCustomTable(table.id)}
                      disabled={isDeleting}
                      className="rounded-full border border-red-200 bg-white/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-red-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isDeleting ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                )}
              </div>

              {canEditCustomTables && (
                <div className="mt-3 flex flex-wrap gap-3 rounded-lg border border-[#e2d7b5] bg-white/70 px-3 py-2 text-[11px] text-[#6b6f4c]">
                  <label className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.12em]">
                      Visible from
                    </span>
                    <input
                      type="date"
                      value={table.visibleStart || ""}
                      onChange={(event) =>
                        updateCustomTableState(table.id, (prev) => ({
                          ...prev,
                          visibleStart: event.target.value,
                        }))
                      }
                      className="rounded-full border border-[#d0c9a4] bg-white/90 px-3 py-1 text-[11px] font-semibold text-[#4b5133]"
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.12em]">
                      Visible until
                    </span>
                    <input
                      type="date"
                      value={table.visibleEnd || ""}
                      onChange={(event) =>
                        updateCustomTableState(table.id, (prev) => ({
                          ...prev,
                          visibleEnd: event.target.value,
                        }))
                      }
                      className="rounded-full border border-[#d0c9a4] bg-white/90 px-3 py-1 text-[11px] font-semibold text-[#4b5133]"
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.12em]">
                      Rows
                    </span>
                    <select
                      value={rowHeaderType}
                      onChange={(event) =>
                        updateCustomTableState(table.id, (prev) => ({
                          ...prev,
                          rowHeaderType: event.target.value as CustomTable["rowHeaderType"],
                        }))
                      }
                      className="rounded-full border border-[#d0c9a4] bg-white/90 px-3 py-1 text-[11px] font-semibold text-[#4b5133]"
                    >
                      {headerTypeOptions.map((opt) => (
                        <option key={`row-${opt.value}`} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.12em]">
                      Columns
                    </span>
                    <select
                      value={columnHeaderType}
                      onChange={(event) =>
                        updateCustomTableState(table.id, (prev) => ({
                          ...prev,
                          columnHeaderType: event.target.value as CustomTable["columnHeaderType"],
                        }))
                      }
                      className="rounded-full border border-[#d0c9a4] bg-white/90 px-3 py-1 text-[11px] font-semibold text-[#4b5133]"
                    >
                      {headerTypeOptions.map((opt) => (
                        <option key={`column-${opt.value}`} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.12em]">
                      Cells
                    </span>
                    <select
                      value={cellType}
                      onChange={(event) =>
                        updateCustomTableState(table.id, (prev) => ({
                          ...prev,
                          cellType: event.target.value as CustomTable["cellType"],
                        }))
                      }
                      className="rounded-full border border-[#d0c9a4] bg-white/90 px-3 py-1 text-[11px] font-semibold text-[#4b5133]"
                    >
                      {headerTypeOptions.map((opt) => (
                        <option key={`cell-${opt.value}`} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="min-w-[140px] border border-[#e2d7b5] bg-[#f1ecd7] px-2 py-2 text-left text-[11px] uppercase tracking-[0.12em] text-[#6b6f4c]">
                        {rowHeaderType === "user"
                          ? "Users"
                          : rowHeaderType === "task"
                            ? "Tasks"
                            : "Rows"}
                      </th>
                      {table.columnHeaders.map((header, colIdx) => (
                        <th
                          key={`${table.id}-column-${colIdx}`}
                          className="border border-[#e2d7b5] bg-[#f1ecd7] px-2 py-2 text-left"
                          onDragOver={(event) => {
                            if (!canEditCustomTables || !draggingColumn) return;
                            if (draggingColumn.tableId !== table.id) return;
                            event.preventDefault();
                          }}
                          onDrop={(event) => {
                            if (!canEditCustomTables || !draggingColumn) return;
                            if (draggingColumn.tableId !== table.id) return;
                            event.preventDefault();
                            if (draggingColumn.index === colIdx) return;
                            updateCustomTableState(table.id, (prev) => ({
                              ...prev,
                              columnHeaders: reorderList(prev.columnHeaders, draggingColumn.index, colIdx),
                              cells: prev.cells.map((row) =>
                                reorderList(row, draggingColumn.index, colIdx)
                              ),
                            }));
                            setDraggingColumn(null);
                          }}
                        >
                          {canEditCustomTables ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                draggable
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = "move";
                                  setDraggingColumn({ tableId: table.id, index: colIdx });
                                }}
                                onDragEnd={() => setDraggingColumn(null)}
                                className="rounded-full border border-[#d0c9a4] bg-white/80 px-2 py-1 text-[10px] font-semibold text-[#4b5133]"
                                aria-label="Drag to reorder column"
                              >
                                ⇅
                              </button>
                              {columnHeaderType === "user" ? (
                                <MultiSelectChecklist
                                  value={header}
                                  options={userOptions}
                                  placeholder="Select users"
                                  onChange={(nextValue) =>
                                    updateCustomTableState(table.id, (prev) => {
                                      const nextHeaders = [...prev.columnHeaders];
                                      nextHeaders[colIdx] = nextValue;
                                      return { ...prev, columnHeaders: nextHeaders };
                                    })
                                  }
                                />
                              ) : columnHeaderType === "task" ? (
                                <MultiSelectChecklist
                                  value={header}
                                  options={taskNameOptions}
                                  placeholder="Select tasks"
                                  onChange={(nextValue) =>
                                    updateCustomTableState(table.id, (prev) => {
                                      const nextHeaders = [...prev.columnHeaders];
                                      nextHeaders[colIdx] = nextValue;
                                      return { ...prev, columnHeaders: nextHeaders };
                                    })
                                  }
                                />
                              ) : (
                                <input
                                  value={header}
                                  onChange={(event) =>
                                    updateCustomTableState(table.id, (prev) => {
                                      const nextHeaders = [...prev.columnHeaders];
                                      nextHeaders[colIdx] = event.target.value;
                                      return { ...prev, columnHeaders: nextHeaders };
                                    })
                                  }
                                  className="w-full min-w-[120px] rounded-md border border-[#d0c9a4] bg-white/90 px-2 py-1 text-[11px] font-semibold text-[#3b4224]"
                                  placeholder={`Column ${colIdx + 1}`}
                                />
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  updateCustomTableState(table.id, (prev) => ({
                                    ...prev,
                                    columnHeaders: prev.columnHeaders.filter((_, idx) => idx !== colIdx),
                                    cells: prev.cells.map((row) =>
                                      row.filter((_, idx) => idx !== colIdx)
                                    ),
                                  }))
                                }
                                className="rounded-full border border-red-200 bg-white/80 px-2 py-1 text-[10px] font-semibold text-red-700"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <span className="text-[12px] font-semibold text-[#3b4224]">
                              {header}
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rowHeaders.map((rowHeader, rowIdx) => (
                      <tr
                        key={`${table.id}-row-${rowIdx}`}
                        className={
                          normalizedUserName &&
                          rowHeaderType === "user" &&
                          rowHeader.toLowerCase() === normalizedUserName
                            ? "bg-[#eaf1da]"
                            : ""
                        }
                        onDragOver={(event) => {
                          if (!canEditCustomTables || !draggingRow) return;
                          if (draggingRow.tableId !== table.id) return;
                          event.preventDefault();
                        }}
                        onDrop={(event) => {
                          if (!canEditCustomTables || !draggingRow) return;
                          if (draggingRow.tableId !== table.id) return;
                          event.preventDefault();
                          if (draggingRow.index === rowIdx) return;
                          updateCustomTableState(table.id, (prev) => ({
                            ...prev,
                            rowHeaders: reorderList(prev.rowHeaders, draggingRow.index, rowIdx),
                            cells: reorderList(prev.cells, draggingRow.index, rowIdx),
                          }));
                          setDraggingRow(null);
                        }}
                      >
                        <th className="border border-[#e2d7b5] bg-[#f7f2e2] px-2 py-2 text-left">
                          {canEditCustomTables ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                draggable
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = "move";
                                  setDraggingRow({ tableId: table.id, index: rowIdx });
                                }}
                                onDragEnd={() => setDraggingRow(null)}
                                className="rounded-full border border-[#d0c9a4] bg-white/80 px-2 py-1 text-[10px] font-semibold text-[#4b5133]"
                                aria-label="Drag to reorder row"
                              >
                                ⇅
                              </button>
                              {rowHeaderType === "user" ? (
                                <MultiSelectChecklist
                                  value={rowHeader}
                                  options={userOptions}
                                  placeholder="Select users"
                                  onChange={(nextValue) =>
                                    updateCustomTableState(table.id, (prev) => {
                                      const nextHeaders = [...prev.rowHeaders];
                                      nextHeaders[rowIdx] = nextValue;
                                      return { ...prev, rowHeaders: nextHeaders };
                                    })
                                  }
                                />
                              ) : rowHeaderType === "task" ? (
                                <MultiSelectChecklist
                                  value={rowHeader}
                                  options={taskNameOptions}
                                  placeholder="Select tasks"
                                  onChange={(nextValue) =>
                                    updateCustomTableState(table.id, (prev) => {
                                      const nextHeaders = [...prev.rowHeaders];
                                      nextHeaders[rowIdx] = nextValue;
                                      return { ...prev, rowHeaders: nextHeaders };
                                    })
                                  }
                                />
                              ) : (
                                <input
                                  value={rowHeader}
                                  onChange={(event) =>
                                    updateCustomTableState(table.id, (prev) => {
                                      const nextHeaders = [...prev.rowHeaders];
                                      nextHeaders[rowIdx] = event.target.value;
                                      return { ...prev, rowHeaders: nextHeaders };
                                    })
                                  }
                                  className="w-full min-w-[120px] rounded-md border border-[#d0c9a4] bg-white/90 px-2 py-1 text-[11px] font-semibold text-[#3b4224]"
                                  placeholder={`Row ${rowIdx + 1}`}
                                />
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  updateCustomTableState(table.id, (prev) => ({
                                    ...prev,
                                    rowHeaders: prev.rowHeaders.filter((_, idx) => idx !== rowIdx),
                                    cells: prev.cells.filter((_, idx) => idx !== rowIdx),
                                  }))
                                }
                                className="rounded-full border border-red-200 bg-white/80 px-2 py-1 text-[10px] font-semibold text-red-700"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <span className="text-[12px] font-semibold text-[#3b4224]">
                              {rowHeader}
                            </span>
                          )}
                        </th>
                        {table.columnHeaders.map((_col, colIdx) => {
                          const cellValue = table.cells[rowIdx]?.[colIdx] ?? "";
                          const cellMatchesUser =
                            cellType === "user" &&
                            normalizedUserName &&
                            cellValue.toLowerCase() === normalizedUserName;
                          return (
                            <td
                              key={`${table.id}-cell-${rowIdx}-${colIdx}`}
                              className={`border border-[#e2d7b5] px-2 py-2 ${
                                cellMatchesUser ? "bg-[#eaf1da]" : ""
                              }`}
                            >
                              {canEditCustomTables ? (
                                cellType === "user" ? (
                                  <MultiSelectChecklist
                                    value={cellValue}
                                    options={userOptions}
                                    placeholder="Select users"
                                    onChange={(nextValue) =>
                                      updateCustomTableState(table.id, (prev) => {
                                        const nextCells = prev.cells.map((row) => [...row]);
                                        nextCells[rowIdx][colIdx] = nextValue;
                                        return { ...prev, cells: nextCells };
                                      })
                                    }
                                  />
                                ) : cellType === "task" ? (
                                  <MultiSelectChecklist
                                    value={cellValue}
                                    options={taskNameOptions}
                                    placeholder="Select tasks"
                                    onChange={(nextValue) =>
                                      updateCustomTableState(table.id, (prev) => {
                                        const nextCells = prev.cells.map((row) => [...row]);
                                        nextCells[rowIdx][colIdx] = nextValue;
                                        return { ...prev, cells: nextCells };
                                      })
                                    }
                                  />
                                ) : (
                                  <input
                                    value={cellValue}
                                    onChange={(event) =>
                                      updateCustomTableState(table.id, (prev) => {
                                        const nextCells = prev.cells.map((row) => [...row]);
                                        nextCells[rowIdx][colIdx] = event.target.value;
                                        return { ...prev, cells: nextCells };
                                      })
                                    }
                                    className="w-full rounded-md border border-[#d0c9a4] bg-white/90 px-2 py-1 text-[11px] font-semibold text-[#3b4224]"
                                  />
                                )
                              ) : (
                                <span className="text-[12px] text-[#3b4224]">{cellValue}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
