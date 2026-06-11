#!/usr/bin/env python3
"""Extraction audit: compare each catalog method we extracted against its bundled
vendor source PDF, to surface where our extraction may have drifted.

WHAT THIS IS
  An internal QA aid (NOT an in-app feature, NOT a CI gate). For every catalog
  template that bundles a vendor source PDF (`source_pdf.bundled === true`), it
  pulls the CRITICAL structured values we extracted (temperatures, times,
  volumes, concentrations, cycle counts, instrument/column params, reagent
  names, ...) and checks whether each value literally appears in the vendor
  PDF's text. The output is a per-template drift report sorted worst-first.

  This is deterministic text extraction + string matching ONLY. There is no LLM
  and no network here, BY DESIGN: the whole point is to check our (LLM-assisted)
  extractions against the ground-truth vendor document with a dumb, auditable
  matcher we can trust.

HOW TO READ THE FLAGS  (READ THIS BEFORE TRUSTING A "NOT FOUND")
  A value reported NOT FOUND is a REVIEW FLAG, not proof of error. There are
  many benign reasons a real, correct value will not match literally:
    - The vendor states it differently (a table cell, "1.5", split across a line
      break, "ninety-five degrees", a figure/image, a value we converted units
      on, or a value we synthesized from "instrument default" / "per protocol").
    - pdfplumber mangles table whitespace, drops superscripts, or splits "10 6"
      out of "10^6".
    - We deliberately authored a sensible default the vendor leaves open.
  So treat NOT FOUND as "a human should glance at this", worst-first. A value
  reported FOUND is strong evidence the extraction matches the source.

  VALUES ARE SPLIT INTO TWO CONFIDENCE TIERS:
    [structured] = read from a typed payload field (gradient temp, scan m/z,
                   column length, ...). A NOT-FOUND here is the higher-signal
                   flag: these are the numbers a user actually runs.
    [free-text]  = mined from author prose (description / notes / markdown body).
                   These were written by us paraphrasing the vendor, so a
                   NOT-FOUND is usually just paraphrase, not drift. Reported but
                   de-weighted in the summary.

HOW TO RUN
  # one-time: throwaway venv (do NOT install into the repo or system Python)
  python3 -m venv /tmp/audit-venv
  /tmp/audit-venv/bin/pip install pdfplumber
  # then, from the repo root:
  /tmp/audit-venv/bin/python scripts/audit-kit-extraction.py
  # (plain `python3 scripts/audit-kit-extraction.py` also works if pdfplumber is
  #  importable; it degrades to a clear error otherwise.)

  Output is written to docs/audits/kit-extraction-audit.md and a one-line
  summary is printed to stdout. Reads only the committed PDFs under
  frontend/public/method-catalog/sources/. Offline.

  Optional: pass one or more slugs to audit just those, e.g.
  /tmp/audit-venv/bin/python scripts/audit-kit-extraction.py gotaq-qpcr biorad-iproof
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    sys.exit(
        "pdfplumber is not importable. Create a throwaway venv and use it:\n"
        "  python3 -m venv /tmp/audit-venv\n"
        "  /tmp/audit-venv/bin/pip install pdfplumber\n"
        "  /tmp/audit-venv/bin/python scripts/audit-kit-extraction.py"
    )

# ── Paths (resolved relative to the repo, so the script is location-independent)
SCRIPT = Path(__file__).resolve()
REPO = SCRIPT.parent.parent  # scripts/ -> repo root
CATALOG = REPO / "frontend/public/method-catalog"
TEMPLATES = CATALOG / "templates"
SOURCES = CATALOG / "sources"
REPORT = REPO / "docs/audits/kit-extraction-audit.md"


# ── PDF text extraction ───────────────────────────────────────────────────────
def extract_pdf_text(pdf_path: Path) -> str:
    """Concatenated text of every page. Tables/figures may mangle whitespace; the
    caller normalizes before matching."""
    parts: list[str] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            parts.append(page.extract_text() or "")
    return "\n".join(parts)


# ── Normalization ─────────────────────────────────────────────────────────────
# We build TWO normalized views of the PDF text:
#   norm_text  = unicode-folded, lowercased, single-spaced (keeps word order)
#   nospace    = norm_text with ALL whitespace removed (defeats "95 C" vs "95C"
#                vs a mid-token line break in a table cell)
# and we match a value if it appears in EITHER view, after the value itself is
# normalized the same way. nospace is the key trick for PDF tables.
_WS = re.compile(r"\s+")


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    # Fold common unicode the NFKD pass leaves behind.
    s = (
        s.replace("°", " ")  # degree sign -> space (so "95°C" -> "95 c")
        .replace("µ", "u")  # micro sign -> u   (µL -> ul)
        .replace("μ", "u")  # greek mu -> u
        .replace("–", "-")  # en dash
        .replace("—", "-")  # em dash
        .replace("−", "-")  # minus sign
        .replace("×", "x")  # times sign -> x
        .replace("′", "'")  # prime
    )
    s = s.lower()
    # Unit/word synonyms so structured units match however the vendor wrote them.
    # Order matters: longest first.
    repls = [
        ("microliters", "ul"),
        ("microliter", "ul"),
        ("microlitres", "ul"),
        ("microlitre", "ul"),
        ("milliliters", "ml"),
        ("milliliter", "ml"),
        ("seconds", "sec"),
        ("second", "sec"),
        ("minutes", "min"),
        ("minute", "min"),
        ("degrees", " "),
        ("degree", " "),
        ("º", " "),
    ]
    for a, b in repls:
        s = s.replace(a, b)
    s = _WS.sub(" ", s).strip()
    return s


def nospace(s: str) -> str:
    return re.sub(r"\s+", "", s)


# ── A single value to check ───────────────────────────────────────────────────
class Check:
    """One value we extracted, plus the candidate normalized strings any of which
    counts as a literal match in the PDF."""

    __slots__ = ("label", "candidates", "tier")

    def __init__(self, label: str, candidates: list[str], tier: str):
        self.label = label
        # Normalize candidates once; drop empties/dups, keep order.
        seen = set()
        self.candidates = []
        for c in candidates:
            n = normalize(c)
            if n and n not in seen:
                seen.add(n)
                self.candidates.append(n)
        self.tier = tier  # "structured" | "free-text"

    def found_in(self, norm_text: str, ns_text: str) -> bool:
        for c in self.candidates:
            if c in norm_text:
                return True
            cn = nospace(c)
            if len(cn) >= 2 and cn in ns_text:
                return True
        return False


# ── Value generators (the heart of the audit) ─────────────────────────────────
# Helpers that turn a raw numeric/unit value into the several literal forms a
# vendor might use, so a correct value isn't flagged just for formatting.

def _num_forms(n) -> list[str]:
    """Candidate spellings of a number: int without trailing .0, the float, and a
    comma-grouped form for thousands (PDFs often write '2,000')."""
    out: list[str] = []
    if isinstance(n, bool):
        return out
    if isinstance(n, (int, float)):
        if float(n).is_integer():
            i = int(n)
            out.append(str(i))
            if abs(i) >= 1000:
                out.append(f"{i:,}")  # 2000 -> 2,000
        else:
            out.append(repr(float(n)).rstrip("0").rstrip("."))
    else:
        out.append(str(n))
    return out


def _temp_forms(c) -> list[str]:
    """Temperature in C -> '95 c', '95c', plus bare number (degree sign already
    folded to space upstream)."""
    out: list[str] = []
    for nf in _num_forms(c):
        out += [f"{nf} c", f"{nf}c", nf]
    return out


_DUR_RE = re.compile(r"^\s*([\d.]+)\s*(sec|min|s|m|h|hr|hour|hours)\b", re.I)


def _duration_forms(text: str) -> list[str]:
    """Duration string like '15 sec' / '2 min' / '1 min' -> tolerant forms."""
    text = (text or "").strip()
    m = _DUR_RE.match(normalize(text))
    if not m:
        return [text] if text else []
    val, unit = m.group(1), m.group(2)
    unit = {"s": "sec", "m": "min", "hr": "h", "hour": "h", "hours": "h"}.get(unit, unit)
    out = [f"{val} {unit}", f"{val}{unit}"]
    if unit == "sec":
        out += [f"{val} s", f"{val}s"]
    if unit == "min":
        out += [f"{val} m", f"{val}min"]
    return out


def _amount_forms(text: str) -> list[str]:
    """A volume/amount string ('10', '0.2', 'to 20') -> number forms + with uL."""
    text = (text or "").strip()
    nums = re.findall(r"\d+\.?\d*", text)
    out: list[str] = []
    for n in nums:
        out += [n, f"{n} ul", f"{n}ul", f"{n} ml", f"{n}ml"]
    return out


def _name_core(name: str) -> str | None:
    """A reagent/ingredient/cell-line name, trimmed of our parenthetical asides
    and trailing qualifiers so the match is on the vendor's product term. Returns
    None if too generic/short to be a meaningful check."""
    name = (name or "").strip()
    # Drop our editorial parentheticals: "Forward primer (200 nM...)" -> "Forward primer"
    name = re.sub(r"\s*\([^)]*\)", "", name).strip()
    # Generic reagents that appear in every protocol -> skip (no signal).
    low = name.lower()
    generic = (
        "nuclease-free water",
        "water",
        "template dna",
        "forward primer",
        "reverse primer",
        "primer",
        "dntp",
        "dntps",
        "mgcl2",
        "any mammalian cell line",
    )
    if low in generic or len(name) < 4:
        return None
    return name


def checks_for_pcr(payload: dict) -> list[Check]:
    out: list[Check] = []
    g = payload.get("gradient") or {}
    # initial / final / hold step lists + cycle steps. `hold` is a single dict in
    # some templates and a list in others; coerce to a list of dicts either way.
    def _as_steps(v):
        if v is None:
            return []
        if isinstance(v, dict):
            return [v]
        return [s for s in v if isinstance(s, dict)]

    for phase in ("initial", "final", "hold"):
        for step in _as_steps(g.get(phase)):
            t = step.get("temperature")
            if isinstance(t, (int, float)):
                out.append(Check(f"gradient.{phase} temp {t} C", _temp_forms(t), "structured"))
            d = step.get("duration")
            dl = str(d).lower() if d else ""
            if d and "default" not in dl and "instrument" not in dl and "indef" not in dl:
                out.append(Check(f"gradient.{phase} duration '{d}'", _duration_forms(d), "structured"))
    for ci, cyc in enumerate(g.get("cycles") or []):
        if not isinstance(cyc, dict):
            continue
        rep = cyc.get("repeats")
        if isinstance(rep, int):
            out.append(
                Check(
                    f"gradient.cycles[{ci}] repeats {rep}",
                    [str(rep), f"{rep} cycles", f"{rep}cycles", f"{rep}x", f"x{rep}"],
                    "structured",
                )
            )
        for step in cyc.get("steps") or []:
            if not isinstance(step, dict):
                continue
            t = step.get("temperature")
            if isinstance(t, (int, float)):
                out.append(Check(f"cycle temp {t} C", _temp_forms(t), "structured"))
            d = step.get("duration")
            if d and "default" not in str(d).lower() and "indef" not in str(d).lower():
                out.append(Check(f"cycle duration '{d}'", _duration_forms(d), "structured"))
    for ing in payload.get("ingredients") or []:
        core = _name_core(ing.get("name", ""))
        if core:
            out.append(Check(f"ingredient name '{core}'", [core], "structured"))
        conc = ing.get("concentration")
        if conc and conc not in ("-", ""):
            nums = re.findall(r"\d+\.?\d*\s*(?:x|nm|um|mm|m|%|mg|ug)?", str(conc), re.I)
            if nums:
                out.append(Check(f"ingredient conc '{conc}'", [str(conc)] + nums, "structured"))
    return out


def checks_for_lc_gradient(payload: dict) -> list[Check]:
    out: list[Check] = []
    for i, st in enumerate(payload.get("gradient_steps") or []):
        for key, suff in (("time_min", "min"), ("percent_b", "%b"), ("percent_a", "%a")):
            v = st.get(key)
            if isinstance(v, (int, float)):
                forms = _num_forms(v)
                if "%" in suff:
                    forms += [f"{n}%" for n in _num_forms(v)] + [f"{n} %" for n in _num_forms(v)]
                out.append(Check(f"gradient_steps[{i}].{key}={v}", forms, "structured"))
    col = payload.get("column") or {}
    if col.get("model"):
        # column model can carry our parentheticals; check the core product term
        core = re.sub(r"\s*\([^)]*\)", "", str(col["model"])).strip()
        out.append(Check(f"column model '{core}'", [core], "structured"))
    for key, unit, mul in (
        ("length_mm", "mm", 1),
        ("inner_diameter_mm", "mm", 1),
        ("particle_size_um", "um", 1),
    ):
        v = col.get(key)
        if isinstance(v, (int, float)):
            forms = _num_forms(v)
            # i.d. is often quoted in um in the PDF (0.075 mm == 75 um); length in cm.
            if key == "inner_diameter_mm":
                forms += _num_forms(v * 1000) + [f"{n} um" for n in _num_forms(v * 1000)]
            if key == "length_mm":
                forms += _num_forms(v / 10) + [f"{n} cm" for n in _num_forms(v / 10)]
            out.append(Check(f"column.{key}={v}", forms, "structured"))
    w = payload.get("detection_wavelength_nm")
    if isinstance(w, (int, float)):
        out.append(Check(f"detection_wavelength_nm={w}", _num_forms(w) + [f"{w} nm", f"{w}nm"], "structured"))
    for ing in payload.get("ingredients") or []:
        core = _name_core(ing.get("name", ""))
        if core:
            out.append(Check(f"solvent name '{core}'", [core], "structured"))
    return out


def checks_for_mass_spec(payload: dict) -> list[Check]:
    out: list[Check] = []
    if payload.get("instrument"):
        core = re.sub(r"\s*\([^)]*\)", "", str(payload["instrument"])).strip()
        out.append(Check(f"instrument '{core}'", [core], "structured"))
    src = payload.get("source") or {}
    for key, unit in (
        ("source_temp_c", "c"),
        ("capillary_kv", "kv"),
        ("nebulizer_gas_lpm", ""),
        ("drying_gas_lpm", ""),
        ("drying_gas_temp_c", "c"),
        ("ei_energy_ev", "ev"),
        ("maldi_laser_nm", "nm"),
    ):
        v = src.get(key)
        if isinstance(v, (int, float)):
            forms = _num_forms(v)
            if unit:
                forms += [f"{n} {unit}" for n in _num_forms(v)] + [f"{n}{unit}" for n in _num_forms(v)]
            out.append(Check(f"source.{key}={v}", forms, "structured"))
    scan = payload.get("scan") or {}
    for key, unit in (
        ("scan_mz_low", ""),
        ("scan_mz_high", ""),
        ("scan_rate_hz", "hz"),
        ("resolution_r", ""),
        ("msms_isolation_window_mz", ""),
        ("msms_collision_energy_ev", "ev"),
    ):
        v = scan.get(key)
        if isinstance(v, (int, float)):
            forms = _num_forms(v)
            if unit:
                forms += [f"{n} {unit}" for n in _num_forms(v)]
            out.append(Check(f"scan.{key}={v}", forms, "structured"))
    cal = payload.get("calibration") or {}
    if cal.get("reference_standard"):
        out.append(Check(f"calibration.reference_standard", [str(cal["reference_standard"])], "structured"))
    return out


def checks_for_cell_culture(payload: dict) -> list[Check]:
    out: list[Check] = []
    cl = payload.get("cell_line") or {}
    core = _name_core(cl.get("name", ""))
    if core:
        out.append(Check(f"cell_line.name '{core}'", [core], "structured"))
    media = payload.get("media") or {}
    if media.get("serum_percent") is not None and isinstance(media.get("serum_percent"), (int, float)):
        sp = media["serum_percent"]
        out.append(Check(f"media.serum_percent={sp}", _num_forms(sp) + [f"{n}%" for n in _num_forms(sp)], "structured"))
    for sup in media.get("supplements") or []:
        nm = _name_core(sup.get("name", ""))
        if nm:
            out.append(Check(f"supplement '{nm}'", [nm], "structured"))
        conc = sup.get("concentration")
        units = sup.get("units") or ""
        if conc not in (None, "", "-"):
            nums = re.findall(r"\d+\.?\d*", str(conc))
            forms = [str(conc)] + nums + [f"{n}{units}" for n in nums] + [f"{n} {units}" for n in nums]
            out.append(Check(f"supplement conc '{conc} {units}'", forms, "structured"))
    return out


def checks_for_plate(payload: dict) -> list[Check]:
    out: list[Check] = []
    sz = payload.get("plate_size")
    if isinstance(sz, int):
        out.append(Check(f"plate_size={sz}", [f"{sz}-well", f"{sz} well", str(sz)], "structured"))
    # The substantive plate values live in region notes (volumes, temps, times,
    # wavelengths, concentrations). Mine numbers-with-units from those notes as
    # free-text-tier (they are our prose paraphrase of the vendor procedure).
    for r in payload.get("region_labels") or []:
        notes = r.get("notes") or ""
        for ch in _mine_value_tokens(notes, "plate region note", tier="free-text"):
            out.append(ch)
    return out


# ── Free-text value mining (markdown body + notes + descriptions) ─────────────
# Pull numeric-with-unit tokens and a few catalog-number-shaped tokens. These
# are author prose, so reported at the lower-signal "free-text" tier.
_VALUE_TOKEN_RE = re.compile(
    r"""
    (?<![A-Za-z0-9])
    (
        \d+(?:\.\d+)?\s*(?:°\s*c|c\b|sec\b|min\b|h\b|hr\b|hours?\b|
            ul\b|µl\b|ml\b|nm\b|nM\b|uM\b|µM\b|mM\b|mg\b|ug\b|µg\b|
            %|x\b|rpm\b|g\b|kv\b|v\b|bp\b|kb\b)
    )
    """,
    re.X | re.I,
)


def _mine_value_tokens(text: str, label_prefix: str, tier: str) -> list[Check]:
    out: list[Check] = []
    if not text:
        return out
    seen = set()
    for m in _VALUE_TOKEN_RE.finditer(text):
        raw = m.group(1).strip()
        key = normalize(raw)
        if not key or key in seen:
            continue
        seen.add(key)
        # Build tolerant forms: spaced + unspaced + bare number.
        num = re.match(r"[\d.]+", raw)
        forms = [raw]
        if num:
            forms.append(num.group(0))
        out.append(Check(f"{label_prefix}: '{raw}'", forms, tier))
    return out


def checks_for_markdown(payload: dict) -> list[Check]:
    body = payload.get("body") or ""
    return _mine_value_tokens(body, "markdown body value", tier="free-text")


def free_text_checks(template: dict) -> list[Check]:
    """description + payload.notes mined as free-text tier (applies to all types)."""
    out: list[Check] = []
    desc = template.get("description") or ""
    out += _mine_value_tokens(desc, "card description value", tier="free-text")
    notes = (template.get("payload") or {}).get("notes")
    if isinstance(notes, str):
        out += _mine_value_tokens(notes, "payload.notes value", tier="free-text")
    # lc_gradient also carries a payload.description
    pdesc = (template.get("payload") or {}).get("description")
    if isinstance(pdesc, str):
        out += _mine_value_tokens(pdesc, "payload.description value", tier="free-text")
    return out


TYPE_DISPATCH = {
    "pcr": checks_for_pcr,
    "lc_gradient": checks_for_lc_gradient,
    "mass_spec": checks_for_mass_spec,
    "cell_culture": checks_for_cell_culture,
    "plate": checks_for_plate,
    "markdown": checks_for_markdown,
}


def dedupe_checks(checks: list[Check]) -> list[Check]:
    """Collapse checks whose candidate-set is identical (the same value mined from
    both a structured field and prose), keeping the higher-signal tier."""
    by_key: dict[tuple, Check] = {}
    for ch in checks:
        key = tuple(sorted(ch.candidates))
        if not key:
            continue
        prev = by_key.get(key)
        if prev is None:
            by_key[key] = ch
        elif prev.tier == "free-text" and ch.tier == "structured":
            by_key[key] = ch  # upgrade tier
    return list(by_key.values())


# ── Per-template audit ────────────────────────────────────────────────────────
class Result:
    def __init__(self, slug, title, method_type):
        self.slug = slug
        self.title = title
        self.method_type = method_type
        self.struct_total = 0
        self.struct_found = 0
        self.free_total = 0
        self.free_found = 0
        self.missing_structured: list[str] = []
        self.missing_free: list[str] = []
        self.error: str | None = None

    @property
    def struct_miss(self):
        return self.struct_total - self.struct_found

    def score(self):
        # worst-first ranking: structured misses dominate, then free misses.
        return (-self.struct_miss, -(self.free_total - self.free_found))


def audit_template(tpl_path: Path) -> Result | None:
    tpl = json.loads(tpl_path.read_text(encoding="utf-8"))
    sp = tpl.get("source_pdf") or {}
    if not sp.get("bundled"):
        return None
    slug = tpl.get("slug") or tpl_path.stem
    res = Result(slug, tpl.get("title", slug), tpl.get("method_type", "?"))
    pdf_path = SOURCES / f"{slug}.pdf"
    if not pdf_path.exists():
        res.error = f"bundled source PDF missing on disk: {pdf_path.name}"
        return res
    try:
        raw = extract_pdf_text(pdf_path)
    except Exception as e:  # noqa: BLE001 - report, do not crash the run
        res.error = f"PDF text extraction failed: {e}"
        return res
    norm_text = normalize(raw)
    ns_text = nospace(norm_text)

    gen = TYPE_DISPATCH.get(res.method_type)
    checks: list[Check] = []
    if gen:
        checks += gen(tpl.get("payload") or {})
    checks += free_text_checks(tpl)
    checks = dedupe_checks(checks)

    for ch in checks:
        ok = ch.found_in(norm_text, ns_text)
        if ch.tier == "structured":
            res.struct_total += 1
            if ok:
                res.struct_found += 1
            else:
                res.missing_structured.append(ch.label)
        else:
            res.free_total += 1
            if ok:
                res.free_found += 1
            else:
                res.missing_free.append(ch.label)
    return res


# ── Report ────────────────────────────────────────────────────────────────────
def write_report(results: list[Result]) -> str:
    results_sorted = sorted(results, key=lambda r: r.score())
    n = len(results)
    errored = [r for r in results if r.error]
    clean = [r for r in results if not r.error and r.struct_miss == 0 and not r.missing_free]
    struct_clean = [r for r in results if not r.error and r.struct_miss == 0]
    flagged = [r for r in results if not r.error and (r.struct_miss > 0 or r.missing_free)]

    tot_struct = sum(r.struct_total for r in results)
    found_struct = sum(r.struct_found for r in results)
    tot_free = sum(r.free_total for r in results)
    found_free = sum(r.free_found for r in results)

    L: list[str] = []
    L.append("# Kit extraction audit\n")
    L.append(
        "_Auto-generated by `scripts/audit-kit-extraction.py`. Re-run after any "
        "template or source-PDF change. This is a human-review aid, NOT a pass/fail "
        "gate._\n"
    )
    L.append("## How to read this\n")
    L.append(
        "For every catalog template that bundles a vendor source PDF, this checks "
        "whether the CRITICAL values we extracted appear literally in the vendor "
        "PDF's text (deterministic string matching, no LLM, no network).\n"
    )
    L.append(
        "- A value listed under **Review (structured)** is the higher-signal flag: "
        "it was read from a typed payload field (a temperature, time, m/z, column "
        "spec, reagent name) and was NOT found in the PDF text.\n"
        "- A value listed under **Review (free-text)** was mined from our own prose "
        "(card description / notes / markdown body). A miss there is usually just "
        "paraphrase, not drift.\n"
        "- **NOT FOUND is a REVIEW FLAG, not proof of error.** PDF tables mangle "
        "whitespace, vendors phrase values differently, some values are figures or "
        "deliberate authored defaults, and unit conversions won't match literally. "
        "Confirm against the actual PDF before changing anything.\n"
    )
    L.append("## Top-line summary\n")
    L.append(f"- Templates audited (bundled source PDF): **{n}**")
    L.append(f"- Fully clean (every structured AND free-text value found): **{len(clean)}**")
    L.append(f"- Clean on structured values (the ones that matter most): **{len(struct_clean)}**")
    L.append(f"- Flagged for review (>=1 value not found): **{len(flagged)}**")
    L.append(f"- Errored (PDF missing / unreadable): **{len(errored)}**")
    sp_pct = (100 * found_struct / tot_struct) if tot_struct else 100.0
    fp_pct = (100 * found_free / tot_free) if tot_free else 100.0
    L.append(
        f"- Structured values matched: **{found_struct}/{tot_struct}** ({sp_pct:.0f}%)"
    )
    L.append(
        f"- Free-text values matched: **{found_free}/{tot_free}** ({fp_pct:.0f}%)\n"
    )

    if errored:
        L.append("## Errors\n")
        for r in errored:
            L.append(f"- `{r.slug}` ({r.method_type}): {r.error}")
        L.append("")

    L.append("## Per-template (worst-first)\n")
    for r in results_sorted:
        if r.error:
            L.append(f"### `{r.slug}` - {r.title}\n")
            L.append(f"- method_type: `{r.method_type}`")
            L.append(f"- **ERROR**: {r.error}\n")
            continue
        flag = ""
        if r.struct_miss > 0:
            flag = " FLAGGED (structured)"
        elif r.missing_free:
            flag = " review (free-text only)"
        else:
            flag = " clean"
        L.append(f"### `{r.slug}` - {r.title}{flag}\n")
        L.append(f"- method_type: `{r.method_type}`")
        L.append(
            f"- structured: {r.struct_found}/{r.struct_total} found"
            f" | free-text: {r.free_found}/{r.free_total} found"
        )
        if r.missing_structured:
            L.append(f"- **Review (structured), {len(r.missing_structured)}:**")
            for m in r.missing_structured:
                L.append(f"    - {m}")
        if r.missing_free:
            L.append(f"- Review (free-text), {len(r.missing_free)}:")
            for m in r.missing_free:
                L.append(f"    - {m}")
        L.append("")

    text = "\n".join(L) + "\n"
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(text, encoding="utf-8")
    return (
        f"{n} templates audited | {len(clean)} fully clean, "
        f"{len(struct_clean)} structured-clean, {len(flagged)} flagged, "
        f"{len(errored)} errored | structured {found_struct}/{tot_struct} "
        f"({sp_pct:.0f}%), free-text {found_free}/{tot_free} ({fp_pct:.0f}%)"
    )


def main():
    only = set(sys.argv[1:])
    results: list[Result] = []
    for tpl_path in sorted(TEMPLATES.glob("*.json")):
        if only and tpl_path.stem not in only:
            continue
        r = audit_template(tpl_path)
        if r is not None:
            results.append(r)
    if not results:
        sys.exit("No bundled templates found to audit (check the slugs/paths).")
    summary = write_report(results)
    print(summary)
    print(f"Report: {REPORT}")


if __name__ == "__main__":
    main()
