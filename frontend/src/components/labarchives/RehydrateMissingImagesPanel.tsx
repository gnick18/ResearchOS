"use client";

/**
 * Re-usable 3-tab "fetch your missing LabArchives inline images" panel.
 *
 * Used by:
 *  - the ELN import wizard's `5 · Fetch images` step
 *    (`components/import-eln/steps/LabArchivesSignInStep.tsx`), via the
 *    thin wizard-step wrapper that adds the Back/Continue buttons.
 *  - the persistent post-import banner in `TaskDetailPopup`'s Lab Notes
 *    tab, via `RehydrateMissingImagesModal` — when a user clicked away from
 *    the wizard or otherwise missed step 5, this panel pops out of the
 *    banner so they can finish the rehydration without re-running the
 *    entire import.
 *
 * The panel owns the tab state + per-tab staging maps; the parent owns the
 * Back/Continue/Apply buttons (and decides what "Continue" means — wizard:
 * advance to apply, modal: write to disk + close).
 *
 * Path conventions:
 *  - "api"      — original credentialed flow. Only available when the
 *                 deployer has institutional LabArchives creds set up
 *                 (`isLabArchivesConfigured()` / async). Hidden in demo
 *                 mode.
 *  - "devtools" — paste-a-script-into-LabArchives-DevTools, no creds. Works
 *                 in demo.
 *  - "drop"     — drop a folder / zip you already have. Works in demo.
 *
 * The `onMatchesChange` callback fires every time the staged map for the
 * currently-active panel changes. Parents that want a single source of
 * truth (e.g. modal) should treat the latest fired map as the canonical
 * value. The map keys are `MissingInlineImage.originalUrl`; values are
 * `FetchedImage` (`{ kind: "ok"; blob; contentType } | { kind: "error" }`).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { connectLabArchives } from "@/lib/labarchives/connect";
import {
  fetchInlineImages,
  type FetchedImage,
  type FetchFailureKind,
} from "@/lib/labarchives/api-client";
import {
  readConnection,
  type LabArchivesConnection,
} from "@/lib/labarchives/tokens-store";
import {
  isLabArchivesConfigured,
  isLabArchivesConfiguredAsync,
} from "@/lib/labarchives/config";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
import type { MissingInlineImage } from "@/lib/import/eln/types";
import ManualImageDropPanel from "../import-eln/steps/ManualImageDropPanel";
import DevToolsScriptPanel from "../import-eln/steps/DevToolsScriptPanel";

type WhichPanel = "api" | "devtools" | "drop";

type ApiPhase =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "fetching"; current: number; total: number }
  | {
      kind: "done";
      success: number;
      errors: number;
      /** When every image failed, the panel renders a top-level callout
       *  ("your LabArchives connection may have expired") in addition to
       *  the per-row error messages. The `dominantFailureKind` tunes the
       *  copy: auth → "expired", network → "network looks down", config →
       *  "deployment misconfigured", null → generic. */
      allFailed: boolean;
      dominantFailureKind: FetchFailureKind | null;
    }
  | { kind: "error"; message: string };

export interface RehydrateMissingImagesPanelProps {
  /** Username whose `_labarchives.json` we read/write for the API flow.
   *  In the wizard this is the receiver (sign-in scopes to receiver); in
   *  the post-import banner this is the task owner. */
  username: string;
  /** Form-B inline images we know about. Length-aware UI (e.g. the count
   *  in the explanatory copy) reads from here. */
  missingImages: MissingInlineImage[];
  /** Optional notebook label for the DevTools-script's ZIP filename and
   *  panel copy. */
  notebookLabel?: string;
  /** Fires every time the currently-active panel's staged matches change.
   *  Empty map = "user is on this panel but hasn't dropped anything yet."
   *  Parents typically gate their primary CTA on `map.size > 0`. */
  onMatchesChange: (matches: Map<string, FetchedImage>) => void;
}

export default function RehydrateMissingImagesPanel({
  username,
  missingImages,
  notebookLabel,
  onMatchesChange,
}: RehydrateMissingImagesPanelProps) {
  // Demo / wiki-capture mode hides the API tab entirely — the cred-less
  // paths still work because they don't touch the LabArchives backend until
  // the user actively drops a file or generates a script.
  const demoMode = isDemoOrWikiCapture();

  const [configured, setConfigured] = useState<boolean>(() =>
    !demoMode && isLabArchivesConfigured(),
  );
  const [active, setActive] = useState<WhichPanel>(
    configured ? "api" : "devtools",
  );
  const [connection, setConnection] = useState<LabArchivesConnection | null>(null);
  const [apiPhase, setApiPhase] = useState<ApiPhase>({ kind: "idle" });
  const [apiFetched, setApiFetched] = useState<Map<string, FetchedImage> | null>(null);
  const [scriptDrop, setScriptDrop] = useState<Map<string, FetchedImage>>(new Map());
  const [manualDrop, setManualDrop] = useState<Map<string, FetchedImage>>(new Map());

  useEffect(() => {
    if (demoMode) return;
    let cancelled = false;
    void readConnection(username).then((c) => {
      if (!cancelled) setConnection(c);
    });
    return () => {
      cancelled = true;
    };
  }, [username, demoMode]);

  useEffect(() => {
    if (demoMode) return;
    let cancelled = false;
    void isLabArchivesConfiguredAsync().then((ok) => {
      if (!cancelled) setConfigured(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [demoMode]);

  const handleConnect = useCallback(async () => {
    setApiPhase({ kind: "connecting" });
    try {
      const conn = await connectLabArchives(username);
      setConnection(conn);
      setApiPhase({ kind: "idle" });
    } catch (err) {
      setApiPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Sign-in failed.",
      });
    }
  }, [username]);

  const handleFetch = useCallback(async () => {
    if (!connection) return;
    setApiPhase({ kind: "fetching", current: 0, total: missingImages.length });
    try {
      const result = await fetchInlineImages({
        uid: connection.uid,
        images: missingImages,
        onProgress: (current, total) => {
          setApiPhase({ kind: "fetching", current, total });
        },
      });
      setApiFetched(result.byUrl);
      setApiPhase({
        kind: "done",
        success: result.successCount,
        errors: result.errorCount,
        allFailed: result.allFailed,
        dominantFailureKind: result.dominantFailureKind,
      });
    } catch (err) {
      setApiPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Image fetch failed.",
      });
    }
  }, [connection, missingImages]);

  const stagedForActive = useMemo<Map<string, FetchedImage>>(() => {
    if (active === "api") return apiFetched ?? new Map();
    if (active === "devtools") return scriptDrop;
    return manualDrop;
  }, [active, apiFetched, scriptDrop, manualDrop]);

  // Bubble the active map up to the parent. Re-fires whenever the active
  // panel OR its underlying map changes.
  useEffect(() => {
    onMatchesChange(stagedForActive);
  }, [stagedForActive, onMatchesChange]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">
          Pull online-only images into your notes
        </h3>
        <p className="text-xs text-gray-500 mt-1">
          The export ZIP doesn&apos;t bundle every inline image — about half are
          stored online by LabArchives. Pick a path below to fetch them now,
          or skip and leave them as placeholders you can fix up later.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-900">
          <span className="font-semibold">{missingImages.length}</span> online-only
          image{missingImages.length === 1 ? "" : "s"} expected.
        </p>
      </div>

      <PanelSwitcher
        active={active}
        onChange={setActive}
        apiAvailable={configured && !demoMode}
        demoMode={demoMode}
      />

      {active === "api" &&
        (configured && !demoMode ? (
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <ConnectionRow
              connection={connection}
              onConnect={handleConnect}
              connecting={apiPhase.kind === "connecting"}
            />
            {connection && apiPhase.kind !== "fetching" && apiPhase.kind !== "done" && (
              <button
                type="button"
                onClick={handleFetch}
                className="w-full px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
              >
                Fetch {missingImages.length} image
                {missingImages.length === 1 ? "" : "s"}
              </button>
            )}
            {apiPhase.kind === "fetching" && (
              <FetchProgress current={apiPhase.current} total={apiPhase.total} />
            )}
            {apiPhase.kind === "done" && (
              <>
                {apiPhase.allFailed && (
                  <AllFailedBanner
                    total={apiPhase.errors}
                    failureKind={apiPhase.dominantFailureKind}
                    onReconnect={handleConnect}
                  />
                )}
                <FetchSummary success={apiPhase.success} errors={apiPhase.errors} />
              </>
            )}
            {apiPhase.kind === "error" && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {apiPhase.message}
              </p>
            )}
          </div>
        ) : (
          <ApiNotConfiguredNotice demoMode={demoMode} />
        ))}

      {active === "devtools" && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <DevToolsScriptPanel
            missing={missingImages}
            notebookLabel={notebookLabel}
            onMatchesChange={setScriptDrop}
          />
        </div>
      )}

      {active === "drop" && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <p className="text-xs text-gray-600">
            Already saved your inline images somewhere — from a previous
            download, a screenshot batch, or another tool? Drop the folder
            or a <code className="text-[10px]">.zip</code> here. ResearchOS
            matches the files to the expected names automatically.
          </p>
          <ManualImageDropPanel
            missing={missingImages}
            onMatchesChange={setManualDrop}
          />
        </div>
      )}
    </div>
  );
}

function PanelSwitcher({
  active,
  onChange,
  apiAvailable,
  demoMode,
}: {
  active: WhichPanel;
  onChange: (p: WhichPanel) => void;
  apiAvailable: boolean;
  demoMode: boolean;
}) {
  const tab = (
    id: WhichPanel,
    label: string,
    subtitle: string,
    extraCls = "",
  ) => (
    <button
      key={id}
      type="button"
      onClick={() => onChange(id)}
      className={`flex-1 text-left px-3 py-2 rounded-lg border transition-colors ${
        active === id
          ? "border-blue-400 bg-blue-50"
          : "border-gray-200 bg-white hover:border-gray-300"
      } ${extraCls}`}
    >
      <p className="text-xs font-semibold text-gray-900">{label}</p>
      <p className="text-[11px] text-gray-600 mt-0.5">{subtitle}</p>
    </button>
  );

  const apiLabel = demoMode
    ? "Connect via API (demo mode)"
    : apiAvailable
      ? "Connect via API"
      : "Connect via API (not configured)";
  const apiSubtitle = demoMode
    ? "Disabled in the in-browser demo. Use one of the other paths."
    : apiAvailable
      ? "Fastest. Requires institution-issued API credentials."
      : "Needs deployer setup. Pick another path below.";

  return (
    <div className="flex items-stretch gap-2">
      {tab(
        "api",
        apiLabel,
        apiSubtitle,
        apiAvailable && !demoMode ? "" : "opacity-70",
      )}
      {tab(
        "devtools",
        "Generate browser script",
        "Paste a one-liner into LabArchives DevTools. No credentials needed.",
      )}
      {tab(
        "drop",
        "Drop your own images",
        "Already have the files? Drop a folder or .zip and we'll match them.",
      )}
    </div>
  );
}

function ApiNotConfiguredNotice({ demoMode }: { demoMode: boolean }) {
  if (demoMode) {
    return (
      <div className="rounded-xl border border-purple-300 bg-purple-50 px-4 py-3">
        <p className="text-sm font-medium text-purple-900">
          The API path is disabled in the in-browser demo.
        </p>
        <p className="text-xs text-purple-800 mt-1">
          Try the DevTools script or the manual drop paths above — both work
          in demo mode and don&apos;t need institutional API credentials.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-sm font-medium text-amber-900">
        This deployment doesn&apos;t have LabArchives API credentials set up
        yet.
      </p>
      <p className="text-xs text-amber-800 mt-1">
        Pick one of the two cred-less paths above instead — they get you the
        same end state without needing institutional API access.
      </p>
      <p className="text-xs text-amber-900 mt-2">
        Whoever runs this deployment can also flip this on from{" "}
        <a
          href="/wiki/integrations/labarchives#deployer-setup"
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-medium hover:no-underline"
        >
          the deployer setup guide
        </a>
        .
      </p>
    </div>
  );
}

function ConnectionRow({
  connection,
  onConnect,
  connecting,
}: {
  connection: LabArchivesConnection | null;
  onConnect: () => void;
  connecting: boolean;
}) {
  if (connection) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-emerald-900">
            Connected as {connection.fullname ?? connection.email ?? connection.uid}
          </p>
          {connection.email && connection.fullname && (
            <p className="text-xs text-emerald-800 mt-0.5">{connection.email}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onConnect}
          className="text-xs text-emerald-900 underline hover:no-underline"
        >
          Switch account
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onConnect}
      disabled={connecting}
      className="w-full px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {connecting ? "Waiting for sign-in window…" : "Sign in to LabArchives"}
    </button>
  );
}

function FetchProgress({ current, total }: { current: number; total: number }) {
  const pct = total === 0 ? 100 : Math.round((current / total) * 100);
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-xs text-gray-700">
        Fetching {current} / {total}
      </p>
      <div className="mt-1.5 w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function AllFailedBanner({
  total,
  failureKind,
  onReconnect,
}: {
  total: number;
  failureKind: FetchFailureKind | null;
  onReconnect: () => void;
}) {
  // Per-kind copy: `auth` is the most actionable (reconnect button), the
  // others are read-only suggestions. We default to the auth message when
  // the kind is unclassified-but-all-failed because rotted connections are
  // by far the most common cause in the wild.
  let headline: string;
  let detail: string;
  let showReconnect = false;
  switch (failureKind) {
    case "auth":
      headline = `All ${total} images failed — your LabArchives connection may have expired.`;
      detail = "Reconnect and try fetching again.";
      showReconnect = true;
      break;
    case "network":
      headline = `All ${total} images failed — LabArchives or your network appears unreachable.`;
      detail = "Check your connection and try again in a moment.";
      break;
    case "config":
      headline = `All ${total} images failed — the LabArchives integration looks misconfigured on this deployment.`;
      detail = "Ask whoever runs this deployment to verify the institutional credentials.";
      break;
    case "parse":
      headline = `All ${total} images failed — none of the URLs in your import carried a recognisable ID.`;
      detail =
        "Try a different path (Drop your own images / Generate browser script).";
      break;
    default:
      headline = `All ${total} images failed.`;
      detail = "Your LabArchives connection may have expired — try reconnecting.";
      showReconnect = true;
      break;
  }
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 space-y-2">
      <p className="text-xs font-medium text-amber-900">{headline}</p>
      <p className="text-[11px] text-amber-800">{detail}</p>
      {showReconnect && (
        <button
          type="button"
          onClick={onReconnect}
          className="text-[11px] font-medium text-amber-900 underline hover:no-underline"
        >
          Reconnect to LabArchives
        </button>
      )}
    </div>
  );
}

function FetchSummary({ success, errors }: { success: number; errors: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs space-y-0.5">
      <p>
        <span className="text-emerald-700 font-medium">Fetched:</span> {success}
      </p>
      {errors > 0 && (
        <p>
          <span className="text-amber-700 font-medium">Failed:</span> {errors} —
          these will use the existing &quot;missing image&quot; placeholder.
        </p>
      )}
    </div>
  );
}
