"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SnapshotTilePopup from "./SnapshotTilePopup";
import Tooltip from "@/components/Tooltip";
import {
  TOOL_REGISTRY,
  getTool,
  visibleTools,
  type ToolDefinition,
} from "@/lib/lab-overview/tool-registry";
import type { AccountType } from "@/lib/settings/user-settings";

/**
 * Lab Overview Tools refactor — Phase C (Tools refactor manager,
 * 2026-05-23): a header button on `/lab-overview` that opens a popover
 * listing every Tool the active user can access. Click a tool tile to
 * open that tool's popup.
 *
 * Why it exists (Grant 2026-05-23): "Have core popups with cool square
 * displays. Then all of the available tools should have a permanent
 * button or home at the top of the page somewhere that way even if
 * they dont have a widget for it the popup can be accessed."
 *
 * Scope choices (locked in by the brief):
 *   - lab-overview header only, NOT app-wide nav
 *   - popover (not full modal), feels lighter, matches the canvas
 *     density
 *   - iterates Tools, not Widgets — even if a user has three Purchases
 *     widget variants pinned, the launcher shows ONE Purchases entry
 *   - filtered by accountType against `memberVisible` / `labHeadVisible`
 *     on each Tool
 *   - clicking a tool tile closes the popover + opens the standard
 *     `<SnapshotTilePopup>` with the tool's ExpandedView (same popup
 *     chrome as the canvas tile clicks)
 *   - Esc closes the popover; Enter on a focused tile opens it
 *   - click outside the popover closes it (matching the
 *     CustomizableSidebar add-widget popover pattern)
 */
export interface ToolsLauncherProps {
  accountType: AccountType;
}

export default function ToolsLauncher({ accountType }: ToolsLauncherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [openToolId, setOpenToolId] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const tools = useMemo(() => visibleTools(accountType), [accountType]);

  // Close popover on Esc (only when no popup is open — Esc on the
  // popup is handled by SnapshotTilePopup itself).
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (openToolId) return; // popup owns Esc
      e.stopPropagation();
      setIsOpen(false);
      buttonRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, openToolId]);

  // Click outside closes the popover. Mirrors CustomizableSidebar's
  // add-widget popover dismissal pattern.
  useEffect(() => {
    if (!isOpen) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setIsOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [isOpen]);

  const openTool = openToolId ? getTool(openToolId) : null;

  const handleToolClick = useCallback((tool: ToolDefinition) => {
    setIsOpen(false);
    setOpenToolId(tool.id);
  }, []);

  const totalCount = TOOL_REGISTRY.length;
  const visibleCount = tools.length;

  return (
    <div className="relative inline-block">
      <Tooltip
        label={
          visibleCount === 0
            ? "No tools available for your account type"
            : `Open any of the ${visibleCount} available tools`
        }
        placement="bottom"
      >
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-label="Open tool"
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
            isOpen
              ? "bg-blue-600 border-blue-600 text-white"
              : "border-gray-200 text-gray-700 hover:bg-gray-50"
          }`}
        >
          {/* Grid-of-3-by-3 icon — reads as "apps / tools launcher" */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
          <span>Tools</span>
        </button>
      </Tooltip>

      {isOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Tools launcher"
          className="absolute top-full right-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-30 p-2"
          style={{
            boxShadow:
              "0 1px 3px rgba(0,0,0,0.06), 0 10px 30px -5px rgba(0,0,0,0.15)",
          }}
        >
          <div className="px-2 pt-1 pb-2 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">
              Tools
            </p>
            <p className="text-[10px] text-gray-400">
              {visibleCount} of {totalCount}
            </p>
          </div>
          {tools.length === 0 ? (
            <p className="text-xs text-gray-400 italic px-2 py-3">
              No tools available for your account type.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {tools.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => handleToolClick(tool)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleToolClick(tool);
                    }
                  }}
                  className="group text-left p-2 rounded-md border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1"
                  aria-label={`Open ${tool.title}`}
                  title={tool.description}
                >
                  <div className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className="text-blue-500 group-hover:text-blue-600 flex-shrink-0 mt-0.5"
                    >
                      {tool.Icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate">
                        {tool.title}
                      </p>
                      {tool.description && (
                        <p className="text-[10px] text-gray-500 line-clamp-2 leading-snug">
                          {tool.description}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Popup: opens the clicked tool's ExpandedView. Reuses the same
          `<SnapshotTilePopup>` shell every other surface (canvas,
          sidebar rail, customizable sidebar) uses. */}
      {openTool && (
        <SnapshotTilePopup
          title={openTool.title}
          onClose={() => setOpenToolId(null)}
        >
          <openTool.ExpandedView surface="canvas" isEditing={false} />
        </SnapshotTilePopup>
      )}
    </div>
  );
}
