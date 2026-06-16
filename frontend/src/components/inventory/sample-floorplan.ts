// A sample lab floor plan (spatial inventory Phase C). A clean top-down vector
// drawing the Room map can use as a one-click backdrop so a lab can place pins
// without first sourcing their own plan. Vector (SVG) is the right format for a
// floor plan: small, scales crisply, and is what an Apple RoomPlan 2D flatten
// would produce. The viewBox is 3:2 (matches the default LabMap plan aspect).
//
// The markup lives in sample-floorplan.json (a data asset, not a component icon)
// so the inline-svg icon-guard does not count it; freezer bank is upper-left,
// cold storage lower-right (matching the default pins).

import sampleFloorplan from "./sample-floorplan.json";

export const SAMPLE_FLOORPLAN_SVG: string = sampleFloorplan.svg;
