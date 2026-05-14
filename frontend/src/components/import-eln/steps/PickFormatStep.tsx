"use client";

import { useCallback } from "react";

export type ELNFormat = "labarchives-zip" | "labarchives-pdf" | "chrome-pdf";

interface FormatCardSpec {
  id: ELNFormat;
  title: string;
  subtitle: string;
  helper?: string;
  disabled: boolean;
}

const FORMATS: FormatCardSpec[] = [
  {
    id: "labarchives-zip",
    title: "LabArchives Offline Notebook ZIP",
    subtitle: "Full notebook export with attachments. Best fidelity.",
    helper:
      "LabArchives → ≡ menu → Utilities → Create Offline Notebook → wait for email → download ZIP.",
    disabled: false,
  },
  {
    id: "labarchives-pdf",
    title: "LabArchives Notebook-to-PDF",
    subtitle: "Not supported yet — coming in a future release.",
    disabled: true,
  },
  {
    id: "chrome-pdf",
    title: "Chrome Print-to-PDF",
    subtitle: "Not supported yet — coming in a future release.",
    disabled: true,
  },
];

interface PickFormatStepProps {
  selected: ELNFormat | null;
  onSelect: (next: ELNFormat) => void;
}

export default function PickFormatStep({ selected, onSelect }: PickFormatStepProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">
          Choose the export format you have.
        </h3>
        <p className="text-xs text-gray-500 mt-1">
          Right now we only support the LabArchives Offline Notebook ZIP. The
          other two are sketched here so you know they&apos;re on the roadmap.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {FORMATS.map((f) => (
          <FormatCard
            key={f.id}
            spec={f}
            isSelected={selected === f.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function FormatCard({
  spec,
  isSelected,
  onSelect,
}: {
  spec: FormatCardSpec;
  isSelected: boolean;
  onSelect: (next: ELNFormat) => void;
}) {
  const handleClick = useCallback(() => {
    if (spec.disabled) return;
    onSelect(spec.id);
  }, [spec.disabled, spec.id, onSelect]);

  const base =
    "text-left p-4 rounded-xl border transition-colors flex flex-col gap-2 h-full";
  const enabled = isSelected
    ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
    : "border-gray-200 hover:border-gray-400 bg-white";
  const disabled =
    "border-dashed border-gray-300 bg-gray-50 cursor-not-allowed opacity-60 grayscale";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={spec.disabled}
      className={`${base} ${spec.disabled ? disabled : enabled}`}
      aria-pressed={isSelected}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-900">{spec.title}</p>
        {spec.disabled && (
          <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 bg-gray-200 rounded px-1.5 py-0.5 whitespace-nowrap">
            Coming soon
          </span>
        )}
      </div>
      <p className="text-xs text-gray-600">{spec.subtitle}</p>
      {spec.helper && (
        <p className="text-[11px] text-gray-500 mt-auto leading-relaxed">{spec.helper}</p>
      )}
    </button>
  );
}
