# View method on phone (recipe-at-the-bench)

Status: spec for the orchestrator (mobile manager). Grant's idea (2026-06-09).
Touches the experiment/method system + the mobile relay, the manager's domain,
so this is a design spec, not cosmetics-session code.

## The idea

A researcher running an experiment at the bench pulls up that experiment's
METHOD on their phone in read mode, so they can follow the protocol away from
the laptop (the recipe-on-your-phone-while-cooking pattern). And they can add
VARIATIONS from the phone as they go (this batch I used 30 cycles not 28), which
route back to the experiment. It makes the phone useful DURING an experiment,
not only for capture afterward.

## Why it fits, the plumbing already exists

This reuses the whole mobile-relay + focus-context + route-capture stack:

- The laptop already tells the phone which experiment is active,
  `FocusContextPublisher` / focus-context.
- The laptop already publishes snapshots to paired phones, `mobile-relay/today-snapshot.ts`,
  `inventory-snapshot.ts`, `timers-snapshot.ts`, `notebooks-snapshot.ts`. A method
  snapshot is the same pattern.
- The phone already fetches named snapshots, `fetchSnapshot('today' | 'inventory' | ...)`.
- The phone already sends sealed commands back that route into a specific
  experiment, `route-capture` posts `{ type:"route-capture", captureId, taskId,
  owner, tab:"notes"|"results" }`. Adding a variation reuses this exact shape.
- Experiments already have a variations concept (`MethodExperimentsSidebar`,
  the per-method-type tab content).

## Flow

1. Laptop. An experiment is focused (focus-context already knows this). Either
   automatically while focused + paired, or via an explicit "View on phone"
   action on the experiment, the laptop publishes that experiment's method to
   the paired phone: a new `mobile-relay/method-snapshot.ts` publisher mirroring
   the notebooks/today publishers, sealed to the device key.
2. Phone. Fetches the method snapshot (a new `'method'` kind in
   `fetchSnapshot`) and renders a READ-MODE method viewer, the protocol steps /
   recipe / reagents, scrollable, large type, bench-friendly. No editing of the
   method itself.
3. Phone. An "Add variation" action composes a short variation note and posts a
   sealed command back, extend route-capture with an `add-variation` command
   type (`{ type:"add-variation", taskId, owner, text, at }`), or route a note
   tagged as a variation. The laptop's poller writes it to the experiment's
   variations / notes.

## What the read-mode viewer shows

The method content the laptop already renders (it has per-type tab content,
`PcrMethodTabContent`, `LcMethodTabContent`, `CompoundMethodTabContent`).
The phone shows a simplified, read-only projection: the ordered steps / recipe,
reagent list, key parameters (cycles, temps, volumes). The exact payload per
method type is the manager's call (see open questions).

## Reuse vs new

- Reuse: focus-context (active experiment), the snapshot publish/fetch pattern,
  route-capture (send back), the variations concept, the device sealing keys.
- New: `method-snapshot.ts` publisher (laptop), a `'method'` snapshot type +
  read-mode viewer screen (phone), an `add-variation` command path (extends
  route-capture), and the entry point on the laptop.

## Open questions for the orchestrator

- Method payload per type. PCR / LC / compound methods have different content;
  decide what the read-mode projection includes for each, and whether to ship one
  type first (PCR is the most recipe-like).
- Variation model. Is a phone variation a note on the experiment, or a derived
  variation experiment (the existing variations feature)? Recommend a lightweight
  note tagged "variation" for v1, promotable later.
- Entry point. Automatic while an experiment is focused + a phone is paired, vs
  an explicit "View method on phone" button on the experiment. Recommend explicit
  for v1 (predictable), automatic as a follow-up.
- Read-mode only confirmed. The method itself is not editable on the phone (only
  variations are added), to avoid divergent edits at the bench.

## Scope note

Feature build in the experiment/method + relay systems, the orchestrator's
domain. This doc is the design; the cosmetics session is not building it.
