// E2E snapshot download (piece B). The laptop publishes a small, sealed JSON
// snapshot (for example "today") to the relay, sealed to THIS phone's X25519
// key. The phone fetches it with a device-Ed25519-signed request, unseals it
// locally, and parses the JSON. The relay only ever holds opaque bytes. House
// style: no em-dashes, no emojis, no mid-sentence colons.
import { unsealSnapshot } from '@/lib/device-identity';
import type { Pairing } from '@/lib/pairing';

import {
  DEMO_TODAY_SNAPSHOT,
  DEMO_INVENTORY_SNAPSHOT,
  DEMO_NOTEBOOKS_SNAPSHOT,
  DEMO_NOTIFICATIONS_SNAPSHOT,
} from '@/lib/demo-fixtures';

// ---- Canonical signed-byte string (MUST match relay/scripts/smoke-snapshot.mjs
// and relay/src/worker.ts verbatim). The DEVICE Ed25519 key signs this; "device"
// is the device's Ed25519 pubkey hex. Copied verbatim from the contract. ------

export function snapshotGetMessage(
  u: string,
  name: string,
  device: string,
  ts: string,
): string {
  return `researchos-snapshot-get\nu=${u}\nname=${name}\ndevice=${device}\nts=${ts}`;
}

// One task row as it appears in the "today" snapshot. All fields are tolerated
// missing so a laptop on an older shape never crashes the screen.
export type SnapshotTask = {
  id?: string;
  name?: string;
  start_date?: string;
  end_date?: string;
  task_type?: string;
};

// The decrypted "today" snapshot. generatedAt drives the "last synced" line.
// overdueTasks / upcomingTasks are the actual rows (capped by the laptop); the
// counts stay for the summary chips. Older laptops omit the arrays, so treat
// them as optional and fall back to the counts.
export type TodaySnapshot = {
  generatedAt?: string;
  tasks?: SnapshotTask[];
  overdue?: number;
  upcoming?: number;
  overdueTasks?: SnapshotTask[];
  upcomingTasks?: SnapshotTask[];
};

// ---- Method snapshot (View method on phone, 2026-06-10) -------------------
//
// The laptop publishes a sealed read-mode projection of the focused experiment's
// method(s) under the name "method" when the researcher clicks "View method on
// phone". The phone fetches + unseals it and renders a bench-friendly protocol
// viewer. All fields are tolerated missing so an older laptop shape never
// crashes the screen; the viewer narrows on resolvedType to pick a renderer.

export type MethodPcrStep = {
  name?: string;
  /** Temperature in C. */
  temperature?: number;
  /** Human duration string, e.g. "2 min". */
  duration?: string;
};

export type MethodPcrCycle = {
  repeats?: number;
  steps?: MethodPcrStep[];
};

export type MethodPcrProjection = {
  initial?: MethodPcrStep[];
  cycles?: MethodPcrCycle[];
  final?: MethodPcrStep[];
  hold?: MethodPcrStep | null;
  ingredients?: Array<{
    name?: string;
    concentration?: string;
    amountPerReaction?: string;
  }>;
  notes?: string | null;
};

export type MethodLcProjection = {
  steps?: Array<{
    timeMin?: number;
    percentA?: number;
    percentB?: number;
    flowMlMin?: number;
  }>;
  column?: {
    manufacturer?: string | null;
    model?: string | null;
    lengthMm?: number | null;
    innerDiameterMm?: number | null;
    particleSizeUm?: number | null;
  };
  detectionWavelengthNm?: number | null;
  ingredients?: Array<{
    name?: string;
    role?: string;
    concentration?: string;
  }>;
  description?: string | null;
};

export type MethodCompoundProjection = {
  children?: Array<{
    methodId?: number;
    label?: string;
    methodType?: string | null;
  }>;
};

export type MethodProjection = {
  methodId?: number;
  name?: string;
  methodType?: string | null;
  resolvedType?: string;
  keyParams?: Array<{ label?: string; value?: string }>;
  pcr?: MethodPcrProjection;
  lc?: MethodLcProjection;
  compound?: MethodCompoundProjection;
  body?: string | null;
};

export type MethodSnapshot = {
  generatedAt?: string;
  taskId?: number;
  owner?: string;
  experimentName?: string;
  methods?: MethodProjection[];
};

// ---- Calculators snapshot (Custom Calculator Builder Phase 3, 2026-06-10) ----
//
// The laptop auto-publishes a sealed projection of the calculators the user can
// see (their own custom calculators plus the lab-shared ones) under the name
// "calculators", on the same cadence as today / inventory / notebooks. The
// phone fetches + unseals it and runs the SAME ported engine
// (lib/calculators/custom.ts) over each spec, so a calculator built on the
// laptop computes identically at the bench. All fields tolerated missing so an
// older laptop shape never crashes the screen.
//
// The spec fields (inputs / steps / conditionals / outputs) match the engine's
// CustomCalculatorSpec, so a fetched calculator drops straight into
// evaluateCustomCalculator.

export type SnapshotCalculatorDropdownOption = {
  label?: string;
  value?: number | string;
};

export type SnapshotCalculatorTableColumn = {
  key?: string;
  label?: string;
  kind?: 'input' | 'computed';
  unit?: string;
  expr?: string;
};

export type SnapshotCalculatorInput = {
  key?: string;
  type?: 'number' | 'replicate' | 'dropdown' | 'table';
  label?: string;
  unit?: string;
  default?: number | number[] | string;
  options?: SnapshotCalculatorDropdownOption[];
  /** Columns + seed rows for a table input (Phase 5). */
  columns?: SnapshotCalculatorTableColumn[];
  rows?: Record<string, number | string>[];
};

export type SnapshotCalculatorStep = {
  key?: string;
  expr?: string;
};

export type SnapshotCalculatorConditional = {
  expr?: string;
};

export type SnapshotCalculatorOutput = {
  label?: string;
  expr?: string;
  unit?: string;
  /** Per-output number format, carried through so phone display matches the
   *  laptop (a scientific output reads as 2.5e8, not 250000000). */
  format?: 'auto' | 'scientific' | 'fixed';
  decimals?: number;
};

export type SnapshotCalculator = {
  uid?: string;
  id?: number;
  name?: string;
  description?: string;
  field?: string;
  inputs?: SnapshotCalculatorInput[];
  steps?: SnapshotCalculatorStep[];
  conditionals?: SnapshotCalculatorConditional[];
  outputs?: SnapshotCalculatorOutput[];
  /** Owner username, used for the "Shared by <owner>" line on a lab calc. */
  ownerLabel?: string;
  /** True when owned by another lab member (read-only, surfaced via the share). */
  isShared?: boolean;
};

export type CalculatorsSnapshot = {
  generatedAt?: string;
  calculators?: SnapshotCalculator[];
};

// ---- Notifications snapshot (phone channel, 2026-06-12) --------------------
//
// The laptop publishes the user's phone-routed notifications under the name
// "notifications" (see frontend/src/lib/mobile-relay/notifications-snapshot.ts).
// Each entry is already rendered to a category title + one-line body on the
// laptop, so the phone just lists them. All fields are tolerated missing so an
// older laptop shape never crashes the screen. This is a synced LIST, not an OS
// push (the laptop publishes while open; the phone shows it on poll).

export type SnapshotNotification = {
  id?: string;
  category?: string;
  title?: string;
  body?: string;
  createdAt?: string | null;
  read?: boolean;
};

export type NotificationsSnapshot = {
  generatedAt?: string;
  notifications?: SnapshotNotification[];
};

// Fetch + unseal a named snapshot. GETs the relay's snapshot/get endpoint with a
// device-Ed25519-signed query (device = the phone's Ed25519 pubkey, taken from
// the pairing record), reads the raw sealed bytes on 200, unseals with this
// phone's X25519 key, and JSON-parses the plaintext. Returns null on 404, which
// is the "laptop has not published yet" case. Any other non-200 throws so the
// caller can surface it.
//
// When pairing.demo is true the relay is never touched; a matching fixture is
// returned immediately so the placeholder keys never reach the network.
export async function fetchSnapshot(
  name: string,
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
): Promise<unknown | null> {
  if (pairing.demo) {
    // Return the appropriate fixture without signing or fetching anything.
    if (name === 'inventory') return DEMO_INVENTORY_SNAPSHOT;
    // The notebooks fixture gives the capture chooser real destinations to route
    // into (Lab Notes / Results / an experiment) instead of an empty list.
    if (name === 'notebooks') return DEMO_NOTEBOOKS_SNAPSHOT;
    // The method snapshot has no demo fixture (the read-mode method viewer is
    // driven by a real focused experiment on the laptop). Return null so the
    // viewer shows its "open a method from the laptop" empty state in demo mode.
    if (name === 'method') return null;
    // The calculators snapshot has no demo fixture (custom calculators are
    // user-authored on a real laptop). Return null so the viewer shows its
    // "build one on the laptop" empty state in demo mode.
    if (name === 'calculators') return null;
    // The notifications fixture gives the phone screen sample rows so the
    // synced-list UI is shown in demo mode instead of an empty state.
    if (name === 'notifications') return DEMO_NOTIFICATIONS_SNAPSHOT;
    // Default: "today" and any other name fall back to the today fixture.
    return DEMO_TODAY_SNAPSHOT;
  }

  const ts = new Date().toISOString();
  const device = pairing.devicePubkey;
  const sig = await deviceSign(
    snapshotGetMessage(pairing.u, name, device, ts),
  );

  const base = pairing.relayUrl.replace(/\/+$/, '');
  const url =
    `${base}/capture/snapshot/get?u=${pairing.u}` +
    `&name=${encodeURIComponent(name)}` +
    `&device=${device}` +
    `&ts=${encodeURIComponent(ts)}` +
    `&sig=${sig}`;

  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`snapshot fetch failed (status ${res.status})`);
  }

  const sealed = new Uint8Array(await res.arrayBuffer());
  let opened: Uint8Array;
  try {
    opened = await unsealSnapshot(sealed);
  } catch (e) {
    // Unseal (X25519 openSealed) failed. Rare, but worth a clear log for support
    // (usually a device-key mismatch) rather than a generic "could not sync".
    console.warn(
      `[snapshot] unseal failed for "${name}" (sealedBytes=${sealed.length})`,
      e,
    );
    throw e;
  }
  try {
    return JSON.parse(new TextDecoder().decode(opened));
  } catch (e) {
    // The bytes unsealed fine but are not valid JSON (truncated or wrong-shape
    // publish). Surface a clear format error instead of the raw SyntaxError, so
    // the caller does not show this as a generic network failure.
    console.warn(`[snapshot] JSON parse failed for "${name}"`, e);
    throw new Error(`snapshot format error for "${name}"`);
  }
}

/** Typed convenience over fetchSnapshot for the "calculators" snapshot. Returns
 *  null when the laptop has not published yet (or in demo mode). Mirrors how
 *  method.tsx casts the method snapshot. */
export async function fetchCalculatorsSnapshot(
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
): Promise<CalculatorsSnapshot | null> {
  return (await fetchSnapshot('calculators', pairing, deviceSign)) as
    | CalculatorsSnapshot
    | null;
}

/** Typed convenience over fetchSnapshot for the "notifications" snapshot.
 *  Returns null when the laptop has not published yet. In demo mode a fixture is
 *  returned so the notifications screen shows sample rows. */
export async function fetchNotificationsSnapshot(
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
): Promise<NotificationsSnapshot | null> {
  return (await fetchSnapshot('notifications', pairing, deviceSign)) as
    | NotificationsSnapshot
    | null;
}
