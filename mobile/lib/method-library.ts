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

// Per-type display metadata: short label + the type-colored icon background.
// Keyed on the method resolvedType / methodType the snapshot uses.
export const METHOD_TYPE_META: Record<string, { label: string; color: string }> = {
  pcr: { label: 'PCR', color: '#ef5350' },
  lc_gradient: { label: 'LC-MS', color: '#1283C9' },
  cloning: { label: 'Cloning', color: '#5B47D6' },
  extraction: { label: 'Extraction', color: '#16a34a' },
  western: { label: 'Western', color: '#d97706' },
  qpcr: { label: 'qPCR', color: '#0ea5e9' },
  staining: { label: 'Staining', color: '#db2777' },
  culture: { label: 'Culture', color: '#0891b2' },
  compound: { label: 'Kit', color: '#7c3aed' },
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

// PLACEHOLDER library (stands in for hundreds of real methods). Replace with the
// published library snapshot once the bulk-library backend exists.
export const DEMO_LIBRARY: LibraryMethod[] = [
  ['Colony PCR, GoTaq', 'pcr', true, true],
  ['Q5 high-fidelity PCR', 'pcr', true, false],
  ['Phusion PCR, GC-rich', 'pcr', false, false],
  ['Gradient PCR optimization', 'pcr', false, false],
  ['Touchdown PCR', 'pcr', false, false],
  ['Reverse-phase LC, gliotoxin', 'lc_gradient', true, true],
  ['LC-MS metabolite screen', 'lc_gradient', true, false],
  ['Intact protein LC-MS', 'lc_gradient', false, false],
  ['HILIC polar metabolites', 'lc_gradient', false, false],
  ['Peptide map, tryptic digest', 'lc_gradient', false, false],
  ['Gibson assembly, 2-fragment', 'cloning', false, true],
  ['Golden Gate, BsaI', 'cloning', false, false],
  ['Site-directed mutagenesis', 'cloning', false, false],
  ['Gateway BP/LR', 'cloning', false, false],
  ['Phenol-chloroform DNA', 'extraction', false, false],
  ['RNA TRIzol extraction', 'extraction', true, false],
  ['Plasmid miniprep', 'extraction', false, true],
  ['Protein lysate, RIPA', 'extraction', false, false],
  ['Western blot, wet transfer', 'western', false, false],
  ['Western, fluorescent', 'western', false, false],
  ['qPCR, SYBR Green', 'qpcr', false, false],
  ['qPCR, TaqMan', 'qpcr', false, false],
  ['DAPI nuclear stain', 'staining', false, false],
  ['Immunofluorescence, 3-color', 'staining', false, false],
  ['HEK293 passage + split', 'culture', true, false],
  ['Cryopreservation, cells', 'culture', false, false],
].map(([name, type, favorite, onPhone], i) => ({
  id: `demo-${i}`,
  name: name as string,
  type: type as string,
  favorite: favorite as boolean,
  onPhone: onPhone as boolean,
}));

export type LibrarySort = 'type' | 'name' | 'recent';

export function nextSort(s: LibrarySort): LibrarySort {
  return s === 'type' ? 'name' : s === 'name' ? 'recent' : 'type';
}

export function sortLabel(s: LibrarySort): string {
  return s === 'type' ? 'Type' : s === 'name' ? 'A-Z' : 'Recent';
}
