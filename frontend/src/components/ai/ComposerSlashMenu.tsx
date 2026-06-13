"use client";

// ComposerSlashMenu (ai at-mentions bot, 2026-06-13).
//
// The "/" command menu that opens inline above the BeakerBot composer when the
// user types a leading slash. Renders the data-driven SLASH_COMMANDS registry
// (lib/ai/slash-commands.ts). Selecting a command pre-fills the composer with the
// command's intent phrase, the parent owns the textarea write and the caret. This
// is purely the input affordance, each command maps to a tool that already exists.
//
// Presentational only, keyboard navigation (up/down/enter/escape) is driven by the
// parent so the textarea keeps focus. The parent passes the filtered list plus the
// active index, mirroring ComposerMentionPicker.
//
// House style, no inline SVG, no emojis / em-dashes / mid-sentence colons.

import type { SlashCommand } from "@/lib/ai/slash-commands";

export default function ComposerSlashMenu({
  commands,
  activeIndex,
  onSelect,
}: {
  /** The filtered command list (from filterSlashCommands in the parent). */
  commands: SlashCommand[];
  /** The currently highlighted row index (driven by keyboard in the parent). */
  activeIndex: number;
  /** Called when a command is chosen (click or Enter). */
  onSelect: (command: SlashCommand) => void;
}) {
  return (
    <div
      data-testid="beakerbot-slash-menu"
      role="listbox"
      aria-label="Commands"
      className="absolute bottom-[calc(100%+4px)] left-0 right-0 z-30 overflow-hidden rounded-md border border-border bg-surface-raised shadow-lg"
    >
      <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
        Commands
      </div>

      {commands.length > 0 ? (
        <div className="max-h-64 overflow-y-auto pb-1">
          {commands.map((command, i) => {
            const isActive = i === activeIndex;
            return (
              <button
                key={command.name}
                type="button"
                role="option"
                aria-selected={isActive}
                data-testid="beakerbot-slash-row"
                // onMouseDown so the textarea keeps focus through the select.
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
        </div>
      ) : (
        <div className="px-3 pb-2 text-meta text-foreground-muted">
          No matching command
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
