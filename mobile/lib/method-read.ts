// Read-mode flattening (companion method read mode, 2026-06-13).
//
// Turns a MethodProjection (the same sealed snapshot the laptop already
// publishes via fetchSnapshot('method')) into an ordered list of big-text read
// steps plus a per-type "graphic map" descriptor, so the NYT-cooking-style read
// view can drive both the pinned top graphic and the focused step from one
// source. This is presentation only, it never mutates the projection.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.
import type { MethodProjection } from '@/lib/snapshots';

// Temperature tone buckets, color-coded in read mode (hot/anneal/extend/hold).
export type TempTone = 'hot' | 'anneal' | 'extend' | 'hold' | 'none';

export function toneForTemp(tempC?: number): TempTone {
  if (typeof tempC !== 'number') return 'none';
  if (tempC >= 90) return 'hot';
  if (tempC <= 16) return 'hold';
  if (tempC >= 68) return 'extend';
  return 'anneal';
}

// A reagent line for the big checklist.
export type ReadCheck = { name: string; amount: string };

// One big-text read step. `seg` ties the step to a highlighted block on the
// pinned graphic map (PCR profile segment id, or LC gradient point index).
export type ReadStep = {
  kicker: string; // "Step 2 of 5  -  Initial denaturation"
  big: string; // the headline line (huge type)
  tone: TempTone; // colors `big` when it is a temperature
  isTemp: boolean; // render `big` as the giant temperature, else normal big text
  detail?: string; // supporting line under the headline
  checks?: ReadCheck[]; // big reagent checklist (reaction mix / mobile phase)
  pcrSeg?: PcrSegId; // PCR map block this step lights up
  lcSeg?: number; // LC gradient point index this step lights up
};

// ---- PCR graphic map (thermocycler profile) -------------------------------
export type PcrSegId = 'init' | 'cycle' | 'final' | 'hold';

export type PcrProfileBlock = {
  id: PcrSegId;
  label: string; // "95"
  sub: string; // "3:00"
  tempC: number; // drives bar height + color
  isCycle?: boolean; // the bracketed repeated block
  cycleBars?: { tempC: number }[]; // the 3 (or n) bars inside the cycle bracket
  cycleLabel?: string; // "x30"
};

// ---- LC graphic map (gradient curve) --------------------------------------
export type LcGradientPoint = { timeMin: number; percentB: number };

export type GraphicMap =
  | { kind: 'pcr'; label: string; blocks: PcrProfileBlock[] }
  | { kind: 'lc'; label: string; points: LcGradientPoint[] }
  | { kind: 'none' };

export type ReadModel = {
  steps: ReadStep[];
  map: GraphicMap;
};

function pcrStepBig(name: string, tempC?: number, duration?: string): string {
  const t = typeof tempC === 'number' ? `${tempC} C` : '';
  const d = duration ?? '';
  if (t && d) return `${t} for ${d}`;
  if (t) return t;
  if (d) return d;
  return name;
}

// Build an ordered read model from a PCR projection: reaction mix first (as a
// big checklist), then initial, the cycle block, final, and hold.
function buildPcr(method: MethodProjection): ReadModel {
  const pcr = method.pcr ?? {};
  const steps: ReadStep[] = [];
  const blocks: PcrProfileBlock[] = [];

  if (pcr.ingredients && pcr.ingredients.length > 0) {
    steps.push({
      kicker: 'Reaction mix',
      big: 'Master mix, per reaction',
      tone: 'none',
      isTemp: false,
      checks: pcr.ingredients.map((ing) => ({
        name: [ing.name ?? '', ing.concentration ? `(${ing.concentration})` : '']
          .filter(Boolean)
          .join(' '),
        amount: ing.amountPerReaction ?? '',
      })),
    });
  }

  (pcr.initial ?? []).forEach((s) => {
    blocks.push({
      id: 'init',
      label: typeof s.temperature === 'number' ? String(s.temperature) : '',
      sub: s.duration ?? '',
      tempC: s.temperature ?? 95,
    });
    steps.push({
      kicker: s.name ?? 'Initial denaturation',
      big: pcrStepBig(s.name ?? 'Initial', s.temperature, s.duration),
      tone: toneForTemp(s.temperature),
      isTemp: typeof s.temperature === 'number',
      detail: 'One time, before cycling.',
      pcrSeg: 'init',
    });
  });

  const cycles = pcr.cycles ?? [];
  cycles.forEach((cycle) => {
    const cySteps = cycle.steps ?? [];
    blocks.push({
      id: 'cycle',
      label: '',
      sub: '',
      tempC: 60,
      isCycle: true,
      cycleBars: cySteps.map((s) => ({ tempC: s.temperature ?? 60 })),
      cycleLabel: `x${cycle.repeats ?? 1}`,
    });
    const detail = cySteps
      .map(
        (s) =>
          `${typeof s.temperature === 'number' ? `${s.temperature} C` : ''}${
            s.duration ? ` ${s.duration}` : ''
          } ${s.name ?? ''}`.trim(),
      )
      .filter(Boolean)
      .join(', ');
    steps.push({
      kicker: `Cycle x${cycle.repeats ?? 1}`,
      big: `Repeat ${cycle.repeats ?? 1} times`,
      tone: 'anneal',
      isTemp: false,
      detail: detail || undefined,
      pcrSeg: 'cycle',
    });
  });

  (pcr.final ?? []).forEach((s) => {
    blocks.push({
      id: 'final',
      label: typeof s.temperature === 'number' ? String(s.temperature) : '',
      sub: s.duration ?? '',
      tempC: s.temperature ?? 72,
    });
    steps.push({
      kicker: s.name ?? 'Final extension',
      big: pcrStepBig(s.name ?? 'Final', s.temperature, s.duration),
      tone: toneForTemp(s.temperature),
      isTemp: typeof s.temperature === 'number',
      detail: 'Fill in any incomplete products.',
      pcrSeg: 'final',
    });
  });

  if (pcr.hold) {
    blocks.push({
      id: 'hold',
      label: typeof pcr.hold.temperature === 'number' ? String(pcr.hold.temperature) : '',
      sub: pcr.hold.duration ?? 'hold',
      tempC: pcr.hold.temperature ?? 4,
    });
    steps.push({
      kicker: pcr.hold.name ?? 'Hold',
      big: pcrStepBig(pcr.hold.name ?? 'Hold', pcr.hold.temperature, pcr.hold.duration ?? 'hold'),
      tone: toneForTemp(pcr.hold.temperature),
      isTemp: typeof pcr.hold.temperature === 'number',
      detail: 'Safe to leave, or move to the gel.',
      pcrSeg: 'hold',
    });
  }

  // Number the kickers now that the order is fixed.
  numberKickers(steps);
  return {
    steps,
    map: blocks.length > 0 ? { kind: 'pcr', label: 'Thermocycler profile', blocks } : { kind: 'none' },
  };
}

// Build an ordered read model from an LC projection: each gradient row becomes a
// big step, and the rows draw the gradient curve as the graphic map.
function buildLc(method: MethodProjection): ReadModel {
  const lc = method.lc ?? {};
  const rows = lc.steps ?? [];
  const points: LcGradientPoint[] = rows
    .filter((s) => typeof s.timeMin === 'number')
    .map((s) => ({ timeMin: s.timeMin as number, percentB: s.percentB ?? 0 }));

  const steps: ReadStep[] = rows.map((s, i) => {
    const flow = typeof s.flowMlMin === 'number' ? `${s.flowMlMin} mL/min` : '';
    return {
      kicker: typeof s.timeMin === 'number' ? `${s.timeMin} min` : `Step`,
      big: `${s.percentA ?? 0}% A / ${s.percentB ?? 0}% B`,
      tone: 'none',
      isTemp: false,
      detail: flow || undefined,
      lcSeg: i,
    };
  });

  if (lc.ingredients && lc.ingredients.length > 0) {
    steps.push({
      kicker: 'Mobile phase',
      big: 'Solvents',
      tone: 'none',
      isTemp: false,
      checks: lc.ingredients.map((ing) => ({
        name: [ing.name ?? '', ing.role ? `(${ing.role})` : ''].filter(Boolean).join(' '),
        amount: ing.concentration ?? '',
      })),
    });
  }

  numberKickers(steps);
  return {
    steps,
    map: points.length > 1 ? { kind: 'lc', label: 'Gradient (% B over time)', points } : { kind: 'none' },
  };
}

// Generic body / compound fallback: a sensible big-text steps view, no bespoke
// map. Splits the body into paragraph-sized steps; a compound kit lists children.
function buildGeneric(method: MethodProjection): ReadModel {
  const steps: ReadStep[] = [];

  const children = method.compound?.children ?? [];
  if (children.length > 0) {
    children.forEach((c) => {
      steps.push({
        kicker: c.methodType ?? 'Step',
        big: c.label ?? 'Step',
        tone: 'none',
        isTemp: false,
        detail: 'Open the kit on the laptop for this step’s full recipe.',
      });
    });
  } else if (method.body) {
    const chunks = method.body
      .split(/\n{2,}/)
      .map((c) => c.trim())
      .filter(Boolean);
    const list = chunks.length > 0 ? chunks : [method.body];
    list.forEach((chunk) => {
      // First line as the big headline, the rest as detail.
      const lines = chunk.split('\n');
      const head = lines[0].trim();
      const rest = lines.slice(1).join('\n').trim();
      steps.push({
        kicker: 'Step',
        big: head.length > 80 ? head.slice(0, 77) + '...' : head,
        tone: 'none',
        isTemp: false,
        detail: rest || (head.length > 80 ? head : undefined),
      });
    });
  }

  if (steps.length === 0) {
    steps.push({
      kicker: 'Method',
      big: method.name ?? 'Method',
      tone: 'none',
      isTemp: false,
      detail: 'No protocol text to show. Open it on the laptop for the full view.',
    });
  }

  numberKickers(steps);
  return { steps, map: { kind: 'none' } };
}

function numberKickers(steps: ReadStep[]) {
  const n = steps.length;
  steps.forEach((s, i) => {
    s.kicker = `Step ${i + 1} of ${n}  -  ${s.kicker}`;
  });
}

// Public entry point. Narrows on resolvedType the same way the card viewer does.
export function buildReadModel(method: MethodProjection): ReadModel {
  switch (method.resolvedType) {
    case 'pcr':
      return buildPcr(method);
    case 'lc_gradient':
      return buildLc(method);
    default:
      return buildGeneric(method);
  }
}
