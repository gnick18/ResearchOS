"use client";

// Operator panel to STAGE a lab for a PI (staged-pi-provisioning lane).
//
// The operator types the PI raw email plus the lab name, institution, slug, and
// comp tier + months. POSTing to /api/admin/lab-provision/stage hashes the email
// to the PI owner key server-side, reserves the slug to that hash, issues the
// comped-tier grant, and records the staging. When the PI signs in once, their
// client runs the real lab genesis on device and consumes the staging (the server
// never sees their private keys).
//
// This is a STANDALONE form (the PI email is typed in); it does not read the
// roster. Form styling mirrors RowGiftPopup in AccountsPanel.tsx (the same input
// classes, idle/busy/done/error phase machine, emerald success banner, rose error
// text, violet primary button). Icons are <Icon name=...>, tooltips are <Tooltip>.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useState } from "react";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";

/** The three comped tiers, matching the server's CompTier. */
type CompTier = "solo" | "lab" | "dept";

const COMP_TIER_OPTIONS: { value: CompTier; label: string }[] = [
  { value: "solo", label: "Solo" },
  { value: "lab", label: "Lab" },
  { value: "dept", label: "Dept" },
];

type StagePhase =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "done"; slug: string; email: string }
  | { state: "error"; message: string };

export default function StageLabPanel() {
  const [email, setEmail] = useState("");
  const [labName, setLabName] = useState("");
  const [institution, setInstitution] = useState("");
  const [slug, setSlug] = useState("");
  const [piTitle, setPiTitle] = useState("");
  const [piDisplay, setPiDisplay] = useState("");
  const [tier, setTier] = useState<CompTier>("lab");
  const [months, setMonths] = useState("");
  const [phase, setPhase] = useState<StagePhase>({ state: "idle" });

  const monthsMissing = !months;
  const canStage =
    email.trim() !== "" &&
    labName.trim() !== "" &&
    slug.trim() !== "" &&
    !monthsMissing &&
    phase.state !== "busy";

  const stage = useCallback(async () => {
    setPhase({ state: "busy" });
    try {
      const res = await fetch("/api/admin/lab-provision/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          labName: labName.trim(),
          institution: institution.trim() || undefined,
          slug: slug.trim(),
          compTier: tier,
          compMonths: months ? Number(months) : undefined,
          piTitle: piTitle.trim() || undefined,
          piDisplay: piDisplay.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setPhase({
          state: "error",
          message: j.error ?? "Staging failed. Try again.",
        });
        return;
      }
      setPhase({ state: "done", slug: slug.trim(), email: email.trim() });
    } catch {
      setPhase({ state: "error", message: "Staging failed. Try again." });
    }
  }, [email, labName, institution, slug, tier, months, piTitle, piDisplay]);

  const reset = useCallback(() => {
    setEmail("");
    setLabName("");
    setInstitution("");
    setSlug("");
    setPiTitle("");
    setPiDisplay("");
    setTier("lab");
    setMonths("");
    setPhase({ state: "idle" });
  }, []);

  if (phase.state === "done") {
    return (
      <div className="max-w-lg">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Icon name="vial" className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-body font-semibold text-emerald-800">
                Lab staged
              </p>
              <p className="mt-1 text-meta text-emerald-700">
                The lab is reserved at slug {phase.slug} for {phase.email}. When
                they sign in once, their device runs the lab genesis and binds it
                automatically. The server never sees their private keys.
              </p>
            </div>
          </div>
        </div>
        <div className="mt-4">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-violet-600 px-3.5 py-2 text-body font-semibold text-white transition-colors hover:bg-violet-700"
          >
            Stage another lab
          </button>
        </div>
      </div>
    );
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500";

  return (
    <div className="max-w-lg">
      <div className="space-y-3">
        {/* PI email (typed in; hashed server-side, never stored plaintext). */}
        <label className="block text-meta text-foreground-muted">
          <Tooltip label="Hashed server-side to the PI owner key. The plaintext email is never stored.">
            <span className="flex w-fit items-center gap-1 font-medium uppercase tracking-wide underline decoration-dotted underline-offset-2">
              PI email
              <span className="text-red-500" aria-hidden>
                *
              </span>
            </span>
          </Tooltip>
          <input
            type="email"
            value={email}
            disabled={phase.state === "busy"}
            onChange={(e) => {
              setEmail(e.target.value);
              if (phase.state === "error") setPhase({ state: "idle" });
            }}
            placeholder="pi@university.edu"
            className={inputClass}
          />
        </label>

        {/* Lab name. */}
        <label className="block text-meta text-foreground-muted">
          <span className="flex items-center gap-1 font-medium uppercase tracking-wide">
            Lab name
            <span className="text-red-500" aria-hidden>
              *
            </span>
          </span>
          <input
            type="text"
            value={labName}
            disabled={phase.state === "busy"}
            onChange={(e) => setLabName(e.target.value)}
            placeholder="e.g. Nickles Lab"
            className={inputClass}
          />
        </label>

        {/* Institution (optional). */}
        <label className="block text-meta text-foreground-muted">
          <span className="block font-medium uppercase tracking-wide">
            Institution
          </span>
          <input
            type="text"
            value={institution}
            disabled={phase.state === "busy"}
            onChange={(e) => setInstitution(e.target.value)}
            placeholder="e.g. UW-Madison"
            className={inputClass}
          />
        </label>

        {/* Slug (reserved to the PI hash at stage time). */}
        <label className="block text-meta text-foreground-muted">
          <Tooltip label="The companion-site address. Reserved to the PI now, bound to the real lab when they sign in.">
            <span className="flex w-fit items-center gap-1 font-medium uppercase tracking-wide underline decoration-dotted underline-offset-2">
              Slug
              <span className="text-red-500" aria-hidden>
                *
              </span>
            </span>
          </Tooltip>
          <input
            type="text"
            value={slug}
            disabled={phase.state === "busy"}
            onChange={(e) => {
              setSlug(e.target.value);
              if (phase.state === "error") setPhase({ state: "idle" });
            }}
            placeholder="e.g. nickles-lab"
            className={inputClass}
          />
        </label>

        {/* Comp tier + months. */}
        <div className="flex gap-3">
          <label className="block flex-1 text-meta text-foreground-muted">
            <span className="block font-medium uppercase tracking-wide">
              Comp tier
            </span>
            <select
              value={tier}
              disabled={phase.state === "busy"}
              onChange={(e) => setTier(e.target.value as CompTier)}
              className={inputClass}
            >
              {COMP_TIER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block flex-1 text-meta text-foreground-muted">
            <span className="flex items-center gap-1 font-medium uppercase tracking-wide">
              Months
              <span className="text-red-500" aria-hidden>
                *
              </span>
            </span>
            <input
              type="number"
              min="1"
              step="1"
              value={months}
              disabled={phase.state === "busy"}
              onChange={(e) => {
                setMonths(e.target.value);
                if (phase.state === "error") setPhase({ state: "idle" });
              }}
              placeholder="e.g. 12"
              className={`mt-1 w-full rounded-lg border bg-surface-sunken px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                monthsMissing ? "border-red-400" : "border-border"
              }`}
            />
          </label>
        </div>
        {monthsMissing && (
          <p className="text-meta text-red-600">
            A comped tier requires a month count. Permanent comps are not allowed
            (decision 3).
          </p>
        )}

        {/* Optional cosmetic PI title + display. */}
        <div className="flex gap-3">
          <label className="block flex-1 text-meta text-foreground-muted">
            <span className="block font-medium uppercase tracking-wide">
              PI title
            </span>
            <input
              type="text"
              value={piTitle}
              disabled={phase.state === "busy"}
              onChange={(e) => setPiTitle(e.target.value)}
              placeholder="e.g. Dr."
              className={inputClass}
            />
          </label>
          <label className="block flex-1 text-meta text-foreground-muted">
            <span className="block font-medium uppercase tracking-wide">
              PI display name
            </span>
            <input
              type="text"
              value={piDisplay}
              disabled={phase.state === "busy"}
              onChange={(e) => setPiDisplay(e.target.value)}
              placeholder="e.g. Grant Nickles"
              className={inputClass}
            />
          </label>
        </div>
      </div>

      {phase.state === "error" && (
        <p className="mt-3 text-meta text-rose-700">{phase.message}</p>
      )}

      <div className="mt-5">
        <button
          type="button"
          onClick={stage}
          disabled={!canStage}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2 text-body font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
        >
          {phase.state === "busy" ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Staging...
            </>
          ) : (
            <>
              <Icon name="plus" className="h-4 w-4" />
              Stage lab
            </>
          )}
        </button>
      </div>
    </div>
  );
}
