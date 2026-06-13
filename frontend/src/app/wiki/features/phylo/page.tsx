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
        alt="The Phylogenetics workbench landing on the Tree Studio, with a saved tree rendered as a rectangular phylogram, a left panel of layout and annotation controls, and a top toggle between Tree Builder and Tree Studio."
        caption="The Phylogenetics workbench. A toggle at the top switches between the Tree Builder (write a recipe) and the Tree Studio (render and annotate a finished tree)."
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
        <code>.treefile</code> the Tree Builder recipe produced. From there you lay
        the tree out as a <strong>rectangular</strong> phylogram or a{" "}
        <strong>circular</strong> one, <strong>reroot</strong> it on any branch or
        outgroup, <strong>ladderize</strong> it so the branching reads cleanly,{" "}
        <strong>collapse</strong> a clade you want to summarize, and{" "}
        <strong>color</strong> branches to call out a group.
      </p>
      <Screenshot
        src="/wiki/screenshots/phylo-studio-rectangular.png"
        alt="The Tree Studio showing a rectangular phylogram with bootstrap support shown on internal nodes, tip labels, and a colored clade highlight, alongside a control panel for layout, rooting, and annotation tracks."
        caption="A rectangular phylogram in the Tree Studio with support values and a highlighted clade. Layout, rooting, and annotation are all controls on the left."
      />
      <p>
        <strong>Annotation tracks.</strong> A finished figure is rarely just the
        tree. The Studio layers the tracks a published phylogeny carries, tip
        labels, colored tip points, a color strip beside the tips, aligned bar
        charts, a heatmap panel, clade highlights, and the bootstrap or posterior
        support on each branch. Each track is toggled on or off, so you build up
        exactly the figure you need.
      </p>
      <p>
        <strong>Linking your metadata.</strong> The tracks are driven by a metadata
        table you link as a CSV, one row per tip with whatever columns you want to
        show, a clade assignment, a country, a resistance call, an abundance. Real
        tip labels are messy, often a strain name joined to an accession, so the
        match is robust. It tries an exact match first, then a normalized one, then
        a token match against composite labels, auto-detects which column holds the
        tip identifier, and shows you a live count of how many tips it matched, so
        you can see at a glance whether your table lined up.
      </p>
      <Screenshot
        src="/wiki/screenshots/phylo-studio-circular.png"
        alt="The Tree Studio showing a large circular tree with a colored clade strip and a resistance heatmap ring around the outside, drawn from a linked metadata CSV."
        caption="A circular layout with a clade color strip and a metadata heatmap ring. The rings are driven by the columns in the linked CSV."
      />

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
