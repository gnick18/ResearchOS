"use client";

// Dev preview for the account-setup revamp (Phase A + C). Renders the opening
// Splash and the AccountTierChooser in isolation so they can be reviewed and
// verified live WITHOUT touching the real entry gate (providers.tsx /
// ResearchFolderSetupNew). The real wiring is Phase B. This route is dev-only.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useState } from "react";

import { AccountTierChooser, type AccountTier } from "@/components/onboarding/AccountTierChooser";
import { Splash } from "@/components/onboarding/Splash";
import { SuccessTransition } from "@/components/onboarding/SuccessTransition";

type Stage = "splash" | "chooser" | "success";

export default function AccountSetupPreviewPage() {
  const [stage, setStage] = useState<Stage>("splash");
  const [chosen, setChosen] = useState<AccountTier | null>(null);

  return (
    <main className="min-h-screen bg-surface">
      {stage === "splash" && <Splash onComplete={() => setStage("chooser")} />}

      {stage === "chooser" && (
        <div className="py-10">
          <AccountTierChooser
            onChoose={(tier) => {
              setChosen(tier);
              setStage("success");
            }}
          />
        </div>
      )}

      {stage === "success" && (
        <SuccessTransition onComplete={() => setStage("chooser")} />
      )}

      {/* dev controls */}
      <div className="fixed bottom-4 left-4 z-[300] flex gap-2 rounded-xl border border-border bg-surface-overlay px-3 py-2 text-meta text-foreground shadow-lg">
        <span className="text-foreground-muted">preview:</span>
        <button className="font-semibold text-brand-action" onClick={() => setStage("splash")}>
          Replay splash
        </button>
        <button className="font-semibold text-brand-action" onClick={() => setStage("chooser")}>
          Chooser
        </button>
        <button className="font-semibold text-brand-action" onClick={() => setStage("success")}>
          Success
        </button>
        {chosen && <span className="text-foreground-muted">last choice: {chosen}</span>}
      </div>
    </main>
  );
}
