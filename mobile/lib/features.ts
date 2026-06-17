// Mobile feature flags.
//
// Spatial inventory (Phase B structured box-finder + Phase C 2D/3D room map) is
// gated OFF by default, permanently. Decision 2026-06-16 (Grant): real labs label
// their drawers, so the phone only shows the free-text location note (Phase A).
// The room-map viewer, find-on-map links, and external-storage rows stay in the
// code but dormant, revivable later. Set EXPO_PUBLIC_SPATIAL_INVENTORY_ENABLED=1
// (or "true") to bring them back. Expo inlines EXPO_PUBLIC_* at build time, so an
// unset value resolves to OFF.
export const SPATIAL_INVENTORY_ENABLED =
  process.env.EXPO_PUBLIC_SPATIAL_INVENTORY_ENABLED === '1' ||
  process.env.EXPO_PUBLIC_SPATIAL_INVENTORY_ENABLED === 'true';
