# Connection gate, pair-before-use on the data-dependent tabs

Status: spec for the orchestrator (mobile manager). This edits shared screens
(`notebook.tsx`, `inventory.tsx`) and changes the capture-behavior model, so the
cosmetics session is not building it. Decision below is Grant's (2026-06-09).

## Decision

When the phone is NOT paired to a laptop, the **Notebook** and **Inventory**
tabs show ONLY a "Pair this phone" call to action, with all other content hidden.
Once paired, the normal screen renders. On unpair, the screen reverts to the
gated pair-only state (reactive via `usePairing`).

Scope, confirmed by Grant:

- Gate fully: Notebook and Inventory.
- Leave offline: Calc (calculators), Timers, Wiki. These do real work with no
  connection and are NOT gated.

This deliberately drops the current offline capture queue on Notebook (today you
can take a photo / quick note while unpaired and it queues to send on pairing).
Per Grant's call, capture now requires pairing first. The capture/queue
infrastructure (`captures.ts`, `addCapture`, the outbox) can stay as-is; only the
UI entry points become unreachable while unpaired.

## Behavior

- `notebook.tsx`: when `!pairing`, render only the pair CTA (reuse the existing
  "Not paired" card copy + the `<Button label="Pair this phone" onPress={() =>
  router.push('/pair')} />`), centered, and skip the quick-capture row (Take a
  photo / Quick note / Upload), the Today list, and the synced footer. When
  `pairing` is set, render the screen as today (minus the now-redundant inline
  "Not paired" card, since the gate covers that state).
- `inventory.tsx`: when `!pairing`, render the same pair CTA instead of the empty
  snapshot state it shows now. When paired, render as today.
- Both already call `usePairing()`, so the gate is a render branch on `pairing`,
  no new state. Unpair (from the Notebook unpair control or Settings) flips
  `pairing` to null and the gate reappears automatically.

## Edge cases to confirm (orchestrator)

- Demo mode. `setDemoPairing()` writes a pairing record, so demo users are
  "paired" and see full content. The gate respects this automatically (no special
  case). Verify.
- Pre-existing queued captures. If a user had captures queued from before this
  ships and then is unpaired, they cannot reach the outbox UI on Notebook while
  the gate is up. Decide whether queued-but-unsent captures need a visible path
  (for example a small "N queued, pair to send" line inside the gated state) or
  whether that case is rare enough to ignore for v1. Recommend the small line if
  any captures exist, so nothing is silently stranded.
- Copy. The gated state can reuse the existing "Pair this phone with your laptop
  to send captures and notes to your lab." line, or a per-tab variant ("Pair to
  see your lab inventory."). Orchestrator's call.

## Not in scope

Calc, Timers, Wiki stay offline-capable. The pairing handshake, QR/register flow,
and the relay are unchanged; this is purely a render gate reading existing
pairing state.
