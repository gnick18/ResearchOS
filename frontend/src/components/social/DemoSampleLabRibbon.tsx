// Sample-lab ribbon for the seeded demo lab (demo-lab-network Phase 2, social
// lane).
//
// A small, calm "this lab is a sample" line shown ONLY for the seeded demo lab,
// so a viewer of the public companion site or the directory card always knows the
// lab is fabricated for the tutorial. Reuses the DemoEntryCue framing ("The data
// is fictional"). It is DEMO-SLUG-SCOPED by its only caller (it is rendered behind
// an isDemoLabSlug check), so it can never appear on a real lab's site.
//
// Text-only and understated on purpose (no leading glyph), matching DemoEntryCue's
// quiet style so the demo still reads like a real lab.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export default function DemoSampleLabRibbon({
  tone = "page",
}: {
  /** "page" sits at the top of a companion page, "card" sits inside the
   *  directory card. The copy is the same, the chrome adapts. */
  tone?: "page" | "card";
}) {
  if (tone === "card") {
    return (
      <span className="inline-flex items-center rounded-full border border-border bg-surface-sunken px-2.5 py-0.5 text-[11px] font-medium text-foreground-muted">
        Sample lab, fabricated for the demo
      </span>
    );
  }
  return (
    <div className="border-b border-border bg-surface-sunken">
      <div className="mx-auto max-w-3xl px-6 py-2 text-meta text-foreground-muted">
        You are viewing a sample lab. The lab, its people, and its results are
        fictional and shown to demonstrate what a ResearchOS lab site looks like.
      </div>
    </div>
  );
}
