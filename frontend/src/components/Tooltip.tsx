"use client";

import { Children, cloneElement, isValidElement, type ReactElement } from "react";

type Placement = "top" | "bottom" | "left" | "right";

interface Props {
  /** Required — short, action-oriented label, e.g. "Open settings". */
  label: string;
  /** Where the tooltip pops relative to the child. Default "bottom". */
  placement?: Placement;
  /**
   * Single child that the tooltip attaches to. Must be a positioned
   * (relative / absolute / fixed) element so the floating label can
   * absolute-position against it; if the child has no position class the
   * wrapper auto-applies `relative`.
   */
  children: ReactElement<{ className?: string; "aria-label"?: string }>;
  /** Optional aria-label override; defaults to `label`. */
  ariaLabel?: string;
}

const PLACEMENT_CLASSES: Record<Placement, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
  left: "right-full top-1/2 -translate-y-1/2 mr-1.5",
  right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
};

/**
 * Lightweight CSS-only tooltip. Wraps a single child element and shows the
 * label on hover/focus with a 100ms fade-in. Adds `group` + `relative` to
 * the child's className (preserving any existing classes) so the absolute
 * tooltip span anchors correctly without bumping page layout.
 *
 * Uses native `:hover` / `group-focus-within` rather than JS so there's no
 * 1-second native-title delay and no event handlers to worry about.
 */
export default function Tooltip({
  label,
  placement = "bottom",
  children,
  ariaLabel,
}: Props) {
  const child = Children.only(children);
  if (!isValidElement(child)) return child;

  const existing = child.props.className ?? "";
  // Only add `relative` if the child isn't already positioned — `fixed` /
  // `absolute` / `sticky` classes shouldn't be overridden.
  const needsRelative =
    !/(^|\s)(relative|absolute|fixed|sticky)(\s|$)/.test(existing);
  const merged = [
    existing,
    "group",
    needsRelative ? "relative" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return cloneElement(child, {
    className: merged,
    "aria-label": child.props["aria-label"] ?? ariaLabel ?? label,
    children: (
      <>
        {(child.props as { children?: React.ReactNode }).children}
        <span
          role="tooltip"
          className={`pointer-events-none absolute z-[200] whitespace-nowrap rounded-md bg-gray-900 text-white text-[11px] font-medium px-2 py-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-100 shadow-lg ${PLACEMENT_CLASSES[placement]}`}
        >
          {label}
        </span>
      </>
    ),
  } as Record<string, unknown>);
}
