"use client";

// Track builders for the onboarding wizard. Each builder assembles the step
// components into a WizardTrack the shell can drive. The account tracks merge the
// former Handle, Profile, and Preferred-name pages into ONE Identity step so a
// fresh sign-in has fewer pages to clear before reaching the folder:
//
//   Solo (free):  Sign in (no skip) -> Identity (no skip) -> Folder (no skip)
//   Solo (local): Folder + Preferred-name (no account, kept as is)
//   PI / lab:     Sign in -> Identity -> Lab setup (no skip) -> Folder
//
// The org-admin track (Track 3) is built in tracks-org.tsx (Phase 4).
//
// Sign in is a page-leaving OAuth redirect, so the SignInStep does not advance
// the shell itself; the host resumes the wizard at the next step on the
// post-OAuth return. The builders are pure data, so the host owns finish/close.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { WizardTrack } from "./wizard-model";
import SignInStep from "./steps/SignInStep";
import IdentityStep from "./steps/IdentityStep";
import LabStep, { type LabStepResult } from "./steps/LabStep";
import FolderStep from "./steps/FolderStep";
// PreferredNameStep is still used by the local-only track (no account, so no
// merged Identity step); the merged Identity step saves the greeting itself.
import PreferredNameStep from "./steps/PreferredNameStep";

/** Optional hooks the host passes to capture step output. */
export interface TrackCallbacks {
  /** Capture the claimed handle (host may persist or branch on it). */
  onHandleClaimed?: (handle: string) => void;
  /** Capture the lab identity so LabCreateResume can provision on return. */
  onLabCaptured?: (result: LabStepResult) => void;
  /**
   * Prefill for the PI display name on the lab step. A getter (not a bare
   * string) so the host can return the handle claimed DURING the wizard, after
   * the track was built.
   */
  defaultPiDisplay?: string | (() => string);
}

/** Resolve the defaultPiDisplay hook, which may be a string or a live getter. */
function resolveDefaultPiDisplay(
  hook: string | (() => string) | undefined,
): string | undefined {
  return typeof hook === "function" ? hook() : hook;
}

/** Solo researcher, free account: sign in, identity, folder. */
export function buildSoloFreeTrack(cb: TrackCallbacks = {}): WizardTrack {
  return {
    id: "solo-free",
    label: "Free account",
    steps: [
      {
        id: "sign-in",
        label: "Sign in",
        skippable: false,
        render: () => (
          <SignInStep
            heading="Create your free account"
            subheading="Pick a sign-in provider. Your data stays on your disk; the account is free and only used for sharing and the researcher directory."
            onboardingWizardReturn="free"
          />
        ),
      },
      {
        id: "identity",
        label: "Profile",
        // Merged handle + profile + greeting page. Not skippable because the
        // handle is required (it is the directory id); the rest of the profile is
        // optional on the page itself, so it never soft-locks.
        skippable: false,
        render: (c) => (
          <IdentityStep
            onSubmit={(h) => {
              cb.onHandleClaimed?.(h);
              c.next();
            }}
          />
        ),
      },
      {
        id: "folder",
        label: "Folder",
        // Go-live: the folder step is unskippable. No folder = no app, so the
        // only ways past it are Back or the permanent "try the demo" escape
        // FolderStep renders. (Was skippable in the pre-go-live wizard.)
        skippable: false,
        render: (c) => <FolderStep onConnected={c.next} />,
      },
    ],
  };
}

/** Solo researcher, local-only: folder only (single step). */
export function buildSoloLocalTrack(): WizardTrack {
  return {
    id: "solo-local",
    label: "Just me, local",
    steps: [
      {
        id: "folder",
        label: "Folder",
        // Go-live: the folder step is unskippable. No folder = no app, so the
        // only ways past it are Back or the permanent "try the demo" escape
        // FolderStep renders. (Was skippable in the pre-go-live wizard.)
        skippable: false,
        render: (c) => <FolderStep onConnected={c.next} />,
      },
      {
        id: "preferred-name",
        label: "Your name",
        // Same lightweight, skippable greeting-name closer as the other tracks.
        // Local-only has no account, so the name stays folder-local here, which
        // still gives a friendlier in-folder greeting.
        skippable: true,
        render: (c) => <PreferredNameStep onSaved={c.next} />,
      },
    ],
  };
}

/** PI / lab head, create path: sign in, identity, lab setup, folder. */
export function buildPiCreateTrack(cb: TrackCallbacks = {}): WizardTrack {
  return {
    id: "pi-create",
    label: "Lab",
    steps: [
      {
        id: "sign-in",
        label: "Sign in",
        skippable: false,
        render: () => (
          <SignInStep
            heading="Create a lab"
            subheading="Sign in with a provider to anchor your lab identity. Your data stays on your disk; the sign-in only binds the lab to your email."
            labCreate
            onboardingWizardReturn="lab"
          />
        ),
      },
      {
        id: "identity",
        label: "Profile",
        // Merged handle + profile + greeting page (see buildSoloFreeTrack). The
        // claimed handle is forwarded so the lab-setup step can prefill the PI
        // display name with it.
        skippable: false,
        render: (c) => (
          <IdentityStep
            onSubmit={(h) => {
              cb.onHandleClaimed?.(h);
              c.next();
            }}
          />
        ),
      },
      {
        id: "lab-setup",
        label: "Lab setup",
        skippable: false,
        render: (c) => (
          <LabStep
            defaultPiDisplay={resolveDefaultPiDisplay(cb.defaultPiDisplay)}
            onSubmit={(result) => {
              cb.onLabCaptured?.(result);
              c.next();
            }}
          />
        ),
      },
      {
        id: "folder",
        label: "Folder",
        // Go-live: the folder step is unskippable. No folder = no app, so the
        // only ways past it are Back or the permanent "try the demo" escape
        // FolderStep renders. (Was skippable in the pre-go-live wizard.)
        skippable: false,
        render: (c) => <FolderStep onConnected={c.next} />,
      },
    ],
  };
}
