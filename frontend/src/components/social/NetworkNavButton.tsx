"use client";

// A permanent, non-draggable nav control that opens the public researcher
// network on the .com origin. It is deliberately SEPARATE from the
// drag-customizable data tabs (Grant 2026-06-20): the network is a distinct
// destination, not one of the per-user workspace tools, so it lives in the nav's
// trailing control slot beside the folder pill rather than in the tab strip.
//
// Links out to research-os.com/network (the public, login-free hub) in a new tab.
// Gated by SOCIAL_LAYER_ENABLED to match the rest of the network surfaces, so it
// is inert when the social layer is off.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { SOCIAL_LAYER_ENABLED } from "@/lib/social/config";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";

const NETWORK_COM_URL = "https://research-os.com/network";

export default function NetworkNavButton({ tinted }: { tinted?: boolean }) {
  if (!SOCIAL_LAYER_ENABLED) return null;
  return (
    <Tooltip label="Open the researcher network" placement="bottom">
      <a
        href={NETWORK_COM_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open the researcher network on research-os.com"
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
          tinted
            ? "bg-white/75 text-gray-700 hover:bg-white shadow-sm"
            : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
        }`}
      >
        <Icon name="network" className="h-[18px] w-[18px]" />
        <span>Network</span>
      </a>
    </Tooltip>
  );
}
