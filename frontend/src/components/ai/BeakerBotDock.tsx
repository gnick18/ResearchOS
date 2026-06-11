"use client";

// BeakerBotDock (ai docking bot, 2026-06-11).
//
// The app-wide home for BeakerBot. Mounted ONCE at the AppShell level so the
// conversation panel (and its useAiChat state inside BeakerBotPanel) PERSISTS
// across client-side route changes. Previously the panel lived only on the /ai
// route and unmounted on navigation, which broke the navigate-and-spotlight tool,
// when BeakerBot walked you to another page to highlight a button, the chat was
// left behind. With the panel always mounted here, spotlight_ui_element can
// navigate the app while the conversation stays exactly where it was.
//
// This component renders two things, the summon FAB (a floating button that
// toggles the panel) and the docked panel itself (right side, collapsible). The
// open/closed flag lives in the panel store so it survives navigation; the panel
// is hidden with a transform when closed, NOT unmounted, so the conversation is
// never torn down.
//
// Gating, the whole dock is gated on AI_ASSISTANT_ENABLED by the AppShell caller,
// so it stays dark on main and in prod (flag off by default) until BeakerBot is
// further along.
//
// House style, Icon only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";
import BeakerBotPanel from "./BeakerBotPanel";
import { useBeakerBotPanel } from "@/lib/ai/panel-store";

export default function BeakerBotDock() {
  const isOpen = useBeakerBotPanel((s) => s.isOpen);
  const toggle = useBeakerBotPanel((s) => s.toggle);
  const close = useBeakerBotPanel((s) => s.close);

  return (
    <>
      {/* Summon FAB. Sits bottom-right above the utility cluster so it does not
          collide with the Calculators / Report-bug row. Hidden while the panel
          is open (the panel has its own close affordance), so there is never a
          duplicate toggle on screen. pointer-events-auto because the FAB is its
          own fixed element here, not inside the pointer-events-none cluster. */}
      {!isOpen ? (
        <Tooltip label="Ask BeakerBot" placement="left">
          <button
            type="button"
            data-testid="beakerbot-summon"
            aria-label="Open BeakerBot"
            aria-expanded={isOpen}
            onClick={toggle}
            className="pointer-events-auto fixed bottom-24 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl"
          >
            <Icon name="vial" className="h-5 w-5" title="BeakerBot" />
          </button>
        </Tooltip>
      ) : null}

      {/* Docked panel. Always mounted (so the conversation persists), shown or
          hidden by translating it off-screen so React keeps it alive. Right-side
          docked column matching the interface concept. aria-hidden + the
          off-canvas transform keep it out of the tab order while collapsed. */}
      <div
        data-testid="beakerbot-dock"
        data-open={isOpen ? "true" : "false"}
        aria-hidden={!isOpen}
        className={`fixed bottom-4 right-4 top-20 z-40 flex w-full max-w-md transition-transform duration-200 ${
          isOpen
            ? "translate-x-0"
            : "pointer-events-none translate-x-[calc(100%+2rem)]"
        }`}
      >
        <BeakerBotPanel onClose={close} />
      </div>
    </>
  );
}
