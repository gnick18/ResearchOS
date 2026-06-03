"use client";

import type { CSSProperties } from "react";

interface MethodChipProps {
  name: string;
  color?: string | null;
  onClick?: () => void;
  title?: string;
}

/**
 * Single method-reference chip used on experiment-outcome cards. Renders
 * the method's name on a tinted background sourced from the user-color
 * of the method's owner (the lab method index colors each method by its
 * author). Shared between the /lab Experiments gallery and the future
 * /workbench "Recent results" cards.
 */
export default function MethodChip({
  name,
  color,
  onClick,
  title,
}: MethodChipProps) {
  const style: CSSProperties | undefined = color
    ? {
        backgroundColor: hexToRgba(color, 0.12),
        color: hexToRgba(color, 1),
        borderColor: hexToRgba(color, 0.3),
      }
    : undefined;

  const baseClass =
    "inline-flex items-center px-2 py-0.5 text-meta rounded-md border max-w-[10rem] truncate";
  const interactive = onClick
    ? " hover:brightness-95 cursor-pointer transition"
    : "";

  if (onClick) {
    return (
      <button
        type="button"
        className={baseClass + interactive}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        style={style}
        title={title ?? name}
      >
        {name}
      </button>
    );
  }
  return (
    <span
      className={baseClass + " bg-gray-100 text-gray-700 border-gray-200"}
      style={style}
      title={title ?? name}
    >
      {name}
    </span>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6) {
    return alpha === 1 ? hex : `rgba(107, 114, 128, ${alpha})`;
  }
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) {
    return alpha === 1 ? hex : `rgba(107, 114, 128, ${alpha})`;
  }
  return alpha === 1
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
