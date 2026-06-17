# Stress-test hardening: four cross-cutting arcs (2026-06-17)

Source: the 2026-06-17 adversarial stress test (`docs/audits/2026-06-17-stress-test-findings.md`, 13 domains). The single-surface bugs are queued as fix chips. This doc proposes the four CROSS-CUTTING patterns, each a small focused arc. Each needs one or two decisions from Grant before build. House voice throughout.

---

## Arc 1. Form validation feedback (the highest-value UX fix)

**Problem.** Forms block submission but tell the user NOTHING. Confirmed on Calendar New Event (empty title, missing end-date, end-before-start all silently keep the dialog open), the ICS "Add Calendar" form (every bad URL fails silently, no loading state), and Settings forms. The user cannot tell a required-field miss from a logical error from a broken button. This is the most common complaint pattern in the whole audit.

**Proposed approach.** A shared, tiny validation-feedback convention every dialog form adopts:
- Required fields get a visible required marker and, on a blocked submit, an inline error under the offending field plus focus moved to it (so screen readers announce it).
- The submit button shows a disabled/explained state OR, on click with errors, surfaces the first error rather than no-op-ing.
- A reusable helper (e.g. a `useFormErrors` hook + an `<FieldError>` slot) so each form opts in with a few lines, rather than N bespoke patterns.

**Decisions for Grant.** (a) Inline-error-under-field vs a summary banner at the top of the dialog (recommend inline + focus). (b) Validate-on-blur live, or only on submit (recommend on-submit, with live clearing once fixed). (c) Scope: just the worst offenders (Calendar, ICS, Settings) first, or every dialog form.

---

## Arc 2. Narrow-viewport responsive — REFRAME FIRST (likely lower priority than it looks)

**Important context.** The core app is DESKTOP-ONLY by design: it runs on the File System Access API, which only Chrome/Edge on desktop support, and the wiki explicitly says mobile browsers cannot open a folder. So sub-450px breakage on the APP shell is NOT a phone-support gap (phones cannot run the app at all). The phone-targeted surfaces (welcome, pricing, wiki, the companion app) are separate and already handled.

**So what is real here.** The only genuine scenario is a NARROW DESKTOP WINDOW (half-screen split, a small laptop). The DOM evidence (top nav 404px min with no collapse, Data Hub 352px sidebar, Methods 224px, GANTT toolbar) means a half-screen window degrades badly. That is a real annoyance, not a launch blocker.

**Proposed approach (modest).** Pick a single min-usable width target (recommend ~900px, a half-screen 1440 display) and make the shell survive it: nav collapses overflow items into the existing "More" menu earlier, the split-shell sidebars (Data Hub/Methods) follow the Sequences pattern (`hidden md:flex` + a reveal toggle), toolbars wrap. Do NOT chase a 320px phone layout for the app shell.

**Decision for Grant.** Confirm the target. Recommendation: support down to ~900px (narrow desktop), explicitly DROP the 320px phone goal for the app shell (it is desktop-only). If you disagree and want true phone layouts, that is a much larger arc and should be its own initiative.

---

## Arc 3. Escape / overlay-layer handling (architectural)

**Problem.** Two related defects. (a) SETTINGS is built on browser URL history, so Escape and the X button step BACK through visited sections one at a time, and after exhausting history Escape navigates the tab to `chrome://newtab` (exits the app). A nested dialog (Rotate key) + Escape blows past both the dialog and Settings. (b) The LAYERED-ESCAPE pattern is inconsistent app-wide: Data Hub Escape closes the deeper dialog (loses an in-progress import), BeakerBot Escape in the `/` menu closes the whole chat, the "More" nav dropdown ignores Escape entirely; account menu + BeakerSearch get it right.

**Proposed approach.** A shared overlay/Escape stack: a tiny registry where each open layer (menu, dialog, modal, Settings panel) pushes an Escape handler, and one global keydown closes ONLY the topmost layer, falling through only when the stack is empty. Re-home Settings close on its own handler (not browser history) so Escape/X close the panel without navigating, and a nested dialog's Escape closes only the dialog. The `LivingPopup` primitive is the natural place to centralize this.

**Decisions for Grant.** (a) Confirm Settings should close as an overlay (not be a back-button/history surface) — recommend yes. (b) Whether to route every existing menu/dialog through the shared stack now, or migrate opportunistically (recommend: build the stack + fix Settings and the 3 confirmed offenders now, migrate the rest as touched).

---

## Arc 4. Input hardening sweep (length caps + control-char strip + export-safe)

**Problem.** Text fields accept unbounded / hostile input. No length cap on display name (10k chars destroys the layout), event title (5000), supply lot number, researcher Display name. Display name accepts RTL-override (U+202E), null bytes, and zero-width chars, all persisted to `_user_metadata.json`. ORCID accepts `javascript:alert(1)`; the email field accepts garbage + tags. XSS is escaped in JSX everywhere (no in-app execution found), but the raw values ride into GenBank labels, PDF/CSV/email exports, and logs.

**Proposed approach.** A shared input-hardening utility applied at the write boundary:
- Sensible `maxLength` per field (names, titles, lot numbers) with the existing "N over limit" affordance the Affiliation field already does right (copy that pattern, it works).
- Strip/reject control characters (RTL override, null bytes, zero-width) on save for identity fields.
- A single `sanitizeForExport()` pass used by every export path (GenBank/PDF/CSV/email) so stored-raw content cannot become stored-XSS downstream. Loose validation (ORCID/email format) stays a soft warning, but reject `javascript:`/control-char schemes outright.

**Decisions for Grant.** (a) Cap values per field (I will propose a table; you sign off). (b) Strip-silently vs warn-and-block control chars (recommend strip on save + a one-time note). (c) Whether to do the export-sanitize pass now or when each export path is next touched (recommend now, it is the only real security-adjacent item).

---

## Suggested sequencing

1. Arc 1 (form feedback) and Arc 3 (Escape stack) are the highest user-visible value and are mostly mechanical once the shared helper exists. Do these first.
2. Arc 4 (input hardening) next; the export-sanitize pass is the one security-adjacent piece.
3. Arc 2 (responsive) last and SMALL, scoped to narrow-desktop only, pending the desktop-only confirmation.

Each arc is one worktree sub-bot with a tight brief once the decisions above are made.
