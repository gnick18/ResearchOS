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

import BeakerBot from "@/components/BeakerBot";
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
          Side-by-side comparison of mascot options at the sizes used by
          the onboarding-tips card. All rendered in <code className="px-1 py-0.5 bg-slate-200 rounded text-xs">text-slate-700</code>{" "}
          so the comparison is purely about silhouette.
        </p>

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
