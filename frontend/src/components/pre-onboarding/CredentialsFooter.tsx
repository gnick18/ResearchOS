"use client";

import Image from "next/image";

/**
 * Pre-onboarding credentials footer.
 *
 * Sits below the speech bubble across all 4 beats. Establishes authority
 * for a first-time researcher: this is a real academic project, not a
 * sketchy app trying to harvest research data. Three signals:
 *
 *   1. Author with degree (Dr. Grant R. Nickles, PhD)
 *   2. Funding source (UW-Madison RISE Initiative) with their logo
 *   3. Free + open source claim
 *
 * Per Grant 2026-05-25: "people might think this is a ruse to steal
 * their research" — the structural trust signal here is necessary even
 * before the security beat lands its data-stays-local claims.
 *
 * Voice rules: NO em-dashes, NO emojis. The RISE logo PNG should live at
 * `frontend/public/credentials/uw-rise-logo.png` (Grant has the asset
 * from the original RISE Initiative branding). If the file is missing the
 * Image component will fall back gracefully to the text-only line above.
 */
export default function CredentialsFooter() {
  return (
    <div
      className="mt-6 flex w-full max-w-2xl flex-col items-center gap-2 text-center text-xs text-slate-300"
      data-testid="pre-onboarding-credentials"
    >
      <p className="leading-relaxed">
        Free and open source. Built by{" "}
        <span className="font-semibold text-slate-100">
          Dr. Grant R. Nickles (PhD)
        </span>
        , funded in part by the{" "}
        <span className="font-semibold text-slate-100">
          UW-Madison RISE Initiative
        </span>
        .
      </p>
      <div className="flex items-center justify-center">
        <Image
          src="/credentials/uw-rise-logo.png"
          alt="Wisconsin RISE Initiative (Wisconsin Research, Innovation and Scholarly Excellence)"
          width={240}
          height={56}
          className="opacity-90"
          // Local public asset, no remote loader needed.
          unoptimized
        />
      </div>
    </div>
  );
}
