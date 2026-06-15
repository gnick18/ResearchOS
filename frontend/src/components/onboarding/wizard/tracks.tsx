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

/** Optional hooks the host passes to capture step output. */
export interface TrackCallbacks {
  /** Capture the claimed handle (host may persist or branch on it). */
  onHandleClaimed?: (handle: string) => void;
  /** Capture the lab identity so LabCreateResume can provision on return. */
  onLabCaptured?: (result: LabStepResult) => void;
  /** Prefill for the PI display name on the lab step. */
  defaultPiDisplay?: string;
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
            defaultPiDisplay={cb.defaultPiDisplay}
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
