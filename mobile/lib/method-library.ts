// Method library types + placeholder fixture (companion method library,
// 2026-06-13).
//
// SCOPE NOTE. The real bulk-library data path (the laptop publishing ALL of the
// user's methods so the phone can browse them offline) does NOT exist yet. It is
// deferred to a later "offline sync" task. Until that backend lands, the big
// library list below is a typed FIXTURE so the browse / search / filter / sort
// UI is real and reviewable. The active-experiment recommendations band is NOT
// fixture-backed, it is driven by the real MethodSnapshot the laptop already
// publishes via fetchSnapshot('method'). Wiring C should replace DEMO_LIBRARY
// with the published library snapshot and the offline download/status with the
// real sync state, keeping this same shape.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.
import type { MethodProjection, MethodSnapshot } from '@/lib/snapshots';

// Per-type display metadata: short label + the type-colored icon background.
// Keyed on the method resolvedType / methodType the snapshot uses.
export const METHOD_TYPE_META: Record<string, { label: string; color: string }> = {
  pcr: { label: 'PCR', color: '#ef5350' },
  lc_gradient: { label: 'LC-MS', color: '#1283C9' },
  mass_spec: { label: 'MS', color: '#0e7490' },
  cloning: { label: 'Cloning', color: '#5B47D6' },
  extraction: { label: 'Extraction', color: '#16a34a' },
  western: { label: 'Western', color: '#d97706' },
  qpcr: { label: 'qPCR', color: '#0ea5e9' },
  staining: { label: 'Staining', color: '#db2777' },
  culture: { label: 'Culture', color: '#0891b2' },
  compound: { label: 'Kit', color: '#7c3aed' },
  markdown: { label: 'Doc', color: '#475569' },
  pdf: { label: 'PDF', color: '#be123c' },
  coding: { label: 'Code', color: '#334155' },
};

const FALLBACK_META = { label: 'Method', color: '#6b7280' };

export function typeMeta(type?: string | null): { label: string; color: string } {
  if (!type) return FALLBACK_META;
  return METHOD_TYPE_META[type] ?? { label: type, color: FALLBACK_META.color };
}

// One row in the library list.
export type LibraryMethod = {
  id: string;
  name: string;
  type: string; // a key in METHOD_TYPE_META
  favorite: boolean;
  onPhone: boolean; // downloaded for offline use
};

// A demo method = one browse row PLUS the full read-mode projection it opens to,
// kept in one place so the list and the reader can never drift. The `detail`
// carries a real MethodProjection so read mode renders the same way it will once
// the bulk-library backend publishes real methods. resolvedType drives which
// reader the method opens (pcr profile, lc curve, compound kit, or the generic
// big-text reader for every other type), so demo mode has one seeded, openable
// method of EVERY type for debugging and for reviewers walking the readers.
export type DemoMethod = LibraryMethod & { detail: MethodProjection };

// One fully-authored method per type (the openable, reader-complete seeds), plus
// a few extra browse-only rows so the list still reads like a real library. The
// extras reuse the generic reader via a short body so nothing ever opens blank.
export const DEMO_METHODS: DemoMethod[] = [
  // ---- PCR (thermocycler-profile reader) ----------------------------------
  {
    id: 'demo-pcr-colony',
    name: 'Colony PCR, GoTaq',
    type: 'pcr',
    favorite: true,
    onPhone: true,
    detail: {
      name: 'Colony PCR, GoTaq',
      methodType: 'pcr',
      resolvedType: 'pcr',
      keyParams: [
        { label: 'Polymerase', value: 'GoTaq G2' },
        { label: 'Reaction', value: '25 uL' },
        { label: 'Cycles', value: '30' },
      ],
      pcr: {
        ingredients: [
          { name: 'GoTaq G2 Master Mix', concentration: '2x', amountPerReaction: '12.5 uL' },
          { name: 'Forward primer', concentration: '10 uM', amountPerReaction: '0.5 uL' },
          { name: 'Reverse primer', concentration: '10 uM', amountPerReaction: '0.5 uL' },
          { name: 'Colony lysate', concentration: '', amountPerReaction: '1 uL' },
          { name: 'Nuclease-free water', concentration: '', amountPerReaction: '10.5 uL' },
        ],
        initial: [{ name: 'Initial denaturation', temperature: 95, duration: '3 min' }],
        cycles: [
          {
            repeats: 30,
            steps: [
              { name: 'Denature', temperature: 95, duration: '30 s' },
              { name: 'Anneal', temperature: 55, duration: '30 s' },
              { name: 'Extend', temperature: 72, duration: '1 min' },
            ],
          },
        ],
        final: [{ name: 'Final extension', temperature: 72, duration: '5 min' }],
        hold: { name: 'Hold', temperature: 4, duration: 'hold' },
        notes: 'Pick a single colony into the reaction, then streak the rest onto a backup plate before adding the lysate.',
      },
    },
  },
  {
    id: 'demo-pcr-q5',
    name: 'Q5 high-fidelity PCR',
    type: 'pcr',
    favorite: true,
    onPhone: false,
    detail: {
      name: 'Q5 high-fidelity PCR',
      methodType: 'pcr',
      resolvedType: 'pcr',
      keyParams: [
        { label: 'Polymerase', value: 'Q5' },
        { label: 'Reaction', value: '50 uL' },
        { label: 'Cycles', value: '25' },
      ],
      pcr: {
        ingredients: [
          { name: 'Q5 Master Mix', concentration: '2x', amountPerReaction: '25 uL' },
          { name: 'Forward primer', concentration: '10 uM', amountPerReaction: '2.5 uL' },
          { name: 'Reverse primer', concentration: '10 uM', amountPerReaction: '2.5 uL' },
          { name: 'Template DNA', concentration: '', amountPerReaction: '1 uL' },
          { name: 'Nuclease-free water', concentration: '', amountPerReaction: '19 uL' },
        ],
        initial: [{ name: 'Initial denaturation', temperature: 98, duration: '30 s' }],
        cycles: [
          {
            repeats: 25,
            steps: [
              { name: 'Denature', temperature: 98, duration: '10 s' },
              { name: 'Anneal', temperature: 62, duration: '20 s' },
              { name: 'Extend', temperature: 72, duration: '30 s' },
            ],
          },
        ],
        final: [{ name: 'Final extension', temperature: 72, duration: '2 min' }],
        hold: { name: 'Hold', temperature: 4, duration: 'hold' },
        notes: 'For amplicons over 1 kb use 30 s per kb at the extension step.',
      },
    },
  },
  // ---- LC-MS (gradient-curve reader) --------------------------------------
  {
    id: 'demo-lc-gliotoxin',
    name: 'Reverse-phase LC, gliotoxin',
    type: 'lc_gradient',
    favorite: true,
    onPhone: true,
    detail: {
      name: 'Reverse-phase LC, gliotoxin',
      methodType: 'lc_gradient',
      resolvedType: 'lc_gradient',
      keyParams: [
        { label: 'Detection', value: '254 nm' },
        { label: 'Flow', value: '0.4 mL/min' },
        { label: 'Run', value: '25 min' },
      ],
      lc: {
        steps: [
          { timeMin: 0, percentA: 95, percentB: 5, flowMlMin: 0.4 },
          { timeMin: 2, percentA: 95, percentB: 5, flowMlMin: 0.4 },
          { timeMin: 18, percentA: 5, percentB: 95, flowMlMin: 0.4 },
          { timeMin: 20, percentA: 5, percentB: 95, flowMlMin: 0.4 },
          { timeMin: 21, percentA: 95, percentB: 5, flowMlMin: 0.4 },
          { timeMin: 25, percentA: 95, percentB: 5, flowMlMin: 0.4 },
        ],
        column: {
          manufacturer: 'Waters',
          model: 'XSelect HSS T3',
          lengthMm: 150,
          innerDiameterMm: 2.1,
          particleSizeUm: 3.5,
        },
        detectionWavelengthNm: 254,
        ingredients: [
          { name: 'Water with 0.1% formic acid', role: 'A', concentration: '' },
          { name: 'Acetonitrile with 0.1% formic acid', role: 'B', concentration: '' },
        ],
        description: 'Equilibrate at 5% B for at least five column volumes before the first injection.',
      },
    },
  },
  // ---- Mass spec (generic reader, MS acquisition) -------------------------
  {
    id: 'demo-ms-metabolite',
    name: 'LC-MS metabolite screen',
    type: 'mass_spec',
    favorite: false,
    onPhone: false,
    detail: {
      name: 'LC-MS metabolite screen',
      methodType: 'mass_spec',
      resolvedType: 'mass_spec',
      keyParams: [
        { label: 'Mode', value: 'ESI positive' },
        { label: 'Range', value: '100 to 1000 m/z' },
        { label: 'Resolution', value: '70k' },
      ],
      body:
        'Source\nElectrospray in positive mode, capillary 3.5 kV, sheath gas 40, aux gas 10, capillary temp 320 C.\n\nAcquisition\nFull scan from 100 to 1000 m/z at 70,000 resolution, followed by data-dependent MS2 on the top five ions with a 30 s dynamic exclusion.\n\nQuality control\nInject a pooled QC every ten samples and a solvent blank every twenty to track carryover and drift.',
    },
  },
  // ---- qPCR (generic reader, plate + cycling + Cq) ------------------------
  {
    id: 'demo-qpcr-sybr',
    name: 'qPCR, SYBR Green',
    type: 'qpcr',
    favorite: false,
    onPhone: true,
    detail: {
      name: 'qPCR, SYBR Green',
      methodType: 'qpcr',
      resolvedType: 'qpcr',
      keyParams: [
        { label: 'Dye', value: 'SYBR Green' },
        { label: 'Reference', value: 'ACT1' },
        { label: 'Plate', value: '384 well' },
      ],
      body:
        'Plate layout\nRun each sample in technical triplicate. Reserve one column for the no-template control and one for the standard-curve dilution series.\n\nReaction, per well\n5 uL 2x SYBR master mix, 0.3 uL of each primer at 10 uM, 2 uL diluted cDNA, water to 10 uL.\n\nCycling\nHold 95 C for 2 min, then 40 cycles of 95 C for 5 s and 60 C for 30 s. Add a melt curve from 65 C to 95 C at the end.\n\nAnalysis\nUse ACT1 as the reference gene and report relative expression with the delta delta Cq method against the untreated control.',
    },
  },
  // ---- Western blot (generic reader) --------------------------------------
  {
    id: 'demo-western-wet',
    name: 'Western blot, wet transfer',
    type: 'western',
    favorite: false,
    onPhone: false,
    detail: {
      name: 'Western blot, wet transfer',
      methodType: 'western',
      resolvedType: 'western',
      keyParams: [
        { label: 'Gel', value: '10% SDS-PAGE' },
        { label: 'Transfer', value: '100 V, 60 min' },
        { label: 'Primary', value: 'anti-p53, 1:1000' },
      ],
      body:
        'Run\nLoad 20 ug lysate per lane and run the gel at 120 V until the dye front reaches the bottom.\n\nTransfer\nWet transfer to PVDF at 100 V for 60 min on ice.\n\nBlock and probe\nBlock in 5% milk in TBST for 1 h, then primary anti-p53 at 1:1000 overnight at 4 C. Wash three times in TBST, then HRP secondary at 1:5000 for 1 h.\n\nImage\nDevelop with ECL and image. Strip and reprobe for the loading control.',
    },
  },
  // ---- Staining / immunofluorescence (generic reader) ---------------------
  {
    id: 'demo-stain-if3',
    name: 'Immunofluorescence, 3-color',
    type: 'staining',
    favorite: false,
    onPhone: false,
    detail: {
      name: 'Immunofluorescence, 3-color',
      methodType: 'staining',
      resolvedType: 'staining',
      keyParams: [
        { label: 'Fixation', value: '4% PFA' },
        { label: 'Nuclei', value: 'DAPI' },
        { label: 'Mount', value: 'ProLong Gold' },
      ],
      body:
        'Fix and permeabilize\nFix coverslips in 4% PFA for 15 min, wash in PBS, then permeabilize in 0.1% Triton X-100 for 10 min.\n\nBlock and stain\nBlock in 3% BSA for 1 h. Apply the primary cocktail overnight at 4 C, wash, then the matched secondaries for 1 h at room temperature in the dark.\n\nNuclei and mount\nCounterstain with DAPI for 5 min, wash, and mount in ProLong Gold. Image within 48 h.',
    },
  },
  // ---- Cell culture (generic reader) --------------------------------------
  {
    id: 'demo-culture-hek',
    name: 'HEK293 passage + split',
    type: 'culture',
    favorite: true,
    onPhone: false,
    detail: {
      name: 'HEK293 passage + split',
      methodType: 'culture',
      resolvedType: 'culture',
      keyParams: [
        { label: 'Split', value: '1:6' },
        { label: 'Media', value: 'DMEM + 10% FBS' },
        { label: 'Confluence', value: '80 to 90%' },
      ],
      body:
        'Warm reagents\nWarm DMEM, PBS, and trypsin to 37 C.\n\nDetach\nAspirate the spent media, wash once with PBS, then add 1 mL of 0.25% trypsin and incubate 3 min at 37 C until the cells round up.\n\nNeutralize and split\nAdd 4 mL of complete media, pipette to a single-cell suspension, and reseed at a 1:6 ratio into a fresh flask.\n\nReturn\nTop up to the working volume and return to the incubator at 37 C and 5% CO2.',
    },
  },
  // ---- Cloning (generic reader) -------------------------------------------
  {
    id: 'demo-cloning-gibson',
    name: 'Gibson assembly, 2-fragment',
    type: 'cloning',
    favorite: false,
    onPhone: true,
    detail: {
      name: 'Gibson assembly, 2-fragment',
      methodType: 'cloning',
      resolvedType: 'cloning',
      keyParams: [
        { label: 'Ratio', value: '1:2 vector to insert' },
        { label: 'Incubation', value: '50 C, 15 min' },
        { label: 'Overlap', value: '20 to 40 bp' },
      ],
      body:
        'Set up\nCombine the vector and insert at a 1:2 molar ratio in a total of 5 uL, then add 5 uL of 2x Gibson master mix.\n\nAssemble\nIncubate at 50 C for 15 min in the thermocycler.\n\nTransform\nAdd 2 uL of the reaction to 50 uL of competent cells, recover for 1 h, and plate on selective agar. Pick colonies the next morning for colony PCR.',
    },
  },
  // ---- Extraction (generic reader) ----------------------------------------
  {
    id: 'demo-extract-trizol',
    name: 'RNA TRIzol extraction',
    type: 'extraction',
    favorite: true,
    onPhone: false,
    detail: {
      name: 'RNA TRIzol extraction',
      methodType: 'extraction',
      resolvedType: 'extraction',
      keyParams: [
        { label: 'Lysis', value: 'TRIzol' },
        { label: 'Phase', value: 'chloroform' },
        { label: 'Yield check', value: 'A260/A280' },
      ],
      body:
        'Lyse\nAdd 1 mL TRIzol per well, pipette to lyse, and rest 5 min at room temperature.\n\nSeparate phases\nAdd 200 uL chloroform, shake 15 s, rest 3 min, then spin 12,000 g for 15 min at 4 C and collect the clear upper phase.\n\nPrecipitate and wash\nPrecipitate with 500 uL isopropanol, spin, then wash the pellet twice in 75% ethanol.\n\nResuspend\nAir-dry briefly and resuspend in nuclease-free water. Check A260/A280 before downstream work.',
    },
  },
  // ---- Compound kit (multi-step kit reader) -------------------------------
  {
    id: 'demo-kit-lipo',
    name: 'Lipofectamine 3000 transfection',
    type: 'compound',
    favorite: false,
    onPhone: false,
    detail: {
      name: 'Lipofectamine 3000 transfection',
      methodType: 'compound',
      resolvedType: 'compound',
      keyParams: [
        { label: 'Format', value: '24 well' },
        { label: 'DNA', value: '500 ng/well' },
        { label: 'Complex', value: '15 min, room temp' },
      ],
      compound: {
        children: [
          { label: 'Dilute Lipofectamine 3000 in Opti-MEM', methodType: 'mix' },
          { label: 'Dilute DNA in Opti-MEM and add P3000 reagent', methodType: 'mix' },
          { label: 'Combine the two and incubate 15 min at room temperature', methodType: 'incubate' },
          { label: 'Add the complex dropwise to the cells', methodType: 'transfect' },
        ],
      },
    },
  },
  // ---- Markdown / written protocol (generic reader) -----------------------
  {
    id: 'demo-doc-handling',
    name: 'Sample handling SOP',
    type: 'markdown',
    favorite: false,
    onPhone: false,
    detail: {
      name: 'Sample handling SOP',
      methodType: 'markdown',
      resolvedType: 'markdown',
      keyParams: [{ label: 'Scope', value: 'All wet-lab samples' }],
      body:
        'Receiving\nLog every incoming sample in the freezer inventory before storage, with the date, source, and box position.\n\nStorage\nKeep working aliquots at minus 20 C and long-term stocks at minus 80 C. Never refreeze a thawed aliquot.\n\nDisposal\nAutoclave biological waste before it leaves the lab and record the cycle in the maintenance log.',
    },
  },
  // ---- PDF-backed method (generic reader, real PDF reader pending) --------
  {
    id: 'demo-pdf-paper',
    name: 'Published method, Nature Protocols',
    type: 'pdf',
    favorite: false,
    onPhone: false,
    detail: {
      name: 'Published method, Nature Protocols',
      methodType: 'pdf',
      resolvedType: 'pdf',
      keyParams: [
        { label: 'Source', value: 'Nature Protocols' },
        { label: 'DOI', value: '10.1038/s41596-000-00000-0' },
      ],
      body:
        'Summary\nThis method is backed by an attached PDF. The bench summary below covers the key steps, the full figures and references live in the PDF.\n\nKey steps\nPrepare the lysate, run the affinity pulldown, wash under the stated stringency, then elute and analyze.\n\nNote\nThe paper-faithful PDF reader is the next reader to build. Open the method on the laptop for the full document.',
    },
  },
  // ---- Coding / analysis script (generic reader) --------------------------
  {
    id: 'demo-code-deltacq',
    name: 'Delta delta Cq analysis',
    type: 'coding',
    favorite: false,
    onPhone: false,
    detail: {
      name: 'Delta delta Cq analysis',
      methodType: 'coding',
      resolvedType: 'coding',
      keyParams: [
        { label: 'Language', value: 'Python' },
        { label: 'Input', value: 'Cq table CSV' },
      ],
      body:
        'Load\nRead the Cq export into a dataframe and average the technical replicates per sample and target.\n\nNormalize\nSubtract the reference-gene Cq from each target to get delta Cq, then subtract the control delta Cq to get delta delta Cq.\n\nReport\nFold change is two to the power of negative delta delta Cq. Plot per group with the replicate spread shown.',
    },
  },
];

// Browse rows derived from the seeds, so the list never drifts from the readers.
export const DEMO_LIBRARY: LibraryMethod[] = DEMO_METHODS.map(
  ({ id, name, type, favorite, onPhone }) => ({ id, name, type, favorite, onPhone }),
);

// uid -> full read projection, for the demo open path (method-detail ?demo=<uid>).
export const DEMO_METHOD_DETAILS: Record<string, MethodProjection> = Object.fromEntries(
  DEMO_METHODS.map((m) => [m.id, m.detail]),
);

/** Resolve a seeded demo method's read projection by its library uid. */
export function getDemoMethod(uid: string): MethodProjection | null {
  return DEMO_METHOD_DETAILS[uid] ?? null;
}

// Demo "method" snapshot for the active-experiment recommendations band (the
// laptop normally publishes this when the researcher taps View method on phone).
// Two seeds stand in as the focused experiment's methods so the band, and its
// read mode, are demoable too.
export const DEMO_METHOD_SNAPSHOT: MethodSnapshot = {
  generatedAt: new Date().toISOString(),
  experimentName: 'fakeGFP expression (chapter 2)',
  methods: [
    DEMO_METHOD_DETAILS['demo-qpcr-sybr'],
    DEMO_METHOD_DETAILS['demo-pcr-colony'],
  ],
};

export type LibrarySort = 'type' | 'name' | 'recent';

export function nextSort(s: LibrarySort): LibrarySort {
  return s === 'type' ? 'name' : s === 'name' ? 'recent' : 'type';
}

export function sortLabel(s: LibrarySort): string {
  return s === 'type' ? 'Type' : s === 'name' ? 'A-Z' : 'Recent';
}
