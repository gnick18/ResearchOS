#!/usr/bin/env python3
"""Bundle 15 verified vendor PDFs into the method-catalog templates as their
source_pdf, mirroring the proven FastStart pattern.

FastStart pattern (frontend/public/method-catalog/templates/roche-faststart-taq.json):
  - source_pdf is an object: { bundled: bool, filename: str, source_url: str, sha256: str }
  - The disk file lives at sources/<slug>.pdf (resolved BY SLUG CONVENTION by the
    loader, NOT by the filename field). filename keeps the ORIGINAL vendor name as
    provenance only.
  - sha256 == the raw-file sha256 == the git-LFS oid.
  - There is NO source_pdf_path in catalog templates (that is runtime-derived into
    the user data folder by copyBundledSourcePdf).
  - The manifest entry mirrors the template's top fields + source_pdf.

This script copies each drop PDF to sources/<slug>.pdf (per-slug, so a dual-target
PDF is copied to BOTH slug names so each template is self-contained), computes the
sha256, and writes source_pdf into both the template JSON and its manifest entry.

Template JSONs use a mix of compact inline arrays and multi-line blocks, so the
template edit is a SURGICAL TEXT INSERT of the source_pdf block immediately before
the top-level "payload": line (preserving all existing formatting). The manifest
round-trips byte-identical through json.dump(indent=2), so it is rewritten via the
JSON serializer.

Run with --check to print a plan without writing.
"""
import hashlib
import json
import shutil
import sys
from collections import OrderedDict
from pathlib import Path

WT = Path("/Users/gnickles/Desktop/ResearchOS/.claude/worktrees/agent-a02c791144ffe8e88")
DROP = Path("/Users/gnickles/Desktop/kit-pdfs-drop")
CATALOG = WT / "frontend/public/method-catalog"
TEMPLATES = CATALOG / "templates"
SOURCES = CATALOG / "sources"
MANIFEST = CATALOG / "manifest.json"

# drop-filename -> (source_url, [target slugs])
PLAN = [
    ("10031339.pdf",
     "https://www.bio-rad.com/webroot/web/pdf/lsr/literature/10031339.pdf",
     ["ssoadvanced-sybr-qpcr"]),
    ("bulletin-10031340.pdf",
     "https://www.bio-rad.com/webroot/web/pdf/lsr/literature/bulletin-10031340.pdf",
     ["ssoadvanced-probes-qpcr"]),
    ("10000068167.pdf",
     "https://www.bio-rad.com/webroot/web/pdf/lsr/literature/10000068167.pdf",
     ["itaq-sybr-qpcr"]),
    ("10014647A.pdf",
     "https://www.bio-rad.com/webroot/web/pdf/lsr/literature/10014647A.pdf",
     ["ssofast-evagreen-qpcr"]),
    ("10002298B.pdf",
     "https://www.bio-rad.com/webroot/web/pdf/lsr/literature/10002298B.pdf",
     ["biorad-iproof"]),
    ("4106202B.pdf",
     "https://www.bio-rad.com/webroot/web/pdf/lsr/literature/4106202B.pdf",
     ["biorad-itaq"]),
    ("Bulletin_2423.pdf",
     "https://www.bio-rad.com/webroot/web/pdf/lsr/literature/Bulletin_2423.pdf",
     ["sds-page-coomassie"]),
    ("AN-656-LC-MSn-Metabolomics-AN64832-EN.pdf",
     "https://assets.thermofisher.com/TFS-Assets/CMD/Application-Notes/AN-656-LC-MSn-Metabolomics-AN64832-EN.pdf",
     ["lcms-metabolite-hilic-lc-thermo", "lcms-metabolite-ms-thermo-qexactive"]),
    ("AN-21550-LC-EASY-Spray-Acclaim-PepMap-C18-75cm-Column-AN21550-EN.pdf",
     "https://assets.thermofisher.com/TFS-Assets/CMD/Application-Notes/AN-21550-LC-EASY-Spray-Acclaim-PepMap-C18-75cm-Column-AN21550-EN.pdf",
     ["lcms-peptide-ms-thermo-orbitrap", "lcms-peptide-rp-lc-thermo"]),
    ("an-73885-lc-ms-characterization-mabs-native-denaturing-an73885-en.pdf",
     "https://documents.thermofisher.com/TFS-Assets/CMD/Application-Notes/an-73885-lc-ms-characterization-mabs-native-denaturing-an73885-en.pdf",
     ["lcms-intact-protein-ms-thermo-exploris", "lcms-intact-protein-rp-lc-thermo"]),
    ("Qubit_dsDNA_HS_Assay_UG.pdf",
     "https://documents.thermofisher.com/TFS-Assets/LSG/manuals/Qubit_dsDNA_HS_Assay_UG.pdf",
     ["qubit-dsdna-hs-assay"]),
    ("animal-cell-culture-guide.pdf",
     "https://www.atcc.org/-/media/resources/culture-guides/animal-cell-culture-guide.pdf",
     ["cryopreservation-freezing", "thaw-cryopreserved-cells"]),
    ("taqkb.pdf",
     "https://www.sigmaaldrich.com/deepweb/assets/sigmaaldrich/product/documents/272/232/taqkb.pdf",
     ["kapa-taq"]),
    ("2grkb.pdf",
     "https://www.sigmaaldrich.com/deepweb/assets/sigmaaldrich/product/documents/150/359/2grkb.pdf",
     ["kapa2g-robust"]),
    ("TopTaq-PCR-Handbook.pdf",
     "https://www.qiagen.com/en-US/resources/download/KitHandbook/en-toptaq-pcr-handbook",
     ["qiagen-toptaq"]),
]


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def is_pdf(path: Path) -> bool:
    with open(path, "rb") as f:
        return f.read(5) == b"%PDF-"


def source_pdf_block(filename: str, url: str, sha: str) -> str:
    """Render the multi-line source_pdf block at 2-space top-level indent, byte
    -shape-identical to FastStart (2-space outer, 4-space inner keys)."""
    return (
        '  "source_pdf": {\n'
        '    "bundled": true,\n'
        f'    "filename": {json.dumps(filename)},\n'
        f'    "source_url": {json.dumps(url)},\n'
        f'    "sha256": {json.dumps(sha)}\n'
        '  },\n'
    )


def insert_into_template(text: str, slug: str, block: str) -> str:
    """Insert the source_pdf block on its own lines immediately before the
    top-level "payload": line. Idempotent guard: refuse if source_pdf already
    present."""
    if '"source_pdf"' in text:
        raise SystemExit(f"FATAL: {slug} already has a source_pdf block")
    lines = text.splitlines(keepends=True)
    # The top-level payload line is exactly two-space indented.
    target = '  "payload":'
    idx = None
    for i, ln in enumerate(lines):
        if ln.startswith(target):
            idx = i
            break
    if idx is None:
        raise SystemExit(f"FATAL: {slug} has no top-level payload line to anchor on")
    lines.insert(idx, block)
    return "".join(lines)


def insert_source_pdf_manifest(entry: "OrderedDict", source_pdf: "OrderedDict") -> "OrderedDict":
    """Insert source_pdf after tags (mirroring FastStart's manifest entry)."""
    new = OrderedDict()
    inserted = False
    for k, v in entry.items():
        new[k] = v
        if k == "tags" and not inserted:
            new["source_pdf"] = source_pdf
            inserted = True
    if not inserted:
        new["source_pdf"] = source_pdf
    return new


def main():
    check_only = "--check" in sys.argv
    bundles = []  # (slug, drop_filename, url, sha)
    seen_slugs = []
    for drop_name, url, slugs in PLAN:
        src = DROP / drop_name
        if not src.exists():
            raise SystemExit(f"FATAL: missing drop PDF {src}")
        if not is_pdf(src):
            raise SystemExit(f"FATAL: not a PDF (no %PDF- magic): {src}")
        sha = sha256_of(src)
        for slug in slugs:
            tpl = TEMPLATES / f"{slug}.json"
            if not tpl.exists():
                raise SystemExit(f"FATAL: template file missing for slug {slug}: {tpl}")
            bundles.append((slug, drop_name, url, sha))
            seen_slugs.append(slug)

    if len(set(seen_slugs)) != len(seen_slugs):
        dupes = sorted({s for s in seen_slugs if seen_slugs.count(s) > 1})
        raise SystemExit(f"FATAL: duplicate target slug(s): {dupes}")

    print(f"Plan: {len(PLAN)} drop PDFs -> {len(bundles)} template bundles")
    for slug, drop_name, url, sha in bundles:
        print(f"  {slug:42} <- {drop_name:60} sha={sha[:12]}")

    if check_only:
        print("\n--check: no files written.")
        return

    # 1. Copy each PDF to sources/<slug>.pdf and verify the copy sha.
    for slug, drop_name, url, sha in bundles:
        dst = SOURCES / f"{slug}.pdf"
        shutil.copyfile(DROP / drop_name, dst)
        assert sha256_of(dst) == sha, f"copy sha mismatch for {slug}"
    print(f"\nCopied {len(bundles)} PDFs into {SOURCES}")

    # 2. Surgical text insert into each template JSON, then JSON-validate.
    for slug, drop_name, url, sha in bundles:
        tpl_path = TEMPLATES / f"{slug}.json"
        text = tpl_path.read_text(encoding="utf-8")
        block = source_pdf_block(drop_name, url, sha)
        new_text = insert_into_template(text, slug, block)
        parsed = json.loads(new_text)  # validate
        sp = parsed.get("source_pdf")
        assert sp == {
            "bundled": True,
            "filename": drop_name,
            "source_url": url,
            "sha256": sha,
        }, f"source_pdf shape mismatch for {slug}: {sp}"
        tpl_path.write_text(new_text, encoding="utf-8")
    print(f"Updated {len(bundles)} template JSON files (surgical insert)")

    # 3. Manifest (round-trips byte-identical through json.dump(indent=2)).
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f, object_pairs_hook=OrderedDict)
    by_slug = {b[0]: b for b in bundles}
    updated = 0
    new_templates = []
    for entry in manifest["templates"]:
        slug = entry.get("slug")
        if slug in by_slug:
            _, drop_name, url, sha = by_slug[slug]
            source_pdf = OrderedDict(
                [("bundled", True), ("filename", drop_name), ("source_url", url), ("sha256", sha)]
            )
            entry = insert_source_pdf_manifest(entry, source_pdf)
            updated += 1
        new_templates.append(entry)
    manifest["templates"] = new_templates
    if updated != len(bundles):
        raise SystemExit(f"FATAL: manifest updated {updated}, expected {len(bundles)}")
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"Updated {updated} manifest entries")
    print("DONE")


if __name__ == "__main__":
    main()
