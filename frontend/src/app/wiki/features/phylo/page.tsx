import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { TryInDemo } from "@/components/wiki/TryInDemo";

export default function PhyloFeaturePage() {
  return (
    <WikiPage
      title="Phylogenetics"
      intro="The Phylogenetics workbench has two halves. The Tree Builder writes you a verified, copy-and-run tree-building recipe for your own data. The Tree Studio renders, annotates, and exports finished trees in the browser, a free alternative to iTOL. Both keep your trees in your own folder, and neither needs a server."
    >
      <Screenshot
        src="/wiki/screenshots/phylo-hub-overview.png"
        alt="The Phylogenetics workbench landing on the Tree Studio, with a collection rail on the left listing saved trees, a rectangular phylogram rendered in the center canvas, and the tabbed action rail on the right."
        caption="The Phylogenetics workbench. The left rail holds your saved tree library. The canvas renders the open tree. The right rail carries five tabs for shaping, layering, data, exporting, and code."
      />

      <TryInDemo href="/phylo">Try the Phylogenetics workbench</TryInDemo>

      <h2>What the workbench is</h2>
      <p>
        Building a phylogenetic tree and drawing a publication figure of it are
        normally two separate chores with two separate kinds of friction. The first
        means remembering the exact incantation for MAFFT, trimAl, ModelFinder, and
        IQ-TREE, and the flags that go with them. The second usually means uploading
        your tree to a web service like iTOL and styling it there. The Phylogenetics
        workbench answers both, and it lives at <code>/phylo</code>, one click from
        the rest of the app.
      </p>
      <p>
        It does this without running any heavy computation on a server, because
        ResearchOS has no server to run it on. That single constraint shapes the
        whole feature. Tree search is expensive and stochastic, so instead of
        pretending to run it for you, the Tree Builder hands you the exact,
        version-pinned commands to run yourself, locally, with full control and full
        reproducibility. Rendering a tree is cheap, so the Tree Studio does that
        entirely in your browser. Your trees, your alignments, and your figures stay
        in your folder.
      </p>
      <Callout variant="info" title="Turning the workbench on">
        Phylogenetics is an opt-in workbench, the same way Chemistry and the{" "}
        <Link href="/wiki/features/datahub">Data Hub</Link> are. It shows up as a{" "}
        <code>/phylo</code> tab once enabled, and it is always available in the demo,
        so you can explore the whole thing here before turning it on in your own
        workspace.
      </Callout>

      <h2>The Tree Builder: a recipe, not a black box</h2>
      <p>
        The Tree Builder is a short wizard. You answer a handful of questions about
        your data and how you want to analyze it, and it writes you a complete,
        runnable recipe, the alignment step, the trimming step, the model selection,
        the tree search, and the support values, with every tool version pinned. It
        never runs the recipe. It gives you the commands and an environment file so
        you run them yourself and own the result.
      </p>
      <Screenshot
        src="/wiki/screenshots/phylo-builder-wizard.png"
        alt="The Tree Builder wizard showing choices for data type, analysis type, aligner, trimming, substitution model, inference tool, and support, with a generated recipe preview on the right."
        caption="The Tree Builder wizard. Each choice updates the generated recipe live; nothing runs until you copy the commands and run them yourself."
      />
      <p>
        The questions follow the real shape of a phylogenetics analysis. You pick
        whether your data is <strong>nucleotide or protein</strong>, then which of
        three analyses you are doing. A <strong>single locus</strong> takes one gene
        or region to one tree. A <strong>concatenated supermatrix</strong> joins
        many genes into one partitioned alignment and infers a single
        maximum-likelihood tree. A <strong>coalescent species tree</strong> builds a
        tree per gene and summarizes them with ASTRAL, which accounts for the way
        individual gene histories disagree. From there you choose the aligner
        (MAFFT by default, with MUSCLE and Clustal Omega as alternatives), the
        trimming step (trimAl, ClipKIT, or Gblocks, or none), how the substitution
        model is chosen, the inference tool, and how branch support is measured.
      </p>
      <p>
        <strong>Model selection.</strong> By default the recipe uses ModelFinder,
        which tests candidate substitution models against your alignment and picks
        the best-fitting one, so you do not have to guess. If you already know the
        model you want, a searchable picker lets you fix it instead, and the recipe
        passes it straight through.
      </p>
      <p>
        <strong>Support values.</strong> The default is the ultrafast bootstrap with
        1000 replicates plus an SH-aLRT test, the modern standard for IQ-TREE. You
        can switch to the slower standard bootstrap, or turn support off for a quick
        look. An advanced section exposes the dials a phylogeneticist actually
        reaches for, the bootstrap replicate count, the <code>-bnni</code>{" "}
        correction, ascertainment-bias correction for SNP data, restricting
        ModelFinder to a common model set, the thread count, and an outgroup to root
        on.
      </p>

      <h3>What you get out</h3>
      <p>
        The Builder produces three things that fit together. A{" "}
        <strong>recipe</strong> of shell commands, each with a one-line comment
        explaining what it does, that you copy and run. An{" "}
        <strong>environment file</strong> (<code>environment.yml</code>) that pins
        every tool to a specific version through conda, so the run is reproducible
        and so installing the tools is one command. And <strong>install steps</strong>{" "}
        for your operating system, conda-first on macOS, Windows, and Linux, because
        that is the honest cross-platform path for bioinformatics tools. The point is
        that you can hand the recipe to a labmate, or to your future self, and get
        the same tree.
      </p>
      <Screenshot
        src="/wiki/screenshots/phylo-builder-recipe.png"
        alt="The generated recipe output panel showing commented shell commands for alignment, trimming, and IQ-TREE inference, a copy button, and a generated environment.yml with pinned tool versions."
        caption="The generated recipe. Every command is commented and every tool is version-pinned in the environment file, so the run is reproducible and copy-and-paste ready."
      />
      <Callout variant="info" title="The command catalog is a verified asset">
        Every tool name, flag, and version pin the Builder emits is taken from the
        official documentation for that tool and checked by hand, because
        researchers copy these commands and run them as written. The same verified
        catalog is what the BeakerBot AI assistant fills when you ask it to build a
        tree in plain language, so the assistant proposes the same trustworthy
        commands rather than inventing flags.
      </Callout>
      <Callout variant="tip" title="On a small alignment, set a fixed thread count">
        By default the recipe lets IQ-TREE choose its own thread count with{" "}
        <code>-T AUTO</code>, which is right for a large alignment. On a small one it
        is slow, because IQ-TREE re-measures the best thread count for every model
        ModelFinder tries, and that measurement can dominate the whole run. The
        recipe says so where it matters and suggests replacing <code>-T AUTO</code>{" "}
        with a fixed count like <code>-T 4</code> for small data.
      </Callout>

      <h2>The Tree Studio: render and annotate, no upload</h2>
      <p>
        The Tree Studio is the free answer to iTOL. You open a tree, and it draws,
        styles, annotates, and exports it entirely in your browser. There is no
        upload step and no account, because the rendering is native, computed in the
        page rather than by a plotting service.
      </p>
      <p>
        It reads the standard tree formats, Newick and Nexus, whether you paste the
        text, open a saved tree from your library, or drop in the{" "}
        <code>.treefile</code> the Tree Builder recipe produced. The Tree Builder
        wizard is reachable from the rail&apos;s <strong>Build a tree</strong>{" "}
        overlay button rather than a top-level toggle.
      </p>

      <h3>The collection rail</h3>
      <Screenshot
        src="/wiki/screenshots/phylo-collection-rail.png"
        alt="The left collection rail in the Tree Studio listing saved trees with their names and last-modified dates, with a search field at the top and a Build a tree button below it."
        caption="The left rail holds every tree you have saved. Click one to open it in the Studio. Build a tree opens the recipe wizard as an overlay."
      />
      <p>
        A collapsible left rail lists every tree you have saved, newest first,
        with a search field to filter by name. Clicking a tree in the rail opens
        it in the canvas. A <strong>Build a tree</strong> button at the bottom of
        the rail opens the Tree Builder recipe wizard as a centered overlay, so you
        can kick off a new analysis without leaving the Studio.
      </p>

      <h3>The five action-rail tabs</h3>
      <Screenshot
        src="/wiki/screenshots/phylo-studio-tabs.png"
        alt="The right action rail of the Tree Studio with five tabs visible: Shape, Layers, Data, Export, and Code, with the Shape tab open showing layout options, a phylogram/cladogram toggle, and axis controls."
        caption="The five tabs of the action rail. Shape covers layout and axes. Layers controls the draw order. Data holds metadata and alignment inputs. Export saves the figure. Code generates ggtree R."
      />
      <p>
        When a tree is open, a tabbed rail on the right organizes every control
        into five tabs. Each tab is a flyout panel.
      </p>
      <ul>
        <li>
          <strong>Shape.</strong> Layout, rooting, axes, and the page frame.
          Pick one of six layouts: <em>Rectangular</em>, <em>Slanted</em>,{" "}
          <em>Circular</em>, <em>Fan</em>, <em>Inward Circular</em>, or{" "}
          <em>Unrooted</em>. Toggle between <em>phylogram</em> (branch lengths
          to scale) and <em>cladogram</em> (equal branch lengths). Toggle the
          branch-length scale bar, a root-edge stub, and a full-width time axis.
          Reroot on an outgroup, midpoint-root, ladderize, or rotate a clade by
          picking its tip members. Color branches by a metadata column using the{" "}
          <em>Branch color by</em> picker.
        </li>
        <li>
          <strong>Layers.</strong> The draw order from inner to outer. Each
          layer is an annotation track that you add from the Add menu and reorder
          by dragging. Tracks include tip labels, tip points, color strips,
          heatmap rings, bar panels, MRCA clade highlights, node pies, bracket
          annotations, and support-value labels on internal nodes.
        </li>
        <li>
          <strong>Data.</strong> Metadata (drop a CSV to drive the layers),
          alignment (drop a FASTA to show an MSA panel beside the tips), and a
          Data Hub plot picker (align a grouped-bar figure to the tips by a join
          column). The tab shows live match counts for each source so you know
          how many tips lined up before you add a layer.
        </li>
        <li>
          <strong>Export.</strong> Download as SVG or PNG, copy the figure to
          the clipboard, export the page sheet (when the artboard is on), and
          save the current tree to your library. A <em>Copy reference for a
          note</em> button produces a <code>ros://</code> link you can paste
          into any note to embed the tree as a live card.
        </li>
        <li>
          <strong>Code.</strong> A generated ggtree R script that reproduces the
          current figure in R, with a caveat that two rendering engines never
          agree pixel-for-pixel.
        </li>
      </ul>

      <Screenshot
        src="/wiki/screenshots/phylo-studio-rectangular.png"
        alt="The Tree Studio showing a rectangular phylogram with bootstrap support values on internal nodes, tip labels, and a colored clade highlight on the canvas, with the Layers tab open on the right."
        caption="A rectangular phylogram with support values and a clade highlight. Layers on the right control the draw order of annotation tracks."
      />

      <Screenshot
        src="/wiki/screenshots/phylo-studio-branch-color.png"
        alt="The Tree Studio Shape tab with the Branch color by picker showing a metadata column selected, and the canvas rendering branches colored by that column with a legend."
        caption="Branch color by column, set in the Shape tab. Any metadata column can drive the branch color."
      />

      <p>
        <strong>Annotation tracks.</strong> A finished figure is rarely just the
        tree. The Studio layers the tracks a published phylogeny carries: tip
        labels, colored tip points, a color strip beside the tips, aligned bar
        charts, a heatmap panel, MRCA clade highlights, node pie charts, bracket
        annotations, and the bootstrap or posterior support on each branch. Each
        track is toggled on or off, so you build up exactly the figure you need.
      </p>
      <p>
        <strong>Linking your metadata.</strong> The tracks are driven by a metadata
        table you link as a CSV in the Data tab, one row per tip with whatever
        columns you want to show, a clade assignment, a country, a resistance call,
        an abundance. Real tip labels are messy, often a strain name joined to an
        accession, so the match is robust. It tries an exact match first, then a
        normalized one, then a token match against composite labels, auto-detects
        which column holds the tip identifier, and shows you a live count of how
        many tips it matched, so you can see at a glance whether your table lined up.
      </p>
      <Screenshot
        src="/wiki/screenshots/phylo-studio-circular.png"
        alt="The Tree Studio showing a large circular tree with a colored clade strip and a resistance heatmap ring around the outside, drawn from a linked metadata CSV."
        caption="A circular layout with a clade color strip and a metadata heatmap ring. The rings are driven by the columns in the linked CSV."
      />

      <h3>MSA alignment panel</h3>
      <Screenshot
        src="/wiki/screenshots/phylo-studio-msa.png"
        alt="The Tree Studio with an MSA alignment panel rendered as a colored grid of sequence blocks beside the tree tips, joined to each tip by label."
        caption="Drop an aligned FASTA in the Data tab and the MSA panel appears beside the tips. Sequences join to tips by label, the same way metadata does."
      />
      <p>
        Drop an aligned FASTA in the Data tab and the Tree Studio adds an MSA
        panel beside the tips. Sequences join to tips by label using the same
        robust matcher as metadata. Long alignments are binned into blocks for
        readability; the match-count line shows how many tips have a sequence.
      </p>

      <h3>ZoomPanCanvas and minimap</h3>
      <p>
        The canvas pans and zooms with the same trackpad-native model the Data Hub
        and Figure Composer use: pinch or scroll to zoom at the cursor position, drag
        to pan. A minimap thumbnail appears in the corner when you are zoomed in,
        giving you a birds-eye view of the full tree with a rectangle showing the
        current viewport. Click or drag the minimap rectangle to jump to that region.
        A fit control snaps the tree back to fill the visible area, and a zoom
        readout shows the current scale.
      </p>

      <h3>Adding data straight from the Data Hub</h3>
      <p>
        Linking a CSV by hand is one way in. The Studio also finds the data for
        you. When you open a saved tree, it looks at the{" "}
        <Link href="/wiki/features/datahub">Data Hub</Link> tables in the same
        project, works out which ones share identifiers with your tips, and ranks
        them by how many tips each one covers. A quiet banner tells you when
        something fits, for example that a resistance table joins seven of your
        eight tips, and a <strong>Find data for this tree</strong> button is
        always there in the Layers panel.
      </p>
      <p>
        Choosing one opens a short add-data wizard. You pick the table, pick the
        columns you care about, and for each column pick how it should read on the
        tree, where a numeric column can become a bar panel, a heatmap, dots, or
        sized points, and a categorical one becomes a color strip. The wizard adds
        them as real, editable layers in the stack, the same layers you would have
        built by hand, and you can loop back to add another table without leaving
        it. Every join rate and every available overlay is computed in the page,
        so what the wizard offers is always grounded in your actual data.
      </p>
      <Callout variant="tip" title="Or just ask in plain language">
        The BeakerBot assistant reaches the same engine. With a tree open, ask it
        something like "what data can I overlay on this tree" and it resolves
        which tree you mean, reports the same ranked matches, and mounts the very
        same add-data wizard inside the chat. Whichever door you use, the app does
        the matching and the math and the assistant only narrates it, so the two
        always agree.
      </Callout>

      <h3>Exporting the figure</h3>
      <p>
        When the figure looks right, you export it as <strong>SVG</strong> for a
        vector you can drop into a manuscript or refine in Illustrator, or as a{" "}
        <strong>PNG</strong> for a slide, using the same exporter the Data Hub uses
        for its plots. You can also export the figure as{" "}
        <strong>ggtree R code</strong>, a script that reproduces the same figure in
        R for a reviewer or a collaborator who works there. We are honest about that
        last one, the generated R reproduces the figure closely rather than
        pixel-for-pixel, because two rendering engines never agree to the pixel.
      </p>

      <h2>Trees alongside the rest of your work</h2>
      <p>
        A tree is an object in your folder like a note, a sequence, or a molecule, so
        it lives in the same connected workspace. A saved tree opens in the Studio by
        a deep link, and you can <strong>embed</strong> it in a note or experiment,
        where it renders as a live tree card rather than a flat screenshot, the same
        way a <Link href="/wiki/features/sequences">sequence</Link> or a{" "}
        <Link href="/wiki/features/chemistry">molecule</Link> embeds. The writeup of
        an analysis and the tree it describes stay in one place. How embeds behave in
        a note is covered under the{" "}
        <Link href="/wiki/features/markdown-editor">markdown editor</Link>.
      </p>

      <h2>Why you can trust the output</h2>
      <p>
        Two things on the <Link href="/wiki/trust">transparency page</Link> back the
        workbench up. The first is that the Tree Studio's native layout is checked
        against ggtree, the de-facto standard tree-plotting package in R, on real
        published phylogenies, so the figure you draw here matches the one the
        standard tool draws. The second is published-tree reproduction, where we run
        the Builder's generated recipe on a real paper's own data and check that it
        recovers that paper's published tree.
      </p>
      <Callout variant="info" title="What 'reproduces the published tree' honestly means">
        Maximum-likelihood tree search is stochastic, and we run on the paper's
        alignment rather than its exact tool versions, so we never claim a
        bit-for-bit identical tree. The honest test is whether the recipe recovers
        every clade the original study was confident about. A case passes when it
        misses no published clade with bootstrap support at or above 70, the
        field-standard well-supported bar (Hillis and Bull 1993). We still show the
        raw distance and list every branch that differs with its support, so a small
        disagreement reads as low-support noise among near-identical tips, not a
        hidden miss.
      </Callout>

      <h2>What it is built on</h2>
      <p>
        The Tree Studio's layout and rendering are written natively in the app, with
        no plotting library doing the drawing, which is what lets it render in the
        browser with nothing to upload. The Tree Builder writes recipes for the
        standard open-source phylogenetics tools, MAFFT, trimAl, ClipKIT, Gblocks,
        ModelFinder, IQ-TREE, RAxML-NG, FastTree, MrBayes, AMAS, and ASTRAL, and pins
        them through conda so your run is reproducible. The ggtree code export
        targets ggtree and treeio. These projects, and the rest of the open-source
        software ResearchOS stands on, are credited on the{" "}
        <Link href="/wiki/trust/open-source">open-source page</Link>.
      </p>
      <Callout variant="tip" title="Nothing about your tree leaves your machine">
        The Builder writes a recipe and the Studio renders a tree, both in your
        browser against files in your folder, so working here transmits nothing. When
        you run the recipe it produces, it runs on your own computer too. The trees,
        alignments, and figures are yours and stay local.
      </Callout>
    </WikiPage>
  );
}
