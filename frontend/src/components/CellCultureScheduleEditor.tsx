"use client";

import { useMemo } from "react";
import Tooltip from "@/components/Tooltip";
import {
  MODIFIED_BADGE_CLASSES,
  MODIFIED_CELL_CLASSES,
  MODIFIED_CHIP_TEXT,
  originalValueTooltip,
} from "@/lib/methods/diff-display";
import type {
  CellCultureCellLine,
  CellCultureEventType,
  CellCultureMedia,
  CellCulturePlannedEvent,
  CellCultureSupplement,
} from "@/lib/types";

/**
 * Interactive editor for a cell-culture passaging schedule — the structured
 * counterpart to `LcGradientEditor` for HPLC and `InteractiveGradientEditor`
 * for PCR.
 *
 * Layout (top → bottom):
 *  1. Optional "Modified from source" chip (visible only when `original*`
 *     props are passed AND any live value diverges from the source).
 *  2. Cell-line metadata fields (name, species, tissue, notes).
 *  3. Media composition (base medium, serum %, supplements table).
 *  4. Planned events list — day offset, event type, split ratio, notes.
 *  5. Hand-rolled SVG timeline strip visualising day-offsets with event
 *     glyphs (feed / split / observe / harvest), so the cadence is legible
 *     at a glance without pulling in recharts.
 *
 * Diff-display semantics mirror LC: when `original*` props are supplied,
 * modified cells get the `MODIFIED_CELL_CLASSES` ring + tooltip, and the
 * shared "Modified from source" badge renders above the editor. The
 * snapshot-or-source branching is owned by the caller (the tab content).
 */
export interface CellCultureScheduleEditorProps {
  cellLine: CellCultureCellLine;
  onCellLineChange?: (cell_line: CellCultureCellLine) => void;
  media: CellCultureMedia;
  onMediaChange?: (media: CellCultureMedia) => void;
  plannedEvents: CellCulturePlannedEvent[];
  onPlannedEventsChange?: (events: CellCulturePlannedEvent[]) => void;
  description?: string | null;
  onDescriptionChange?: (description: string | null) => void;
  /** When true, all inputs render read-only. */
  readOnly?: boolean;
  /** When set, diff display compares against these source values and shows
   *  the "Modified from source" chip + per-cell highlights. */
  originalCellLine?: CellCultureCellLine;
  originalMedia?: CellCultureMedia;
  originalPlannedEvents?: CellCulturePlannedEvent[];
  originalDescription?: string | null;
}

const EVENT_TYPE_OPTIONS: ReadonlyArray<CellCultureEventType> = [
  "feed",
  "split",
  "observe",
  "harvest",
];

const EVENT_TYPE_LABELS: Record<CellCultureEventType, string> = {
  feed: "Feed",
  split: "Split",
  observe: "Observe",
  harvest: "Harvest",
};

const EVENT_TYPE_COLORS: Record<CellCultureEventType, string> = {
  feed: "#0ea5e9",
  split: "#e11d48",
  observe: "#6b7280",
  harvest: "#10b981",
};

const EVENT_TYPE_GLYPHS: Record<CellCultureEventType, string> = {
  feed: "F",
  split: "S",
  observe: "O",
  harvest: "H",
};

function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return String(n);
}

function parseNumberOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cellLineEqual(a: CellCultureCellLine, b: CellCultureCellLine): boolean {
  return (
    (a.name ?? "") === (b.name ?? "") &&
    (a.species ?? "") === (b.species ?? "") &&
    (a.tissue ?? "") === (b.tissue ?? "") &&
    (a.notes ?? "") === (b.notes ?? "")
  );
}

function supplementsEqual(a: CellCultureSupplement[], b: CellCultureSupplement[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i].name !== b[i].name ||
      a[i].concentration !== b[i].concentration ||
      a[i].units !== b[i].units
    ) {
      return false;
    }
  }
  return true;
}

function mediaEqual(a: CellCultureMedia, b: CellCultureMedia): boolean {
  if ((a.base_medium ?? "") !== (b.base_medium ?? "")) return false;
  if ((a.serum_percent ?? null) !== (b.serum_percent ?? null)) return false;
  return supplementsEqual(a.supplements ?? [], b.supplements ?? []);
}

function plannedEventsEqual(
  a: CellCulturePlannedEvent[],
  b: CellCulturePlannedEvent[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i].day_offset !== b[i].day_offset ||
      a[i].event_type !== b[i].event_type ||
      (a[i].split_ratio ?? "") !== (b[i].split_ratio ?? "") ||
      (a[i].notes ?? "") !== (b[i].notes ?? "")
    ) {
      return false;
    }
  }
  return true;
}

export default function CellCultureScheduleEditor(props: CellCultureScheduleEditorProps) {
  const {
    cellLine,
    onCellLineChange,
    media,
    onMediaChange,
    plannedEvents,
    onPlannedEventsChange,
    description,
    onDescriptionChange,
    readOnly = false,
    originalCellLine,
    originalMedia,
    originalPlannedEvents,
    originalDescription,
  } = props;

  const editable = !readOnly;
  const diffMode =
    originalCellLine !== undefined ||
    originalMedia !== undefined ||
    originalPlannedEvents !== undefined ||
    originalDescription !== undefined;

  const isModified = useMemo(() => {
    if (!diffMode) return false;
    if (originalCellLine && !cellLineEqual(cellLine, originalCellLine)) return true;
    if (originalMedia && !mediaEqual(media, originalMedia)) return true;
    if (originalPlannedEvents && !plannedEventsEqual(plannedEvents, originalPlannedEvents)) {
      return true;
    }
    if (
      originalDescription !== undefined &&
      (description ?? "") !== (originalDescription ?? "")
    ) {
      return true;
    }
    return false;
  }, [diffMode, cellLine, media, plannedEvents, description, originalCellLine, originalMedia, originalPlannedEvents, originalDescription]);

  // ── Cell line mutators ───────────────────────────────────────────────────
  const updateCellLine = <K extends keyof CellCultureCellLine>(
    field: K,
    value: CellCultureCellLine[K],
  ) => {
    if (!onCellLineChange) return;
    onCellLineChange({ ...cellLine, [field]: value });
  };

  // ── Media mutators ───────────────────────────────────────────────────────
  const updateMedia = <K extends keyof CellCultureMedia>(field: K, value: CellCultureMedia[K]) => {
    if (!onMediaChange) return;
    onMediaChange({ ...media, [field]: value });
  };

  const supplements = media.supplements ?? [];
  const updateSupplement = <K extends keyof CellCultureSupplement>(
    idx: number,
    field: K,
    value: CellCultureSupplement[K],
  ) => {
    if (!onMediaChange) return;
    const next = supplements.map((s, i) => (i === idx ? { ...s, [field]: value } : s));
    onMediaChange({ ...media, supplements: next });
  };
  const addSupplement = () => {
    if (!onMediaChange) return;
    onMediaChange({
      ...media,
      supplements: [...supplements, { name: "", concentration: "", units: "" }],
    });
  };
  const removeSupplement = (idx: number) => {
    if (!onMediaChange) return;
    onMediaChange({ ...media, supplements: supplements.filter((_, i) => i !== idx) });
  };

  // ── Planned event mutators ──────────────────────────────────────────────
  const updateEvent = <K extends keyof CellCulturePlannedEvent>(
    idx: number,
    field: K,
    value: CellCulturePlannedEvent[K],
  ) => {
    if (!onPlannedEventsChange) return;
    const next = plannedEvents.map((e, i) => (i === idx ? { ...e, [field]: value } : e));
    onPlannedEventsChange(next);
  };
  const addEvent = () => {
    if (!onPlannedEventsChange) return;
    const last = plannedEvents[plannedEvents.length - 1];
    onPlannedEventsChange([
      ...plannedEvents,
      {
        day_offset: last ? last.day_offset + 1 : 0,
        event_type: "feed",
      },
    ]);
  };
  const removeEvent = (idx: number) => {
    if (!onPlannedEventsChange) return;
    onPlannedEventsChange(plannedEvents.filter((_, i) => i !== idx));
  };

  // ── Timeline visualisation bounds ───────────────────────────────────────
  const timelineExtent = useMemo(() => {
    if (plannedEvents.length === 0) return { min: 0, max: 7 };
    let min = plannedEvents[0].day_offset;
    let max = plannedEvents[0].day_offset;
    for (const e of plannedEvents) {
      if (e.day_offset < min) min = e.day_offset;
      if (e.day_offset > max) max = e.day_offset;
    }
    return { min: Math.min(min, 0), max: Math.max(max, min + 1) };
  }, [plannedEvents]);

  // ── Diff lookups for per-row highlighting ───────────────────────────────
  const originalEventByIdx = (idx: number): CellCulturePlannedEvent | undefined =>
    originalPlannedEvents?.[idx];

  return (
    <div className="space-y-4">
      {isModified && (
        <div>
          <span className={MODIFIED_BADGE_CLASSES}>{MODIFIED_CHIP_TEXT}</span>
        </div>
      )}

      {/* Cell line metadata */}
      <div>
        <h4 className="text-body font-semibold text-foreground mb-2">Cell line</h4>
        <div className="grid grid-cols-2 gap-3">
          <CellLineField
            label="Name"
            value={cellLine.name ?? ""}
            onChange={(v) => updateCellLine("name", v)}
            originalValue={originalCellLine?.name}
            placeholder="HeLa"
            editable={editable}
          />
          <CellLineField
            label="Species"
            value={cellLine.species ?? ""}
            onChange={(v) => updateCellLine("species", v)}
            originalValue={originalCellLine?.species}
            placeholder="Homo sapiens"
            editable={editable}
          />
          <CellLineField
            label="Tissue"
            value={cellLine.tissue ?? ""}
            onChange={(v) => updateCellLine("tissue", v)}
            originalValue={originalCellLine?.tissue}
            placeholder="Cervix (adenocarcinoma)"
            editable={editable}
          />
          <CellLineField
            label="Notes"
            value={cellLine.notes ?? ""}
            onChange={(v) => updateCellLine("notes", v)}
            originalValue={originalCellLine?.notes}
            placeholder="ATCC CCL-2; mycoplasma-negative"
            editable={editable}
          />
        </div>
      </div>

      {/* Media composition */}
      <div>
        <h4 className="text-body font-semibold text-foreground mb-2">Media</h4>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <CellLineField
            label="Base medium"
            value={media.base_medium ?? ""}
            onChange={(v) => updateMedia("base_medium", v)}
            originalValue={originalMedia?.base_medium}
            placeholder="DMEM (high glucose)"
            editable={editable}
          />
          <div className="flex flex-col">
            <label className="text-meta text-foreground-muted mb-1">Serum (%)</label>
            <input
              type="number"
              value={fmtNumber(media.serum_percent)}
              onChange={(e) => updateMedia("serum_percent", parseNumberOrNull(e.target.value))}
              readOnly={!editable}
              className={`px-2 py-1 text-body border border-border rounded ${
                originalMedia &&
                (media.serum_percent ?? null) !== (originalMedia.serum_percent ?? null)
                  ? MODIFIED_CELL_CLASSES
                  : ""
              }`}
              placeholder="10"
            />
            {originalMedia &&
              (media.serum_percent ?? null) !== (originalMedia.serum_percent ?? null) && (
                <Tooltip label={originalValueTooltip(fmtNumber(originalMedia.serum_percent) || "—")} placement="bottom">
                  <span className="text-meta text-amber-700 dark:text-amber-300 mt-0.5">Modified</span>
                </Tooltip>
              )}
          </div>
        </div>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-meta">
            <thead className="bg-surface-sunken">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-foreground-muted">Supplement</th>
                <th className="px-3 py-2 text-left font-medium text-foreground-muted">Concentration</th>
                <th className="px-3 py-2 text-left font-medium text-foreground-muted">Units</th>
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {supplements.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-center text-foreground-muted text-meta">
                    No supplements yet.
                  </td>
                </tr>
              ) : (
                supplements.map((s, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-surface-raised" : "bg-surface-sunken"}>
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={s.name}
                        onChange={(e) => updateSupplement(i, "name", e.target.value)}
                        readOnly={!editable}
                        className="w-full px-2 py-1 border border-border rounded"
                        placeholder="PenStrep"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={s.concentration}
                        onChange={(e) => updateSupplement(i, "concentration", e.target.value)}
                        readOnly={!editable}
                        className="w-full px-2 py-1 border border-border rounded"
                        placeholder="1"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={s.units}
                        onChange={(e) => updateSupplement(i, "units", e.target.value)}
                        readOnly={!editable}
                        className="w-full px-2 py-1 border border-border rounded"
                        placeholder="%"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {editable && (
                        <Tooltip label="Remove supplement" placement="left">
                          <button
                            onClick={() => removeSupplement(i)}
                            className="text-foreground-muted hover:text-red-500"
                          >
                            ✕
                          </button>
                        </Tooltip>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {editable && (
            <button
              onClick={addSupplement}
              className="w-full py-2 text-meta text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-brand-action/10 border-t border-border"
            >
              + Add supplement
            </button>
          )}
        </div>
      </div>

      {/* Planned events table */}
      <div>
        <h4 className="text-body font-semibold text-foreground mb-2">Planned events</h4>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-meta">
            <thead className="bg-surface-sunken">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-foreground-muted w-24">Day offset</th>
                <th className="px-3 py-2 text-left font-medium text-foreground-muted w-32">Event</th>
                <th className="px-3 py-2 text-left font-medium text-foreground-muted w-24">Split ratio</th>
                <th className="px-3 py-2 text-left font-medium text-foreground-muted">Notes</th>
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {plannedEvents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-center text-foreground-muted text-meta">
                    No planned events yet.
                  </td>
                </tr>
              ) : (
                plannedEvents.map((event, idx) => {
                  const orig = originalEventByIdx(idx);
                  const dayChanged = orig && event.day_offset !== orig.day_offset;
                  const typeChanged = orig && event.event_type !== orig.event_type;
                  const ratioChanged =
                    orig && (event.split_ratio ?? "") !== (orig.split_ratio ?? "");
                  const notesChanged = orig && (event.notes ?? "") !== (orig.notes ?? "");
                  return (
                    <tr key={idx} className={idx % 2 === 0 ? "bg-surface-raised" : "bg-surface-sunken"}>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={fmtNumber(event.day_offset)}
                            onChange={(e) =>
                              updateEvent(idx, "day_offset", parseNumberOrNull(e.target.value) ?? 0)
                            }
                            readOnly={!editable}
                            className={`w-16 px-2 py-1 border border-border rounded ${
                              dayChanged ? MODIFIED_CELL_CLASSES : ""
                            }`}
                          />
                          {dayChanged && (
                            <Tooltip
                              label={originalValueTooltip(orig!.day_offset)}
                              placement="top"
                            >
                              <span className="text-meta text-amber-700 dark:text-amber-300">●</span>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1">
                          <select
                            value={event.event_type}
                            onChange={(e) =>
                              updateEvent(idx, "event_type", e.target.value as CellCultureEventType)
                            }
                            disabled={!editable}
                            className={`w-full px-2 py-1 border border-border rounded bg-surface-raised ${
                              typeChanged ? MODIFIED_CELL_CLASSES : ""
                            }`}
                          >
                            {EVENT_TYPE_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {EVENT_TYPE_LABELS[opt]}
                              </option>
                            ))}
                          </select>
                          {typeChanged && (
                            <Tooltip
                              label={originalValueTooltip(EVENT_TYPE_LABELS[orig!.event_type])}
                              placement="top"
                            >
                              <span className="text-meta text-amber-700 dark:text-amber-300">●</span>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={event.split_ratio ?? ""}
                          onChange={(e) =>
                            updateEvent(idx, "split_ratio", e.target.value || undefined)
                          }
                          readOnly={!editable || event.event_type !== "split"}
                          className={`w-full px-2 py-1 border border-border rounded ${
                            ratioChanged ? MODIFIED_CELL_CLASSES : ""
                          } ${event.event_type !== "split" ? "bg-surface-sunken text-foreground-muted" : ""}`}
                          placeholder={event.event_type === "split" ? "1:5" : "—"}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={event.notes ?? ""}
                          onChange={(e) => updateEvent(idx, "notes", e.target.value || undefined)}
                          readOnly={!editable}
                          className={`w-full px-2 py-1 border border-border rounded ${
                            notesChanged ? MODIFIED_CELL_CLASSES : ""
                          }`}
                          placeholder="Optional notes"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {editable && (
                          <Tooltip label="Remove event" placement="left">
                            <button
                              onClick={() => removeEvent(idx)}
                              className="text-foreground-muted hover:text-red-500"
                            >
                              ✕
                            </button>
                          </Tooltip>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {editable && (
            <button
              onClick={addEvent}
              className="w-full py-2 text-meta text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-brand-action/10 border-t border-border"
            >
              + Add planned event
            </button>
          )}
        </div>
      </div>

      {/* Timeline strip */}
      <div>
        <h4 className="text-body font-semibold text-foreground mb-2">Schedule timeline</h4>
        <TimelineStrip
          events={plannedEvents}
          min={timelineExtent.min}
          max={timelineExtent.max}
        />
      </div>

      {/* Description */}
      <div>
        <h4 className="text-body font-semibold text-foreground mb-2">Description (optional)</h4>
        <textarea
          value={description ?? ""}
          onChange={(e) => onDescriptionChange?.(e.target.value || null)}
          readOnly={!editable}
          rows={2}
          className={`w-full px-3 py-2 text-body border border-border rounded-lg ${
            originalDescription !== undefined &&
            (description ?? "") !== (originalDescription ?? "")
              ? MODIFIED_CELL_CLASSES
              : ""
          }`}
          placeholder="Any additional details about this schedule…"
        />
      </div>
    </div>
  );
}

interface CellLineFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  originalValue?: string | null;
  placeholder?: string;
  editable: boolean;
}

function CellLineField({ label, value, onChange, originalValue, placeholder, editable }: CellLineFieldProps) {
  const modified =
    originalValue !== undefined && (originalValue ?? "") !== value;
  return (
    <div className="flex flex-col">
      <label className="text-meta text-foreground-muted mb-1">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={!editable}
          placeholder={placeholder}
          className={`flex-1 px-2 py-1 text-body border border-border rounded ${
            modified ? MODIFIED_CELL_CLASSES : ""
          }`}
        />
        {modified && originalValue && (
          <Tooltip label={originalValueTooltip(originalValue || "—")} placement="left">
            <span className="text-meta text-amber-700 dark:text-amber-300">●</span>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

interface TimelineStripProps {
  events: CellCulturePlannedEvent[];
  min: number;
  max: number;
}

function TimelineStrip({ events, min, max }: TimelineStripProps) {
  const width = 800;
  const height = 80;
  const padLeft = 30;
  const padRight = 16;
  const axisY = 50;
  const span = Math.max(1, max - min);
  const xFor = (day: number) => padLeft + ((day - min) / span) * (width - padLeft - padRight);

  // Tick every day if the span is small enough; otherwise every ~span/8.
  const tickStep = span <= 14 ? 1 : Math.max(1, Math.ceil(span / 8));
  const ticks: number[] = [];
  for (let d = min; d <= max; d += tickStep) ticks.push(d);

  return (
    <div className="border border-border rounded-lg bg-surface-raised p-2 overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="w-full" style={{ minWidth: 320 }}>
        {/* Axis */}
        <line
          x1={padLeft}
          x2={width - padRight}
          y1={axisY}
          y2={axisY}
          stroke="#d1d5db"
          strokeWidth={1}
        />
        {ticks.map((d) => (
          <g key={d}>
            <line x1={xFor(d)} x2={xFor(d)} y1={axisY - 4} y2={axisY + 4} stroke="#d1d5db" strokeWidth={1} />
            <text x={xFor(d)} y={axisY + 16} fontSize="9" fill="#6b7280" textAnchor="middle">
              D{d}
            </text>
          </g>
        ))}
        {/* Event markers */}
        {events.map((event, idx) => {
          const x = xFor(event.day_offset);
          const color = EVENT_TYPE_COLORS[event.event_type];
          const glyph = EVENT_TYPE_GLYPHS[event.event_type];
          return (
            <g key={idx}>
              <circle cx={x} cy={axisY - 14} r={9} fill={color} opacity={0.9} />
              <text
                x={x}
                y={axisY - 11}
                fontSize="10"
                fontWeight="bold"
                fill="white"
                textAnchor="middle"
              >
                {glyph}
              </text>
              {event.event_type === "split" && event.split_ratio && (
                <text
                  x={x}
                  y={axisY - 28}
                  fontSize="9"
                  fill="#374151"
                  textAnchor="middle"
                >
                  {event.split_ratio}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex items-center gap-3 mt-1 text-meta text-foreground-muted">
        {EVENT_TYPE_OPTIONS.map((opt) => (
          <span key={opt} className="inline-flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: EVENT_TYPE_COLORS[opt] }}
            />
            {EVENT_TYPE_LABELS[opt]}
          </span>
        ))}
      </div>
    </div>
  );
}
