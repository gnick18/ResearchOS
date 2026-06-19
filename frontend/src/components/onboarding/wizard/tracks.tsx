"use client";

// Track builders for the onboarding wizard. Each builder assembles the step
// components into a WizardTrack the shell can drive, honoring the spec's
// per-step skip table:
//
//   Solo (free):  Sign in (no skip) -> Handle (no skip) -> Profile (skip)
//                 -> Folder (skip)
//   Solo (local): Folder only (single step, no sign in / handle / profile)
//   PI / lab:     Sign in -> Handle -> Profile (skip) -> Lab setup (no skip)
//                 -> Folder (skip)
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
import HandleStep from "./steps/HandleStep";
import ProfileStep from "./steps/ProfileStep";
import LabStep, { type LabStepResult } from "./steps/LabStep";
import FolderStep from "./steps/FolderStep";
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

/** Solo researcher, free account: sign in, handle, profile, folder. */
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
        id: "handle",
        label: "Handle",
        skippable: false,
        render: (c) => (
          <HandleStep
            onClaimed={(h) => {
              cb.onHandleClaimed?.(h);
              c.next();
            }}
          />
        ),
      },
      {
        id: "profile",
        label: "Profile",
        skippable: true,
        render: (c) => <ProfileStep onSaved={c.next} />,
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
      {
        id: "preferred-name",
        label: "Your name",
        // Lightweight closer: BeakerBot asks what to call the user and saves it as
        // their preferred greeting name. Skippable, so it never soft-locks the
        // flow, and placed AFTER the folder so the folder-local save lands on a
        // connected folder (the account-scoped copy rides along when its flag is on).
        skippable: true,
        render: (c) => <PreferredNameStep onSaved={c.next} />,
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

/** PI / lab head, create path: solo steps + a lab-setup step before the folder. */
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
        id: "handle",
        label: "Handle",
        skippable: false,
        render: (c) => (
          <HandleStep
            onClaimed={(h) => {
              cb.onHandleClaimed?.(h);
              c.next();
            }}
          />
        ),
      },
      {
        id: "profile",
        label: "Profile",
        skippable: true,
        render: (c) => <ProfileStep onSaved={c.next} />,
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
      {
        id: "preferred-name",
        label: "Your name",
        // Lightweight, skippable greeting-name closer (see the solo-free track).
        // After the folder so the folder-local save lands on a connected folder;
        // the account-scoped copy rides along when its flag is on.
        skippable: true,
        render: (c) => <PreferredNameStep onSaved={c.next} />,
      },
    ],
  };
}
