"use client";

// TEMPORARY dev harness for live-testing the LabSignInGate. NOT committed.
import { useMemo } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { createLabSessionEffects } from "@/lib/lab/lab-session-effects";
import { createLabSessionController } from "@/lib/lab/lab-session";
import { LabSignInGate } from "@/components/lab/LabSignInGate";

const LAB_ID = "8a000000-b1d1-4e00-9000-000000000001"; // the Phase 8a bound lab

export default function DevGatePage() {
  const { currentUser } = useCurrentUser();

  // Stable controller per (user) — must not be recreated each render.
  const controller = useMemo(() => {
    if (!currentUser) return null;
    return createLabSessionController(
      createLabSessionEffects({ labId: LAB_ID, username: currentUser }),
    );
  }, [currentUser]);

  if (!controller) {
    return (
      <div style={{ padding: 40, fontFamily: "monospace" }}>
        Waiting for a current user…
      </div>
    );
  }

  return (
    <LabSignInGate controller={controller}>
      <div style={{ padding: 60, fontFamily: "monospace" }}>
        <h1 style={{ fontSize: 28 }}>🎌 You are in the lab.</h1>
        <p>
          The sign-in gate dismissed because the session is <b>live</b> — OAuth
          gate, keypair unlock, and lab key all loaded. This panel is the app
          behind the gate (lab {LAB_ID.slice(0, 8)}…).
        </p>
        <p style={{ color: "#16a34a" }}>Login UX works end to end.</p>
      </div>
    </LabSignInGate>
  );
}
