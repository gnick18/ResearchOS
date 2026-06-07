# Structured ROIs + ontology tagging for image annotation (design, not scheduled)

Status: design backlog. Captured 2026-06-07 after the Annotorious spike. The
near-term annotate work ships as a full-viewport Konva revamp (Option 3); this
doc is the deliberate next project for turning annotations into structured,
queryable data.

## Problem

Today an annotation is a drawn shape plus, at most, a free-text label. Free text
is useless downstream: the database sees the string "colony 3", not an entity. A
researcher cannot later ask "show every melanized transformant of Af293 across
my plates" because nothing is structured.

## Goal

Let a drawn region carry STRUCTURED metadata from controlled fields / an
ontology, not free text. Example target shape on an ROI:

```
roi {
  geometry: <rect | polygon | point in natural image coords>
  entity: {
    type: "transformant" | "colony" | "zone-of-inhibition" | ...   // controlled vocab
    strain?: string        // ideally autocomplete from the project's strains
    phenotype?: string[]   // controlled tags, e.g. ["melanized"]
    note?: string          // free text stays allowed, but is secondary
  }
}
```

## Design directions to decide later

1. **Shape model.** Region of interest = rectangle / polygon / point. Polygon is
   the important add (irregular regions, zones). The full-viewport Konva revamp
   adds polygon now, so the geometry is ready; this project adds the metadata.
2. **Color semantics.** Color should mean something. Options: color-by-entity
   (all markers for one entity share a color) or color-by-type (all
   transformants blue). The current free color picker decouples color from
   meaning. Decide a binding.
3. **Ontology source.** Where do controlled vocabularies live? Options: a small
   built-in default set in the repo (method-catalog style static JSON), per
   project custom vocab in the data folder, or pull strain names from the
   project's existing entities. Local-first, so no external ontology service by
   default.
4. **Storage.** Extend `AnnotationShape` with an optional `entity` object
   (additive, lazy-normalized so old `.annot.json` keep working), OR adopt the
   Annotorious / W3C `bodies[]` model if we revisit the library decision. Keep it
   additive either way, no flag-day cutover (see the field-migration pattern in
   AGENTS.md).
5. **Query surface.** The payoff is search: a way to filter images/ROIs by
   entity fields. Out of scope for v1 of this project; note it as the reason the
   data must be structured.

## Relationship to the library decision

The Annotorious spike (`docs/proposals/ANNOTATE_ANNOTORIOUS_SPIKE.md` +
`docs/mockups/annotate-annotorious-spike.html`) showed Annotorious's `bodies[]`
field is a natural home for this structured metadata, and its W3C model would
give portability. We chose to keep Konva for now (to preserve arrow/line/text
and avoid a migration), so this project would either extend our own schema or
re-open the Annotorious question deliberately. That is the first decision when
this project is scheduled.

## Non-goals (for the near-term revamp)

The revamp shipping now does NOT add ontology/structured tags. It ships the
full-viewport editor, floating tools, light/dark, and polygon geometry. This doc
is the follow-on.
