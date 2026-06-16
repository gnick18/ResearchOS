"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import Kicker from "@/components/marketing/Kicker";
import { Icon } from "@/components/icons";
import {
  loadAssetManifest,
  reviewableAssets,
  assetSvgUrl,
  removalDaysLeft,
  type LibraryAsset,
  type RemovedAsset,
} from "@/lib/figure/asset-library";
import { useLibraryActor, normalizeHandle } from "./use-library-actor";

/**
 * `/library/review` peer-review queue. Wiki-style + accountable: any signed-in
 * user can VERIFY a community submission (vouch it is accurate + openly licensed)
 * or REJECT it WITH A WRITTEN REASON. A reject is not destructive: the asset moves
 * to a 30-day removal window (the "Recently removed" panel below), where the
 * reviewer's @handle + reason are shown and ANYONE with an account can restore it.
 * The submitter's own work is excluded from their queue, and the server
 * independently re-checks the verifier identity, so no one clears their own flag.
 *
 * Identity is the actor's @handle, confirmed once and persisted (see
 * use-library-actor); the same handle attributes every action.
 *
 * Voice rules: no em-dashes, no emojis, no mid-sentence colons.
 */

const SOURCE_LABELS: Record<string, string> = {
  phylopic: "PhyloPic",
  bioicons: "Bioicons",
  community: "Community",
};

export default function ReviewQueue() {
  const actor = useLibraryActor();
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [handleInput, setHandleInput] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, "verified" | "rejected">>({});

  // Reject-with-reason: the uid currently being rejected + its reason draft.
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState("");

  // Recently-removed panel.
  const [removed, setRemoved] = useState<RemovedAsset[]>([]);
  const [removedErr, setRemovedErr] = useState("");

  useEffect(() => {
    let live = true;
    void loadAssetManifest().then((a) => {
      if (!live) return;
      setAssets(a);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  // Seed the input from the persisted handle once it hydrates.
  useEffect(() => {
    if (actor.handle) setHandleInput(actor.handle);
  }, [actor.handle]);

  const loadRemoved = useCallback(async () => {
    try {
      const res = await fetch("/api/library/removed");
      const data = await res.json();
      if (res.ok && data.ok) setRemoved(data.removed as RemovedAsset[]);
      else setRemovedErr(data?.error || `Failed to load removed (${res.status})`);
    } catch (err) {
      setRemovedErr((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadRemoved();
  }, [loadRemoved]);

  const queue = useMemo(
    () =>
      reviewableAssets(assets, normalizeHandle(handleInput) || null).filter(
        (a) => !done[a.uid],
      ),
    [assets, handleInput, done],
  );

  /** Resolve + persist the actor handle, or set an error on the card and bail. */
  const requireActor = (uid: string): string | null => {
    const me = normalizeHandle(handleInput);
    if (!me) {
      setErrors((e) => ({ ...e, [uid]: "Enter your @handle first" }));
      return null;
    }
    actor.setHandle(me);
    return me;
  };

  const verify = async (asset: LibraryAsset) => {
    const me = requireActor(asset.uid);
    if (!me) return;
    setActing(asset.uid);
    setErrors((e) => ({ ...e, [asset.uid]: "" }));
    try {
      const res = await fetch("/api/library/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: asset.uid, verifierId: me }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrors((e) => ({ ...e, [asset.uid]: data?.error || `Failed (${res.status})` }));
        return;
      }
      setDone((d) => ({ ...d, [asset.uid]: "verified" }));
    } catch (err) {
      setErrors((e) => ({ ...e, [asset.uid]: (err as Error).message }));
    } finally {
      setActing(null);
    }
  };

  const confirmReject = async (asset: LibraryAsset) => {
    const me = requireActor(asset.uid);
    if (!me) return;
    const reason = reasonDraft.trim();
    if (reason.length < 4) {
      setErrors((e) => ({ ...e, [asset.uid]: "A written reason is required to reject" }));
      return;
    }
    setActing(asset.uid);
    setErrors((e) => ({ ...e, [asset.uid]: "" }));
    try {
      const res = await fetch("/api/library/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: asset.uid, actorId: me, reason }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrors((e) => ({ ...e, [asset.uid]: data?.error || `Failed (${res.status})` }));
        return;
      }
      setDone((d) => ({ ...d, [asset.uid]: "rejected" }));
      setRejecting(null);
      setReasonDraft("");
      void loadRemoved();
    } catch (err) {
      setErrors((e) => ({ ...e, [asset.uid]: (err as Error).message }));
    } finally {
      setActing(null);
    }
  };

  const restore = async (asset: RemovedAsset) => {
    const me = requireActor(asset.uid);
    if (!me) return;
    setActing(asset.uid);
    try {
      const res = await fetch("/api/library/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: asset.uid, actorId: me }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setRemovedErr(data?.error || `Restore failed (${res.status})`);
        return;
      }
      // Drop from the removed panel and let it re-enter the queue on next load.
      setRemoved((r) => r.filter((x) => x.uid !== asset.uid));
      setDone((d) => {
        const next = { ...d };
        delete next[asset.uid];
        return next;
      });
      setAssets((cur) =>
        cur.some((x) => x.uid === asset.uid)
          ? cur
          : [...cur, { ...asset, verification: { status: "unverified", flags: 0 } } as LibraryAsset],
      );
    } catch (err) {
      setRemovedErr((err as Error).message);
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <MarketingNav />
      {/* Persistent way back to the library (the empty-state link is not enough
          once a queue or the removed panel is showing). */}
      <div className="mx-auto max-w-6xl px-6 pt-4">
        <Link
          href="/library"
          className="inline-flex items-center gap-1.5 text-meta font-semibold text-foreground-muted transition hover:text-brand-action"
        >
          <Icon name="chevronLeft" className="h-4 w-4" /> Back to the library
        </Link>
      </div>
      <section className="relative overflow-hidden">
        <MarketingBackdrop tone="vivid" />
        <div className="relative z-10 mx-auto max-w-3xl px-6 pb-8 pt-14 text-center sm:pt-20">
          <div className="flex justify-center">
            <Kicker>Help review</Kicker>
          </div>
          <h1 className="mx-auto mt-4 max-w-2xl text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            Review community submissions
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-foreground-muted">
            Community icons go live flagged unverified for accuracy. Vouch for the
            ones that look right and openly licensed, or reject the ones that do
            not with a short reason. A reject is undoable for 30 days. You cannot
            review your own submissions.
          </p>
          <div className="mx-auto mt-6 max-w-xs">
            <input
              value={handleInput}
              onChange={(e) => setHandleInput(e.target.value)}
              onBlur={() => handleInput.trim() && actor.setHandle(handleInput)}
              placeholder="Your @handle"
              className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-center text-sm outline-none"
              aria-label="Your handle"
            />
            {actor.ready && (
              <p className="mt-1 text-[11px] text-foreground-faint">
                Reviewing as {normalizeHandle(handleInput) || actor.handle}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-10">
          {loading ? (
            <p className="py-16 text-center text-foreground-muted">Loading the queue...</p>
          ) : queue.length === 0 ? (
            <div className="rounded-2xl border border-border bg-surface-raised/70 p-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-action/10 text-brand-action">
                <Icon name="check" className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-xl font-bold">Nothing to review</h2>
              <p className="mx-auto mt-2 max-w-md text-foreground-muted">
                Every community submission has been checked. Thank you for keeping
                the library accurate.
              </p>
              <Link
                href="/library"
                className="mt-6 inline-flex items-center gap-2 rounded-full border border-border-strong px-5 py-2.5 text-sm font-semibold hover:border-brand-action"
              >
                Back to the library
              </Link>
            </div>
          ) : (
            <>
              <p className="mb-4 text-meta text-foreground-muted">
                {queue.length} awaiting review
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {queue.map((a) => (
                  <div key={a.uid} className="flex flex-col rounded-2xl border border-border bg-surface-raised/70 p-4">
                    <div className="flex h-28 items-center justify-center rounded-xl border border-border bg-surface-sunken p-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={assetSvgUrl(a)} alt={a.title} loading="lazy" className="h-full w-full object-contain" />
                    </div>
                    <h3 className="mt-3 truncate font-semibold" title={a.title}>
                      {a.title}
                    </h3>
                    <p className="text-meta text-foreground-muted">
                      {SOURCE_LABELS[a.source] ?? a.source}
                      {a.category ? ` / ${a.category}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px]">
                        <Icon name="shield" className="h-3 w-3 text-brand-action" />
                        {a.license}
                      </span>
                      {a.submittedBy && (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-foreground-muted">
                          by {a.submittedBy}
                        </span>
                      )}
                    </div>
                    {a.tags.length > 0 && (
                      <p className="mt-2 line-clamp-2 text-[11px] text-foreground-faint">{a.tags.join(", ")}</p>
                    )}
                    <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-foreground-muted">{a.credit}</p>
                    {errors[a.uid] && <p className="mt-2 text-[11px] text-red-600">{errors[a.uid]}</p>}

                    {rejecting === a.uid ? (
                      <div className="mt-auto pt-3">
                        <textarea
                          value={reasonDraft}
                          onChange={(e) => setReasonDraft(e.target.value)}
                          placeholder="Why is this being rejected? (bad license, junk, mis-tagged, duplicate...)"
                          rows={2}
                          className="w-full rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-[11px] outline-none"
                          autoFocus
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => confirmReject(a)}
                            disabled={acting === a.uid}
                            className="flex-1 rounded-full bg-red-600 px-3 py-1.5 text-meta font-semibold text-white disabled:opacity-40"
                          >
                            {acting === a.uid ? "..." : "Confirm reject"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejecting(null);
                              setReasonDraft("");
                            }}
                            disabled={acting === a.uid}
                            className="rounded-full border border-border-strong px-3 py-1.5 text-meta font-semibold disabled:opacity-40"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-auto flex gap-2 pt-3">
                        <button
                          type="button"
                          onClick={() => verify(a)}
                          disabled={acting === a.uid}
                          className="flex-1 rounded-full bg-brand-action px-3 py-1.5 text-meta font-semibold text-white disabled:opacity-40"
                        >
                          {acting === a.uid ? "..." : "Verify"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejecting(a.uid);
                            setReasonDraft("");
                          }}
                          disabled={acting === a.uid}
                          className="rounded-full border border-border-strong px-3 py-1.5 text-meta font-semibold hover:border-red-400 hover:text-red-600 disabled:opacity-40"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Recently removed: the 30-day revert window, with who + why. */}
          {(removed.length > 0 || removedErr) && (
            <div className="mt-12 border-t border-border pt-8">
              <h2 className="text-lg font-bold">Recently removed</h2>
              <p className="mt-1 text-meta text-foreground-muted">
                Rejected community icons stay here for 30 days. Anyone with an
                account can restore one, which sends it back to review.
              </p>
              {removedErr && <p className="mt-2 text-[11px] text-red-600">{removedErr}</p>}
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {removed.map((a) => {
                  const daysLeft = removalDaysLeft(a.removal);
                  return (
                    <div
                      key={a.uid}
                      className="flex flex-col rounded-2xl border border-border bg-surface-sunken/60 p-4"
                    >
                      <div className="flex h-24 items-center justify-center rounded-xl border border-border bg-surface p-3 opacity-70">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={assetSvgUrl(a)} alt={a.title} loading="lazy" className="h-full w-full object-contain" />
                      </div>
                      <h3 className="mt-3 truncate font-semibold" title={a.title}>
                        {a.title}
                      </h3>
                      <p className="mt-1 text-[11px] text-foreground-muted">
                        Removed by {a.removal.removedBy} · {daysLeft} day
                        {daysLeft === 1 ? "" : "s"} left
                      </p>
                      <p className="mt-1 line-clamp-3 rounded-lg bg-surface px-2 py-1.5 text-[11px] text-foreground-muted">
                        Reason: {a.removal.reason}
                      </p>
                      <button
                        type="button"
                        onClick={() => restore(a)}
                        disabled={acting === a.uid}
                        className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-full border border-border-strong px-3 py-1.5 text-meta font-semibold hover:border-brand-action disabled:opacity-40"
                      >
                        <Icon name="refresh" className="h-3.5 w-3.5" />
                        {acting === a.uid ? "..." : "Restore"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
