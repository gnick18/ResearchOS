# Compound combinations: cross-session contract (catalog session <-> store session)

Date 2026-05-30. The contract for modeling LC-MS pairs as compound COMBINATION templates that render in the Extension Store Phase D combination renderer. Two sessions build disjoint halves against this shared shape.

## Model (resolves the apparent conflict)
- Single-method + PDF attachment = the LEAF/kit model (every single-type template; the bulletproof-PDF model).
- Compound + components = the COMBINATION model (bundles multiple TYPES). LC-MS = lc_gradient + mass_spec.
- A combination's components ARE leaf templates (each keeps its own source_pdf). The models are layers, not alternatives.

## The shape (the contract both halves agree on)
```ts
export interface CompoundTemplateComponent {
  slug: string;        // another catalog template slug (the child)
  ordering: number;    // 0-based; LC at 0, MS at 1 (sample flows LC -> MS)
  label?: string;      // optional override; defaults to the child template title
}
export interface CompoundTemplatePayload {
  description?: string | null;
  components: CompoundTemplateComponent[];   // non-empty
}
```
Combination = a manifest/template entry with method_type "compound" + a CompoundTemplatePayload. References children by SLUG (no method ids exist at browse time). The 6 LC-MS leaf templates STAY; combinations are additive.

## OWNERSHIP SPLIT
HR / catalog session builds (in method-catalog.ts + public/method-catalog/):
1. CatalogMethodType union + CATALOG_METHOD_TYPES Set gain "compound".
2. CompoundTemplatePayload + CompoundTemplateComponent exports.
3. MethodCatalogTemplate union gains the compound arm; parseMethodCatalogTemplate validates payload.components is a non-empty array of {slug, ordering, label?}.
4. instantiateMethodFromTemplate compound branch: instantiate each child first (recurse the per-type branches), then methodsApi.create the compound parent with source_path:null + components:[{method_id, owner:null, ordering, label?}]. (types.ts MethodCreate ALREADY accepts compound + components, no types.ts change.)
5. InstantiateTemplateDeps gains a fetchTemplate(slug) seam so the compound branch can fetch + recurse children (unit-testable).
6. The 3 LC-MS combination templates + their 3 manifest entries.
All FLAGGED data-shape touches; pre-approved direction (the three-concept IA is locked + Grant-signed).

Store/renderer session builds (it owns the Phase D files):
1. resolveCatalogCompoundComponents(components, manifestBySlug): ResolvedCompoundComponent[] in compound-template-detail.ts -- maps each {slug, ordering, label} -> {method_id: ordering (synthetic), owner: "", ordering, label: label ?? entry.title, method_type: entry.method_type}. distinctComponentTypes / missingComponentTypes (already pure) work unchanged.
2. MethodTemplateLibraryModal wiring: renderDetail branches on method_type === "compound" -> CompoundTemplateDetail with the catalog-resolved components (lazy-fetch the payload like SingleTemplateDetail does); Use is gated until ALL component types are enabled (lc_gradient AND mass_spec); handleUse already dispatches on template.method_type so it works once the loader branch lands.
CompoundTemplateDetail (the renderer component) needs NO change -- Phase D built the right shape.

## The 3 combination templates (category "LC-MS")
- lcms-peptide-combo-thermo: [lcms-peptide-rp-lc-thermo (0), lcms-peptide-ms-thermo-orbitrap (1)]
- lcms-metabolite-combo-thermo: [lcms-metabolite-hilic-lc-thermo (0), lcms-metabolite-ms-thermo-qexactive (1)]
- lcms-intact-protein-combo-thermo: [lcms-intact-protein-rp-lc-thermo (0), lcms-intact-protein-ms-thermo-exploris (1)]
(Pairings verified against the on-disk files. Titles use the "(kit)" suffix pending Grant naming confirm.)

## source_pdf interaction
Children keep their own source_pdf; the combination parent gets NONE (it has source_path:null, no method to hang a PDF on). Recursive instantiation copies each child PDF automatically via the per-type branch; the compound branch never calls copyPdf. Zero-work for LC-MS (no LC-MS leaf has a source_pdf yet).

## SEQUENCING (REVISED to loader-first; avoids degraded compound entries in the live store during the parallel verifiers)
1. Kit Phase 3 landed (commit cffbfa76, 33 bundled PDFs). Manifest is now free.
2. HR: catalog-union LOADER ONLY (method-catalog.ts: types + parser + instantiation branch + tests). NO templates, NO manifest write. This gives the store session the CompoundTemplatePayload type to build against, without putting unrenderable compound entries in the live store. (in flight: compound-union-loader bot)
3. Store session rebases onto step 2, adds resolveCatalogCompoundComponents + the modal wiring (fixture-tested; Phase D already fixture-tested the renderer against a compound method).
4. HR: add the 3 LC-MS combination templates + 3 manifest entries (small follow-up, after step 3 so they render correctly the moment they appear). Loader already accepts "compound", so the on-disk test passes.
5. Standard 3-verifier loop (touches the store detail pane).

## Decisions (LOCKED by Grant 2026-05-30)
1. Partial-failure on multi-child instantiation: LEAVE the orphaned created child (best-effort), BUT mark it for follow-up so it is discoverable as an incomplete kit (surface the modal error + tag/flag the orphan child, e.g. a follow-up marker on the created method, so the user/system knows the combination did not complete). Do NOT roll back.
2. User-facing naming: "kit". Titles use the "(kit)" suffix (e.g. "Thermo EASY-nLC + Q Exactive: peptide LC-MS/MS (kit)").
