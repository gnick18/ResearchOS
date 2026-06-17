// Spatial inventory layers — gated OFF by default, permanently.
//
// Decision 2026-06-16 (Grant): real labs already label every drawer/box, so the
// only location feature that ships is the free-text note (Phase A) — "type where
// you put it, using your own numbering". The richer layers are intentionally
// dormant, NOT deleted, so they can be revived in a future season if a lab ever
// asks for them:
//   - Phase B: the structured box-finder (cascading freezer -> rack -> box -> cell
//     picker + the Storage map tree view).
//   - Phase C: the 2D room map (RoomMap), pins, floor-plan templates, location
//     photos, external-storage section, and the (unbuilt) iPhone RoomPlan 3D scan.
//
// All of that code stays in the tree and behind this single flag. To bring it
// back, set NEXT_PUBLIC_SPATIAL_INVENTORY_ENABLED=1 (or "true"). Independent of
// NEXT_PUBLIC_INVENTORY_ENABLED so the free-text location stays on regardless.
export const SPATIAL_INVENTORY_ENABLED =
  process.env.NEXT_PUBLIC_SPATIAL_INVENTORY_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_SPATIAL_INVENTORY_ENABLED === "true";
