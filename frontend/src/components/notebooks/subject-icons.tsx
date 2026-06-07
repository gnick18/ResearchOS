/**
 * Notebook subject icons — 8 science/classroom SVG icons approved by Grant
 * (session aeb7c2f3, 2026-06-07). Each renders at any size via className;
 * the viewBox is 0 0 24 24, stroke="currentColor", fill="none", same style
 * as the rest of the ResearchOS icon library.
 *
 * Color palette: 10 presets that match the project/experiment swatch pattern.
 */

import type { FC, SVGProps } from "react";

export type SubjectIconKey =
  | "biology"
  | "chemistry"
  | "physics"
  | "mathematics"
  | "computer_science"
  | "neuroscience"
  | "ecology"
  | "genetics";

type SvgFC = FC<SVGProps<SVGSVGElement>>;

const BASE: SVGProps<SVGSVGElement> = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const BiologyIcon: SvgFC = (props) => (
  <svg {...BASE} {...props}>
    <path d="M12 3Q19.5 7 19.5 12Q19.5 17.5 12 21Q4.5 17.5 4.5 12Q4.5 7 12 3Z" />
    <path d="M12 21V3" />
    <path d="M12 15.5L8 11.5M12 15.5L16 11.5" />
  </svg>
);

export const ChemistryIcon: SvgFC = (props) => (
  <svg {...BASE} {...props}>
    <path d="M10 2H14" />
    <path d="M10 2V8M14 2V8" />
    <path d="M10 8L5 20C4.5 21 5 21.5 6 21.5H18C19 21.5 19.5 21 19 20L14 8" />
    <path d="M7.5 17H16.5" />
  </svg>
);

export const PhysicsIcon: SvgFC = (props) => (
  <svg {...BASE} {...props}>
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(120 12 12)" />
  </svg>
);

export const MathematicsIcon: SvgFC = (props) => (
  <svg {...BASE} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M7.5 9.5H16.5" />
    <path d="M10 9.5C10 13.5 9.5 15.5 8 18" />
    <path d="M14 9.5V18" />
  </svg>
);

export const ComputerScienceIcon: SvgFC = (props) => (
  <svg {...BASE} {...props}>
    <path d="M8 7L3 12L8 17" />
    <path d="M16 7L21 12L16 17" />
    <path d="M14 6L10 18" />
  </svg>
);

export const NeuroscienceIcon: SvgFC = (props) => (
  <svg {...BASE} {...props}>
    <path d="M12 5C9.5 5 7 6.8 7 9.5C7 10.5 7.4 11.4 8 12C7 12.4 6 13.5 6 15C6 17 7.5 18.5 9 18.5H15C16.5 18.5 18 17.2 18 15.5C18 14 17.2 12.8 16 12.3C16.6 11.5 17 10.5 17 9.5C17 6.8 14.5 5 12 5Z" />
    <path d="M12 5V18.5" />
    <path d="M9 10C9 10 10 11 12 11C14 11 15 10 15 10" />
    <path d="M9 15C9 15 10 14 12 14C14 14 15 15 15 15" />
  </svg>
);

export const EcologyIcon: SvgFC = (props) => (
  <svg {...BASE} {...props}>
    <path d="M12 2L4 12H9L5 20H12M12 2L20 12H15L19 20H12" />
    <path d="M12 20V22" />
  </svg>
);

export const GeneticsIcon: SvgFC = (props) => (
  <svg {...BASE} {...props}>
    <g transform="rotate(-38 12 12)">
      <path d="M3 9C7 9 9 15 12 15C15 15 17 9 21 9" />
      <path d="M3 15C7 15 9 9 12 9C15 9 17 15 21 15" />
      <line x1="5" y1="10" x2="5" y2="14" />
      <line x1="7.5" y1="11.2" x2="7.5" y2="12.8" />
      <line x1="10.5" y1="13" x2="10.5" y2="11" />
      <line x1="13.5" y1="11" x2="13.5" y2="13" />
      <line x1="16.5" y1="11.2" x2="16.5" y2="12.8" />
      <line x1="19" y1="10" x2="19" y2="14" />
    </g>
  </svg>
);

export const SUBJECT_ICONS: Record<
  SubjectIconKey,
  { label: string; Icon: SvgFC }
> = {
  biology: { label: "Biology", Icon: BiologyIcon },
  chemistry: { label: "Chemistry", Icon: ChemistryIcon },
  physics: { label: "Physics", Icon: PhysicsIcon },
  mathematics: { label: "Mathematics", Icon: MathematicsIcon },
  computer_science: { label: "Computer Science", Icon: ComputerScienceIcon },
  neuroscience: { label: "Neuroscience", Icon: NeuroscienceIcon },
  ecology: { label: "Ecology", Icon: EcologyIcon },
  genetics: { label: "Genetics", Icon: GeneticsIcon },
};

export const SUBJECT_ICON_KEYS = Object.keys(SUBJECT_ICONS) as SubjectIconKey[];

/** Resolve an icon component from its key string (guards bad stored values). */
export function getSubjectIcon(key: string | undefined): SvgFC | null {
  if (!key) return null;
  return SUBJECT_ICONS[key as SubjectIconKey]?.Icon ?? null;
}

/** 10-color palette for notebook covers. Hex values match the project/experiment swatch style. */
export const NOTEBOOK_COLORS = [
  { hex: "#3b82f6", label: "Blue" },
  { hex: "#8b5cf6", label: "Violet" },
  { hex: "#ec4899", label: "Pink" },
  { hex: "#ef4444", label: "Red" },
  { hex: "#f97316", label: "Orange" },
  { hex: "#eab308", label: "Yellow" },
  { hex: "#22c55e", label: "Green" },
  { hex: "#14b8a6", label: "Teal" },
  { hex: "#06b6d4", label: "Cyan" },
  { hex: "#6b7280", label: "Gray" },
] as const;
