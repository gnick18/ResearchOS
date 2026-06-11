// @vitest-environment jsdom
//
// Live page-perception test (ai perception bot, 2026-06-11).
//
// Exercises the DOM walker against a jsdom fixture page. Covers accessible-name
// computation across the common labeling mechanisms, role resolution, visibility
// filtering (hidden elements excluded), ref minting and resolution, deduping, and
// the cap. jsdom does no layout, so the walker is run with hasLayout false, the
// same fallback the live wrapper would never hit but the test relies on.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, beforeEach } from "vitest";
import {
  perceiveDocument,
  resolveRef,
  resolveRole,
  accessibleName,
  isVisible,
} from "../page-perception";

function setBody(html: string): void {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("resolveRole", () => {
  it("reads implicit roles from tags", () => {
    setBody(`
      <button id="b">x</button>
      <a id="a" href="/x">link</a>
      <select id="s"></select>
      <input id="t" type="text" />
      <input id="c" type="checkbox" />
    `);
    expect(resolveRole(document.getElementById("b")!)).toBe("button");
    expect(resolveRole(document.getElementById("a")!)).toBe("link");
    expect(resolveRole(document.getElementById("s")!)).toBe("combobox");
    expect(resolveRole(document.getElementById("t")!)).toBe("textbox");
    expect(resolveRole(document.getElementById("c")!)).toBe("checkbox");
  });

  it("prefers an explicit role attribute", () => {
    setBody(`<div id="d" role="tab">Tab one</div>`);
    expect(resolveRole(document.getElementById("d")!)).toBe("tab");
  });

  it("returns null for a non-control element", () => {
    setBody(`<p id="p">just text</p>`);
    expect(resolveRole(document.getElementById("p")!)).toBeNull();
  });
});

describe("accessibleName", () => {
  it("prefers aria-label over text", () => {
    setBody(`<button id="b" aria-label="Add a method">+</button>`);
    expect(accessibleName(document.getElementById("b")!, document)).toBe(
      "Add a method",
    );
  });

  it("resolves aria-labelledby", () => {
    setBody(`
      <span id="lbl">Save changes</span>
      <button id="b" aria-labelledby="lbl"></button>
    `);
    expect(accessibleName(document.getElementById("b")!, document)).toBe(
      "Save changes",
    );
  });

  it("reads an associated label for a form field", () => {
    setBody(`
      <label for="name">Experiment name</label>
      <input id="name" type="text" />
    `);
    expect(accessibleName(document.getElementById("name")!, document)).toBe(
      "Experiment name",
    );
  });

  it("falls back to visible text for a button", () => {
    setBody(`<button id="b">+ New Method</button>`);
    expect(accessibleName(document.getElementById("b")!, document)).toBe(
      "+ New Method",
    );
  });

  it("falls back to placeholder for an unlabeled field", () => {
    setBody(`<input id="q" type="text" placeholder="Search methods" />`);
    expect(accessibleName(document.getElementById("q")!, document)).toBe(
      "Search methods",
    );
  });

  it("does not echo a text input's value as its name", () => {
    setBody(`<input id="q" type="text" value="typed text" />`);
    expect(accessibleName(document.getElementById("q")!, document)).toBe("");
  });
});

describe("isVisible", () => {
  it("excludes display:none", () => {
    setBody(`<button id="b" style="display:none">hidden</button>`);
    expect(isVisible(document.getElementById("b")!)).toBe(false);
  });

  it("excludes [hidden] and aria-hidden", () => {
    setBody(`
      <button id="h" hidden>a</button>
      <button id="ah" aria-hidden="true">b</button>
    `);
    expect(isVisible(document.getElementById("h")!)).toBe(false);
    expect(isVisible(document.getElementById("ah")!)).toBe(false);
  });

  it("excludes an element inside a display:none ancestor", () => {
    setBody(`<div style="display:none"><button id="b">a</button></div>`);
    expect(isVisible(document.getElementById("b")!)).toBe(false);
  });

  it("includes a plain visible button", () => {
    setBody(`<button id="b">a</button>`);
    expect(isVisible(document.getElementById("b")!)).toBe(true);
  });
});

describe("perceiveDocument", () => {
  it("returns visible interactive elements with names and refs", () => {
    setBody(`
      <h2>Methods</h2>
      <button>+ New Method</button>
      <a href="/templates">Template library</a>
      <input type="text" aria-label="Search" />
      <button style="display:none">Hidden action</button>
      <p>not a control</p>
    `);
    const els = perceiveDocument({ doc: document, hasLayout: false });
    const names = els.map((e) => e.name);
    expect(names).toContain("+ New Method");
    expect(names).toContain("Template library");
    expect(names).toContain("Search");
    expect(names).not.toContain("Hidden action");
    for (const e of els) {
      expect(e.ref).toMatch(/^bb-\d+$/);
      expect(e.role.length).toBeGreaterThan(0);
    }
  });

  it("excludes disabled controls", () => {
    setBody(`
      <button>Active</button>
      <button disabled>Disabled</button>
      <button aria-disabled="true">Aria disabled</button>
    `);
    const names = perceiveDocument({ doc: document, hasLayout: false }).map(
      (e) => e.name,
    );
    expect(names).toEqual(["Active"]);
  });

  it("dedupes identical name+role+hint controls", () => {
    setBody(`
      <button>Save</button>
      <button>Save</button>
    `);
    const els = perceiveDocument({ doc: document, hasLayout: false });
    expect(els.filter((e) => e.name === "Save").length).toBe(1);
  });

  it("attaches a section heading as a hint", () => {
    setBody(`
      <section><h3>My methods</h3><button>Edit</button></section>
    `);
    const el = perceiveDocument({ doc: document, hasLayout: false }).find(
      (e) => e.name === "Edit",
    );
    expect(el?.hint).toBe("My methods");
  });

  it("respects the cap", () => {
    const buttons = Array.from(
      { length: 10 },
      (_, i) => `<button>Action ${i}</button>`,
    ).join("");
    setBody(buttons);
    const els = perceiveDocument({ doc: document, hasLayout: false, max: 4 });
    expect(els.length).toBe(4);
  });
});

describe("resolveRef", () => {
  it("resolves a minted ref back to its live element", () => {
    setBody(`<button>+ New Method</button>`);
    const els = perceiveDocument({ doc: document, hasLayout: false });
    const ref = els[0].ref;
    const el = resolveRef(ref);
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el?.textContent).toBe("+ New Method");
  });

  it("returns null for an unknown ref", () => {
    setBody(`<button>x</button>`);
    perceiveDocument({ doc: document, hasLayout: false });
    expect(resolveRef("bb-does-not-exist")).toBeNull();
  });

  it("re-mints refs on each read so a stale ref does not resolve", () => {
    setBody(`<button>First</button>`);
    const firstRead = perceiveDocument({ doc: document, hasLayout: false });
    const staleRef = firstRead[0].ref;
    // Replace the page, then read again. The old element is gone.
    setBody(`<button>Second</button>`);
    perceiveDocument({ doc: document, hasLayout: false });
    expect(resolveRef(staleRef)).toBeNull();
  });
});
