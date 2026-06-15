"use client";

// Lab identity + branding: the shared name + PI title + logo capture fields.
//
// Used by the "Set up your lab" step (LabCreateResume) and the Settings -> Lab
// settings editor, so both surfaces capture the lab identity the same way. This
// is a controlled, presentational block: the parent owns the state and the save.
//
// PI title is a select with the common academic titles plus a "Custom" option
// that reveals a free-text field, and a "None" option. Logo is an image picker
// that downscales client-side (fileToLabLogo) and shows a preview; the parent
// uploads it after the lab exists.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback } from "react";
import FileDropzone from "@/components/ui/FileDropzone";
import { fileToLabLogo, type PreparedLogo } from "@/lib/lab/lab-logo-image";

/** The preset PI titles. "Custom" reveals a free-text field, "None" clears it. */
export const PI_TITLE_PRESETS = ["Dr.", "Prof.", "PhD", "MD", "MS", "None"] as const;

const inputClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-body text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-brand-action/40";
const labelClass = "block text-meta font-medium text-foreground";

export interface LabIdentityValue {
  labName: string;
  /** The selected preset, or "Custom" when the free-text title is in use. */
  piTitlePreset: string;
  /** The free-text title, only meaningful when piTitlePreset === "Custom". */
  piTitleCustom: string;
  piDisplay: string;
}

/** Resolves the effective PI title string from the field value. */
export function resolvePiTitle(v: LabIdentityValue): string {
  if (v.piTitlePreset === "None") return "";
  if (v.piTitlePreset === "Custom") return v.piTitleCustom.trim();
  return v.piTitlePreset;
}

export default function LabIdentityFields({
  value,
  onChange,
  logo,
  onLogoChange,
  onLogoError,
  disabled,
}: {
  value: LabIdentityValue;
  onChange: (next: LabIdentityValue) => void;
  /** The prepared logo (downscaled bytes + preview), or null when none chosen.
   *  An existing-logo preview url can be passed via previewUrl on a synthetic
   *  PreparedLogo by the parent. */
  logo: PreparedLogo | { previewUrl: string } | null;
  onLogoChange: (logo: PreparedLogo | null) => void;
  /** Surface a human-readable image error to the parent. */
  onLogoError?: (message: string) => void;
  disabled?: boolean;
}) {
  const handleFile = useCallback(
    async (file: File) => {
      try {
        const prepared = await fileToLabLogo(file);
        onLogoChange(prepared);
      } catch (err) {
        onLogoError?.(
          err instanceof Error ? err.message : "That image could not be used.",
        );
      }
    },
    [onLogoChange, onLogoError],
  );

  const set = (patch: Partial<LabIdentityValue>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="lab-name" className={labelClass}>
          Lab name
        </label>
        <input
          id="lab-name"
          type="text"
          value={value.labName}
          onChange={(e) => set({ labName: e.target.value })}
          placeholder="Fungal Interactions Lab"
          className={inputClass}
          disabled={disabled}
          autoComplete="off"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="pi-title" className={labelClass}>
            PI title
          </label>
          <select
            id="pi-title"
            value={value.piTitlePreset}
            onChange={(e) => set({ piTitlePreset: e.target.value })}
            className={inputClass}
            disabled={disabled}
          >
            {PI_TITLE_PRESETS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value="Custom">Custom...</option>
          </select>
          {value.piTitlePreset === "Custom" && (
            <input
              type="text"
              value={value.piTitleCustom}
              onChange={(e) => set({ piTitleCustom: e.target.value })}
              placeholder="Your title"
              className={`${inputClass} mt-2`}
              disabled={disabled}
              aria-label="Custom PI title"
              autoComplete="off"
            />
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="pi-display" className={labelClass}>
            PI name
          </label>
          <input
            id="pi-display"
            type="text"
            value={value.piDisplay}
            onChange={(e) => set({ piDisplay: e.target.value })}
            placeholder="Emile Gluck-Thaler"
            className={inputClass}
            disabled={disabled}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <span className={labelClass}>Lab logo (optional)</span>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logo.previewUrl}
                alt="Lab logo preview"
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="text-meta text-foreground-subtle">None</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <FileDropzone
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onFiles={(files) => {
                if (files[0]) void handleFile(files[0]);
              }}
              onReject={(msg) => onLogoError?.(msg)}
              disabled={disabled}
              compact
              label={logo ? "Replace logo" : "Choose logo"}
              hint="PNG, JPEG, WebP, SVG"
              ariaLabel="Lab logo"
            />
            {logo && (
              <button
                type="button"
                onClick={() => onLogoChange(null)}
                className="text-left text-meta text-foreground-muted hover:text-foreground disabled:opacity-50"
                disabled={disabled}
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <p className="text-meta text-foreground-subtle leading-relaxed">
          PNG, JPEG, WebP, or SVG. We shrink it on your device before upload.
        </p>
      </div>
    </div>
  );
}
