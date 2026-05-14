"use client";

import { useCallback, useEffect, useState } from "react";
import { connectLabArchives } from "@/lib/labarchives/connect";
import {
  fetchInlineImages,
  type FetchedImage,
} from "@/lib/labarchives/api-client";
import {
  readConnection,
  type LabArchivesConnection,
} from "@/lib/labarchives/tokens-store";
import { isLabArchivesConfigured } from "@/lib/labarchives/config";
import type { MissingInlineImage } from "@/lib/import/eln/types";

interface Props {
  /** Receiver-side username; we read/write `_labarchives.json` here. */
  receiver: string;
  /** Form-B inline images we know about from the Preview step. */
  missingImages: MissingInlineImage[];
  /** Fire when the user chooses to continue. The map is keyed by
   *  `MissingInlineImage.originalUrl` and may be empty (the user opted to
   *  skip the sign-in step). */
  onContinue: (fetched: Map<string, FetchedImage>) => void;
  /** Fire when the user backs out of this step. */
  onBack: () => void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "fetching"; current: number; total: number }
  | { kind: "done"; success: number; errors: number }
  | { kind: "error"; message: string };

export default function LabArchivesSignInStep({
  receiver,
  missingImages,
  onContinue,
  onBack,
}: Props) {
  const [connection, setConnection] = useState<LabArchivesConnection | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [fetched, setFetched] = useState<Map<string, FetchedImage> | null>(null);
  const configured = isLabArchivesConfigured();

  // Check if the receiver already has a saved LabArchives connection — if
  // so we surface it as "already connected" and let them jump straight
  // into the fetch step without re-entering credentials.
  useEffect(() => {
    let cancelled = false;
    void readConnection(receiver).then((c) => {
      if (!cancelled) setConnection(c);
    });
    return () => {
      cancelled = true;
    };
  }, [receiver]);

  const handleConnect = useCallback(async () => {
    setPhase({ kind: "connecting" });
    try {
      const conn = await connectLabArchives(receiver);
      setConnection(conn);
      setPhase({ kind: "idle" });
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Sign-in failed.",
      });
    }
  }, [receiver]);

  const handleFetch = useCallback(async () => {
    if (!connection) return;
    setPhase({ kind: "fetching", current: 0, total: missingImages.length });
    try {
      const result = await fetchInlineImages({
        uid: connection.uid,
        images: missingImages,
        onProgress: (current, total) => {
          setPhase({ kind: "fetching", current, total });
        },
      });
      setFetched(result.byUrl);
      setPhase({
        kind: "done",
        success: result.successCount,
        errors: result.errorCount,
      });
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Image fetch failed.",
      });
    }
  }, [connection, missingImages]);

  const handleContinueClick = useCallback(() => {
    onContinue(fetched ?? new Map());
  }, [onContinue, fetched]);

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">
          Fetch online-only images from LabArchives
        </h3>
        <p className="text-xs text-gray-500 mt-1">
          The export ZIP doesn&apos;t bundle every inline image — about half are
          stored online. Sign in to LabArchives to pull them down now so they
          land in your notes, or skip and recover them later from the broken-image
          popup.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-900">
          <span className="font-semibold">{missingImages.length}</span> online-only
          image{missingImages.length === 1 ? "" : "s"} found.
        </p>
      </div>

      {!configured && (
        <ConfigMissingNotice />
      )}

      {configured && (
        <>
          <ConnectionRow
            connection={connection}
            onConnect={handleConnect}
            connecting={phase.kind === "connecting"}
          />
          {connection && phase.kind !== "fetching" && phase.kind !== "done" && (
            <button
              type="button"
              onClick={handleFetch}
              className="w-full px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
            >
              Fetch {missingImages.length} image{missingImages.length === 1 ? "" : "s"}
            </button>
          )}
          {phase.kind === "fetching" && (
            <FetchProgress current={phase.current} total={phase.total} />
          )}
          {phase.kind === "done" && (
            <FetchSummary success={phase.success} errors={phase.errors} />
          )}
          {phase.kind === "error" && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {phase.message}
            </p>
          )}
        </>
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
            Skip for now
          </button>
          <button
            type="button"
            onClick={handleContinueClick}
            disabled={!fetched || phase.kind === "fetching"}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue to import
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfigMissingNotice() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-sm font-medium text-amber-900">
        LabArchives integration isn&apos;t configured on this deployment.
      </p>
      <p className="text-xs text-amber-800 mt-1">
        Online-only images will be written as placeholders. Skip this step to
        finish the import — you can relink them manually later.
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
