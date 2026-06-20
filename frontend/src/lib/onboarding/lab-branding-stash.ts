// Onboarding wizard -> LabCreateResume handoff for the captured lab identity.
//
// The PI / lab Create wizard track captures the lab name, PI title, PI display
// name, and an optional logo in its LabStep, but the lab itself is not
// provisioned until LATER: after the folder is connected, the global
// LabCreateResume mount runs createLabLocal + publishPendingGenesis. Without a
// bridge between the two, the captured branding is dropped on the floor and
// LabCreateResume re-prompts with its own LabSetupStep (the "wizard popped up
// AGAIN" bug), and the lab is created with no name (so it falls back to the
// head's username).
//
// This module is that bridge. The text branding rides in sessionStorage so it
// survives a reload between capture and provisioning; the logo bytes ride in a
// module-level variable (best-effort, survives the client-side navigation from
// the wizard finish to the app root, lost only on a hard reload, exactly like a
// skipped logo which the head can re-upload in Settings).
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { PreparedLogo } from "@/lib/lab/lab-logo-image";

const BRANDING_KEY = "researchos:lab-branding";

/** The text half of the captured lab identity (everything but the logo). */
export interface StashedLabBranding {
  labName: string;
  piTitle: string;
  piDisplay: string;
}

// The logo bytes cannot serialize cleanly into sessionStorage, so they ride in
// memory. This survives a client-side router.replace (the wizard finish) but not
// a hard reload, matching the optional, re-uploadable nature of the logo.
let stashedLogo: PreparedLogo | null = null;

/** Stash the text branding so LabCreateResume can provision the lab with it. */
export function stashLabBranding(branding: StashedLabBranding): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(BRANDING_KEY, JSON.stringify(branding));
  } catch {
    // sessionStorage unavailable (private mode quota, etc.). The lab can still
    // be created via the LabSetupStep fallback; nothing is lost but the prefill.
  }
}

/** Stash the optional logo (best-effort, in memory). */
export function stashLabLogo(logo: PreparedLogo | null): void {
  stashedLogo = logo;
}

/**
 * Whether lab branding is currently stashed, WITHOUT consuming it. The wizard
 * resume uses this to decide if the lab-setup step is already done (so a
 * re-entry skips it rather than re-asking the lab name). Read-only, so it never
 * disturbs the consume-once contract.
 */
export function hasStashedLabBranding(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(BRANDING_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Read AND clear the stashed text branding. Returns null when nothing was
 * captured (e.g. the chooser path, which has no wizard LabStep), in which case
 * LabCreateResume falls back to its own LabSetupStep.
 */
export function consumeLabBranding(): StashedLabBranding | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(BRANDING_KEY);
    if (raw !== null) window.sessionStorage.removeItem(BRANDING_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StashedLabBranding>;
    return {
      labName: typeof parsed.labName === "string" ? parsed.labName : "",
      piTitle: typeof parsed.piTitle === "string" ? parsed.piTitle : "",
      piDisplay: typeof parsed.piDisplay === "string" ? parsed.piDisplay : "",
    };
  } catch {
    return null;
  }
}

/** Read AND clear the stashed logo. */
export function consumeLabLogo(): PreparedLogo | null {
  const logo = stashedLogo;
  stashedLogo = null;
  return logo;
}
