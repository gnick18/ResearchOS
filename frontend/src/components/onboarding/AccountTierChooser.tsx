"use client";

// The 3-tier account chooser. Rendered as the first beat for a fresh user
// (no currentUser, fresh folder) before ResearchFolderSetupNew.
//
// Copy, tile layout, comparison table, and guide are lifted verbatim from
// docs/mockups/account-setup-revamp.html and docs/mockups/beakerbot-tier-icons.html.
//
// Flag gating:
//   Local tile  -- ALWAYS shown.
//   Free tile   -- shown when isOAuthPublishAvailable() (NEXT_PUBLIC_SHARING_ENABLED).
//   Lab tile    -- shown when LAB_TIER_ENABLED.
//
// This component is purely presentational + the onChoose callback.
// It does NOT create accounts or touch OAuth (Phase B).
//
// No em-dashes, no emojis, no mid-sentence colons.

import React, { useState } from "react";
import { BeakerBotScene } from "@/components/onboarding/BeakerBotScene";
import { LAB_TIER_ENABLED } from "@/lib/lab/config";
import { isOAuthPublishAvailable } from "@/lib/sharing/oauth-availability";

export type AccountTier = "local" | "free" | "lab";

export interface AccountTierChooserProps {
  /** Called when the user clicks a tier's primary button. */
  onChoose: (tier: AccountTier) => void;
}

// ---- Feature comparison table data (verbatim from beakerbot-tier-icons.html FEAT array) ----
type CellValue = boolean | string;
const FEAT: [string, CellValue, CellValue, CellValue][] = [
  ["The account itself", "Free (no account)", "Free", "Free to create"],
  ["Sign-in required", false, "Yes (Google etc.)", "Yes (Google etc.)"],
  ["Local-first: your data lives on your disk", true, true, true],
  [
    "Cloud is only an intermediary (relays sync/sharing)",
    "Never used",
    "For external sends",
    "Keeps the team in sync",
  ],
  [
    "Full app: Gantt, methods, notes, sequences, calculators",
    true,
    true,
    true,
  ],
  ["Works fully offline", true, true, "Local-first; collab needs internet"],
  ["Findable in the researcher directory", false, true, true],
  [
    "Send & receive notes / methods / files with outside researchers",
    false,
    true,
    true,
  ],
  ["Real-time co-editing inside a lab", false, false, true],
  ["Shared lab workspace + PI oversight", false, false, true],
  ["Sign in & restore on a new device", false, true, true],
  [
    "Free cloud (sharing + collab)",
    "—",
    "1 GB",
    "1 GB per member (pooled)",
  ],
  [
    "At the free cap",
    "Never reached",
    "Usage pauses, you are never billed",
    "Usage pauses unless the cap is raised",
  ],
  [
    "Want more (opt-in)",
    "—",
    "Raise your cap; pay only for what you use, up to a ceiling you set ($0.30/GB-mo)",
    "PI raises one lab cap; one consolidated bill",
  ],
  [
    "Upgrade later",
    "Add an account or lab anytime",
    "Create or join a lab anytime",
    "—",
  ],
];

// ---- Which tier is for you? guide (verbatim from beakerbot-tier-icons.html GUIDE array) ----
const GUIDE = [
  {
    h: "Just me, local",
    p: "You work on your own, want zero setup, and want everything to stay on your computer. No account, no internet required, the most private option.",
  },
  {
    h: "Free account",
    p: "You mostly work solo but want to share notes, methods or files with collaborators at other labs, or be findable by other researchers. The account is free and your data still lives on your disk. You get 1 GB of cloud free; if you hit it, sharing just pauses (old sends auto-expire after 30 days, freeing space) and you are never charged. Want more headroom? Raise your cap and pay only for what you use, never more than the ceiling you set.",
  },
  {
    h: "Lab",
    p: "You run or belong to a lab and want the whole team together: a shared workspace, real-time co-editing, and PI oversight. It is still local-first, every member's data lives on their own disk; the cloud is only the intermediary that keeps the team in sync, and that is what the PI funds. Creating a lab is free, with a 1 GB pooled allowance per member. If the lab needs more, the PI raises one cap and pays only for actual use ($0.30/GB-mo), capped at a ceiling they set. A small or light lab stays at $0.",
  },
];

// ---- Cell renderer for the comparison table ----
function CompareCell({ value }: { value: CellValue }) {
  if (value === true) {
    return (
      <td className="text-center py-2.5 px-3">
        <span className="text-green-600 font-bold text-base">&#10003;</span>
      </td>
    );
  }
  if (value === false) {
    return (
      <td className="text-center py-2.5 px-3">
        <span className="text-slate-300 text-base">&mdash;</span>
      </td>
    );
  }
  return (
    <td className="text-center py-2.5 px-3">
      <span className="text-foreground-muted text-xs">{value}</span>
    </td>
  );
}

// ---- Compare + guide expandable section ----
function CompareTiers({
  showFree,
  showLab,
}: {
  showFree: boolean;
  showLab: boolean;
}) {
  return (
    <div className="w-full max-w-4xl mt-8 space-y-6">
      {/* comparison table */}
      <div className="overflow-x-auto rounded-xl border border-border shadow-sm">
        <table className="w-full border-collapse bg-surface-raised text-sm">
          <thead>
            <tr className="bg-[#E6F4FE] dark:bg-surface-sunken">
              <th className="py-3 px-3 text-left w-[40%]" />
              <th className="py-3 px-3 text-center">
                <span className="inline-block w-10 h-10 mb-1">
                  <BeakerBotScene name="solo" />
                </span>
                <div className="font-bold text-sm text-foreground">Just me, local</div>
                <div className="text-[11px] font-semibold text-foreground-muted">Free</div>
              </th>
              {showFree && (
                <th className="py-3 px-3 text-center">
                  <span className="inline-block w-10 h-10 mb-1">
                    <BeakerBotScene name="computer" />
                  </span>
                  <div className="font-bold text-sm text-foreground">Free account</div>
                  <div className="text-[11px] font-semibold text-foreground-muted">Free</div>
                </th>
              )}
              {showLab && (
                <th className="py-3 px-3 text-center">
                  <span className="inline-block w-10 h-10 mb-1">
                    <BeakerBotScene name="lab" />
                  </span>
                  <div className="font-bold text-sm text-foreground">Lab</div>
                  <div className="text-[11px] font-semibold text-foreground-muted">Paid</div>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {FEAT.map(([label, localVal, freeVal, labVal], i) => (
              <tr
                key={i}
                className="border-t border-border last:border-b-0"
              >
                <td className="py-2.5 px-3 font-semibold text-foreground text-xs">
                  {label}
                </td>
                <CompareCell value={localVal} />
                {showFree && <CompareCell value={freeVal} />}
                {showLab && <CompareCell value={labVal} />}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* which tier is for you */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-foreground-muted mb-3">
          Which tier is for you?
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {GUIDE.map((g, i) => {
            // Only render free/lab guide cards if those tiers are visible
            if (i === 1 && !showFree) return null;
            if (i === 2 && !showLab) return null;
            return (
              <div
                key={i}
                className="bg-surface-raised border border-border rounded-2xl p-4 shadow-sm"
              >
                <div className="text-[11px] font-extrabold tracking-wide uppercase text-[#1AA0E6] mb-1">
                  Pick this if
                </div>
                <h4 className="font-extrabold text-base text-foreground mb-1.5">{g.h}</h4>
                <p className="text-xs text-foreground-muted leading-relaxed">{g.p}</p>
              </div>
            );
          })}
        </div>
        {/* tip bar */}
        <div className="mt-4 bg-[#E6F4FE] dark:bg-surface-sunken border border-border rounded-xl px-4 py-3 text-sm text-foreground">
          <span className="font-bold text-brand-sky">Every tier is local-first</span>,
          your files always live on your own disk. The cloud is only an
          intermediary for sharing and team sync. We charge only to cover what
          that intermediary actually costs us (cost-recovery, never more), and
          the free allowance is on us.{" "}
          <span className="font-bold text-brand-sky">Not sure?</span> Start
          with Just me, local, you can upgrade any time without moving or
          losing anything.
        </div>
      </div>
    </div>
  );
}

// ---- Main component ----
export function AccountTierChooser({ onChoose }: AccountTierChooserProps) {
  const [compareOpen, setCompareOpen] = useState(false);

  // Flag gating: evaluate once at render time (these are env-var reads, stable)
  const showFree = isOAuthPublishAvailable();
  const showLab = LAB_TIER_ENABLED;

  return (
    <div className="flex flex-col items-center w-full px-6 py-10 min-h-screen bg-surface text-foreground">
      {/* header BeakerBot + wordmark */}
      <div className="w-16 h-20 mb-3 flex-none">
        <BeakerBotScene name="solo" className="w-full h-full" />
      </div>

      <h1 className="text-2xl font-extrabold tracking-tight text-foreground text-center mt-1">
        How will you use ResearchOS?
      </h1>
      <p className="text-sm text-foreground-muted text-center mt-2 mb-0">
        Pick one. You can change later, nothing is locked in.
      </p>

      {/* tiles */}
      <div
        className={[
          "grid gap-4 w-full max-w-3xl mt-8",
          showFree || showLab ? "sm:grid-cols-3" : "sm:grid-cols-1 max-w-xs",
        ].join(" ")}
      >
        {/* Local-only tile — ALWAYS shown */}
        <div className="flex flex-col text-left border border-border rounded-2xl p-5 bg-surface-raised cursor-pointer transition-transform hover:-translate-y-0.5 hover:border-[#1283c9] hover:shadow-lg min-h-[230px]">
          <BeakerBotScene name="solo" className="w-20 h-20 mb-2 flex-none" />
          <span className="inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full mb-1.5 bg-green-100 text-green-700 self-start">
            Free
          </span>
          <h3 className="font-extrabold text-lg text-foreground mb-1">Just me, local</h3>
          <p className="text-xs text-foreground-muted mt-1">
            Everything stays on your computer. No account, no login, nothing
            leaves your disk.
          </p>
          <ul className="mt-3 pl-4 text-xs text-foreground-muted space-y-1 list-disc">
            <li>Full app, offline</li>
            <li>No sign-in ever</li>
            <li>Most private</li>
          </ul>
          <div className="mt-auto pt-4">
            <button
              className="w-full py-2 px-4 rounded-xl bg-[#1283c9] hover:bg-[#0f6fa8] text-white font-semibold text-sm transition-colors"
              onClick={() => onChoose("local")}
            >
              Start local
            </button>
          </div>
        </div>

        {/* Free account tile — shown when SHARING_ENABLED */}
        {showFree && (
          <div className="flex flex-col text-left border border-border rounded-2xl p-5 bg-surface-raised cursor-pointer transition-transform hover:-translate-y-0.5 hover:border-[#1283c9] hover:shadow-lg min-h-[230px]">
            <BeakerBotScene name="computer" className="w-20 h-20 mb-2 flex-none" />
            <span className="inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full mb-1.5 bg-green-100 text-green-700 self-start">
              Free
            </span>
            <h3 className="font-extrabold text-lg text-foreground mb-1">Free account</h3>
            <p className="text-xs text-foreground-muted mt-1">
              Local like above, plus a sign-in so you can share notes, methods
              and files with researchers outside your folder.
            </p>
            <ul className="mt-3 pl-4 text-xs text-foreground-muted space-y-1 list-disc">
              <li>Data still on your disk</li>
              <li>Findable in the directory</li>
              <li>Send + receive externally</li>
            </ul>
            <div className="mt-auto pt-4">
              <button
                className="w-full py-2 px-4 rounded-xl bg-[#1283c9] hover:bg-[#0f6fa8] text-white font-semibold text-sm transition-colors"
                onClick={() => onChoose("free")}
              >
                Create free account
              </button>
            </div>
          </div>
        )}

        {/* Lab tile — shown when LAB_TIER_ENABLED */}
        {showLab && (
          <div className="flex flex-col text-left border border-border rounded-2xl p-5 bg-surface-raised cursor-pointer transition-transform hover:-translate-y-0.5 hover:border-[#1283c9] hover:shadow-lg min-h-[230px]">
            <BeakerBotScene name="lab" className="w-20 h-20 mb-2 flex-none" />
            <span className="inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full mb-1.5 bg-purple-100 text-[#5B47D6] self-start">
              Paid
            </span>
            <h3 className="font-extrabold text-lg text-foreground mb-1">Lab</h3>
            <p className="text-xs text-foreground-muted mt-1">
              Run or join a lab. Real-time collaboration, PI oversight,
              cloud-backed so your team works together.
            </p>
            <ul className="mt-3 pl-4 text-xs text-foreground-muted space-y-1 list-disc">
              <li>Create a lab or join one</li>
              <li>Cloud sync (server-blind)</li>
              <li>Everything in Free, too</li>
            </ul>
            <div className="mt-auto pt-4">
              <button
                className="w-full py-2 px-4 rounded-xl bg-[#1283c9] hover:bg-[#0f6fa8] text-white font-semibold text-sm transition-colors"
                onClick={() => onChoose("lab")}
              >
                Set up a lab
              </button>
            </div>
          </div>
        )}
      </div>

      {/* solo escape hatch */}
      <p className="mt-5 text-sm text-foreground-muted text-center">
        Not sure?{" "}
        <button
          className="text-brand-action font-semibold underline hover:no-underline"
          onClick={() => onChoose("local")}
        >
          Start local for now
        </button>
        , you can upgrade to an account or a lab any time.
      </p>

      {/* compare the tiers expandable */}
      <div className="w-full max-w-4xl mt-8">
        <button
          className="flex items-center gap-2 text-sm font-semibold text-[#1283c9] hover:text-[#0f6fa8] transition-colors mx-auto"
          onClick={() => setCompareOpen((o) => !o)}
          aria-expanded={compareOpen}
        >
          <span
            aria-hidden="true"
            className={`inline-block text-xs leading-none transition-transform ${compareOpen ? "rotate-180" : ""}`}
          >
            &#9662;
          </span>
          {compareOpen ? "Hide comparison" : "Compare the tiers"}
        </button>

        {compareOpen && (
          <CompareTiers showFree={showFree} showLab={showLab} />
        )}
      </div>
    </div>
  );
}

export default AccountTierChooser;
