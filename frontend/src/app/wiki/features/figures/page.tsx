import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import { TryInDemo } from "@/components/wiki/TryInDemo";

export default function FiguresFeaturePage() {
  return (
    <WikiPage
      title="Figure Composer"
      intro="The Figure Composer lays your real data figures out on a single publication page. Each panel is a live view of a sequence map, a molecule, a phylogenetic tree, or a Data Hub plot, arranged at true size on a real paper sheet and exported as one clean vector SVG. It runs entirely in the browser, so your figures never leave your folder."
    >
      <TryInDemo href="/figures">Try the Figure Composer</TryInDemo>

      <h2>What the Figure Composer is</h2>
      <p>
        A finished figure in a paper is usually several smaller figures arranged
        on one page with panel labels, a few arrows, and a caption. The Figure
        Composer is the surface that does that last step inside ResearchOS. It
        lives at <code>/figures</code> and pulls panels straight from the work you
        already have, so you assemble a publication figure without exporting images
        out to a separate design tool and stitching them back together.
      </p>
      <p>
        The page is measured in real inches on a real paper size, so what you see
        on screen is what the journal gets. Nothing about the figure is a
        screenshot. Every panel stays a true vector, and the whole page exports as
        one scalable file.
      </p>

      <h2>Panels are live, not pasted</h2>
      <p>
        When you add a figure to the page, you are not pasting a flat picture. You
        are placing a live panel that knows where it came from. A sequence map, a
        chemical structure, a phylogenetic tree, and a Data Hub plot can all sit on
        the same page, and each one re-renders from its source when the source
        changes. This is the part most figure tools cannot do, because they only
        ever see a finished image. ResearchOS keeps the data behind the panel, so
        the figure and the underlying record stay connected.
      </p>
      <p>
        Panels are labeled automatically in reading order, top row first and then
        left to right, in your choice of <code>A B C</code>, <code>a b c</code>, or{" "}
        <code>1 2 3</code> style. You drag panels to position them, resize from the
        corner, and an optional snap-to-grid keeps everything aligned. Each panel
        also carries its own style controls, so the parts of a figure that the
        source exposes, such as a tree&apos;s scale bar or a plot&apos;s palette,
        can be tuned per panel without leaving the page.
      </p>

      <h2>The page frame and the canvas</h2>
      <p>
        A paper preset sets the page to a standard size such as US Letter or a
        single or double journal column. The white sheet is the export region, so
        anything on it is in the figure and anything off it is just working space.
        The canvas itself pans and zooms the same way the Phylogenetics Tree Studio
        and the Data Hub graph editor do, with a fit control, a zoom readout, and a
        minimap when you are zoomed in, so a large multi-panel figure is easy to
        move around.
      </p>

      <h2>Annotations and icons</h2>
      <p>
        A small set of annotation tools covers what figures usually need on top of
        the panels: text labels, arrows, and brackets, placed directly on the page
        and exported as part of the vector. Beyond annotations, an optional icon
        library lets you drop scientific icons onto the figure, recolor them, and
        resize or rotate them like any other element.
      </p>
      <Callout variant="info" title="Icons carry their own credit">
        Every icon in the library comes from a vetted open-license source, and the
        Figure Composer auto-generates a Figure credits block listing the source,
        license, and creator for each one that requires attribution. Compliance is
        by construction, and public-domain assets are omitted from the block so it
        stays short. See the <Link href="/wiki/features/datahub">Data Hub</Link>{" "}
        and <Link href="/wiki/features/phylo">Phylogenetics</Link> pages for the
        data figures those panels come from.
      </Callout>

      <h2>Export</h2>
      <p>
        The whole page exports as a single vector SVG at publication resolution, so
        the lines stay crisp at any size and the file drops straight into a
        manuscript or a slide. Because the panels are true vectors rather than
        rasterized images, the export is the figure itself, not a photograph of it.
      </p>

      <Callout variant="tip" title="Your figures stay in your folder">
        The Figure Composer runs entirely in the browser. There is no server doing
        the layout or the export, so your figures and the data behind their panels
        stay in your own folder the same way your notes, sequences, and trees do.
      </Callout>
    </WikiPage>
  );
}
