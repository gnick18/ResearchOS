"use client";

import { useEffect } from "react";
import { isRecordingMode } from "@/lib/file-system/wiki-capture-mock";

/**
 * Recording-mode (`?record=1`) body class.
 *
 * Mounted once at the app root inside `<Providers>`. When recording mode is
 * active it adds the `recording-mode` class to `<body>`, which a small set of
 * global CSS rules (globals.css) use to hide non-product floating chrome that
 * has no place in a marketing-video capture: the Next.js dev-tools indicator
 * (`nextjs-portal`), the bottom-right floating dock (Calculators / Report bug),
 * and the BeakerBot summon flask. Record mode is meant to be a pristine surface
 * (it already hides the demo chrome), so this completes that for the chrome
 * that lives outside the demo path.
 *
 * Effect-gated (not a render-time `typeof window` branch) so there is no
 * server/client hydration mismatch: the class is only ever added on the client.
 */
export default function RecordingModeBodyClass() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!isRecordingMode()) return;
    document.body.classList.add("recording-mode");
    return () => {
      document.body.classList.remove("recording-mode");
    };
  }, []);

  return null;
}
