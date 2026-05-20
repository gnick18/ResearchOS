"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import OnboardingTutorialSequencer from "@/components/OnboardingTutorialSequencer";
import {
  isDemoOrWikiCapture,
  isTutorialMode,
} from "@/lib/file-system/wiki-capture-mock";

// TODO P1: rewire to v4 walkthrough per ONBOARDING_V3_PROPOSAL.md §5-§11.
// The old orchestrator body (tip roll loop, mode/sidecar state machine,
// wizard mount gate, cross-tab tutorial subscriber) is gone with the
// sidecar v3 → v4 migration (P0). The OnboardingProvider mount decision
// below is preserved as the only piece of "mount logic" the brief asks
// P0 to keep intact; the OnboardingOrchestrator body is a pass-through
// stub until P1 builds the v3 walkthrough surface.
//
// Consumers of useOnboarding() see a context that returns no-ops for
// every method, so DevForceTipButton and any other surface that calls
// orchestrator.forceFireTip(...) compiles cleanly and silently does
// nothing. The wizard preview hook (?wizard-preview=1) is also a no-op
// here, P1 will reintroduce it against the v3 wizard component.

interface OrchestratorContextValue {
  cancelTip: (tipId: string) => void;
  forceFireTip: (tipId: string) => void;
}

const NO_OP_CONTEXT: OrchestratorContextValue = {
  cancelTip: () => {},
  forceFireTip: () => {},
};

const OrchestratorContext = createContext<OrchestratorContextValue | null>(null);

export function OnboardingOrchestrator({
  children,
}: {
  username: string;
  children: ReactNode;
}) {
  return (
    <OrchestratorContext.Provider value={NO_OP_CONTEXT}>
      {children}
    </OrchestratorContext.Provider>
  );
}

export function useOnboarding(): OrchestratorContextValue | null {
  return useContext(OrchestratorContext);
}

/**
 * Top-level provider that decides what onboarding surface (if any) to
 * mount. P0 keeps the mount-decision tree intact so /demo?tutorial=1
 * still wires up the Phase-4 sequencer; the real orchestrator body it
 * routes to is a P1 rewrite target.
 */
export function OnboardingProvider({
  currentUser,
  children,
}: {
  currentUser: string | null;
  children: ReactNode;
}) {
  const searchParams = useSearchParams();
  const wizardPreviewMode = searchParams?.get("wizard-preview") === "1";

  if (!currentUser) return <>{children}</>;
  if (isDemoOrWikiCapture() && !wizardPreviewMode) {
    if (isTutorialMode()) {
      return (
        <>
          {children}
          <OnboardingTutorialSequencer />
        </>
      );
    }
    return <>{children}</>;
  }
  return (
    <OnboardingOrchestrator username={currentUser}>
      {children}
    </OnboardingOrchestrator>
  );
}
