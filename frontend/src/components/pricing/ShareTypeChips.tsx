"use client";

/**
 * Multi-select share-type chips ("What do labs mainly share?") shared by the
 * department and institution plan builders on /pricing. At least one chip stays
 * selected, and the caller averages the selected per-member GB values (a mix of
 * share types), mirroring the mockup's multiToggle + avgData helpers.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import { SHARE_TYPE_OPTIONS } from "@/lib/pricing/assumptions";

export default function ShareTypeChips({
  selected,
  onChange,
}: {
  /** Indices into SHARE_TYPE_OPTIONS that are currently selected. */
  selected: number[];
  onChange: (next: number[]) => void;
}) {
  function toggle(i: number) {
    const has = selected.includes(i);
    let next = has ? selected.filter((x) => x !== i) : [...selected, i];
    // Always keep at least one chip on.
    if (next.length === 0) next = [i];
    onChange(next);
  }

  return (
    <div>
      <div className="mb-2 text-[12.5px] font-semibold text-foreground">
        What do labs mainly share? Pick any that apply.
      </div>
      <div className="flex flex-wrap gap-2">
        {SHARE_TYPE_OPTIONS.map((opt, i) => {
          const active = selected.includes(i);
          return (
            <button
              key={opt.label}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(i)}
              className={`cursor-pointer rounded-[9px] border px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${
                active
                  ? "border-brand-action bg-brand-action text-white"
                  : "border-border bg-surface-sunken text-foreground hover:border-foreground-muted"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
