"use client";

// ComposerSlashMenu (ai at-mentions bot, 2026-06-13).
//
// The "/" command menu that opens inline above the BeakerBot composer when the
// user types a leading slash. Renders two groups, the data-driven SLASH_COMMANDS
// registry (lib/ai/slash-commands.ts) and the user's saved workflow macros.
//
// A curated command pre-fills the composer with its intent phrase (the parent
// owns the textarea write and the caret), each maps to a tool that already
// exists. A macro is already a fixed sequence, so selecting it does NOT pre-fill,
// it stages a run (the parent calls runStoredMacro). Macros read differently,
// tinted with a "macro" tag, so a saved routine is never confused for a one-shot.
//
// Presentational only, keyboard navigation (up/down/enter/escape) is driven by
// the parent so the textarea keeps focus. The parent passes the filtered lists
// plus a single active index that spans commands THEN macros, so one arrow path
// moves through both groups.
//
// House style, no inline SVG, no emojis / em-dashes / mid-sentence colons.

import type { SlashCommand } from "@/lib/ai/slash-commands";

// The minimal macro shape the menu renders. Kept local so this presentational
// component does not depend on the full StoredMacro.
export type MacroMenuItem = {
  id: number;
  name: string;
  description: string;
};

export default function ComposerSlashMenu({
  commands,
  macros,
  activeIndex,
  onSelect,
  onSelectMacro,
}: {
  /** The filtered command list (from filterSlashCommands in the parent). */
  commands: SlashCommand[];
  /** The filtered macro list (from the parent). May be empty. */
  macros: MacroMenuItem[];
  /** The highlighted row index, spanning commands first then macros. */
  activeIndex: number;
  /** Called when a curated command is chosen (click or Enter). */
  onSelect: (command: SlashCommand) => void;
  /** Called when a macro is chosen (click or Enter), the parent runs it. */
  onSelectMacro: (macro: MacroMenuItem) => void;
}) {
  const hasAny = commands.length > 0 || macros.length > 0;

  return (
    <div
      data-testid="beakerbot-slash-menu"
      role="listbox"
      aria-label="Commands"
      className="absolute bottom-[calc(100%+4px)] left-0 right-0 z-30 overflow-hidden rounded-md border border-border bg-surface-raised shadow-lg"
    >
      {!hasAny ? (
        <div className="px-3 py-2 text-meta text-foreground-muted">
          No matching command
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto pb-1">
          {commands.length > 0 ? (
            <>
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
                Commands
              </div>
              {commands.map((command, i) => {
                const isActive = i === activeIndex;
                return (
                  <button
                    key={command.name}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    data-testid="beakerbot-slash-row"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onSelect(command);
                    }}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
                      isActive ? "bg-brand/10" : "hover:bg-surface-sunken"
                    }`}
                  >
                    <span className="w-[88px] flex-none text-body font-semibold text-brand">
                      /{command.name}
                    </span>
                    <span className="flex-1 text-meta leading-snug text-foreground-muted">
                      {command.description}
                    </span>
                  </button>
                );
              })}
            </>
          ) : null}

          {macros.length > 0 ? (
            <>
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-purple-500 dark:text-purple-300">
                Your macros
              </div>
              {macros.map((macro, j) => {
                const index = commands.length + j;
                const isActive = index === activeIndex;
                return (
                  <button
                    key={macro.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    data-testid="beakerbot-macro-row"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onSelectMacro(macro);
                    }}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
                      isActive ? "bg-purple-500/10" : "hover:bg-surface-sunken"
                    }`}
                  >
                    <span className="w-[88px] flex-none truncate text-body font-semibold text-purple-600 dark:text-purple-300">
                      /{macro.name}
                    </span>
                    <span className="flex-1 text-meta leading-snug text-foreground-muted">
                      {macro.description}
                    </span>
                    <span className="flex-none rounded bg-purple-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-purple-600 dark:text-purple-300">
                      macro
                    </span>
                  </button>
                );
              })}
            </>
          ) : null}
        </div>
      )}

      <div className="flex gap-3 border-t border-border px-3 py-1.5 text-[10px] text-foreground-muted">
        <span>Up and down to navigate</span>
        <span>Enter to select</span>
        <span>Esc to close</span>
      </div>
    </div>
  );
}
