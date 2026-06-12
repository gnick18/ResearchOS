"use client";

// BeakerBotPanel (ai convo-store bot, 2026-06-11).
//
// The docked BeakerBot panel. Renders the panel chrome (header with the
// BeakerBot title, autonomy toggle, and close affordance) and delegates the
// conversation body to <BeakerBotConversation>, which owns the thread,
// approvals, status line, and composer.
//
// By delegating to BeakerBotConversation, the same body component can be
// rendered by the BeakerSearch palette in Phase 2 without duplicating any
// rendering logic. The dock stays visually identical to before because
// BeakerBotConversation is a pixel-perfect extraction of what used to be
// inside this component.
//
// House style, Icon only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";
import { useBeakerBotAutonomy } from "@/lib/ai/autonomy-store";
import BeakerBotConversation from "./BeakerBotConversation";

export default function BeakerBotPanel({
  onClose,
}: {
  // When provided, the header shows a close affordance. The app-wide docked
  // mount passes this so the panel can collapse; the full-page /ai route omits
  // it so that surface stays close-free, exactly as before.
  onClose?: () => void;
} = {}) {
  const autonomy = useBeakerBotAutonomy((s) => s.mode);
  const toggleAutonomy = useBeakerBotAutonomy((s) => s.toggle);

  return (
    <div
      data-testid="beakerbot-panel"
      className="flex h-full w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-surface-overlay"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="text-brand">
          <Icon name="vial" className="h-5 w-5" title="BeakerBot" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-body font-semibold text-foreground">BeakerBot</h2>
          <p className="text-meta text-foreground-muted">
            Ask BeakerBot about your work in ResearchOS.
          </p>
        </div>
        {/* Autonomy toggle. "Ask" (default) means BeakerBot proposes an action
            and waits for you to allow it. "Auto" lets it act on reversible
            in-app steps without asking; dangerous or outward-facing actions
            still confirm. */}
        <Tooltip
          label={
            autonomy === "auto"
              ? "Auto mode. BeakerBot acts without asking, except for risky actions. Click to require approval."
              : "Ask mode. BeakerBot asks before it acts. Click to let it act automatically."
          }
          placement="bottom"
        >
          <button
            type="button"
            data-testid="beakerbot-autonomy-toggle"
            aria-label={
              autonomy === "auto"
                ? "BeakerBot autonomy, auto. Switch to ask before doing."
                : "BeakerBot autonomy, ask before doing. Switch to auto."
            }
            aria-pressed={autonomy === "auto"}
            onClick={toggleAutonomy}
            className={`flex flex-shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-meta font-medium transition-colors ${
              autonomy === "auto"
                ? "border-brand bg-brand/10 text-brand"
                : "border-border text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
            }`}
          >
            <Icon
              name={autonomy === "auto" ? "bolt" : "ask"}
              className="h-3.5 w-3.5"
              title={autonomy === "auto" ? "Auto" : "Ask"}
            />
            {autonomy === "auto" ? "Auto" : "Ask"}
          </button>
        </Tooltip>
        {onClose ? (
          <button
            type="button"
            data-testid="beakerbot-close"
            aria-label="Close BeakerBot"
            onClick={onClose}
            className="flex-shrink-0 rounded-md p-1 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
          >
            <Icon name="close" className="h-4 w-4" title="Close BeakerBot" />
          </button>
        ) : null}
      </header>

      {/* Conversation body, thread + approvals + status + composer. The flex-1
          lets it fill the remaining height inside the panel's flex column. */}
      <BeakerBotConversation className="flex-1" />
    </div>
  );
}
