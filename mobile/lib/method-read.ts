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
  figures?: string[]; // figure alt texts referenced by this step (placeholders in
  // Phase 1; the real images render inline once the snapshot ships them)
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

// ---- Deterministic markdown -> steps parser (Phase 1 reformatter) ----------
// Segments and labels a free-form protocol body into structured read steps
// WITHOUT rewriting the user's text. It only decides where steps, checklists,
// and figures begin; every number, unit, and reagent is carried verbatim. So a
// real markdown / pdf / kit method stops rendering as one flat wall of text.
//   - numbered lists (1. / 1)) each become a step,
//   - markdown headings and standalone bold lines become the phase in the kicker,
//   - bullet lists become the tickable reagent checklist,
//   - sub-steps (a/b, i/ii) fold into the step detail,
//   - image refs become figure placeholders (real images ship in Phase 2),
//   - plain prose falls back to one step per blank-line paragraph.
// House style: no em-dashes, no emojis, no mid-sentence colons.

const RE_NUM = /^\s*\d+[.)]\s+(.*)$/;
const RE_SUB = /^\s{0,8}(?:[a-z]|[ivx]{1,4})[.)]\s+(.*)$/i;
const RE_BULLET = /^\s*[-*•]\s+(.*)$/;
const RE_HEADING = /^\s*#{1,6}\s+(.*?)\s*#*$/;
const RE_BOLDLINE = /^\s*\*\*(.+?)\*\*\s*:?\s*$/;
const RE_IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const RE_TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const RE_TABLE_SEP = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

// Convert the common inline markdown to plain reader text. Deliberately does NOT
// touch a single `*` (it is a multiply sign in values like 5*10^6), only the
// unambiguous `**bold**`, `code`, and link forms. Stripping a marker keeps the
// wrapped text verbatim, so no number or reagent is altered.
function inlineText(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pull any markdown image refs out of a line into `into`, then clean inline
// markdown from what remains.
function lineText(line: string, into: string[]): string {
  const noImg = line.replace(RE_IMAGE, (_m, alt) => {
    into.push(inlineText(alt || 'Figure'));
    return '';
  });
  return inlineText(noImg);
}

// Split a markdown table row into trimmed, inline-cleaned cells.
function tableCells(line: string): string[] {
  const m = line.match(RE_TABLE_ROW);
  if (!m) return [];
  return m[1].split('|').map((c) => inlineText(c.trim()));
}

// Split a reagent line into name + amount by peeling a trailing parenthetical
// only, so name + amount reconstruct the original text (no value is rewritten).
function splitReagent(text: string): ReadCheck {
  const t = text.trim();
  const m = t.match(/^(.*\S)\s*(\([^()]*\))$/);
  if (m && m[1].trim().length > 0) return { name: m[1].trim(), amount: m[2] };
  return { name: t, amount: '' };
}

// Choose a punchy headline: the first sentence if there is a clean break (period
// then a capital, never inside a decimal like 0.45), else the line itself, else a
// word-boundary head with the remainder kept as detail. Both pieces are verbatim.
function splitHeadline(text: string): { big: string; rest: string } {
  const t = text.replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.{12,90}?[a-z0-9)])\.\s+(?=[A-Z(])/);
  if (m) return { big: m[1].trim(), rest: t.slice(m[0].length).trim() };
  if (t.length <= 90) return { big: t, rest: '' };
  const head = t.slice(0, 84);
  const sp = head.lastIndexOf(' ');
  const at = sp > 40 ? sp : 84;
  return { big: t.slice(0, at).trim(), rest: t.slice(at).trim() };
}

type StepDraft = {
  phase?: string;
  kind: 'num' | 'para' | 'checklist';
  headline: string;
  detail: string[];
  checks: ReadCheck[];
  figures: string[];
};

function draftToStep(d: StepDraft): ReadStep {
  if (d.kind === 'checklist') {
    const detail = d.detail.join(' ').trim();
    return {
      kicker: d.phase ?? 'Materials',
      big: d.phase ?? 'Materials',
      tone: 'none',
      isTemp: false,
      detail: detail || undefined,
      checks: d.checks.length ? d.checks : undefined,
      figures: d.figures.length ? d.figures : undefined,
    };
  }
  const { big, rest } = splitHeadline(d.headline);
  const detailParts = [rest, ...d.detail].map((s) => s.trim()).filter(Boolean);
  return {
    kicker: d.phase ?? 'Step',
    big: big || d.phase || 'Step',
    tone: 'none',
    isTemp: false,
    detail: detailParts.length ? detailParts.join('\n') : undefined,
    checks: d.checks.length ? d.checks : undefined,
    figures: d.figures.length ? d.figures : undefined,
  };
}

function parseBodyToSteps(body: string): ReadStep[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  const steps: ReadStep[] = [];
  let phase: string | undefined;
  let cur: StepDraft | null = null;
  const flush = () => {
    if (cur) {
      steps.push(draftToStep(cur));
      cur = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      // A blank line ends a prose paragraph; list and checklist steps continue.
      if (cur && cur.kind === 'para') flush();
      continue;
    }

    // Markdown table: consume the whole block. The row before a separator is the
    // header (dropped); each data row becomes a reagent check (first cell name,
    // last cell amount). Attaches to the current step, or starts a checklist.
    if (RE_TABLE_ROW.test(line) && !RE_TABLE_SEP.test(line)) {
      let j = i;
      const block: string[] = [];
      while (j < lines.length && RE_TABLE_ROW.test(lines[j])) {
        block.push(lines[j]);
        j++;
      }
      const sepAt = block.findIndex((b) => RE_TABLE_SEP.test(b));
      const rows = block.filter((b, idx) => !RE_TABLE_SEP.test(b) && idx !== sepAt - 1);
      if (!cur) cur = { phase, kind: 'checklist', headline: phase ?? 'Materials', detail: [], checks: [], figures: [] };
      rows.forEach((r) => {
        const cells = tableCells(r).filter(Boolean);
        if (cells.length === 0) return;
        const amount = cells.length > 1 ? cells[cells.length - 1] : '';
        const name = cells.length > 1 ? cells.slice(0, -1).join(' ') : cells[0];
        cur!.checks.push({ name, amount });
      });
      i = j - 1;
      continue;
    }

    const heading = line.match(RE_HEADING) ?? line.match(RE_BOLDLINE);
    if (heading) {
      flush();
      phase = inlineText(heading[1]);
      continue;
    }

    const num = line.match(RE_NUM);
    if (num) {
      flush();
      const figs: string[] = [];
      const text = lineText(num[1], figs);
      cur = { phase, kind: 'num', headline: text, detail: [], checks: [], figures: figs };
      continue;
    }

    const bullet = line.match(RE_BULLET);
    if (bullet) {
      const figs: string[] = [];
      const text = lineText(bullet[1], figs);
      if (!cur) cur = { phase, kind: 'checklist', headline: phase ?? 'Materials', detail: [], checks: [], figures: [] };
      if (text) cur.checks.push(splitReagent(text));
      cur.figures.push(...figs);
      continue;
    }

    const sub = line.match(RE_SUB);
    if (sub && cur) {
      const figs: string[] = [];
      const text = lineText(sub[1], figs);
      if (text) cur.detail.push(text);
      cur.figures.push(...figs);
      continue;
    }

    // A plain line: continuation of the current step, or the start of a new
    // prose-paragraph step when nothing is open.
    const figs: string[] = [];
    const text = lineText(line, figs);
    if (cur) {
      if (text) cur.detail.push(text);
      cur.figures.push(...figs);
    } else if (text || figs.length) {
      cur = { phase, kind: 'para', headline: text, detail: [], checks: [], figures: figs };
    }
  }
  flush();
  return steps;
}

// Generic body / compound fallback: a sensible big-text steps view, no bespoke
// map. A compound kit lists its children; any other body is run through the
// deterministic parser above so real protocols read as structured steps.
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
    steps.push(...parseBodyToSteps(method.body));
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
