"use client";

// AddLocationDialog (box-finder map UI). Creates a StorageNode (name + kind,
// and for a `box` kind, the grid dims). Lives inside a LivingPopup raised by
// StorageMap. The whole-lab-edit default sharing is applied by
// storageNodesApi.create, so this form only collects the shape.
//
// House style: <Icon> only (no inline svg), brand + semantic dark-mode tokens,
// no emojis / em-dashes / mid-sentence colons.

import { useState } from "react";

import { Icon } from "@/components/icons";
import type { StorageNodeCreate, StorageNodeKind } from "@/lib/types";
import {
  DEFAULT_BOX_DIMS,
  STORAGE_KIND_LABEL,
  STORAGE_KIND_ORDER,
} from "./inventory-ui";

const INPUT_CLASS =
  "w-full px-3 py-2 border border-border rounded-lg text-body bg-surface-raised text-foreground placeholder:text-foreground-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-action";
const LABEL_CLASS = "block text-meta font-medium text-foreground-muted mb-1";

interface AddLocationDialogProps {
  /** Name of the parent node we are adding under, or null for top-level. */
  parentName: string | null;
  onCancel: () => void;
  onSubmit: (data: StorageNodeCreate) => Promise<void>;
}

export default function AddLocationDialog({
  parentName,
  onCancel,
  onSubmit,
}: AddLocationDialogProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<StorageNodeKind>("freezer");
  const [boxRows, setBoxRows] = useState("9");
  const [boxCols, setBoxCols] = useState("9");
  const [temperature, setTemperature] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBox = kind === "box";

  const applyPreset = (rows: number, cols: number) => {
    setBoxRows(String(rows));
    setBoxCols(String(cols));
  };

  const handleSubmit = async () => {
    if (saving) return;
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the location a name.");
      return;
    }
    let box_rows: number | null = null;
    let box_cols: number | null = null;
    if (isBox) {
      const r = Math.floor(Number(boxRows));
      const c = Math.floor(Number(boxCols));
      if (!Number.isFinite(r) || r < 1 || r > 16) {
        setError("Box rows must be between 1 and 16.");
        return;
      }
      if (!Number.isFinite(c) || c < 1 || c > 24) {
        setError("Box columns must be between 1 and 24.");
        return;
      }
      box_rows = r;
      box_cols = c;
    }
    const payload: StorageNodeCreate = {
      name: trimmed,
      kind,
      box_rows,
      box_cols,
      temperature: temperature.trim() ? temperature.trim() : null,
    };
    setSaving(true);
    try {
      await onSubmit(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the location.");
      setSaving(false);
    }
  };

  return (
    <div className="p-6 sm:p-7">
      <h2 className="text-title font-semibold text-foreground mb-1">
        Add location
      </h2>
      <p className="text-meta text-foreground-muted mb-5">
        {parentName
          ? `A new spot under ${parentName}.`
          : "A new top-level spot (a room or a standalone freezer)."}{" "}
        A box gets a grid so stocks can sit in numbered cells.
      </p>

      {error && (
        <div className="mb-4 px-3 py-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-lg text-meta text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label htmlFor="loc-name" className={LABEL_CLASS}>
            Name
          </label>
          <input
            id="loc-name"
            className={INPUT_CLASS}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="-80 #2, Rack 3, Box: Enzymes"
            autoComplete="off"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="loc-kind" className={LABEL_CLASS}>
              Kind
            </label>
            <select
              id="loc-kind"
              className={INPUT_CLASS}
              value={kind}
              onChange={(e) => setKind(e.target.value as StorageNodeKind)}
            >
              {STORAGE_KIND_ORDER.map((k) => (
                <option key={k} value={k}>
                  {STORAGE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="loc-temp" className={LABEL_CLASS}>
              Temperature
            </label>
            <input
              id="loc-temp"
              className={INPUT_CLASS}
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              placeholder="-80 C, 4 C, RT"
              autoComplete="off"
            />
          </div>
        </div>

        {isBox && (
          <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3">
            <p className="text-meta font-medium text-foreground mb-2">
              Box grid
            </p>
            <div className="mb-3 flex flex-wrap gap-2">
              {DEFAULT_BOX_DIMS.map((d) => {
                const active =
                  Number(boxRows) === d.rows && Number(boxCols) === d.cols;
                return (
                  <button
                    key={d.label}
                    type="button"
                    onClick={() => applyPreset(d.rows, d.cols)}
                    className={`rounded-md border px-2.5 py-1 text-meta font-medium ${
                      active
                        ? "border-brand-action bg-brand-action/10 text-brand-action"
                        : "border-border text-foreground-muted hover:bg-surface-raised"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="loc-rows" className={LABEL_CLASS}>
                  Rows
                </label>
                <input
                  id="loc-rows"
                  type="number"
                  min={1}
                  max={16}
                  step={1}
                  className={INPUT_CLASS}
                  value={boxRows}
                  onChange={(e) => setBoxRows(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="loc-cols" className={LABEL_CLASS}>
                  Columns
                </label>
                <input
                  id="loc-cols"
                  type="number"
                  min={1}
                  max={24}
                  step={1}
                  className={INPUT_CLASS}
                  value={boxCols}
                  onChange={(e) => setBoxCols(e.target.value)}
                />
              </div>
            </div>
            <p className="text-meta text-foreground-muted mt-2">
              Rows are lettered A onward, columns numbered from 1 (so a cell
              reads B4, the same as the plate editor).
            </p>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-body rounded-lg border border-border text-foreground hover:bg-surface-sunken transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 inline-flex items-center gap-1.5 px-4 py-2 text-body rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Icon name="check" className="h-4 w-4" />
          Add location
        </button>
      </div>
    </div>
  );
}
