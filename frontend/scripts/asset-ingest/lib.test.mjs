// Unit tests for the ingest lib. Run: `node --test scripts/asset-ingest/lib.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLicense, formatCredit, sanitizeSvg } from "./lib.mjs";

test("classifyLicense: allowed set", () => {
  for (const [s, id] of [
    ["https://creativecommons.org/publicdomain/zero/1.0/", "CC0"],
    ["https://creativecommons.org/licenses/by/4.0/", "CC-BY"],
    ["https://creativecommons.org/licenses/by-sa/4.0/", "CC-BY-SA"],
    ["Public Domain", "Public Domain"],
  ]) {
    const r = classifyLicense(s);
    assert.equal(r.id, id, s);
    assert.equal(r.allowed, true, s);
  }
  // attribution flags
  assert.equal(classifyLicense("CC-BY").attribution, true);
  assert.equal(classifyLicense("CC0").attribution, false);
  assert.equal(classifyLicense("Public Domain").attribution, false);
});

test("classifyLicense: BioIcons tags (hyphen cc-0 + permissive code licenses)", () => {
  // BioIcons license values are lowercase path tags.
  assert.deepEqual(classifyLicense("cc-0"), { id: "CC0", allowed: true, attribution: false });
  assert.equal(classifyLicense("cc-by").id, "CC-BY");
  assert.equal(classifyLicense("cc-by-sa").id, "CC-BY-SA");
  // MIT/BSD: allowed, but retain the notice -> attribution true.
  assert.deepEqual(classifyLicense("mit"), { id: "MIT", allowed: true, attribution: true });
  assert.deepEqual(classifyLicense("bsd"), { id: "BSD", allowed: true, attribution: true });
});

test("classifyLicense: excluded NC / ND", () => {
  for (const s of [
    "https://creativecommons.org/licenses/by-nc/4.0/",
    "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    "https://creativecommons.org/licenses/by-nc-nd/4.0/",
    "https://creativecommons.org/licenses/by-nd/4.0/",
    "some unknown thing",
  ]) {
    assert.equal(classifyLicense(s).allowed, false, s);
  }
});

test("formatCredit: per-source format", () => {
  const c = formatCredit({
    source: "phylopic",
    title: "Strix aluco",
    creator: "T. Michael Keesey",
    license: "CC-BY",
    sourceUrl: "https://www.phylopic.org/images/abc",
  });
  assert.match(c, /Strix aluco by T\. Michael Keesey/);
  assert.match(c, /PhyloPic/);
  assert.match(c, /\(CC-BY\)/);

  // Reactome Icon Library credits the icon designer (CC BY 4.0 requires attribution).
  const r = formatCredit({
    source: "reactome",
    title: "Mitochondrial protein",
    creator: "Cristoffer Sevilla",
    license: "CC-BY",
    sourceUrl: "https://reactome.org/content/detail/R-ICO-013019",
  });
  assert.match(r, /Mitochondrial protein by Cristoffer Sevilla/);
  assert.match(r, /Reactome Icon Library/);
  assert.match(r, /\(CC-BY\)/);

  // Health Icons are MIT; courtesy credit retains the project notice.
  const h = formatCredit({
    source: "healthicons",
    title: "lungs",
    creator: "Resolve to Save Lives",
    license: "MIT",
    sourceUrl: "https://healthicons.org/icons/lungs",
  });
  assert.match(h, /Health Icons by Resolve to Save Lives/);
  assert.match(h, /\(MIT\)/);
});

test("sanitizeSvg: strips scripts/handlers, keeps fills + viewBox", () => {
  const dirty =
    '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">' +
    '<script>alert(1)</script>' +
    '<path d="M0 0h10v10H0z" fill="#ff0000" onclick="evil()"/>' +
    '<circle cx="5" cy="5" r="3" fill="#00ff00"/></svg>';
  const { svg, fills, hasViewBox } = sanitizeSvg(dirty);
  assert.ok(!/<script/i.test(svg), "script removed");
  assert.ok(!/onclick/i.test(svg), "handler removed");
  assert.ok(/fill="#ff0000"/.test(svg) && /fill="#00ff00"/.test(svg), "fills preserved");
  assert.equal(fills, 2, "two distinct fills counted (per-fill recolor ready)");
  assert.equal(hasViewBox, true);
});

test("sanitizeSvg: neutralizes external href but keeps internal #refs", () => {
  const s =
    '<svg viewBox="0 0 1 1"><a href="https://evil.test">x</a>' +
    '<use href="#frag"/><rect fill="url(#grad)"/></svg>';
  const { svg } = sanitizeSvg(s);
  assert.ok(!/evil\.test/.test(svg), "external href neutralized");
  assert.ok(/href="#frag"/.test(svg), "internal #ref kept");
  assert.ok(/url\(#grad\)/.test(svg), "gradient ref kept");
});
