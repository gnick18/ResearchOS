"use client";

import { useEffect, useMemo, useState } from "react";
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
  type LibraryAsset,
} from "@/lib/figure/asset-library";

/**
 * `/library/review` peer-review queue (Part 3b). Wiki-style: any signed-in user
 * can VERIFY a community submission (vouch it is accurate + openly licensed) or
 * FLAG it as wrong. The submitter's OWN work is excluded from their queue, and
 * the server independently re-checks the verifier identity, so no one clears
 * their own "unverified" flag.
 *
 * Identity here is the reviewer's @handle (typed in), the same lightweight model
 * the rest of the local-first app uses for attribution.
 *
 * Voice rules: no em-dashes, no emojis, no mid-sentence colons.
 */

const SOURCE_LABELS: Record<string, string> = {
  phylopic: "PhyloPic",
  bioicons: "Bioicons",
  community: "Community",
};

export default function ReviewQueue() {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewerId, setReviewerId] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, "verified" | "flagged">>({});

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

  const queue = useMemo(
    () => reviewableAssets(assets, reviewerId.trim() || null).filter((a) => !done[a.uid]),
    [assets, reviewerId, done],
  );

  const act = async (asset: LibraryAsset, kind: "verify" | "flag") => {
    if (!reviewerId.trim()) {
      setErrors((e) => ({ ...e, [asset.uid]: "Enter your @handle first" }));
      return;
    }
    setActing(asset.uid);
    setErrors((e) => ({ ...e, [asset.uid]: "" }));
    try {
      const res = await fetch(`/api/library/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "verify"
            ? { uid: asset.uid, verifierId: reviewerId.trim() }
            : { uid: asset.uid, reporterId: reviewerId.trim() },
        ),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrors((e) => ({ ...e, [asset.uid]: data?.error || `Failed (${res.status})` }));
        return;
      }
      setDone((d) => ({ ...d, [asset.uid]: kind === "verify" ? "verified" : "flagged" }));
    } catch (err) {
      setErrors((e) => ({ ...e, [asset.uid]: (err as Error).message }));
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <MarketingNav />
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
            ones that look right and openly licensed, or flag the ones that do not.
            You cannot review your own submissions.
          </p>
          <div className="mx-auto mt-6 max-w-xs">
            <input
              value={reviewerId}
              onChange={(e) => setReviewerId(e.target.value)}
              placeholder="Your @handle"
              className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-center text-sm outline-none"
              aria-label="Your handle"
            />
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
                    <div className="mt-auto flex gap-2 pt-3">
                      <button
                        type="button"
                        onClick={() => act(a, "verify")}
                        disabled={acting === a.uid}
                        className="flex-1 rounded-full bg-brand-action px-3 py-1.5 text-meta font-semibold text-white disabled:opacity-40"
                      >
                        {acting === a.uid ? "..." : "Verify"}
                      </button>
                      <button
                        type="button"
                        onClick={() => act(a, "flag")}
                        disabled={acting === a.uid}
                        className="rounded-full border border-border-strong px-3 py-1.5 text-meta font-semibold hover:border-red-400 hover:text-red-600 disabled:opacity-40"
                      >
                        Flag
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
