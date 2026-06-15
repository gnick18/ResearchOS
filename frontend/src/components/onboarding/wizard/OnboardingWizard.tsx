"use client";

// The onboarding wizard host. Selects the track for the chosen path, renders it
// in the stepper shell, and wires finish + close to safe destinations. This is
// the component the entry chooser routes into and that providers.tsx mounts as
// the post-sign-in destination when NEXT_PUBLIC_ONBOARDING_WIZARD is on.
//
// Track selection:
//   solo-local -> Track 1 local-only (folder only)
//   solo-free  -> Track 1 free account
//   pi-create  -> Track 2 PI / lab Create
//   org-dept   -> Track 3 org admin (department), only if DEPT_TIER_ENABLED
//   org-inst   -> Track 3 org admin (institution), only if INSTITUTION_TIER_ENABLED
//
// Sign in is a page-leaving OAuth redirect, so for the research / org tracks the
// host can resume at a later step on the post-OAuth return via initialStepId
// (the caller decides whether sign-in already happened).
//
// Finish routing:
//   research tracks -> the app root (the global resume mounts complete keypair /
//     lab provisioning once a folder is connected, unchanged by the wizard).
//   org tracks      -> the /department or /institution admin portal.
//
// Close (escape from any state) drops to a safe landing, never a hard-trap:
//   research tracks -> the app root in its current state (limited mode if no
//     folder, per Q5).
//   org tracks      -> the admin portal (the org may already be created) or the
//     app root if not.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import OnboardingWizardShell from "./OnboardingWizardShell";
import {
  buildSoloFreeTrack,
  buildSoloLocalTrack,
  buildPiCreateTrack,
} from "./tracks";
import { buildOrgTrack } from "./tracks-org";
import { DEPT_TIER_ENABLED } from "@/lib/dept/config";
import { INSTITUTION_TIER_ENABLED } from "@/lib/institution/config";

export type WizardSelection =
  | "solo-local"
  | "solo-free"
  | "pi-create"
  | "org-dept"
  | "org-inst";

export interface OnboardingWizardProps {
  selection: WizardSelection;
  /** Resume at this step id (e.g. after the OAuth return, skip the sign-in step). */
  initialStepId?: string;
  /**
   * Optional override for the finish destination. Defaults per track. Lets a
   * preview / test capture finish without a real navigation.
   */
  onFinish?: () => void;
  /** Optional override for the close handler. Defaults to a safe landing. */
  onClose?: () => void;
}

export default function OnboardingWizard({
  selection,
  initialStepId,
  onFinish,
  onClose,
}: OnboardingWizardProps) {
  const router = useRouter();
  // The org id created in the org name step, captured so close can route to the
  // portal once the org exists.
  const orgIdRef = useRef<string>("");

  const isOrg = selection === "org-dept" || selection === "org-inst";

  const track = useMemo(() => {
    switch (selection) {
      case "solo-local":
        return buildSoloLocalTrack();
      case "solo-free":
        return buildSoloFreeTrack();
      case "pi-create":
        return buildPiCreateTrack();
      case "org-dept":
        return buildOrgTrack("department", {
          onOrgCreated: (id) => {
            orgIdRef.current = id;
          },
        });
      case "org-inst":
        return buildOrgTrack("institution", {
          onOrgCreated: (id) => {
            orgIdRef.current = id;
          },
        });
      default:
        return buildSoloLocalTrack();
    }
  }, [selection]);

  const orgPortal = selection === "org-dept" ? "/department" : "/institution";

  const handleFinish = useCallback(() => {
    if (onFinish) {
      onFinish();
      return;
    }
    if (isOrg) {
      router.replace(orgPortal);
      return;
    }
    // Research tracks: land in the app. The global resume mounts complete any
    // keypair / lab provisioning once a folder is connected. If no folder was
    // connected (folder step skipped), the app shows its limited state per Q5.
    router.replace("/");
  }, [onFinish, isOrg, orgPortal, router]);

  const handleClose = useCallback(() => {
    if (onClose) {
      onClose();
      return;
    }
    if (isOrg) {
      // If the org was already created, the portal is the safe landing; else the
      // app root. Either way, never a hard-trap.
      router.replace(orgIdRef.current ? orgPortal : "/");
      return;
    }
    router.replace("/");
  }, [onClose, isOrg, orgPortal, router]);

  // Defensive: if an org selection arrives while its tier flag is off (should be
  // unreachable, the chooser gates it), fall back to the app root rather than
  // rendering a dead track.
  if (selection === "org-dept" && !DEPT_TIER_ENABLED) {
    router.replace("/");
    return null;
  }
  if (selection === "org-inst" && !INSTITUTION_TIER_ENABLED) {
    router.replace("/");
    return null;
  }

  return (
    <OnboardingWizardShell
      track={track}
      initialStepId={initialStepId}
      onFinish={handleFinish}
      onClose={handleClose}
    />
  );
}
