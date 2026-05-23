import type { ReactNode } from "react";

/**
 * Shared radio-card primitive used by the v4 Q1-Q6 setup steps.
 * Authoritative copy after the V3 rip (Phase B 2026-05-22).
 */
interface RadioCardProps<V extends string> {
  name: string;
  value: V;
  selected: boolean;
  onChange: (value: V) => void;
  label: string;
  description?: ReactNode;
}

export default function RadioCard<V extends string>({
  name,
  value,
  selected,
  onChange,
  label,
  description,
}: RadioCardProps<V>) {
  return (
    <label
      className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
        selected
          ? "border-sky-300 bg-sky-50"
          : "border-gray-200 hover:border-gray-300"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={selected}
        onChange={() => onChange(value)}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {description && (
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            {description}
          </p>
        )}
      </div>
    </label>
  );
}
