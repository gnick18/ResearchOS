"use client";

/**
 * Dev-only side-by-side gallery for the onboarding-mascot options.
 * Renders all 5 candidate mascots — the shipped `BeakerBot` plus the four
 * alternatives (`TardigradeBot`, `PetriDishBot`, `OwlBot`, `PipetteBot`)
 * — at multiple sizes and in all three pose/direction variants, so the
 * user can compare FORMS at a glance.
 *
 * Dev-gated the same way as `DevForceTipButton` /
 * `DevTestNotificationButton`: a literal `process.env.NODE_ENV ===
 * "development"` check, which Next.js statically replaces at build so
 * the body of the page becomes dead code in production bundles.
 *
 * Single tint color (`text-slate-700`) is applied at the row container
 * so each mascot's `currentColor` strokes render identically and the
 * comparison is about silhouette, not palette.
 */

import BeakerBot, { type BeakerBotPose } from "@/components/BeakerBot";
import TardigradeBot from "@/components/onboarding-mascots/TardigradeBot";
import PetriDishBot from "@/components/onboarding-mascots/PetriDishBot";
import OwlBot from "@/components/onboarding-mascots/OwlBot";
import PipetteBot from "@/components/onboarding-mascots/PipetteBot";

const IS_DEV = process.env.NODE_ENV === "development";

type MascotComponent = React.ComponentType<{
  pose: "idle" | "pointing";
  direction?: "left" | "right";
  className?: string;
}>;

interface MascotRow {
  name: string;
  Component: MascotComponent;
}

const MASCOTS: MascotRow[] = [
  { name: "BeakerBot (shipped)", Component: BeakerBot as MascotComponent },
  { name: "TardigradeBot", Component: TardigradeBot as MascotComponent },
  { name: "PetriDishBot", Component: PetriDishBot as MascotComponent },
  { name: "OwlBot", Component: OwlBot as MascotComponent },
  { name: "PipetteBot", Component: PipetteBot as MascotComponent },
];

interface Variant {
  label: string;
  pose: "idle" | "pointing";
  direction?: "left" | "right";
  sizeClass: string;
}

const VARIANTS: Variant[] = [
  { label: "idle 16", pose: "idle", sizeClass: "w-4 h-4" },
  { label: "idle 24", pose: "idle", sizeClass: "w-6 h-6" },
  { label: "idle 32", pose: "idle", sizeClass: "w-8 h-8" },
  { label: "idle 48", pose: "idle", sizeClass: "w-12 h-12" },
  { label: "point R 32", pose: "pointing", direction: "right", sizeClass: "w-8 h-8" },
  { label: "point R 48", pose: "pointing", direction: "right", sizeClass: "w-12 h-12" },
  { label: "point L 32", pose: "pointing", direction: "left", sizeClass: "w-8 h-8" },
];

// BeakerBot-only: full pose catalog at 48px, both with and without
// the pastel-rainbow liquid fill, in both pointing directions where
// applicable.
interface BeakerVariant {
  label: string;
  pose: BeakerBotPose;
  direction?: "left" | "right";
  noLiquid?: boolean;
  sizeClass: string;
}

const BEAKER_POSE_VARIANTS: BeakerVariant[] = [
  { label: "idle", pose: "idle", sizeClass: "w-12 h-12" },
  { label: "idle (no liquid)", pose: "idle", noLiquid: true, sizeClass: "w-12 h-12" },
  { label: "pointing R", pose: "pointing", direction: "right", sizeClass: "w-12 h-12" },
  { label: "pointing L", pose: "pointing", direction: "left", sizeClass: "w-12 h-12" },
  { label: "pointing-up R", pose: "pointing-up", direction: "right", sizeClass: "w-12 h-12" },
  { label: "pointing-up L", pose: "pointing-up", direction: "left", sizeClass: "w-12 h-12" },
  { label: "pointing-down R", pose: "pointing-down", direction: "right", sizeClass: "w-12 h-12" },
  { label: "pointing-down L", pose: "pointing-down", direction: "left", sizeClass: "w-12 h-12" },
  { label: "cheering", pose: "cheering", sizeClass: "w-12 h-12" },
  { label: "waving R", pose: "waving", direction: "right", sizeClass: "w-12 h-12" },
  { label: "waving L", pose: "waving", direction: "left", sizeClass: "w-12 h-12" },
];

const BEAKER_SCALE_LADDER: { label: string; sizeClass: string }[] = [
  { label: "16", sizeClass: "w-4 h-4" },
  { label: "24", sizeClass: "w-6 h-6" },
  { label: "32", sizeClass: "w-8 h-8" },
  { label: "48", sizeClass: "w-12 h-12" },
  { label: "64", sizeClass: "w-16 h-16" },
  { label: "96", sizeClass: "w-24 h-24" },
];

export default function MascotGalleryPage() {
  if (!IS_DEV) {
    return <div className="p-8 text-slate-600">This page is dev-only.</div>;
  }
  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">
          Onboarding-mascot gallery
        </h1>
        <p className="text-sm text-slate-600 mb-8">
          BeakerBot (winner) is shown first with all pose variants and the
          full size ladder. Other mascot alternatives are kept below for
          reference. The pastel-rainbow liquid is hardcoded (not{" "}
          <code className="px-1 py-0.5 bg-slate-200 rounded text-xs">currentColor</code>);
          the outline tints via Tailwind text-color classes.
        </p>

        {/* BeakerBot — pose catalog */}
        <section className="bg-white border-2 border-sky-200 rounded-lg p-6 mb-10">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">
            BeakerBot — full pose catalog
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            All poses at 48px in <code className="px-1 py-0.5 bg-slate-200 rounded text-[10px]">text-sky-500</code>.
            The pointing variants emit the dotted pointer-line from the
            triangle tip; cheering and waving are non-pointing.
          </p>
          <div className="grid grid-cols-4 gap-6 text-sky-500">
            {BEAKER_POSE_VARIANTS.map((v) => (
              <div
                key={v.label}
                className="flex flex-col items-center gap-2 p-3 rounded-lg bg-slate-50"
              >
                <BeakerBot
                  pose={v.pose}
                  direction={v.direction}
                  noLiquid={v.noLiquid}
                  className={`${v.sizeClass} text-sky-500`}
                />
                <span className="text-[10px] uppercase tracking-wide text-slate-500">
                  {v.label}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* BeakerBot — scale ladder */}
        <section className="bg-white border-2 border-sky-200 rounded-lg p-6 mb-10">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">
            BeakerBot — scale ladder
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            Idle pose at every size the mascot is likely to render in
            (16 → 96px). The pastel-rainbow liquid should remain legible
            at 32px+; at 16/24 the gradient compresses but the
            silhouette holds.
          </p>
          <div className="flex flex-wrap items-end gap-6 text-sky-500">
            {BEAKER_SCALE_LADDER.map((v) => (
              <div key={v.label} className="flex flex-col items-center gap-2">
                <BeakerBot pose="idle" className={`${v.sizeClass} text-sky-500`} />
                <span className="text-[10px] uppercase tracking-wide text-slate-500">
                  {v.label}px
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* BeakerBot — tint variations on the outline. Liquid stays
            the same gradient regardless. */}
        <section className="bg-white border-2 border-sky-200 rounded-lg p-6 mb-10">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">
            BeakerBot — outline tint variations
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            Same mascot rendered in different Tailwind text colors.
            Liquid gradient stays consistent (it's not{" "}
            <code className="px-1 py-0.5 bg-slate-200 rounded text-[10px]">currentColor</code>);
            only the outline + eyes + smile + cheek dashes shift tint.
          </p>
          <div className="flex flex-wrap items-end gap-6">
            {[
              { name: "sky", cls: "text-sky-500" },
              { name: "slate", cls: "text-slate-700" },
              { name: "emerald", cls: "text-emerald-500" },
              { name: "amber", cls: "text-amber-500" },
              { name: "rose", cls: "text-rose-500" },
              { name: "violet", cls: "text-violet-500" },
            ].map((t) => (
              <div key={t.name} className="flex flex-col items-center gap-2">
                <BeakerBot pose="pointing" direction="right" className={`w-12 h-12 ${t.cls}`} />
                <span className="text-[10px] uppercase tracking-wide text-slate-500">
                  {t.name}
                </span>
              </div>
            ))}
          </div>
        </section>

        <h2 className="text-xl font-semibold text-slate-900 mb-4">
          Other mascot alternatives (reference)
        </h2>
        <div className="space-y-10">
          {MASCOTS.map(({ name, Component }) => (
            <section key={name} className="bg-white border border-slate-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">{name}</h2>
              <div className="flex flex-wrap items-end gap-6 text-slate-700">
                {VARIANTS.map((v) => (
                  <div key={v.label} className="flex flex-col items-center gap-2">
                    <Component
                      pose={v.pose}
                      direction={v.direction}
                      className={`${v.sizeClass} text-slate-700`}
                    />
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      {v.label}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <p className="mt-10 text-xs text-slate-500">
          These are mascot options for the onboarding-tips system. The current
          shipped mascot is <strong>BeakerBot</strong>.
        </p>
      </div>
    </div>
  );
}
