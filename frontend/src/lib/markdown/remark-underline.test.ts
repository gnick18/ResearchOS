import { describe, expect, it } from "vitest";
import { unified, type Plugin } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkUnderline from "./remark-underline";
import { markdownSanitizeSchema } from "./sanitize-schema";

/**
 * Same pipeline ReactMarkdown drives at every render site, with the
 * ResearchOS underline plugin slotted in BEFORE remarkRehype so the
 * emphasis-to-underline rewrite happens while the mdast still has
 * source position info.
 */
async function render(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    // remarkUnderline declares minimal local mdast interfaces (see its
    // header note) rather than importing unified's Node types, so its
    // transformer signature doesn't line up structurally with the strict
    // Plugin contract. Cast at the boundary; runtime behavior is unchanged.
    .use(remarkUnderline as unknown as Plugin<[]>)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, markdownSanitizeSchema)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);
  return String(file);
}

describe("remarkUnderline — underscore renders as <u>", () => {
  it("wraps a single underscored word in <u>", async () => {
    const html = await render("_underlined_");
    expect(html).toMatch(/<u>underlined<\/u>/);
    expect(html).not.toMatch(/<em>/);
  });

  it("wraps an underscored sentence in <u>", async () => {
    const html = await render("_Re-order before then._");
    expect(html).toMatch(/<u>Re-order before then\.<\/u>/);
  });

  it("underlines a span inside a paragraph", async () => {
    const html = await render("This is _underlined_ in the middle.");
    expect(html).toMatch(/This is <u>underlined<\/u> in the middle\./);
  });

  it("leaves asterisk emphasis as italic <em>", async () => {
    const html = await render("*italic*");
    expect(html).toMatch(/<em>italic<\/em>/);
    expect(html).not.toMatch(/<u>/);
  });

  it("does NOT underline intra-word underscores (snake_case)", async () => {
    const html = await render("snake_case_word");
    expect(html).not.toMatch(/<u>/);
    expect(html).not.toMatch(/<em>/);
    expect(html).toMatch(/snake_case_word/);
  });

  it("leaves double-underscore strong (__bold__) untouched", async () => {
    const html = await render("__bold__");
    expect(html).toMatch(/<strong>bold<\/strong>/);
    expect(html).not.toMatch(/<u>/);
  });

  it("coexists with bold, italic, and underline in one paragraph", async () => {
    const html = await render("**bold** _underline_ *italic*");
    expect(html).toMatch(/<strong>bold<\/strong>/);
    expect(html).toMatch(/<u>underline<\/u>/);
    expect(html).toMatch(/<em>italic<\/em>/);
  });

  it("preserves nested inline formatting inside an underline", async () => {
    const html = await render("_under **bold** line_");
    // <u> wraps the whole run; <strong>bold</strong> nests inside.
    expect(html).toMatch(/<u>under <strong>bold<\/strong> line<\/u>/);
  });

  it("renders the literal <u>...</u> HTML form too (Cmd+U shortcut output)", async () => {
    // Ctrl/Cmd+U injects raw <u>...</u>; rehype-raw + the schema allowlist
    // must keep it.
    const html = await render("hello <u>world</u>");
    expect(html).toMatch(/<u>world<\/u>/);
  });

  it("survives sanitization with allowed attributes", async () => {
    // Make sure the schema allows <u> as a tag even without our plugin
    // generating it (defense in depth).
    const html = await render("<u>raw</u>");
    expect(html).toMatch(/<u>raw<\/u>/);
  });

  it("handles multi-line content with mixed inline marks", async () => {
    const html = await render(
      [
        "First line has _underline_ here.",
        "",
        "Second line has *italic* and **bold**.",
        "",
        "Third has snake_case identifiers.",
      ].join("\n"),
    );
    expect(html).toMatch(/<u>underline<\/u>/);
    expect(html).toMatch(/<em>italic<\/em>/);
    expect(html).toMatch(/<strong>bold<\/strong>/);
    expect(html).toMatch(/snake_case identifiers/);
  });
});

describe("thematic break (HR) renders full-width while inline underscores stay inline (bug C)", () => {
  // A standalone `___` / `---` / `***` line must render a full-width <hr> in the
  // Preview view, NOT be swallowed by the underscore-underline rewrite. The
  // underline plugin only ever rewrites an `emphasis` mdast node, and a thematic
  // break is its own `thematicBreak` node, so the two never collide.
  for (const rule of ["___", "---", "***"]) {
    it(`renders a standalone ${rule} as <hr>`, async () => {
      const html = await render(`above\n\n${rule}\n\nbelow`);
      expect(html).toMatch(/<hr\s*\/?>/);
      // The rule did not leak its characters into the surrounding text.
      expect(html).toMatch(/above/);
      expect(html).toMatch(/below/);
    });
  }

  it("keeps inline __x__ as <strong> (not an HR) on its own line is bold, ___ is a rule", async () => {
    const bold = await render("__under__");
    expect(bold).toMatch(/<strong>under<\/strong>/);
    expect(bold).not.toMatch(/<hr/);

    const rule = await render("___");
    expect(rule).toMatch(/<hr\s*\/?>/);
  });

  it("keeps inline _x_ underline working alongside a thematic break in the same doc", async () => {
    const html = await render("intro with _underline_\n\n---\n\nmore text");
    expect(html).toMatch(/<u>underline<\/u>/);
    expect(html).toMatch(/<hr\s*\/?>/);
  });
});
