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
import { NAV_ITEMS, HOME_HREF } from "@/lib/nav";
import {
  USE_CASES,
  seedVisibleTabsForStep3,
} from "@/lib/onboarding/use-case-tab-mapping";

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
  username: _username,
  isMultiUserFolder,
  onComplete,
  onSkip,
  previewMode = false,
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
      setWizardData((cur) => {
        const set = new Set(cur.useCases);
        if (set.has(id)) set.delete(id);
        else set.add(id);
        return { ...cur, useCases: Array.from(set) };
      });
    },
    [],
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
          {currentStep >= 4 && (
            <div className="min-h-[200px] flex items-center justify-center text-center text-gray-500 text-sm leading-relaxed">
              Step {currentStep}: {stepSlug}, content lands in Phase 2b/2c.
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
