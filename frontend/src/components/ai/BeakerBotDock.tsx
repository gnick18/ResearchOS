"use client";

// BeakerBotDock (ai retire-dock bot, 2026-06-11).
//
// The app-wide floating summon button for BeakerBot. Mounted ONCE in the ROOT
// layout (app/layout.tsx) so it covers every route without re-mounting on
// navigation.
//
// Phase 4 of BeakerSearch v2: the separate docked right-side panel is RETIRED.
// The floating FAB now opens the centered BeakerSearch palette in Ask mode,
// resuming the persisted conversation (which lives in the root conversation
// store and survives navigation and palette closes). No state is lost when the
// palette closes, so this FAB is the resume affordance: tap it to continue
// wherever the conversation left off.
//
// Visibility gate: shown ONLY when ALL of the following hold:
//   - AI_ASSISTANT_ENABLED flag is on (dark on main and in prod by default),
//   - a user is connected (never appears pre-login / on data-setup),
//   - the route is not suppressed (/sequences, /wiki).
// When in doubt, hide.
//
// House style: Icon only, brand + semantic tokens, no emojis, no em-dashes,
// no mid-sentence colons.

import { usePathname } from "next/navigation";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";
import { AI_ASSISTANT_ENABLED } from "@/lib/ai/config";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useBeakerSearch } from "@/components/beaker-search/BeakerSearchProvider";

export default function BeakerBotDock() {
  const { openBeakerBot } = useBeakerSearch();
  const { currentUser } = useFileSystem();
  const pathname = usePathname();

  // Self-gate. Hidden unless the flag is on AND a user is connected AND the
  // route is not a suppressed surface. Conservative: hide when in doubt.
  const onSuppressedRoute =
    !!pathname?.startsWith("/sequences") || !!pathname?.startsWith("/wiki");
  const visible = AI_ASSISTANT_ENABLED && !!currentUser && !onSuppressedRoute;

  if (!visible) return null;

  return (
    // Summon FAB. Fixed bottom-right, above the utility cluster so it never
    // collides with the Calculators / Report-bug row. Tapping it opens the
    // centered BeakerSearch palette in Ask mode, resuming the conversation.
    <Tooltip label="Ask BeakerBot" placement="left">
      <button
        type="button"
        data-testid="beakerbot-summon"
        aria-label="Open BeakerBot"
        onClick={openBeakerBot}
        className="pointer-events-auto fixed bottom-24 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl"
      >
        <Icon name="vial" className="h-5 w-5" title="BeakerBot" />
      </button>
    </Tooltip>
  );
}
