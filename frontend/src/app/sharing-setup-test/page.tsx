"use client";

// Dev-only harness for the cross-boundary sharing identity setup wizard.
//
// Lets a human exercise the full claim flow by hand (choose a method, prove an
// email via OAuth or a 6-digit code, generate a keypair, save Recovery Words,
// publish) without wiring the wizard into any product surface yet. Gated to
// development only, in any other environment it renders a short notice instead.
//
// Needs the sharing backend to be live for the directory POSTs to do anything,
// SHARING_ENABLED plus the directory env (DIRECTORY_HMAC_PEPPER, DATABASE_URL,
// KV_REST_API_URL, KV_REST_API_TOKEN, RESEND_API_KEY for the email path) and the
// Auth.js env (AUTH_SECRET, AUTH_GOOGLE_ID/SECRET, AUTH_GITHUB_ID/SECRET) for the
// OAuth path. Without them the wizard still renders, but the publish step will
// surface a 404 / network error, which is the expected dev behavior.

import { useEffect, useState } from "react";

import SharingSetupWizard from "@/components/sharing/SharingSetupWizard";
import { useFileSystem } from "@/lib/file-system/file-system-context";

const IS_DEV = process.env.NODE_ENV === "development";

export default function SharingSetupTestPage() {
  if (!IS_DEV) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 p-6">
        <div className="max-w-md text-center">
          <h1 className="text-heading font-semibold text-white">
            Not available
          </h1>
          <p className="text-body text-slate-400 mt-2 leading-relaxed">
            This page is a development-only test harness for the sharing setup
            wizard. It is not part of the shipped app.
          </p>
        </div>
      </div>
    );
  }

  return <SharingSetupTestHarness />;
}

function SharingSetupTestHarness() {
  const { currentUser, isConnected } = useFileSystem();
  const [open, setOpen] = useState(false);
  const [lastResult, setLastResult] = useState<{ fingerprint: string } | null>(
    null,
  );

  // Fall back to a placeholder username so the wizard can be opened even with no
  // folder connected (the publish step then exercises the "local link could not
  // be saved" branch on purpose).
  const username = currentUser ?? "dev-tester";

  // Auto-open the wizard when we return from an OAuth redirect (the callbackUrl
  // carries ?sharingClaim=1). Otherwise the wizard would not be mounted on
  // return and its resume effect could never run.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("sharingClaim") === "1") setOpen(true);
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-lg mx-auto">
        <h1 className="text-heading font-semibold text-white">
          Sharing setup wizard, dev harness
        </h1>
        <p className="text-body text-slate-400 mt-2 leading-relaxed">
          Launch the identity setup wizard and walk the full claim flow. This
          route is gated to development and is not wired into any product UI.
        </p>

        <dl className="mt-4 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-meta">
          <dt className="text-slate-500">Folder connected</dt>
          <dd className="text-slate-200">{isConnected ? "yes" : "no"}</dd>
          <dt className="text-slate-500">Current user</dt>
          <dd className="text-slate-200">
            {currentUser ?? "(none, using dev-tester)"}
          </dd>
        </dl>

        {!isConnected && (
          <p className="text-meta text-amber-300/90 mt-3 leading-relaxed">
            No data folder is connected, so the publish step will exercise the
            local-link-could-not-be-saved path. Connect a folder first to test
            the full sidecar write.
          </p>
        )}

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ros-btn-raise mt-5 px-4 py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white"
        >
          Launch sharing setup
        </button>

        {lastResult && (
          <div className="mt-5 p-3 bg-slate-800 border border-white/10 rounded-lg">
            <p className="text-meta text-slate-400 mb-1">
              Last onComplete fingerprint
            </p>
            <p className="text-body font-mono text-emerald-300">
              {lastResult.fingerprint}
            </p>
          </div>
        )}
      </div>

      {open && (
        <SharingSetupWizard
          username={username}
          onComplete={(result) => setLastResult(result)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
