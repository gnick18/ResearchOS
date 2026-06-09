// Shared Toggle component. Previously duplicated between AppearanceCard and
// CompanionHub. Extracted here so both import a single source of truth.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export default function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer select-none">
      <span className="min-w-0">
        <span className="block text-body font-medium text-foreground">{label}</span>
        {description && (
          <span className="block text-meta text-foreground-muted mt-0.5 leading-relaxed">
            {description}
          </span>
        )}
      </span>
      <span className="relative shrink-0 mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="block h-6 w-11 rounded-full bg-foreground-muted/30 peer-checked:bg-blue-600 transition-colors" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface-raised transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}
