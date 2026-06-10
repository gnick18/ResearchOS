# ResearchOS mobile convergence rubric (what to look for)

The single shared spec every audit agent reads to judge one mobile screen or popup, decide whether to fix the live app, regenerate the ideal, or lock the screen, and feed the loop. This is the engine of the page-by-page convergence (audit, fix, re-capture, re-audit, until every screen is locked).

---

## 0. The prime directive (bidirectional, read this first)

The authored **ideal frame is usually the target, but it is not gospel.** On some screens the live app has a feature, state, or polish the ideal lacks, a deliberate improvement we shipped. When that happens the fix is to **regenerate the ideal to match the better live app, not to strip the app down to the ideal.**

For every element, ask BOTH directions:
- **Is the live app missing something the ideal has?** -> fix the live app (`target: live`).
- **Does the live app have something better or more than the ideal?** -> regenerate the ideal (`target: ideal`).

Worked example: the app folded the old separate "Send" tab into the colorful **Inbox** on Notebook (grouped captures, status lines, swipe-to-delete). The stale ideal still shows a separate Send screen. **The app is right, regenerate the ideal.** Do not "fix" the app back to the old concept.

**Creative liberty:** be inspired by the ideal, not handcuffed to it. The goal is roughly 90% or better aesthetic fidelity to the (possibly-regenerated) ideal, with the app free to be slightly different where that is clearly better. We are converging to the best version, not pixel-cloning.

---

## 1. The design system (what "good" looks like)

- **Canvas:** near-white grey `#f2f3f7`. White cards with a subtle shadow must POP off it. A pure-white page background is a bug.
- **Trio, used tastefully, never a full rainbow:**
  - `sky #1AA0E6` = primary actions, default accent.
  - `coral #FF6F61` = a second creative action, or destructive/discard.
  - `amber #F59E0B` = a creative/active accent (annotate, active mode, upload).
  - Reserve **danger red** (`#dc2626`) for genuine urgency (low stock, failure). Reserve **success green** only for true success, do not let stray greens/purples/oranges leak in as a fourth/fifth palette color.
- **Large title:** 34px, weight 800, tight tracking (~-0.8). Modern iOS large-title feel. Every top-level page and sheet title aims for this.
- **Grouped containers:** lists and row-sets live in ONE rounded white card with hairline separators between rows, NOT a separate bordered card per row.
- **Buttons:** primary = solid sky fill, white label. Secondary = white card with an accent-tinted label (sky default; coral for discard/destructive; amber for a creative action like Annotate). A washed-out primary that is not actually disabled is a bug.
- **Iconography:** custom SVG icons only. **No emoji glyphs, no stray SF Symbols/lucide defaults.** A smiley or emoji in the UI is always a fix.
- **Copy (house style):** no em-dashes, no emojis, no mid-sentence colons. Short and benefit-led. State the why.
- **Cards & spacing:** comfortable padding, white cards on grey, consistent rhythm. Segmented controls are pill-shaped, not boxy-bordered.

---

## 2. Per-screen audit checklist (examine EVERY element)

Go element by element. For each, note whether it matches the design system / ideal, and which direction the fix points.

1. **Header / title** — is it the 34px/800 large title? Correct wording? Right accent on any header action?
2. **Buttons** — variant (primary/secondary), accent color correct for the action's role, not washed-out, not duplicated.
3. **Color & trio** — every colored element inside the trio + semantic (danger/success) palette? Any off-palette leak?
4. **Typography** — sizes/weights/tracking; uppercase section labels where the house pattern calls for it.
5. **Grouped-container usage** — are row-sets unified in one container with hairlines, or wrongly split into separate cards?
6. **Iconography** — custom icons only, no emoji/SF-Symbol leaks.
7. **Copy** — house style, concise, benefit-led.
8. **Spacing / layout** — canvas grey, cards pop, comfortable rhythm, edge padding.
9. **States** — does the screen show its real states well (sending/sent/failed/empty/disabled)? Are disabled states styled, not just pale?

---

## 3. Verdict taxonomy (pick exactly one per screen)

- **`lock`** — live app already matches or BEATS the target. No changes. (Notebook is the reference lock.)
- **`small-fixes`** — close, specific small tweaks would tighten it.
- **`live-missing`** — live is missing something the ideal genuinely has -> fix the app.
- **`ideal-missing`** — the live app has a feature/polish the ideal lacks -> **regenerate the ideal** (the bidirectional case).
- **`off`** — meaningfully off, needs real work.

Be honest. Do not invent problems to look thorough, and do not flag a deliberate live improvement as a regression, that is what `ideal-missing` is for.

---

## 4. The loop (how a screen reaches "locked")

1. **Audit** the current live screenshot against this rubric -> a verdict + a fix-recipe (or "pass").
2. **Author the fixes** in efficient batches (group by file/screen-area; one branch per screen-area).
3. **Apply + re-capture** the screen (stable pages in Expo Go; hot pages on the dev-client).
4. **Re-audit** the new shot. If it passes, **lock it** (`final: true` in `ideal-vs-current.html`) and check it off with Grant. If not, loop from step 1 on the remaining gaps.
5. Repeat per screen until every screen is locked. Loop the failures, not the passes.

Parallelism note: the **audit + fix-recipe** step fans out wide (one agent per screen, like the wiki bot's 60). The **capture + re-audit** step is pipelined on the shared emulator (single device), so it serializes, run it as a tight pipeline, not a swarm.

---

## 5. Output contract (per audited screen)

```
{
  screen, verdict,                 // taxonomy above
  summary,                         // 1-2 sentences, how close + which direction
  lockReady,                       // true only if no changes needed
  fixes: [{
    area,                          // header|buttons|color|typography|spacing|layout|iconography|copy|other
    issue,                         // the exact observable gap
    suggestion,                    // the concrete fix
    priority,                      // high|med|low
    target                        // live (fix the app) | ideal (regenerate the ideal)
  }]
}
```

---

## 6. Guardrails

- **Launch-aware:** keep app changes cosmetic and low-risk; defer structural rewrites; bring judgment calls to Grant.
- **Manager gatekeeps:** one branch per screen-area, tsc-clean, clean merge vs current main; the mobile manager lands each.
- **Privacy:** screenshots use demo/fixture data only (Try the demo), never real research.
- **Grant is the final gate:** agents propose, the loop converges, Grant checks each lock off.
