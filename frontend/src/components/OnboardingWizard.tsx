"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import BeakerBot from "./BeakerBot";
import TelegramPairingModal from "./TelegramPairingModal";
import { NAV_ITEMS, HOME_HREF } from "@/lib/nav";
import {
  USE_CASES,
  seedVisibleTabsForStep3,
} from "@/lib/onboarding/use-case-tab-mapping";
import { createFeed } from "@/lib/calendar/external-feeds-store";

/**
 * The Onboarding v2 7-step wizard component.
 *
 * Phase 1 landed the structural shell. Phase 2a (this chip) lands the
 * step 1-3 content, a focus trap on the modal, and a `?wizard-preview=1`
 * URL-param hook the orchestrator consumes so testing agents can force-
 * mount the wizard without a fresh data folder. Steps 4-7 remain
 * placeholders for Phase 2b/2c.
 *
 * The component itself does NOT persist to `_onboarding.json` or
 * `settings.json`; the orchestrator passes `onComplete` and `onSkip`
 * callbacks and owns the writes. Phase 2a expands `onComplete` to carry
 * `{ useCases, visibleTabs, otherUseCase }` so the wizard's step-3
 * tab toggles are authoritative over the static tab mapping.
 *
 * Step labels (used verbatim for the step title):
 *   1. Welcome to ResearchOS
 *   2. What brings you here?
 *   3. Tabs we'll show
 *   4. Connect Telegram?
 *   5. Add a calendar?
 *   6. AI Helper prompt?
 *   7. You're all set
 *
 * Visual register mirrors the v1 OnboardingWelcomeModal:
 *   - bg-black/30 backdrop-blur-sm overlay, z-[300]
 *   - white rounded-2xl shadow-2xl card with border-gray-200
 *   - p-7 padding, sky-500 primary buttons, gray-300 outlined
 *     secondary buttons
 *   - Card width pinned at 520px (within the 500-540 band specified
 *     in the Phase 1 brief)
 *
 * ARIA: role="dialog" + aria-modal="true" + aria-labelledby pointing
 * at the step title. Escape key triggers Skip (same handler as the
 * Skip link, by brief). Focus trap (Phase 2a, master flag #1 from CDP
 * testing): Tab/Shift+Tab cycles inside the modal; focus restores to
 * the previously-focused element on unmount.
 */

const TOTAL_STEPS = 7;

const STEP_TITLES: Record<number, string> = {
  1: "Welcome to ResearchOS",
  2: "What brings you here?",
  3: "Tabs we'll show",
  4: "Connect Telegram?",
  5: "Add a calendar?",
  6: "AI Helper prompt?",
  7: "You're all set",
};

/** Internal step-name slugs used in the placeholder copy so a future
 *  reader can spot which Phase-2 surface owns each step. Steps 1-3 are
 *  now filled in (Phase 2a); 4-7 still render the placeholder body. */
const STEP_SLUGS: Record<number, string> = {
  1: "welcome",
  2: "use-case picker",
  3: "tab config",
  4: "telegram",
  5: "calendar",
  6: "ai-helper",
  7: "all-set",
};

/** Container shape for per-step state collected as the user clicks
 *  through. Phase 2a adds `visibleTabs` (step-3 tab-config override)
 *  and `otherUseCase` (step-2 free-form text). Phase 2b/2c add the
 *  remaining step inputs (telegram-connected flag, calendar-source
 *  pick, ai-helper prompt seed). The orchestrator receives all three
 *  Phase-2a fields via the expanded onComplete signature. */
interface WizardData {
  useCases: string[];
  /** Step-3 tab-config result. Seeded from
   *  `seedVisibleTabsForStep3(useCases, isMultiUserFolder)` on the
   *  step-2 → step-3 transition; mutated by the per-row checkboxes
   *  on step 3. The orchestrator writes this verbatim to
   *  `settings.json.visibleTabs` (the wizard's toggles are
   *  authoritative over the static tab mapping). */
  visibleTabs: string[];
  /** Free-form string the user types into the step-2 "Other"
   *  affordance. The orchestrator persists this to
   *  `_onboarding.json.other_use_case` (additive v3 sidecar field).
   *  NOT added to `useCases` — it's purely captured for analytics /
   *  future personalization. */
  otherUseCase: string;
  /** Phase 2b: step-4 outcome. `"paired"` when the inline pair flow
   *  finished. `"later"` when the user clicked "Maybe later".
   *  `"skipped"` when the step auto-skipped (computational-only). */
  telegramDecision?: "paired" | "later" | "skipped";
  /** Phase 2b: step-5 outcome. `"added"` after a successful
   *  createFeed call, `"later"` on the Maybe-later button. */
  calendarDecision?: "added" | "later";
  /** Phase 2b: step-6 outcome. `"copied"` after navigator.clipboard
   *  succeeds (or the fallback textarea is surfaced), `"later"` on
   *  the Maybe-later button. */
  aiHelperDecision?: "copied" | "later";
}

interface OnboardingWizardProps {
  /** Resolved username — passed through for any debug surface that
   *  may want to display it. The wizard component itself does NOT
   *  call patchOnboarding / patchUserSettings; the orchestrator owns
   *  those writes via the onComplete / onSkip callbacks. */
  username: string;
  /** Whether the data folder contains more than one non-system user
   *  directory. The wizard reads this on the step-2 → step-3
   *  transition to seed `wizardData.visibleTabs` via
   *  `seedVisibleTabsForStep3()`, which forces `/links` on regardless
   *  of static mapping. NOT computed inside the wizard — the
   *  orchestrator probes `discoverUsers()` once on mount and passes
   *  the result down. */
  isMultiUserFolder: boolean;
  /** Called on step-7 Continue ("Done"). The orchestrator should
   *  persist `use_cases`, `wizard_completed_at`, `visibleTabs`
   *  (the wizard's step-3 toggles are authoritative), `other_use_case`,
   *  and seed `mode: "suggestions"` if null. */
  onComplete: (result: {
    useCases: string[];
    visibleTabs: string[];
    otherUseCase?: string;
  }) => void;
  /** Called by the Skip link on any step AND by the Escape key
   *  (same handler, by brief). The orchestrator should persist
   *  `wizard_skipped_at` only (leave `use_cases` null per master's
   *  null-vs-empty-array distinction) and seed `mode: "suggestions"`
   *  if null. */
  onSkip: () => void;
  /** Dev/testing preview-mode flag. When true, the wizard renders a
   *  small amber "Preview mode — no data written" banner above the
   *  step header. The orchestrator interprets the flag — the wizard
   *  itself doesn't change behavior beyond the banner; persistence
   *  is the orchestrator's contract. Set by the orchestrator's
   *  `?wizard-preview=1` URL-param hook (master flag #2 from CDP
   *  testing). */
  previewMode?: boolean;
  /** Phase 2b: fires whenever `wizardData.useCases` mutates. The
   *  orchestrator can subscribe to log analytics or pre-fetch
   *  downstream resources. Ships with a no-op consumer in Phase 2b,
   *  Phase 2c may use it. The wizard fires this EXACTLY ONCE per
   *  mutation (in the step-2 chip-toggle handler), not on every
   *  render. */
  onUseCasesChange?: (useCases: string[]) => void;
}

/** Custom hook: trap Tab/Shift+Tab cycling inside `containerRef`
 *  while `active` is true, focus the first focusable element on
 *  activation, and restore focus to the previously-focused element
 *  on deactivation. Phase 2a (master flag #1 from CDP testing — Tab
 *  past Continue was exiting the modal).
 *
 *  Implementation notes:
 *   - We re-query focusable elements on each Tab keydown rather
 *     than caching them on mount. The wizard's step body changes
 *     (chips on step 2, checkboxes on step 3) so a cached list
 *     would go stale. Performance cost is negligible — the wizard
 *     has ~15-25 focusable elements at any given step.
 *   - The "first focusable" target on mount is the first focusable
 *     INSIDE the container; the brief asked for this rather than
 *     focusing the container itself, so screen readers announce
 *     the first interactive element rather than a generic dialog. */
function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const getFocusable = (): HTMLElement[] => {
      const nodes = container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      return Array.from(nodes).filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      );
    };

    // Initial focus: first focusable inside the dialog. Defer one tick
    // so the body has rendered (the first mount frame may not have
    // the step body painted yet).
    const initial = window.setTimeout(() => {
      const first = getFocusable()[0];
      if (first) first.focus();
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = getFocusable();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
        return;
      }
      if (activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(initial);
      container.removeEventListener("keydown", onKey);
      // Restore focus to where the user came from.
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        try {
          previouslyFocused.focus();
        } catch {
          // ignore — some elements (e.g. unmounted refs) refuse focus
        }
      }
    };
  }, [active, containerRef]);
}

export default function OnboardingWizard({
  username,
  isMultiUserFolder,
  onComplete,
  onSkip,
  previewMode = false,
  onUseCasesChange,
}: OnboardingWizardProps) {
  const [mounted, setMounted] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [wizardData, setWizardData] = useState<WizardData>({
    useCases: [],
    visibleTabs: [],
    otherUseCase: "",
  });
  // Step-2 "Other" toggle. Independent of `otherUseCase` (the text
  // field) so the user can toggle off without losing what she typed.
  const [otherToggle, setOtherToggle] = useState(false);

  // useId() gives a stable aria-labelledby target so multiple wizard
  // mounts in dev hot-reload don't collide on a hard-coded id.
  const titleId = useId();

  // Container ref for the focus-trap hook. The hook queries focusables
  // inside this element on every Tab keydown.
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal target is client-only; flip mounted after the first client render.
    setMounted(true);
  }, []);

  // Activate the focus trap once the modal is rendered (mounted) and
  // until it unmounts. Trapping is gated on `mounted` rather than the
  // active step because all step bodies share the same dialog frame.
  useFocusTrap(mounted, cardRef);

  const handleBack = useCallback(() => {
    setCurrentStep((s) => Math.max(1, s - 1));
  }, []);

  const handleContinue = useCallback(() => {
    if (currentStep < TOTAL_STEPS) {
      // Step 2 → Step 3 transition: seed visibleTabs from the picks +
      // the multi-user-folder flag. This is the only place the seed
      // happens — once on entering step 3 — so the user's manual
      // toggles aren't clobbered if she Backs to step 2 and Forwards
      // again. (Master locked the seed as a one-shot per the brief.)
      if (currentStep === 2) {
        setWizardData((cur) => {
          // Only seed if step-3 hasn't been touched yet (empty array
          // is the initial state). If the user has already been to
          // step 3 and made manual toggles, preserve them.
          if (cur.visibleTabs.length === 0) {
            return {
              ...cur,
              visibleTabs: seedVisibleTabsForStep3(
                cur.useCases,
                isMultiUserFolder,
              ),
            };
          }
          return cur;
        });
      }
      setCurrentStep((s) => Math.min(TOTAL_STEPS, s + 1));
      return;
    }
    // Step 7: Continue is Done. Surface the picks + step-3 overrides +
    // step-2 free-form to the orchestrator.
    const trimmedOther = wizardData.otherUseCase.trim();
    onComplete({
      useCases: wizardData.useCases,
      visibleTabs: wizardData.visibleTabs,
      otherUseCase: trimmedOther.length > 0 ? trimmedOther : undefined,
    });
  }, [
    currentStep,
    onComplete,
    wizardData.useCases,
    wizardData.visibleTabs,
    wizardData.otherUseCase,
    isMultiUserFolder,
  ]);

  // Escape key → Skip. Mirrors the Skip link (same handler), per brief.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onSkip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, onSkip]);

  const updateWizardData = useCallback(
    (patch: Partial<WizardData>) => {
      setWizardData((cur) => ({ ...cur, ...patch }));
    },
    [],
  );

  const toggleUseCase = useCallback(
    (id: string) => {
      // Fire `onUseCasesChange` exactly once per click. We capture the
      // computed next array out of the functional setter (StrictMode
      // may invoke the updater twice in dev, but both invocations
      // produce the same value, so the final captured array is
      // correct) and call the callback once, AFTER `setWizardData`,
      // so React's batching keeps the state + callback in sync.
      let nextUseCases: string[] | null = null;
      setWizardData((cur) => {
        const set = new Set(cur.useCases);
        if (set.has(id)) set.delete(id);
        else set.add(id);
        const next = Array.from(set);
        nextUseCases = next;
        return { ...cur, useCases: next };
      });
      if (nextUseCases !== null) {
        onUseCasesChange?.(nextUseCases);
      }
    },
    [onUseCasesChange],
  );

  const toggleVisibleTab = useCallback((href: string) => {
    if (href === HOME_HREF) return; // Home is non-toggleable
    setWizardData((cur) => {
      const set = new Set(cur.visibleTabs);
      if (set.has(href)) set.delete(href);
      else set.add(href);
      // Preserve NAV_ITEMS canonical order.
      const next = NAV_ITEMS.map((i) => i.href).filter((h) => set.has(h));
      return { ...cur, visibleTabs: next };
    });
  }, []);

  const progressPct = useMemo(
    () => Math.round((currentStep / TOTAL_STEPS) * 100),
    [currentStep],
  );

  /** Programmatic step advance used by step-body click handlers (the
   *  Continue button on the auto-skip notice, the success path after
   *  createFeed, etc.). Caps at TOTAL_STEPS so an over-eager handler
   *  can't push past step 7. */
  const advanceStep = useCallback(() => {
    setCurrentStep((s) => Math.min(TOTAL_STEPS, s + 1));
  }, []);

  /** Step-4 auto-skip predicate: computational-only users get the
   *  notice card instead of the pair-bot flow. By brief, this is the
   *  ONLY combination that auto-skips: any other single pick, or any
   *  multi-pick that includes computational, lands in the normal Step
   *  4 view. (Master locked the single-use-case rule via the brief.) */
  const shouldAutoSkipTelegram =
    wizardData.useCases.length === 1 && wizardData.useCases[0] === "computational";

  if (!mounted) return null;

  const stepTitle = STEP_TITLES[currentStep] ?? "";
  const stepSlug = STEP_SLUGS[currentStep] ?? "";
  const isLastStep = currentStep === TOTAL_STEPS;
  const isFirstStep = currentStep === 1;

  const visibleTabsSet = new Set(wizardData.visibleTabs);
  const useCasesSet = new Set(wizardData.useCases);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/30 backdrop-blur-sm"
    >
      <div
        ref={cardRef}
        className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-[520px] max-w-[calc(100vw-2rem)] mx-4 overflow-hidden"
      >
        {/* Preview-mode banner: only renders when the orchestrator
            flipped previewMode on via ?wizard-preview=1. Sits above the
            step header so testing agents can confirm at a glance that
            nothing's about to be written. */}
        {previewMode && (
          <div className="px-7 pt-4">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
              Preview mode, no data written.
            </div>
          </div>
        )}

        {/* Header: step indicator + step title + progress bar. */}
        <div className="px-7 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Step {currentStep} of {TOTAL_STEPS}
            </span>
          </div>
          <h2
            id={titleId}
            className="mt-1 text-xl font-semibold text-gray-900"
          >
            {stepTitle}
          </h2>
          {/* Thin progress bar filled to currentStep / TOTAL_STEPS. */}
          <div
            className="mt-3 h-1 w-full bg-gray-100 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={TOTAL_STEPS}
            aria-valuenow={currentStep}
            aria-label={`Onboarding progress: step ${currentStep} of ${TOTAL_STEPS}`}
          >
            <div
              className="h-full bg-sky-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Body: per-step content. Steps 1-3 are Phase 2a, 4-7 still
            placeholder. */}
        <div className="px-7 py-6">
          {currentStep === 1 && <Step1Welcome />}
          {currentStep === 2 && (
            <Step2UseCasePicker
              selected={useCasesSet}
              onToggle={toggleUseCase}
              otherToggle={otherToggle}
              setOtherToggle={setOtherToggle}
              otherText={wizardData.otherUseCase}
              setOtherText={(v) => updateWizardData({ otherUseCase: v })}
            />
          )}
          {currentStep === 3 && (
            <Step3TabConfig
              visibleTabs={visibleTabsSet}
              onToggle={toggleVisibleTab}
            />
          )}
          {currentStep === 4 && (
            <Step4Telegram
              username={username}
              autoSkip={shouldAutoSkipTelegram}
              decision={wizardData.telegramDecision}
              onDecision={(d) => updateWizardData({ telegramDecision: d })}
              onAdvance={advanceStep}
            />
          )}
          {currentStep === 5 && (
            <Step5Calendar
              username={username}
              decision={wizardData.calendarDecision}
              onDecision={(d) => updateWizardData({ calendarDecision: d })}
              onAdvance={advanceStep}
            />
          )}
          {currentStep === 6 && (
            <Step6AIHelper
              decision={wizardData.aiHelperDecision}
              onDecision={(d) => updateWizardData({ aiHelperDecision: d })}
              onAdvance={advanceStep}
            />
          )}
          {currentStep === 7 && (
            <div className="min-h-[200px] flex items-center justify-center text-center text-gray-500 text-sm leading-relaxed">
              Step {currentStep}: {stepSlug}, content lands in Phase 2c.
            </div>
          )}
        </div>

        {/* Footer: Back (left), Skip link (center), Continue (right). */}
        <div className="px-7 pb-6 pt-2 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleBack}
            disabled={isFirstStep}
            className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            Back
          </button>

          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Skip setup
          </button>

          <button
            type="button"
            onClick={handleContinue}
            className="px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm"
          >
            {isLastStep ? "Done" : "Continue"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Step 1: welcome + elevator pitch. Master-locked copy (verbatim,
 *  no em-dashes per project style). Mirrors the v1 OnboardingWelcomeModal
 *  flex layout: 96px mascot on the left + right-column copy. */
function Step1Welcome() {
  return (
    <div className="flex items-start gap-5 min-h-[200px]">
      <div
        aria-hidden
        className="flex-shrink-0"
        style={{ width: 96, height: 96 }}
      >
        <BeakerBot
          pose="waving"
          direction="right"
          className="w-full h-full text-sky-500"
        />
      </div>
      <div className="flex-1 min-w-0 self-center">
        <p className="text-base text-gray-700 leading-relaxed">
          ResearchOS keeps your experiments, lab notes, methods, and
          calendar in one local-first place. We&apos;ll ask a few
          questions to set up your account.
        </p>
      </div>
    </div>
  );
}

/** Step 2: 9-chip use-case multi-select picker + "Other" affordance.
 *  Multi-select; clicking a chip toggles inclusion in `useCases`.
 *  Empty submission is allowed (the orchestrator interprets `[]` as
 *  "show all tabs"); a subtle gray hint surfaces the skip-with-no-
 *  picks affordance when nothing's selected. */
function Step2UseCasePicker({
  selected,
  onToggle,
  otherToggle,
  setOtherToggle,
  otherText,
  setOtherText,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
  otherToggle: boolean;
  setOtherToggle: (v: boolean) => void;
  otherText: string;
  setOtherText: (v: string) => void;
}) {
  const hasNoPicks = selected.size === 0 && !otherText.trim();
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Pick all that apply. We use this to suggest a starting layout.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {USE_CASES.map((uc) => {
          const isSelected = selected.has(uc.id);
          return (
            <button
              key={uc.id}
              type="button"
              onClick={() => onToggle(uc.id)}
              aria-pressed={isSelected}
              className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                isSelected
                  ? "bg-sky-50 border-sky-500 text-sky-700"
                  : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              <div className="text-sm font-medium">{uc.label}</div>
              <div
                className={`text-xs mt-0.5 ${
                  isSelected ? "text-sky-600" : "text-gray-500"
                }`}
              >
                {uc.description}
              </div>
            </button>
          );
        })}
      </div>
      {/* "Other" toggle + free-form text. Persisted separately (does
          NOT add to the `useCases` array) so the static tab mapping
          never sees this string. */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setOtherToggle(!otherToggle)}
          aria-pressed={otherToggle}
          className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
            otherToggle
              ? "bg-sky-50 border-sky-500 text-sky-700"
              : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          <div className="text-sm font-medium">Other</div>
          <div
            className={`text-xs mt-0.5 ${
              otherToggle ? "text-sky-600" : "text-gray-500"
            }`}
          >
            Tell us in your own words
          </div>
        </button>
        {otherToggle && (
          <input
            type="text"
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            placeholder="e.g. running a clinical research coordinator role"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            maxLength={200}
          />
        )}
      </div>
      {hasNoPicks && (
        <p className="text-xs text-gray-500">
          You can submit empty, we&apos;ll show all tabs by default.
        </p>
      )}
    </div>
  );
}

/** Step 3: tab-config toggles seeded from
 *  `seedVisibleTabsForStep3(useCases, isMultiUserFolder)`. Mirrors the
 *  Settings → Tabs grid pattern; Home is rendered disabled with an
 *  "always on" label. Clicking a row's checkbox patches `visibleTabs`
 *  directly (the wizard's step-3 result is authoritative over the
 *  static tab mapping). */
function Step3TabConfig({
  visibleTabs,
  onToggle,
}: {
  visibleTabs: Set<string>;
  onToggle: (href: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Based on your picks. You can change these later in Settings.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {NAV_ITEMS.map((item) => {
          const isHome = item.href === HOME_HREF;
          const checked = isHome || visibleTabs.has(item.href);
          return (
            <label
              key={item.href}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                isHome
                  ? "bg-gray-50 border-gray-200 text-gray-400"
                  : "bg-white border-gray-200 hover:bg-gray-50 cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={isHome}
                onChange={() => onToggle(item.href)}
                className="accent-sky-500"
              />
              <span className="text-sm text-gray-800">{item.label}</span>
              {isHome && (
                <span className="text-[10px] text-gray-400 ml-auto">
                  always on
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** Step 4: Telegram pairing. Two modes:
 *   1. Auto-skip, when `autoSkip === true` (computational-only). Renders
 *      a friendly amber notice card; the Continue button advances to
 *      step 5 and marks `telegramDecision = "skipped"`.
 *   2. Normal, every other use-case combo. Renders two CTAs: "Set it up
 *      now" reveals the inline TelegramPairingModal (`inline=true` so it
 *      drops the portal/backdrop chrome) and "Maybe later" advances
 *      with `telegramDecision = "later"`.
 *
 *  On successful pair: `telegramDecision = "paired"` + advance. On
 *  cancel inside the inline pair flow: re-show the two CTAs so the
 *  user can pick "Maybe later" instead. On disconnect (shouldn't
 *  happen during the wizard since fresh users haven't paired yet,
 *  but the inline modal supports it): treat as cancel. */
function Step4Telegram({
  username,
  autoSkip,
  decision: _decision,
  onDecision,
  onAdvance,
}: {
  username: string;
  autoSkip: boolean;
  decision: "paired" | "later" | "skipped" | undefined;
  onDecision: (d: "paired" | "later" | "skipped") => void;
  onAdvance: () => void;
}) {
  const [showPair, setShowPair] = useState(false);

  if (autoSkip) {
    return (
      <div className="space-y-4 min-h-[200px]">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-900">
            We&apos;re skipping Telegram setup for now
          </h3>
          <p className="mt-2 text-sm text-amber-800 leading-relaxed">
            You picked computational research, which usually doesn&apos;t
            need an image inbox via Telegram. You can always pair the
            bot later from Settings, Telegram.
          </p>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              onDecision("skipped");
              onAdvance();
            }}
            className="px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (showPair) {
    return (
      <div className="space-y-3">
        <TelegramPairingModal
          username={username}
          inline
          onClose={(updated) => {
            // Success path: a TelegramPairing object came back.
            // Cancel/disconnect paths: undefined or null. Re-show the
            // two CTAs in the cancel path so the user can still pick
            // "Maybe later".
            if (updated) {
              onDecision("paired");
              onAdvance();
            } else {
              setShowPair(false);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-[200px]">
      <div>
        <h3 className="text-base font-medium text-gray-900">
          Want to set up Telegram for image inbox?
        </h3>
        <p className="mt-1 text-sm text-gray-600 leading-relaxed">
          Text photos from your phone and they&apos;ll auto-attach to
          the active experiment, or land in your Inbox.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setShowPair(true)}
          className="w-full px-4 py-3 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm"
        >
          Set it up now
        </button>
        <button
          type="button"
          onClick={() => {
            onDecision("later");
            onAdvance();
          }}
          className="w-full px-4 py-3 text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

/** Step 5: calendar feed subscription. Two CTAs ("Add one now" / "Maybe
 *  later"); the former reveals a mini inline form that calls
 *  `createFeed()` with `{ provider: "other", label, icsUrl, color }`.
 *  On success: `calendarDecision = "added"` + 1-second auto-advance
 *  (lets the green "Subscribed!" check breathe before the step
 *  flips). On error: render a red line and keep the form open. */
function Step5Calendar({
  username,
  decision: _decision,
  onDecision,
  onAdvance,
}: {
  username: string;
  decision: "added" | "later" | undefined;
  onDecision: (d: "added" | "later") => void;
  onAdvance: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const validUrl = /^(https?|webcal):\/\//i.test(url.trim());
  const canSubmit = name.trim().length > 0 && validUrl && !submitting;

  const handleSubscribe = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await createFeed(username, {
        provider: "other",
        label: name.trim(),
        icsUrl: url.trim(),
        color: "#3b82f6",
      });
      setSuccess(true);
      onDecision("added");
      // Brief 1s pause so the user sees the green check before the
      // step flips. Avoids a jarring "click → instantly on next step"
      // feel. The wizard's footer Continue button is also live during
      // this pause if the user wants to advance manually.
      window.setTimeout(() => onAdvance(), 1000);
    } catch (err) {
      console.error("[onboarding] step-5 createFeed failed", err);
      setError("Couldn't subscribe. Check the URL and try again.");
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, name, url, username, onDecision, onAdvance]);

  if (showForm) {
    return (
      <div className="space-y-4 min-h-[200px]">
        <div>
          <h3 className="text-base font-medium text-gray-900">
            Subscribe to a calendar feed
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            Paste the ICS URL from Google, Apple, Outlook, or any public
            calendar.
          </p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Google calendar"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              disabled={submitting || success}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              ICS URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              disabled={submitting || success}
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          {success && (
            <p className="text-xs text-emerald-600 flex items-center gap-1.5">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Subscribed!
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              setShowForm(false);
              setError(null);
              setName("");
              setUrl("");
            }}
            disabled={submitting || success}
            className="text-sm text-gray-500 hover:text-gray-700 underline disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubscribe()}
            disabled={!canSubmit || success}
            className="px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Subscribing…" : success ? "Subscribed" : "Subscribe"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-[200px]">
      <div>
        <h3 className="text-base font-medium text-gray-900">
          Want to subscribe to a calendar feed?
        </h3>
        <p className="mt-1 text-sm text-gray-600 leading-relaxed">
          Bring in Google, Apple, Outlook, or any public ICS URL. They
          show up next to your experiments.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="w-full px-4 py-3 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm"
        >
          Add one now
        </button>
        <button
          type="button"
          onClick={() => {
            onDecision("later");
            onAdvance();
          }}
          className="w-full px-4 py-3 text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

/** Step 6: copy the lean AI Helper prompt to the clipboard. Two CTAs;
 *  "Copy prompt now" fetches `/ai-helper/lean.md` and writes it via
 *  `navigator.clipboard.writeText()`. On clipboard failure (rare,
 *  insecure-context, denied permission), surface a fallback textarea
 *  the user can select-all + copy manually. Sets
 *  `aiHelperDecision = "copied"` on copy success, `"later"` on
 *  Maybe-later. */
function Step6AIHelper({
  decision: _decision,
  onDecision,
  onAdvance,
}: {
  decision: "copied" | "later" | undefined;
  onDecision: (d: "copied" | "later") => void;
  onAdvance: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const handleCopy = useCallback(async () => {
    setFetching(true);
    setFetchError(null);
    try {
      // Mirror the AIHelperSection pattern: fetch lean.md directly,
      // no-store so a stale dev cache doesn't serve an older prompt.
      const res = await fetch("/ai-helper/lean.md", { cache: "no-store" });
      if (!res.ok) throw new Error(`prompt fetch failed (${res.status})`);
      const text = await res.text();
      // Try the modern clipboard API first. Falls back to a textarea
      // the user can select-all + copy from on insecure contexts
      // (HTTP, some older WebViews) where navigator.clipboard is
      // either undefined or rejects.
      let clipboardOk = false;
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          clipboardOk = true;
        } catch {
          // fall through to the textarea fallback below
        }
      }
      if (clipboardOk) {
        setCopied(true);
        onDecision("copied");
      } else {
        setFallbackText(text);
        // Treat the fallback path as "copied": the user explicitly
        // requested the prompt, and they have it on screen. Phase 2c
        // can split this into a separate decision if needed.
        onDecision("copied");
      }
    } catch (err) {
      console.error("[onboarding] step-6 AI helper fetch failed", err);
      setFetchError(
        "Couldn't fetch the prompt. You can grab it later from Settings, AI Helper.",
      );
    } finally {
      setFetching(false);
    }
  }, [onDecision]);

  // The textarea fallback view, surfacing the raw prompt for manual
  // select-all + copy. Auto-selects on mount so Cmd/Ctrl-C lands the
  // copy in one keystroke.
  if (fallbackText) {
    return (
      <div className="space-y-3 min-h-[200px]">
        <p className="text-sm text-gray-600">
          We couldn&apos;t reach the clipboard automatically. Select all
          the text below and copy it manually, then paste into Claude,
          ChatGPT, or Gemini&apos;s system instructions.
        </p>
        <textarea
          readOnly
          value={fallbackText}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          className="w-full h-32 px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onAdvance}
            className="px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (copied) {
    return (
      <div className="space-y-3 min-h-[200px]">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-emerald-600 mt-0.5 flex-shrink-0"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <div>
              <p className="text-sm font-medium text-emerald-900">Copied!</p>
              <p className="mt-1 text-sm text-emerald-800 leading-relaxed">
                Paste it into Claude, ChatGPT, or Gemini&apos;s system
                instructions.
              </p>
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onAdvance}
            className="px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-[200px]">
      <div>
        <h3 className="text-base font-medium text-gray-900">
          Want a prompt for Claude, ChatGPT, or Gemini?
        </h3>
        <p className="mt-1 text-sm text-gray-600 leading-relaxed">
          Paste it once and your AI knows ResearchOS, its features,
          schema, drafting helpers.
        </p>
      </div>
      {fetchError && <p className="text-xs text-red-600">{fetchError}</p>}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void handleCopy()}
          disabled={fetching}
          className="w-full px-4 py-3 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {fetching ? "Fetching…" : "Copy prompt now"}
        </button>
        <button
          type="button"
          onClick={() => {
            onDecision("later");
            onAdvance();
          }}
          className="w-full px-4 py-3 text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
