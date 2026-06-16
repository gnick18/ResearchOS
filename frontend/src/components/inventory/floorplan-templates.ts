// Starter lab floor plans for the Room map (spatial inventory Phase C). A small
// library a lab can pick from instead of sourcing or drawing their own plan. Each
// is a clean top-down vector layout that the map fits true-to-shape via its aspect.
//
// The markup lives in floorplan-templates.json (a data asset, not component icons)
// so the inline-svg icon-guard does not count it.

import data from "./floorplan-templates.json";

export interface FloorPlanTemplate {
  id: string;
  name: string;
  /** width / height of the plan, so the map fits it without distortion. */
  aspect: number;
  /** Inline SVG markup rendered as the map backdrop. */
  svg: string;
}

export const FLOOR_PLAN_TEMPLATES: FloorPlanTemplate[] =
  (data as { templates: FloorPlanTemplate[] }).templates;
