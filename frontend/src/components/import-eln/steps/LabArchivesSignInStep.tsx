"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { connectLabArchives } from "@/lib/labarchives/connect";
import {
  fetchInlineImages,
  type FetchedImage,
} from "@/lib/labarchives/api-client";
import {
  readConnection,
  type LabArchivesConnection,
} from "@/lib/labarchives/tokens-store";
import {
  isLabArchivesConfigured,
  isLabArchivesConfiguredAsync,
} from "@/lib/labarchives/config";
import type { MissingInlineImage } from "@/lib/import/eln/types";
import ManualImageDropPanel from "./ManualImageDropPanel";
import DevToolsScriptPanel from "./DevToolsScriptPanel";

interface Props {
  /** Receiver-side username; we read/write `_labarchives.json` here. */
  receiver: string;
  /** Form-B inline images we know about from the Preview step. */
  missingImages: MissingInlineImage[];
  /** Optional notebook label used in the DevTools-script's ZIP filename. */
  notebookLabel?: string;
  /** Fire when the user chooses to continue. The map is keyed by
   *  `MissingInlineImage.originalUrl` and may be empty (the user opted to
   *  skip the rehydration step entirely). */
  onContinue: (fetched: Map<string, FetchedImage>) => void;
  /** Fire when the user backs out of this step. */
  onBack: () => void;
}

type ApiPhase =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "fetching"; current: number; total: number }
  | { kind: "done"; success: number; errors: number }
  | { kind: "error"; message: string };

type WhichPanel = "api" | "devtools" | "drop";

/**
 * The cred-less paths added on 2026-05-14 mean this step is reachable
 * even when the deployment has NO LabArchives institutional credentials.
 * Three options now coexist:
 *
 *   1. Connect via API   — the original credentialed flow (only if
 *                          `isLabArchivesConfigured()`).
 *   2. Generate script   — paste a snippet into LabArchives DevTools to
 *                          download a ZIP of your own images. Cred-less.
 *   3. Drop your images  — drop a folder or ZIP you already have. Cred-less.
 *
 * All three feed the same `Map<originalUrl, FetchedImage>` to apply. The
 * user picks one panel via a tab-style switcher; the active panel's
 * staged matches are what gets passed on Continue.
 */
export default function LabArchivesSignInStep({
  receiver,
  missingImages,
  notebookLabel,
  onContinue,
  onBack,
}: Props) {
  // Env-var configured state is sync (process.env); sidecar configured
  // state lives in FSA and resolves after mount. We start with the sync
  // answer so env-var deployments don't flicker; the post-mount probe
  // adds sidecar-configured deployments (Settings → LabArchives card).
  const [configured, setConfigured] = useState<boolean>(() => isLabArchivesConfigured());
  const [active, setActive] = useState<WhichPanel>(configured ? "api" : "devtools");
  const [connection, setConnection] = useState<LabArchivesConnection | null>(null);
  const [apiPhase, setApiPhase] = useState<ApiPhase>({ kind: "idle" });
  const [apiFetched, setApiFetched] = useState<Map<string, FetchedImage> | null>(null);
  const [scriptDrop, setScriptDrop] = useState<Map<string, FetchedImage>>(new Map());
  const [manualDrop, setManualDrop] = useState<Map<string, FetchedImage>>(new Map());

  // Existing saved connection? Pull it in so "already connected" UX is preserved.
  useEffect(() => {
    let cancelled = false;
    void readConnection(receiver).then((c) => {
      if (!cancelled) setConnection(c);
    });
    return () => {
      cancelled = true;
    };
  }, [receiver]);

  // Re-probe the configured state with the sidecar-aware async check —
  // lights up the wizard for self-host deployers who set up creds via UI.
  useEffect(() => {
    let cancelled = false;
    void isLabArchivesConfiguredAsync().then((ok) => {
      if (!cancelled) setConfigured(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConnect = useCallback(async () => {
    setApiPhase({ kind: "connecting" });
    try {
      const conn = await connectLabArchives(receiver);
      setConnection(conn);
      setApiPhase({ kind: "idle" });
    } catch (err) {
      setApiPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Sign-in failed.",
      });
    }
  }, [receiver]);

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
      });
    } catch (err) {
      setApiPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Image fetch failed.",
      });
    }
  }, [connection, missingImages]);

  // Which map gets handed off when the user clicks Continue depends on
  // which panel they last interacted with.
  const stagedForContinue = useMemo<Map<string, FetchedImage>>(() => {
    if (active === "api") return apiFetched ?? new Map();
    if (active === "devtools") return scriptDrop;
    return manualDrop;
  }, [active, apiFetched, scriptDrop, manualDrop]);

  const stagedCount = stagedForContinue.size;

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
        apiAvailable={configured}
      />

      {active === "api" &&
        (configured ? (
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
              <FetchSummary success={apiPhase.success} errors={apiPhase.errors} />
            )}
            {apiPhase.kind === "error" && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {apiPhase.message}
              </p>
            )}
          </div>
        ) : (
          <ApiNotConfiguredNotice />
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

      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={onBack}
          className="px-3 py-2 text-sm text-gray-700 hover:text-gray-900"
        >
          Back
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onContinue(new Map())}
            className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg"
          >
            Skip — leave as placeholders
          </button>
          <button
            type="button"
            onClick={() => onContinue(stagedForContinue)}
            disabled={stagedCount === 0 || apiPhase.kind === "fetching"}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {stagedCount === 0
              ? "Continue to import"
              : `Continue with ${stagedCount} image${stagedCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function PanelSwitcher({
  active,
  onChange,
  apiAvailable,
}: {
  active: WhichPanel;
  onChange: (p: WhichPanel) => void;
  apiAvailable: boolean;
}) {
  // Tab-style switcher. The API tab is greyed out (but still selectable
  // so the user can read the explanation) when not configured.
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

  return (
    <div className="flex items-stretch gap-2">
      {tab(
        "api",
        apiAvailable ? "Connect via API" : "Connect via API (not configured)",
        apiAvailable
          ? "Fastest. Requires institution-issued API credentials."
          : "Needs deployer setup. Pick another path below.",
        apiAvailable ? "" : "opacity-70",
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

function ApiNotConfiguredNotice() {
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
