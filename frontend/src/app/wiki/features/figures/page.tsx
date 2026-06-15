import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { TryInDemo } from "@/components/wiki/TryInDemo";

export default function FiguresFeaturePage() {
  return (
    <WikiPage
      title="Figure Composer"
      intro="The Figure Composer lays your real data figures out on a single publication page. Each panel is a live view of a sequence map, a molecule, a phylogenetic tree, or a Data Hub plot, arranged at true size on a real paper sheet and exported as one clean vector SVG. It runs entirely in the browser, so your figures never leave your folder."
    >
      <Screenshot
        src="/wiki/screenshots/figure-composer-overview.png"
        alt="The Figure Composer at /figures showing a multi-panel publication page with a sequence map panel, a phylogenetic tree panel, and a Data Hub plot panel arranged on a white page sheet, with the panel picker sidebar open on the left."
        caption="The Figure Composer with three panels on one publication page. Each panel is a live view from its source, not a screenshot."
      />

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

      <h2>Panel sources</h2>
      <p>
        The composer pulls panels from four parts of your workspace. Each source
        exposes the same placing, resizing, and labeling interface, and each
        re-renders from the original data whenever the source changes.
      </p>
      <ul>
        <li>
          <strong>Sequences.</strong> A panel from the{" "}
          <Link href="/wiki/features/sequences">Sequences</Link> library renders
          as a linear or circular sequence map, with features, annotations, and
          primer sites exactly as the full sequence viewer shows them.
        </li>
        <li>
          <strong>Chemistry.</strong> A panel from the{" "}
          <Link href="/wiki/features/chemistry">Chemistry</Link> library renders
          the molecule as a 2D chemical structure diagram.
        </li>
        <li>
          <strong>Phylogenetics.</strong> A panel from the{" "}
          <Link href="/wiki/features/phylo">Tree Studio</Link> renders the saved
          tree with all its layers (annotation tracks, color strips, metadata
          heatmaps) using the same native renderer.
        </li>
        <li>
          <strong>Data Hub.</strong> A panel from a{" "}
          <Link href="/wiki/features/datahub">Data Hub</Link> table renders one
          of its saved plots (bar chart, scatter, histogram, and so on). The
          figure math stays in the Data Hub engine; the composer only places the
          rendered output.
        </li>
      </ul>

      <h2>Panels are live, not pasted</h2>
      <p>
        When you add a figure to the page, you are not pasting a flat picture. You
        are placing a live panel that knows where it came from. All four panel
        sources re-render from their source when the source changes. This is the
        part most figure tools cannot do, because they only ever see a finished
        image. ResearchOS keeps the data behind the panel, so the figure and the
        underlying record stay connected.
      </p>
      <p>
        Panels are labeled automatically in reading order, top row first and then
        left to right, in your choice of <code>A B C</code>, <code>a b c</code>, or{" "}
        <code>1 2 3</code> style. You drag panels to position them, resize from the
        corner, and an optional snap-to-grid keeps everything aligned.
      </p>

      <h2>Per-panel style inspector</h2>
      <Screenshot
        src="/wiki/screenshots/figure-composer-inspector.png"
        alt="The Figure Composer with a phylogenetic tree panel selected, showing the style inspector sidebar with controls for scale bar, tip labels, branch color, and palette exposed by that panel's source."
        caption="Selecting a panel opens its style inspector. Controls vary by source type; a tree panel exposes scale bar and branch color, a Data Hub panel exposes its plot&apos;s palette."
      />
      <p>
        Selecting a panel opens its style inspector. Each source exposes the
        controls that make sense for it. A sequence map panel lets you toggle
        features and annotation tracks. A chemistry panel has no style options
        (the 2D structure is self-contained). A phylogenetic tree panel exposes
        scale bar, tip-label visibility, and branch-color column. A Data Hub plot
        panel exposes the plot&apos;s palette. The controls mirror what the source
        exposes in its own viewer, so what you tune here is the same dial you
        would turn in the full editor.
      </p>
      <p>
        Style changes apply only to that panel in the figure, not back to the
        source, so adjusting a palette for the figure does not change the Data Hub
        table.
      </p>

      <h2>The page frame and the canvas</h2>
      <Screenshot
        src="/wiki/screenshots/figure-composer-artboard.png"
        alt="The Figure Composer showing the artboard preset picker open with options Letter, A4, Legal, Journal single column, Journal double column, Slide 16:9, and Square, with a white page sheet rendered at true inches on the pan-zoom canvas."
        caption="The artboard preset picker. Pick a standard page size or journal column width; the white sheet is the export region at true physical dimensions."
      />
      <p>
        A paper preset sets the page to a standard physical size. Seven presets
        cover the common cases.
      </p>
      <ul>
        <li><strong>Letter</strong> (8.5 x 11 in)</li>
        <li><strong>A4</strong> (8.27 x 11.69 in)</li>
        <li><strong>Legal</strong> (8.5 x 14 in)</li>
        <li><strong>Journal single column</strong> (3.5 in wide)</li>
        <li><strong>Journal double column</strong> (7.2 in wide)</li>
        <li><strong>Slide 16:9</strong> (13.3 x 7.5 in)</li>
        <li><strong>Square</strong> (6 x 6 in)</li>
      </ul>
      <p>
        Portrait and landscape orientations are available for each, and a custom
        width and height field covers anything the presets do not. The white sheet
        is the export region, so anything on it is in the figure and anything off
        it is just working space. The canvas pans and zooms the same way the
        Phylogenetics Tree Studio and the Data Hub graph editor do, with a fit
        control, a zoom readout, and a minimap when you are zoomed in.
      </p>

      <h2>Undo</h2>
      <p>
        Every placement, resize, drag, style change, and panel deletion is
        undoable. The toolbar carries an <strong>Undo</strong> button that steps
        back through the session history one action at a time. There is no redo;
        undo covers the whole history of the current editing session.
      </p>

      <h2>Annotations and icons</h2>
      <p>
        A small set of annotation tools covers what figures usually need on top of
        the panels: text labels, arrows, and brackets, placed directly on the page
        and exported as part of the vector. Beyond annotations, an optional icon
        library lets you drop scientific icons onto the figure, recolor them, and
        resize or rotate them like any other element.
      </p>
      <Callout variant="info" title="Icon library is a flag-gated preview">
        The scientific icon library is gated behind the{" "}
        <code>NEXT_PUBLIC_ASSET_LIBRARY_ENABLED</code> flag, which is off by
        default. When the flag is on, the library draws from vetted open-license
        sources (CC0, CC-BY, and similar), and the Figure Composer auto-generates
        a credits block listing the source, license, and creator for each icon that
        requires attribution. Public-domain assets are omitted from the block so it
        stays short.
      </Callout>

      <h2>Export</h2>
      <p>
        The whole page exports as a single vector SVG at publication resolution, so
        the lines stay crisp at any size and the file drops straight into a
        manuscript or a slide. Because the panels are true vectors rather than
        rasterized images, the export is the figure itself, not a photograph of it.
        A PNG export is also available for slides and print where a raster is
        required.
      </p>

      <Callout variant="tip" title="Your figures stay in your folder">
        The Figure Composer runs entirely in the browser. There is no server doing
        the layout or the export, so your figures and the data behind their panels
        stay in your own folder the same way your notes, sequences, and trees do.
      </Callout>

      <p>
        See the <Link href="/wiki/features/datahub">Data Hub</Link> and{" "}
        <Link href="/wiki/features/phylo">Phylogenetics</Link> pages for the data
        figures those panels come from.
      </p>
    </WikiPage>
  );
}
