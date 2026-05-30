"use client";

import { useMilestoneTwirlTrigger } from "@/hooks/useMilestoneTwirlTrigger";

/**
 * Mounts the milestone twirl trigger (twirl-milestones bot) as a peer of
 * CelebrationManager inside V4MountForUser, where the active username is
 * in scope and the `tour-goodbye:play-outro` window event is dispatched.
 *
 * The hook fires the celebratory BeakerBot twirl ONCE on the first
 * occurrence of three rare checkpoint moments (tour complete, first
 * experiment complete, first project fully done), deduped per-user in
 * localStorage and gated by the BeakerBot-animations opt-out. The 7-day
 * streak twirl is owned by CelebrationManager, not this mount, so the
 * streak never double-celebrates. Renders nothing.
 */
export default function MilestoneTwirlMount({
  username,
}: {
  username: string | null;
}) {
  useMilestoneTwirlTrigger(username);
  return null;
}
