import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";

export default function LibraryFeaturePage() {
  return (
    <WikiPage
      title="Open icon library"
      intro="The open icon library is a public, login-free collection of openly licensed scientific icons and silhouettes, a free alternative to BioRender. It carries roughly 30,000 assets, every one of them under a permissive open license, and every one of them ships with its source and a ready-to-paste citation so attribution is handled for you. Browse it, search it, and drop the icons straight into your figures."
    >
      <h2>What it is for</h2>
      <p>
        A good figure needs clean scientific icons, a cell, a mouse, a flask, a
        species silhouette, and finding ones you are actually allowed to publish is
        harder than it should be. The open icon library answers that. It lives at{" "}
        <code>/library</code>, it needs no account, and it gathers openly licensed
        scientific art into one searchable place so you can find an icon and use it
        without worrying about whether you may.
      </p>
      <p>
        It is a free alternative to BioRender for the asset side of figure making.
        The whole collection is openly licensed and free to use, and because every
        asset carries its provenance, the attribution that open licenses ask for is
        produced for you rather than left as your homework.
      </p>

      <h2>What is in it</h2>
      <p>
        The library holds roughly 30,000 assets drawn from openly licensed sources,
        chiefly PhyloPic for organism silhouettes and BioIcons for scientific
        diagram icons. Everything is vector art that scales cleanly into a figure at
        any size.
      </p>
      <p>
        Only genuinely open licenses are included, CC0, Public Domain, CC-BY, and
        CC-BY-SA. Assets under a non-commercial (NC) or no-derivatives (ND) license
        are deliberately left out, so anything you find here is safe to use and to
        adapt in published work.
      </p>

      <h2>Browse, search, and the category tree</h2>
      <p>
        You can explore the library two ways. Search by keyword to jump straight to
        what you need, or walk a category tree that organizes the collection by
        subject so you can browse by area when you are not sure what to call the
        thing you want. Each asset shows its name, its source, and its license at a
        glance.
      </p>

      <h2>Attribution is handled for you</h2>
      <p>
        Open licenses still ask for credit, and getting that credit right is fiddly.
        The library does it for you. Every asset records the source it came from and
        a verbatim citation, so when you use an icon you have the exact attribution
        text ready to paste, with no guessing about who to credit or how.
      </p>
      <Callout variant="info" title="Open licenses, used correctly">
        Including only CC0, Public Domain, CC-BY, and CC-BY-SA, and carrying each
        asset&rsquo;s source and citation, is what keeps the library honest. You get
        art you are clearly allowed to publish, and the credit that goes with it is
        produced rather than improvised.
      </Callout>

      <h2>Using icons in your figures</h2>
      <p>
        The library feeds the{" "}
        <Link href="/wiki/features/figures">Figure Composer</Link>, where you lay
        your panels out on a publication page. Pull an icon from the library into a
        composition and it sits alongside your live data panels, exported together
        as one clean vector figure, with the attribution it needs traveling with it.
      </p>

      <h2>Contributing and review</h2>
      <p>
        The library is meant to grow, and it grows in the open. A community
        contribution flow lives at <code>/library/contribute</code>, where you can
        submit an openly licensed asset, and an independent peer-review flow at{" "}
        <code>/library/review</code>, where submissions are vetted before they join
        the collection. The review step is what keeps the license guarantees above
        true as the library expands.
      </p>
      <Callout variant="info" title="Rolling out">
        The open icon library is a new surface and its collection keeps growing as
        contributions are submitted and reviewed. Browsing and searching the
        existing assets, and using them in your figures, work today.
      </Callout>
    </WikiPage>
  );
}
