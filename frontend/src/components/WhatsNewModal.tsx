"use client";

import { useState } from "react";
import BeakerBot from "./BeakerBot";
import BeakerBotMouseWaveScene from "./BeakerBotMouseWaveScene";
import LivingPopup from "@/components/ui/LivingPopup";
import { GoogleIcon, GitHubIcon, LinkedInIcon, MicrosoftIcon, OrcidIcon } from "@/components/sharing/icons";
import { isMicrosoftAuthEnabled } from "@/lib/sharing/oauth-availability";
import { FREE_STORAGE_BYTES, TTL_DAYS } from "@/lib/sharing/relay/limits";
import { APP_CHANNEL } from "@/lib/version";
import type { ReleaseNote } from "@/lib/release-notes";

/**
 * <WhatsNewModal /> (whats-new bot)
 *
 * The developer-announcement / "What's New" popup. BeakerBot waves from
 * the top, the latest release's "ResearchOS vX.Y.Z" heading + highlight
 * bullets fill the body, and a single "Got it" button dismisses.
 *
 * Two display shapes, driven by `releases`:
 *   - CATCH-UP (from the manager): `releases` is the missed list,
 *     newest-first, defaulting open on the LATEST release. When more than
 *     one release was missed, a "View all N updates" expander reveals the
 *     rest inline, newest first.
 *   - FULL HISTORY (from Settings "What's new"): `releases` is the entire
 *     eligible log; the expander is pre-expanded so the user sees every
 *     release at once.
 *
 * Purely presentational: it does not read or write the seen-version.
 * Dismiss is the caller's concern (the manager records last-seen; the
 * Settings re-open just closes). House style: no em-dashes, no emojis,
 * BeakerBot is the only mascot, and the icon-only close affordance carries
 * an aria-label.
 */

interface Props {
  /** Controlled open state. Parents always render the modal (so the exit
   *  animation can play) and toggle this. */
  open: boolean;
  /** Releases to display, NEWEST FIRST. The first entry is the headline. */
  releases: ReadonlyArray<ReleaseNote>;
  /** Called when the user dismisses (Got it / close / Escape / backdrop). */
  onDismiss: () => void;
  /** Start real sharing-account creation for the picked OAuth provider (the
   *  v0.5 accounts popup only). The manager records the announcement as seen,
   *  then kicks off the OAuth claim flow. ORCID rides the same path as the
   *  other providers. When absent, the sign-in cards render but the provider
   *  buttons are inert (the manager always wires this). */
  onStartAccount?: (
    provider: "orcid" | "google" | "microsoft-entra-id" | "github" | "linkedin",
  ) => void;
  /** Start the email-verification path (the v0.5 accounts popup only). Unlike
   *  the OAuth providers this does not redirect: the manager records the
   *  announcement as seen, then opens the SharingSetupWizard straight on its
   *  email step. When absent, the email link renders inert. */
  onStartEmail?: () => void;
  /** When true, every release is shown expanded from the start (the
   *  Settings "full history" view). Default false (catch-up view, which
   *  starts collapsed to the headline release with an expander). */
  showAllExpanded?: boolean;
  /** Fire the corner BeakerBot wave scene once when the modal opens.
   *  Default true; the Settings on-demand re-open passes false so a
   *  deliberate "show me the history" click does not also trigger the
   *  flourish. */
  waveOnOpen?: boolean;
}

/** Format a release's display heading, e.g. "ResearchOS v0.1.0 beta". */
function releaseHeading(version: string): string {
  return APP_CHANNEL
    ? `ResearchOS v${version} ${APP_CHANNEL}`
    : `ResearchOS v${version}`;
}

function formatDate(iso: string): string {
  // Display-only; parse defensively so a malformed date never throws in
  // render. Falls back to the raw string.
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** A flat highlights list (the default body shape). */
function HighlightList({ highlights }: { highlights: string[] }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {highlights.map((h, i) => (
        <li key={i} className="flex gap-2 text-body text-foreground leading-snug">
          <span
            aria-hidden="true"
            className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-sky-400"
          />
          <span>{h}</span>
        </li>
      ))}
    </ul>
  );
}

/** A structured from-the-author note: prose paragraphs + bold feature lead-ins
 *  with optional sub-bullets. Rendered in place of the flat highlights when a
 *  release carries a `message`. */
function ReleaseMessage({
  message,
}: {
  message: NonNullable<ReleaseNote["message"]>;
}) {
  return (
    <div className="mt-2 space-y-3">
      {message.map((block, i) =>
        block.kind === "para" ? (
          <p key={i} className="text-body text-foreground leading-relaxed">
            {block.text}
          </p>
        ) : (
          <div key={i} className="text-body text-foreground leading-relaxed">
            <span className="font-semibold text-foreground">{block.title}</span>{" "}
            {block.text}
            {block.items && block.items.length > 0 && (
              <ul className="mt-1.5 space-y-1.5">
                {block.items.map((it, j) => (
                  <li key={j} className="flex gap-2 leading-snug">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-sky-400"
                    />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ),
      )}
    </div>
  );
}

function ReleaseBlock({ release }: { release: ReleaseNote }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-title font-semibold text-foreground">
          {releaseHeading(release.version)}
        </h3>
        <span className="text-meta text-foreground-muted whitespace-nowrap">
          {formatDate(release.date)}
        </span>
      </div>
      {release.message && release.message.length > 0 ? (
        <ReleaseMessage message={release.message} />
      ) : (
        <HighlightList highlights={release.highlights} />
      )}
    </div>
  );
}

/** Sky-blue check glyph for the choice-card bullets (copied from the welcome
 *  page so the popup cards read identically). */
function ChoiceCheck() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 flex-none text-brand-action"
      aria-hidden
    >
      <path d="M4 10.5l3.5 3.5L16 5.5" />
    </svg>
  );
}

/** The full two-path account chooser, the SAME "Free / Also free" cards as the
 *  welcome page, shown in the v0.5 accounts popup so an existing user makes the
 *  same informed choice. The local card dismisses (keep your folder, nothing
 *  changes); the sign-in buttons hand off to `onStartAccount`, which records
 *  the announcement as seen and then runs the OAuth claim flow so the user
 *  returns into the global resume mount and a real sharing identity gets
 *  created. The inbox numbers come from the relay limits so they never drift
 *  from what the server enforces. */
function SignInChoiceCards({
  onKeepLocal,
  onStartAccount,
  onStartEmail,
}: {
  onKeepLocal: () => void;
  onStartAccount?: (
    provider: "orcid" | "google" | "microsoft-entra-id" | "github" | "linkedin",
  ) => void;
  onStartEmail?: () => void;
}) {
  const inboxGb = Math.round(FREE_STORAGE_BYTES / 1024 ** 3);
  const oauthBtn =
    "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-meta font-semibold transition-transform hover:scale-[1.03]";
  return (
    <div className="grid w-full gap-4 text-left md:grid-cols-2">
      {/* Path A: keep using locally. Nothing changes for the existing user. */}
      <div className="flex flex-col rounded-2xl border border-[#d3deec] bg-surface-raised p-5 shadow-[0_2px_12px_rgba(15,40,80,0.06)]">
        <div className="font-mono text-meta font-semibold uppercase tracking-[0.1em] text-brand-action">
          // free
        </div>
        <h3 className="mt-1.5 text-heading font-extrabold tracking-tight text-brand-ink">
          Use it locally
        </h3>
        <ul className="mt-4 flex-1 space-y-2.5">
          <li className="flex items-start gap-2 text-body font-semibold leading-snug text-brand-ink">
            <ChoiceCheck /> 100% of the features, free. Solo users get the whole app, nothing held back.
          </li>
          <li className="flex items-start gap-2 text-body leading-snug text-[#475569]">
            <ChoiceCheck /> Works offline, private, on your own machine.
          </li>
          <li className="flex items-start gap-2 text-body leading-snug text-[#475569]">
            <ChoiceCheck /> Free, and yours to keep forever.
          </li>
        </ul>
        <button
          type="button"
          onClick={onKeepLocal}
          data-testid="whats-new-keep-local"
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-ink px-5 py-3 text-body font-bold text-white shadow-[0_10px_26px_rgba(15,40,80,0.20)] transition-transform hover:scale-[1.01]"
        >
          Keep using locally
        </button>
        <p className="mt-2 text-center text-meta text-[#8593a8]">
          Nothing changes. Your folder stays yours.
        </p>
      </div>

      {/* Path B: sign in to add sharing. Existing user, so signIn directly. */}
      <div className="flex flex-col rounded-2xl border border-[#cfe0f2] bg-[#f5faff] p-5 shadow-[0_2px_12px_rgba(15,40,80,0.06)]">
        <div className="font-mono text-meta font-semibold uppercase tracking-[0.1em] text-brand-action">
          // also free
        </div>
        <h3 className="mt-1.5 text-heading font-extrabold tracking-tight text-brand-ink">
          Sign in to share
        </h3>
        <ul className="mt-4 flex-1 space-y-2.5">
          <li className="flex items-start gap-2 text-body font-semibold leading-snug text-brand-ink">
            <ChoiceCheck /> + Use it locally. Your notebook still lives on your machine.
          </li>
          <li className="flex items-start gap-2 text-body leading-snug text-[#475569]">
            <ChoiceCheck /> Send notes, methods, and projects to anyone by email.
          </li>
          <li className="flex items-start gap-2 text-body leading-snug text-[#475569]">
            <ChoiceCheck /> A {inboxGb} GB encrypted inbox for work others send you, held {TTL_DAYS} days.
          </li>
          <li className="flex items-start gap-2 text-body leading-snug text-[#475569]">
            <ChoiceCheck /> Cross-lab sharing, no shared folder needed.
          </li>
          <li className="flex items-start gap-2 text-body leading-snug text-[#475569]">
            <ChoiceCheck /> Find other ResearchOS users to share with.
          </li>
          <li className="flex items-start gap-2 text-body leading-snug text-[#475569]">
            <ChoiceCheck /> Real-time co-editing on shared notes.
          </li>
        </ul>
        {/* Four identity providers, equal weight, in a 2x2 grid. ORCID sits
            top-left for soft priority as the academic identity, on a WHITE
            button so its green iD circle reads as the full official badge (a
            green button hides the circle against itself). Matches the
            welcome-page account card. */}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onStartAccount?.("orcid")}
            data-testid="whats-new-signin-orcid"
            className={`${oauthBtn} border-[#d7dde5] bg-surface-raised text-foreground`}
          >
            <OrcidIcon className="h-4 w-4 shrink-0" />
            ORCID
          </button>
          <button
            type="button"
            onClick={() => onStartAccount?.("google")}
            data-testid="whats-new-signin-google"
            className={`${oauthBtn} border-[#d7dde5] bg-surface-raised text-foreground`}
          >
            <GoogleIcon className="h-4 w-4 shrink-0" />
            Google
          </button>
          {isMicrosoftAuthEnabled() && (
            <button
              type="button"
              onClick={() => onStartAccount?.("microsoft-entra-id")}
              data-testid="whats-new-signin-microsoft"
              className={`${oauthBtn} border-[#d7dde5] bg-surface-raised text-foreground`}
            >
              <MicrosoftIcon className="h-4 w-4 shrink-0" />
              Microsoft
            </button>
          )}
          <button
            type="button"
            onClick={() => onStartAccount?.("github")}
            data-testid="whats-new-signin-github"
            className={`${oauthBtn} border-[#181717] bg-[#181717] text-white`}
          >
            <GitHubIcon className="h-4 w-4 shrink-0" />
            GitHub
          </button>
          <button
            type="button"
            onClick={() => onStartAccount?.("linkedin")}
            data-testid="whats-new-signin-linkedin"
            className={`${oauthBtn} border-[#0A66C2] bg-[#0A66C2] text-white hover:bg-[#004182]`}
          >
            <LinkedInIcon className="h-4 w-4 shrink-0" />
            LinkedIn
          </button>
        </div>
        <button
          type="button"
          onClick={() => onStartEmail?.()}
          data-testid="whats-new-signin-email"
          className="mt-3 w-full text-center text-meta font-medium text-brand-action transition-colors hover:underline"
        >
          or verify with email instead
        </button>
        <p className="mt-2 text-meta leading-snug text-[#8593a8]">
          Sign-in only verifies your email. Your notebook still lives on your
          machine.
        </p>
      </div>
    </div>
  );
}

export default function WhatsNewModal({
  open,
  releases,
  onDismiss,
  onStartAccount,
  onStartEmail,
  showAllExpanded = false,
  waveOnOpen = true,
}: Props) {
  const [expanded, setExpanded] = useState(showAllExpanded);
  const [waveActive, setWaveActive] = useState(waveOnOpen);

  // With no releases there is nothing to show; keep the modal closed but
  // still let LivingPopup mount (so a transition out can finish) by passing
  // an empty body. The wave scene is suppressed too.
  const isOpen = open && releases.length > 0;

  // Snapshot the last non-empty release list so the body stays rendered
  // through LivingPopup's close animation after the parent clears releases.
  // Synced during render (the supported pattern, mirrors ExportFormatDialog's
  // prevIsOpen sync) so no ref is read during render.
  const [shownReleases, setShownReleases] =
    useState<ReadonlyArray<ReleaseNote>>(releases);
  if (releases.length > 0 && releases !== shownReleases) {
    setShownReleases(releases);
  }

  const [headline, ...rest] = shownReleases;
  const extra = rest.length;
  // Releases are newest-first, so the headline drives whether the footer
  // offers the explicit sign-in fork.
  const offerSignInChoice = headline?.signInChoice === true;
  // In the catch-up view the older missed releases hide behind the
  // expander; in the full-history view they are always shown.
  const showRest = showAllExpanded || expanded;

  return (
    <>
      {/* Corner wave flourish. Fire-and-forget overlay (portals to body),
          mirroring how CelebrationManager mounts the same scene. Only fires
          while the popup is actually open. */}
      {isOpen && waveActive && (
        <BeakerBotMouseWaveScene
          active
          onComplete={() => setWaveActive(false)}
        />
      )}

      <LivingPopup
        open={isOpen}
        onClose={onDismiss}
        label="What's new"
        widthClassName={offerSignInChoice ? "max-w-2xl" : "max-w-md"}
        card={false}
      >
        <div
          aria-labelledby="whats-new-title"
          data-testid="whats-new-modal"
          // This popup brings its own white card chrome (card=false above).
          className="relative w-full rounded-2xl bg-surface-raised border border-border ros-popup-card-shadow overflow-hidden"
        >
          {/* Brand rainbow hairline across the top edge (the same signature as
              the footer + welcome ribbon), so the launch popup reads on-brand at
              a glance. Sits above the header wash; overflow-hidden clips it to
              the rounded top corners. */}
          <div
            aria-hidden
            className="brand-rainbow-bg absolute inset-x-0 top-0 z-10 h-1"
          />
          {/* Header: BeakerBot waving over a soft sky wash. */}
          <div className="relative flex flex-col items-center bg-gradient-to-b from-sky-50 to-white pt-6 pb-4 px-6">
            <BeakerBot
              pose="waving"
              alive
              className="w-20 h-20 text-brand-sky"
              ariaLabel="BeakerBot waving"
            />
            <p
              id="whats-new-title"
              className="mt-2 text-heading font-bold text-foreground"
            >
              What&apos;s new
            </p>
            <p className="text-meta text-foreground-muted">
              Here is what changed since you were last in.
            </p>
          </div>

          {/* Body: the headline release, then (optionally) the rest. On the
              accounts release the two-path chooser cards live here too, under
              the message, so the whole thing scrolls as one block. */}
          <div
            className={`px-6 space-y-5 overflow-y-auto ${
              offerSignInChoice ? "pb-6 max-h-[72vh]" : "pb-2 max-h-[50vh]"
            }`}
          >
            {headline && <ReleaseBlock release={headline} />}

            {extra > 0 && !showAllExpanded && !expanded && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                data-testid="whats-new-view-all"
                className="text-body font-medium text-sky-600 hover:text-sky-700 hover:underline"
              >
                View all {shownReleases.length} updates
              </button>
            )}

            {extra > 0 &&
              showRest &&
              rest.map((r) => (
                <div
                  key={r.version}
                  className="border-t border-border pt-4"
                >
                  <ReleaseBlock release={r} />
                </div>
              ))}

            {offerSignInChoice && (
              <SignInChoiceCards
                onKeepLocal={onDismiss}
                onStartAccount={onStartAccount}
                onStartEmail={onStartEmail}
              />
            )}
          </div>

          {/* Footer: a single dismiss button on a normal release. The accounts
              release puts its actions inside the chooser cards instead. */}
          {!offerSignInChoice && (
            <div className="px-6 py-4">
              <button
                type="button"
                onClick={onDismiss}
                data-testid="whats-new-got-it"
                className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 w-full py-2.5 px-4 text-body font-medium rounded-lg"
              >
                Got it
              </button>
            </div>
          )}
        </div>
      </LivingPopup>
    </>
  );
}
