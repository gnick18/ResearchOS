"use client";

// The 3-tier account chooser. Rendered as the first beat for a fresh user
// (no currentUser, fresh folder) before the folder connect.
//
// Phase B2: the chooser is now a state machine.
//
//   Local tile   -> onLocal() (opens the OS picker directly via connect())
//   Free tile    -> provider sub-step -> router.push("/?connect=1&signIn=<p>")
//   Lab tile     -> create-or-join sub-step:
//                     Create -> provider sub-step -> sets lab-create marker, router.push
//                     Join   -> invite-link sub-step -> router.push to accept path
//
// Flag gating:
//   Local tile  -- ALWAYS shown.
//   Free tile   -- shown when isOAuthPublishAvailable() (NEXT_PUBLIC_SHARING_ENABLED).
//   Lab tile    -- shown when LAB_TIER_ENABLED.
//
// No em-dashes, no emojis, no mid-sentence colons.

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { BeakerBotScene } from "@/components/onboarding/BeakerBotScene";
import LandingBackdrop from "@/components/onboarding/oauth-first/LandingBackdrop";
import { LAB_TIER_ENABLED } from "@/lib/lab/config";
import { DEPT_TIER_ENABLED } from "@/lib/dept/config";
import { INSTITUTION_TIER_ENABLED } from "@/lib/institution/config";
import { ONBOARDING_WIZARD_ENABLED } from "@/lib/onboarding/config";
import { isOAuthPublishAvailable } from "@/lib/sharing/oauth-availability";
import { isRequireAccountEnabled, isLocalPathVisible } from "@/lib/account/require-account";
import { startOAuthFirstSignIn } from "@/lib/sharing/oauth-first-signin";
import SharingProviderButtons from "@/components/sharing/SharingProviderButtons";
import type { SharingProvider } from "@/components/sharing/SharingProviderButtons";

export type AccountTier = "local" | "free" | "lab";

// Shared deck backdrop for the tier-chooser step screens, unifying them with the
// OAuth-first landing. Rendered behind the step content via a negative-z layer
// (the step container is `isolate`, so the backdrop sits above the white base
// but below the static content without re-wrapping every child).
function StepBg() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10">
      <LandingBackdrop />
    </div>
  );
}

export interface AccountTierChooserProps {
  /**
   * Called when the user picks Local (fall-through to folder setup).
   * Either onLocal or onChoose must be supplied; prefer onLocal.
   */
  onLocal?: () => void;
  /**
   * Legacy compat: previously the prop was onChoose(tier). Callers that still
   * pass onChoose get the Local path wired automatically; Free + Lab are handled
   * internally via router.push so they never call back.
   * @deprecated prefer onLocal
   */
  onChoose?: (tier: AccountTier) => void;
  /**
   * Called when the bottom-zone org-admin entry is chosen, with the org kind.
   * Only wired and rendered behind the onboarding wizard flag plus the matching
   * org tier flag (the chooser routes the org path into the wizard there). When
   * the wizard flag is off this prop is never invoked and the entry is hidden,
   * so the chooser's existing behavior is completely unchanged.
   */
  onOrgAdmin?: (kind: "department" | "institution") => void;
}

// Internal navigation state for the sub-steps
type ChooserStep =
  | { view: "tiles" }
  | { view: "free-provider" }
  | { view: "lab-choice" }
  | { view: "lab-create-provider" }
  | { view: "lab-join" };

// ---- Feature comparison table data (verbatim from beakerbot-tier-icons.html FEAT array) ----
type CellValue = boolean | string;
const FEAT: [string, CellValue, CellValue, CellValue][] = [
  ["The account itself", "Free (no account)", "Free", "Paid plan"],
  ["Sign-in required", false, "Yes (Google etc.)", "Yes (Google etc.)"],
  ["Local-first: your data lives on your disk", true, true, true],
  [
    "Cloud is only an intermediary (relays sync/sharing)",
    "Never used",
    "Receives shares for you",
    "Keeps the team in sync",
  ],
  [
    "Full app: Gantt, methods, notes, sequences, calculators",
    true,
    true,
    true,
  ],
  ["Works fully offline", true, true, "Local-first; live sync needs internet"],
  ["Findable in the researcher directory", false, true, true],
  [
    "Receive notes, methods, and files shared by other researchers",
    false,
    true,
    true,
  ],
  [
    "Send and share your own work with outside researchers (paid)",
    false,
    false,
    true,
  ],
  ["Real-time co-editing inside a lab (paid)", false, false, true],
  ["Shared lab workspace and PI oversight", false, false, true],
  ["Sign in and restore on a new device", false, true, true],
  [
    "One-time AI gift on sign-up (about 1.6M tokens)",
    false,
    true,
    true,
  ],
  [
    "Cloud sync and sharing",
    "Never used",
    "Receive only",
    "Pay for what you use, with a cap you set",
  ],
  [
    "No surprise bills",
    true,
    true,
    "A monthly cap you control; the local app never stops",
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
    p: "You mostly work solo but want to receive notes, methods or files shared by researchers at other labs, and be findable in the directory. The account is free and your data still lives on your disk, and signing up comes with a one-time gift of about 1.6 million AI tokens. When you want to send and co-edit your own work, a paid plan unlocks the produce side, pay-for-what-you-use with a monthly cap you set.",
  },
  {
    h: "Lab",
    p: "You run or belong to a lab and want the whole team together, with a shared workspace, real-time co-editing, and PI oversight. It is still local-first, every member's data lives on their own disk, and the cloud is only the intermediary that keeps the team in sync. The Lab plan is a flat per-lab fee plus the cloud your lab actually uses, billed only to the PI on one invoice, with a cap the PI sets so there are no surprises.",
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
  showLocal,
  showFree,
  showLab,
}: {
  showLocal: boolean;
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
              {showLocal && (
                <th className="py-3 px-3 text-center">
                  <span className="inline-block w-10 h-10 mb-1">
                    <BeakerBotScene name="solo" />
                  </span>
                  <div className="font-bold text-sm text-foreground">Just me, local</div>
                  <div className="text-[11px] font-semibold text-foreground-muted">Free</div>
                </th>
              )}
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
                {showLocal && <CompareCell value={localVal} />}
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
            // Only render guide cards for tiers that are visible
            if (i === 0 && !showLocal) return null;
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
          intermediary for sending and team sync. Paid plans are
          pay-for-what-you-use, a small base fee plus the cloud you actually
          use, with a monthly cap you set so there are no surprises.
          {showLocal && (
            <>
              {" "}
              <span className="font-bold text-brand-sky">Not sure?</span> Start
              with Just me, local, you can upgrade any time without moving or
              losing anything.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Sub-step: provider picker with a Back button ----
function ProviderSubStep({
  heading,
  subheading,
  onProvider,
  onBack,
}: {
  heading: string;
  subheading: string;
  onProvider: (p: SharingProvider) => void;
  onBack: () => void;
}) {
  return (
    <div className="light-scope relative isolate flex flex-col items-center w-full px-6 py-10 min-h-screen bg-white text-foreground"><StepBg />
      <div className="w-16 h-20 mb-3 flex-none">
        <BeakerBotScene name="computer" className="w-full h-full" />
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground text-center mt-1">
        {heading}
      </h1>
      <p className="text-sm text-foreground-muted text-center mt-2 mb-8 max-w-sm">
        {subheading}
      </p>
      <div className="w-full max-w-xs">
        <SharingProviderButtons onProvider={onProvider} />
      </div>
      <button
        type="button"
        className="mt-6 text-sm text-foreground-muted hover:text-foreground underline hover:no-underline transition-colors"
        onClick={onBack}
      >
        Back
      </button>
    </div>
  );
}

// ---- Sub-step: create or join a lab ----
function LabChoiceSubStep({
  onCreate,
  onJoin,
  onBack,
}: {
  onCreate: () => void;
  onJoin: () => void;
  onBack: () => void;
}) {
  return (
    <div className="light-scope relative isolate flex flex-col items-center w-full px-6 py-10 min-h-screen bg-white text-foreground"><StepBg />
      <div className="w-16 h-20 mb-3 flex-none">
        <BeakerBotScene name="lab" className="w-full h-full" />
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground text-center mt-1">
        Set up a lab
      </h1>
      <p className="text-sm text-foreground-muted text-center mt-2 mb-8 max-w-sm">
        You can create a new lab or join one you have been invited to.
      </p>
      <div className="w-full max-w-xs space-y-3">
        <button
          type="button"
          className="w-full py-3 px-4 rounded-xl bg-[#1283c9] hover:bg-[#0f6fa8] text-white font-semibold text-sm transition-colors"
          onClick={onCreate}
        >
          Create a lab
        </button>
        <button
          type="button"
          className="w-full py-3 px-4 rounded-xl border border-border bg-surface-raised hover:border-[#1283c9] text-foreground font-semibold text-sm transition-colors"
          onClick={onJoin}
        >
          Join a lab
        </button>
      </div>
      <button
        type="button"
        className="mt-6 text-sm text-foreground-muted hover:text-foreground underline hover:no-underline transition-colors"
        onClick={onBack}
      >
        Back
      </button>
    </div>
  );
}

// ---- Lab directory search result shape ----
interface LabSearchResult {
  labId: string;
  name: string;
  institution: string | null;
  piName: string;
  memberCount: number;
}

// ---- Sub-step: join via invite link or browse the directory ----
function LabJoinSubStep({
  onBack,
}: {
  onBack: () => void;
}) {
  const router = useRouter();
  const [inviteLink, setInviteLink] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

  // Directory search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LabSearchResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  // { labId -> 'idle' | 'pending' | 'sent' | 'error' }
  const [requestState, setRequestState] = useState<Record<string, string>>({});

  function handleJoin() {
    setJoinError(null);
    const trimmed = inviteLink.trim();
    if (!trimmed) {
      setJoinError("Paste an invite link to continue.");
      return;
    }
    try {
      const url = new URL(trimmed);
      router.push(url.pathname + url.search + url.hash);
    } catch {
      if (trimmed.startsWith("/accept/")) {
        router.push(trimmed);
      } else {
        setJoinError("That does not look like a valid invite link. Paste the full URL from your invitation.");
      }
    }
  }

  async function handleSearch() {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchError("Enter at least 2 characters.");
      return;
    }
    setSearchError(null);
    setSearchResults(null);
    setSearching(true);
    try {
      const res = await fetch(
        `/api/directory/labs?q=${encodeURIComponent(q)}`,
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        setSearchError(
          typeof data.error === "string" ? data.error : "Search failed.",
        );
        return;
      }
      const data = (await res.json()) as { labs: LabSearchResult[] };
      setSearchResults(data.labs ?? []);
    } catch {
      setSearchError("Search failed. Check your connection and try again.");
    } finally {
      setSearching(false);
    }
  }

  async function handleRequestJoin(labId: string) {
    setRequestState((s) => ({ ...s, [labId]: "pending" }));
    try {
      const res = await fetch("/api/directory/labs/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ labId }),
      });
      if (!res.ok) {
        setRequestState((s) => ({ ...s, [labId]: "error" }));
        return;
      }
      setRequestState((s) => ({ ...s, [labId]: "sent" }));
    } catch {
      setRequestState((s) => ({ ...s, [labId]: "error" }));
    }
  }

  return (
    <div className="light-scope relative isolate flex flex-col items-center w-full px-6 py-10 min-h-screen bg-white text-foreground"><StepBg />
      <div className="w-16 h-20 mb-3 flex-none">
        <BeakerBotScene name="lab" className="w-full h-full" />
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground text-center mt-1">
        Join a lab
      </h1>
      <p className="text-sm text-foreground-muted text-center mt-2 mb-8 max-w-sm">
        Paste the invite link your PI sent you, or search the lab directory and
        request to join.
      </p>

      {/* Invite link section */}
      <div className="w-full max-w-sm space-y-3">
        <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">
          Have an invite link?
        </p>
        <input
          type="url"
          placeholder="https://research-os.app/accept/..."
          value={inviteLink}
          onChange={(e) => {
            setInviteLink(e.target.value);
            if (joinError) setJoinError(null);
          }}
          className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface-raised text-foreground text-sm placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-[#1283c9] focus:border-transparent"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleJoin();
          }}
        />
        {joinError && (
          <p className="text-xs text-red-600">{joinError}</p>
        )}
        <button
          type="button"
          className="w-full py-3 px-4 rounded-xl bg-[#1283c9] hover:bg-[#0f6fa8] text-white font-semibold text-sm transition-colors disabled:opacity-50"
          onClick={handleJoin}
          disabled={!inviteLink.trim()}
        >
          Join via link
        </button>
      </div>

      {/* Directory search section */}
      <div className="w-full max-w-sm mt-8 space-y-3">
        <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">
          Or browse the lab directory
        </p>
        <div className="flex gap-2">
          <input
            type="search"
            placeholder="Search by lab name or institution..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (searchError) setSearchError(null);
            }}
            className="flex-1 px-3 py-2.5 rounded-xl border border-border bg-surface-raised text-foreground text-sm placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-[#1283c9] focus:border-transparent"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
          />
          <button
            type="button"
            className="px-4 py-2.5 rounded-xl bg-[#1283c9] hover:bg-[#0f6fa8] text-white font-semibold text-sm transition-colors disabled:opacity-50"
            onClick={handleSearch}
            disabled={searching || searchQuery.trim().length < 2}
          >
            {searching ? "..." : "Search"}
          </button>
        </div>
        {searchError && (
          <p className="text-xs text-red-600">{searchError}</p>
        )}

        {/* Search results */}
        {searchResults !== null && (
          <div className="space-y-2 mt-1">
            {searchResults.length === 0 ? (
              <p className="text-xs text-foreground-muted text-center py-4">
                No listed labs matched that search.
              </p>
            ) : (
              searchResults.map((lab) => {
                const reqStatus = requestState[lab.labId] ?? "idle";
                return (
                  <div
                    key={lab.labId}
                    className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {lab.name}
                      </p>
                      {lab.institution && (
                        <p className="text-xs text-foreground-muted truncate">
                          {lab.institution}
                        </p>
                      )}
                      <p className="text-xs text-foreground-muted">
                        PI: {lab.piName}
                        {" "}
                        <span className="text-foreground-muted opacity-60">
                          ({lab.memberCount}{" "}
                          {lab.memberCount === 1 ? "member" : "members"})
                        </span>
                      </p>
                    </div>
                    <div className="flex-none">
                      {reqStatus === "sent" ? (
                        <p className="text-xs text-green-600 font-semibold whitespace-nowrap">
                          Request sent
                        </p>
                      ) : reqStatus === "error" ? (
                        <button
                          type="button"
                          className="text-xs text-red-600 underline whitespace-nowrap"
                          onClick={() => handleRequestJoin(lab.labId)}
                        >
                          Retry
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg bg-[#1283c9] hover:bg-[#0f6fa8] text-white font-semibold text-xs transition-colors disabled:opacity-50 whitespace-nowrap"
                          onClick={() => handleRequestJoin(lab.labId)}
                          disabled={reqStatus === "pending"}
                        >
                          {reqStatus === "pending" ? "Sending..." : "Request to join"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Sent confirmation note */}
        {Object.values(requestState).some((s) => s === "sent") && (
          <p className="text-xs text-foreground-muted text-center pt-2">
            Your request has been sent. The PI will approve it and share an
            invite link with you directly.
          </p>
        )}
      </div>

      <button
        type="button"
        className="mt-8 text-sm text-foreground-muted hover:text-foreground underline hover:no-underline transition-colors"
        onClick={onBack}
      >
        Back
      </button>
    </div>
  );
}

// ---- Main component ----
export function AccountTierChooser({ onLocal, onChoose, onOrgAdmin }: AccountTierChooserProps) {
  const router = useRouter();
  const [step, setStep] = useState<ChooserStep>({ view: "tiles" });
  const [compareOpen, setCompareOpen] = useState(false);

  // Flag gating: evaluate once at render time (these are env-var reads, stable)
  const showFree = isOAuthPublishAvailable();
  const showLab = LAB_TIER_ENABLED;
  // Require-account pivot: when the flag is on, the no-account local-only entry is
  // retired so every new entry goes through sign-in. The local path is kept ONLY
  // as a defensive fallback when no account tier is actually available (so the
  // flag can never strand a visitor with no way forward). See no-soft-locks.
  const showLocal = isLocalPathVisible({
    requireAccount: isRequireAccountEnabled(),
    hasAccountTier: showFree || showLab,
  });
  const tileCount = (showLocal ? 1 : 0) + (showFree ? 1 : 0) + (showLab ? 1 : 0);
  const gridCols =
    tileCount >= 3
      ? "sm:grid-cols-3"
      : tileCount === 2
        ? "sm:grid-cols-2 max-w-xl"
        : "sm:grid-cols-1 max-w-xs";
  // The bottom-zone org-admin entry is purely additive: it appears only when the
  // onboarding wizard flag is on (so the chooser's flag-off behavior is byte for
  // byte unchanged), the host wired onOrgAdmin, and at least one org tier flag is
  // on. Each org option is gated on its own tier flag.
  const showOrgEntry =
    ONBOARDING_WIZARD_ENABLED &&
    Boolean(onOrgAdmin) &&
    (DEPT_TIER_ENABLED || INSTITUTION_TIER_ENABLED);

  // Resolve the local callback: prefer the explicit onLocal; fall back to the
  // legacy onChoose("local") if a caller hasn't migrated yet.
  function handleLocal() {
    if (onLocal) {
      onLocal();
    } else if (onChoose) {
      onChoose("local");
    }
  }

  // -- Free flow: provider sub-step -> navigate --
  // OAuth-first (flag ON): the provider opens IMMEDIATELY, the folder step
  // follows the return (startOAuthFirstSignIn). Legacy (flag OFF): the old
  // deferred path, router.push to the connect gate, then lib/providers fires the
  // redirect only after a folder + user are connected. The OFF branch is
  // byte-for-byte the previous behavior.
  function handleFreeProvider(provider: SharingProvider) {
    // Sign in immediately, carrying the onbWizard marker so the return resumes
    // the Free track wizard at the handle step (no FolderConnectGate bounce).
    startOAuthFirstSignIn(
      provider,
      ONBOARDING_WIZARD_ENABLED ? { onboardingWizard: "free" } : {},
    );
  }

  // -- Lab Create flow: provider sub-step -> set marker -> navigate --
  function handleLabCreateProvider(provider: SharingProvider) {
    // Keep the lab-create marker (LabCreateResume provisions the lab on return)
    // and add the onbWizard marker so the return resumes the PI/lab wizard at the
    // handle step instead of FolderConnectGate.
    startOAuthFirstSignIn(
      provider,
      ONBOARDING_WIZARD_ENABLED
        ? { labCreate: true, onboardingWizard: "lab" }
        : { labCreate: true },
    );
  }

  // ---- Step: tiles ----
  if (step.view === "tiles") {
    return (
      <div className="light-scope relative isolate flex flex-col items-center w-full px-6 py-10 min-h-screen bg-white text-foreground"><StepBg />
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
          className={["grid gap-4 w-full max-w-3xl mt-8", gridCols].join(" ")}
        >
          {/* Local-only tile, hidden when the require-account flag retires the
              no-account path (kept as a defensive fallback, see showLocal). */}
          {showLocal && (
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
                type="button"
                className="w-full py-2 px-4 rounded-xl bg-[#1283c9] hover:bg-[#0f6fa8] text-white font-semibold text-sm transition-colors"
                onClick={handleLocal}
              >
                Start local
              </button>
            </div>
          </div>
          )}

          {/* Free account tile — shown when SHARING_ENABLED */}
          {showFree && (
            <div className="flex flex-col text-left border border-border rounded-2xl p-5 bg-surface-raised cursor-pointer transition-transform hover:-translate-y-0.5 hover:border-[#1283c9] hover:shadow-lg min-h-[230px]">
              <BeakerBotScene name="computer" className="w-20 h-20 mb-2 flex-none" />
              <span className="inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full mb-1.5 bg-green-100 text-green-700 self-start">
                Free
              </span>
              <h3 className="font-extrabold text-lg text-foreground mb-1">Free account</h3>
              <p className="text-xs text-foreground-muted mt-1">
                Local like above, plus a sign-in so you can receive work shared
                by researchers outside your folder and be findable in the
                directory.
              </p>
              <ul className="mt-3 pl-4 text-xs text-foreground-muted space-y-1 list-disc">
                <li>Data still on your disk</li>
                <li>Findable in the directory</li>
                <li>Receive shares, plus 1.6M AI tokens to start</li>
              </ul>
              <div className="mt-auto pt-4">
                <button
                  type="button"
                  className="w-full py-2 px-4 rounded-xl bg-[#1283c9] hover:bg-[#0f6fa8] text-white font-semibold text-sm transition-colors"
                  onClick={() => setStep({ view: "free-provider" })}
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
                  type="button"
                  className="w-full py-2 px-4 rounded-xl bg-[#1283c9] hover:bg-[#0f6fa8] text-white font-semibold text-sm transition-colors"
                  onClick={() => setStep({ view: "lab-choice" })}
                >
                  Create or join a lab
                </button>
              </div>
            </div>
          )}
        </div>

        {/* solo escape hatch, hidden when the require-account flag retires the
            no-account path (showLocal). */}
        {showLocal && (
          <p className="mt-5 text-sm text-foreground-muted text-center">
            Not sure?{" "}
            <button
              type="button"
              className="text-brand-action font-semibold underline hover:no-underline"
              onClick={handleLocal}
            >
              Start local for now
            </button>
            , you can upgrade to an account or a lab any time.
          </p>
        )}

        {/* BOTTOM ZONE: org-admin entry, visually separated below a thin divider
            (Q1 default: a distinct entry, not a full equal-weight card). Purely
            additive, shown only behind the wizard flag + an org tier flag. */}
        {showOrgEntry && (
          <div className="w-full max-w-3xl mt-8" data-testid="chooser-org-zone">
            <div className="flex items-center gap-4">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs font-semibold uppercase tracking-widest text-foreground-muted">
                Setting up for a department or institution?
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="mt-4 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
              {DEPT_TIER_ENABLED && (
                <button
                  type="button"
                  data-testid="chooser-org-dept"
                  onClick={() => onOrgAdmin?.("department")}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-[#1283c9] hover:bg-surface-sunken"
                >
                  Set up a department account
                </button>
              )}
              {INSTITUTION_TIER_ENABLED && (
                <button
                  type="button"
                  data-testid="chooser-org-institution"
                  onClick={() => onOrgAdmin?.("institution")}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-[#1283c9] hover:bg-surface-sunken"
                >
                  Set up an institution account
                </button>
              )}
            </div>
            <p className="mt-3 text-center text-xs text-foreground-muted">
              For administrators setting up infrastructure for researchers. No
              research workspace, no data folder.
            </p>
          </div>
        )}

        {/* compare the tiers expandable */}
        <div className="w-full max-w-4xl mt-8">
          <button
            type="button"
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
            <CompareTiers showLocal={showLocal} showFree={showFree} showLab={showLab} />
          )}
        </div>
      </div>
    );
  }

  // ---- Step: Free provider picker ----
  if (step.view === "free-provider") {
    return (
      <ProviderSubStep
        heading="Create your free account"
        subheading="Pick a sign-in provider. Your data stays on your disk, the account is free and used for receiving shares and the researcher directory, and you get a one-time gift of about 1.6 million AI tokens."
        onProvider={handleFreeProvider}
        onBack={() => setStep({ view: "tiles" })}
      />
    );
  }

  // ---- Step: Lab create or join ----
  if (step.view === "lab-choice") {
    return (
      <LabChoiceSubStep
        onCreate={() => setStep({ view: "lab-create-provider" })}
        onJoin={() => setStep({ view: "lab-join" })}
        onBack={() => setStep({ view: "tiles" })}
      />
    );
  }

  // ---- Step: Lab create provider picker ----
  if (step.view === "lab-create-provider") {
    return (
      <ProviderSubStep
        heading="Create a lab"
        subheading="Sign in with a provider to anchor your lab identity. Your data stays on your disk; the sign-in only binds the lab to your OAuth email."
        onProvider={handleLabCreateProvider}
        onBack={() => setStep({ view: "lab-choice" })}
      />
    );
  }

  // ---- Step: Lab join via invite link ----
  if (step.view === "lab-join") {
    return (
      <LabJoinSubStep onBack={() => setStep({ view: "lab-choice" })} />
    );
  }

  // Exhaustive: should never reach here
  return null;
}

export default AccountTierChooser;
