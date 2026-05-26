/**
 * Tests for the wiki search index builder. Runs under Node's built-in
 * test runner so it matches the other scripts/ tests:
 *
 *   node --test scripts/lib/__tests__/wiki-search-index.test.mjs
 *
 * Two concerns:
 *
 *   1. The TSX → content extractor handles the wiki's house-style markup:
 *      <WikiPage title="..." intro="..."> wrapper, <h2>/<h3> headings,
 *      <p>/<li> paragraphs and list items, <Callout title="..."> with body
 *      children, <Step> wrappers, fragment shorthand <></>, and `&apos;`
 *      style HTML entities. Code blocks and import statements should not
 *      leak into the index.
 *
 *   2. The href → category derivation matches the WIKI_NAV top-level
 *      sections (features / getting-started / shared-lab-accounts /
 *      integrations / security), with `quickstart` for the landing page.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  extractPageContent,
  fallbackTitleFromHref,
  deriveCategoryId,
} from "../../build-wiki-search-index.mjs";

describe("extractPageContent", () => {
  test("pulls WikiPage title prop, intro, headings, paragraphs, and list items", () => {
    const tsx = `
      import WikiPage from "@/components/wiki/WikiPage";
      import Callout from "@/components/wiki/Callout";

      export default function Page() {
        return (
          <WikiPage
            title="Lab Head"
            intro="A Lab Head is a per-user role that unlocks the Lab Overview."
          >
            <h2>What it is</h2>
            <p>The role gates the soft-write queue.</p>
            <ul>
              <li>Approve purchases</li>
              <li>Assign tasks</li>
            </ul>
          </WikiPage>
        );
      }
    `;
    const content = extractPageContent(tsx);
    assert.equal(content.titleProp, "Lab Head");
    assert.ok(content.bodySnippets.some((s) => s.includes("Lab Head is a per-user role")));
    assert.ok(content.headings.includes("What it is"));
    assert.ok(content.bodySnippets.some((s) => s.includes("soft-write queue")));
    assert.ok(content.bodySnippets.includes("Approve purchases"));
    assert.ok(content.bodySnippets.includes("Assign tasks"));
  });

  test("decodes HTML entities like &apos; and &ldquo;", () => {
    const tsx = `
      <WikiPage>
        <p>It&apos;s the &ldquo;canonical&rdquo; place.</p>
      </WikiPage>
    `;
    const content = extractPageContent(tsx);
    const joined = content.bodySnippets.join(" | ");
    assert.ok(joined.includes("It's the"));
    assert.ok(joined.includes('"canonical"'));
  });

  test("captures Callout title (as heading) and Callout body (as snippet)", () => {
    const tsx = `
      <WikiPage>
        <Callout variant="info" title="Heads up">
          <p>Sharing the folder means sharing the data.</p>
        </Callout>
      </WikiPage>
    `;
    const content = extractPageContent(tsx);
    assert.ok(content.headings.includes("Heads up"));
    assert.ok(
      content.bodySnippets.some((s) => s.includes("Sharing the folder means sharing the data")),
    );
  });

  test("captures Step body text", () => {
    const tsx = `
      <WikiPage>
        <Steps>
          <Step>Click the New Event button.</Step>
          <Step>Pick a start time.</Step>
        </Steps>
      </WikiPage>
    `;
    const content = extractPageContent(tsx);
    assert.ok(
      content.bodySnippets.some((s) => s.includes("Click the New Event button")),
    );
    assert.ok(content.bodySnippets.some((s) => s.includes("Pick a start time")));
  });

  test("strips imports and <code>/<pre> contents from body text", () => {
    const tsx = `
      import WikiPage from "@/components/wiki/WikiPage";

      <WikiPage>
        <p>Visit <code>/api/calendar-feed</code> to see the proxy.</p>
        <pre><code>{"verbose code block"}</code></pre>
      </WikiPage>
    `;
    const content = extractPageContent(tsx);
    const all = content.bodySnippets.join(" ");
    // Import path should not appear in any snippet
    assert.ok(!all.includes("WikiPage from"));
    // Code-block content should not appear
    assert.ok(!all.includes("verbose code block"));
    assert.ok(!all.includes("/api/calendar-feed"));
    // But the surrounding paragraph text should
    assert.ok(all.includes("Visit") && all.includes("to see the proxy"));
  });

  test("captures Screenshot alt and caption strings", () => {
    const tsx = `
      <WikiPage>
        <Screenshot src="/wiki/screenshots/foo.png" alt="The calendar in month view." caption="Caption text here." />
      </WikiPage>
    `;
    const content = extractPageContent(tsx);
    const all = content.bodySnippets.join(" | ");
    assert.ok(all.includes("calendar in month view"));
    assert.ok(all.includes("Caption text here"));
  });

  test("handles fragment shorthand inside intro prop", () => {
    const tsx = `
      <WikiPage
        intro={<>Everything you need to <strong>get started</strong> with ResearchOS.</>}
      >
        <h2>Section</h2>
      </WikiPage>
    `;
    const content = extractPageContent(tsx);
    const all = content.bodySnippets.join(" ");
    assert.ok(all.includes("Everything you need"));
    assert.ok(all.includes("get started"));
    // Fragment tags themselves should not leak.
    assert.ok(!all.includes("<>"));
    assert.ok(!all.includes("</>"));
  });
});

describe("deriveCategoryId", () => {
  test("returns 'quickstart' for the wiki landing", () => {
    assert.equal(deriveCategoryId("/wiki"), "quickstart");
  });
  test("returns the first segment under /wiki", () => {
    assert.equal(deriveCategoryId("/wiki/features"), "features");
    assert.equal(deriveCategoryId("/wiki/features/lab-head"), "features");
    assert.equal(deriveCategoryId("/wiki/features/lab-overview/widgets-and-tools"), "features");
    assert.equal(deriveCategoryId("/wiki/getting-started/demo-mode"), "getting-started");
    assert.equal(deriveCategoryId("/wiki/integrations/telegram"), "integrations");
    assert.equal(deriveCategoryId("/wiki/security"), "security");
    assert.equal(deriveCategoryId("/wiki/shared-lab-accounts/box"), "shared-lab-accounts");
  });
});

describe("fallbackTitleFromHref", () => {
  test("returns 'ResearchOS Wiki' for the landing href", () => {
    assert.equal(fallbackTitleFromHref("/wiki"), "ResearchOS Wiki");
  });
  test("title-cases the last path segment", () => {
    assert.equal(fallbackTitleFromHref("/wiki/features/lab-head"), "Lab Head");
    assert.equal(fallbackTitleFromHref("/wiki/features/markdown-editor"), "Markdown Editor");
    assert.equal(fallbackTitleFromHref("/wiki/getting-started/welcome-wizard"), "Welcome Wizard");
  });
});
