"use client";

// Dev preview for the account-setup revamp. Renders the opening Splash, the
// StartScreen front door, the AccountTierChooser, and the SuccessTransition in
// isolation so the full flow can be reviewed and verified live WITHOUT a fresh
// folder and without touching the real entry gate. This route is dev-only.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useState } from "react";

import { AccountTierChooser, type AccountTier } from "@/components/onboarding/AccountTierChooser";
import { StartScreen } from "@/components/onboarding/StartScreen";
import { Splash } from "@/components/onboarding/Splash";
import { SuccessTransition } from "@/components/onboarding/SuccessTransition";

type Stage = "splash" | "start" | "start-returning" | "chooser" | "success";

export default function AccountSetupPreviewPage() {
  const [stage, setStage] = useState<Stage>("splash");
  const [chosen, setChosen] = useState<AccountTier | null>(null);

  return (
    <main className="min-h-screen bg-surface">
      {stage === "splash" && <Splash onComplete={() => setStage("start")} />}

      {(stage === "start" || stage === "start-returning") && (
        <StartScreen
          returning={stage === "start-returning"}
          onOpenFolder={() => setStage("success")}
          onCreateAccount={() => setStage("chooser")}
          onScrollDown={() => {}}
        />
      )}

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
        <button className="font-semibold text-brand-action" onClick={() => setStage("start")}>
          Start (fresh)
        </button>
        <button className="font-semibold text-brand-action" onClick={() => setStage("start-returning")}>
          Start (returning)
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
