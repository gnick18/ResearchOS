# Taxonomy backbone build (stage 1)

A re-runnable pipeline that turns the NCBI new_taxdump into a compact bundled
"backbone" of every taxon down to FAMILY, so the tree explorer can navigate the
upper tree of life instantly and offline. Deeper nodes (genus, species, strain)
fall back to the live Datasets API in the UI, not here.

## Run

```
node tools/taxonomy-backbone/build-backbone.mjs
```

It downloads + unzips the taxdump to a gitignored temp dir, parses `nodes.dmp`
and `names.dmp`, runs the pure transform, and writes:

- `frontend/public/taxonomy-backbone/backbone.json` (the compact node array)
- `frontend/public/taxonomy-backbone/manifest.json` (provenance + per-rank tallies)

then prints the raw + gzipped size of `backbone.json`.

To rebuild from a local copy of the dump without re-downloading:

```
node tools/taxonomy-backbone/build-backbone.mjs --taxdump-dir /path/with/dmp/files
```

The raw taxdump zip and the `.dmp` files (under `.taxdump-tmp/`) are gitignored
and never committed.

## What it keeps

A node is kept when its rank is family or above (the allowlist in
`transform.mjs`, KEEP_RANKS, covers superkingdom / realm / domain / kingdom /
phylum / class / order / family and their super/sub/infra variants). Each kept
node is re-parented to its nearest kept ancestor, so the unranked intermediate
clades collapse away and the tree stays connected. The species-under count is
computed over the FULL taxdump tree (all ~2.8M taxa), so it is exact and offline.

## Bundle schema (short keys to save bytes)

`backbone.json` is a flat array of nodes. Each node:

| key | meaning | type |
| --- | --- | --- |
| `i` | tax id | number |
| `n` | scientific name | string |
| `r` | NCBI rank | string |
| `p` | nearest kept ancestor's tax id, or null for a backbone root | number or null |
| `c` | tax ids of kept children | number[] |
| `s` | descendant nodes with rank "species" | number |

The frontend loader (`frontend/src/lib/sequences/taxonomy-backbone.ts`) maps
these to the full-word `BackboneNode` shape on load and caches the indexed result
(Cache API plus in-memory), mirroring the HMMER curated-database pattern.

## Backbone roots

The two true roots (nodes with no kept ancestor) are `cellular organisms`
(131567) and `Viruses` (10239). The three cellular domains (Bacteria 2, Archaea
2157, Eukaryota 2759) sit one level below, as children of `cellular organisms`,
because the allowlist keeps the "cellular root" and "acellular root" ranks.
