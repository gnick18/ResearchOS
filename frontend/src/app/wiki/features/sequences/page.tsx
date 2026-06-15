import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { TryInDemo } from "@/components/wiki/TryInDemo";

export default function SequencesFeaturePage() {
  return (
    <WikiPage
      title="Sequences"
      intro="The Sequences workbench is where plasmids, oligos, genes, and protein sequences live alongside your experiments and notes."
    >
      <Screenshot
        src="/wiki/screenshots/sequences-workbench-overview.png"
        alt="The Sequences workbench showing the library panel on the left and the editor surface on the right, with a circular plasmid map rendered in the main view area."
        caption="The Sequences workbench, with the library on the left and the editor and map on the right."
      />

      <TryInDemo href="/sequences">Try the Sequences workbench</TryInDemo>

      <h2>What the workbench is</h2>
      <p>
        The Sequences workbench is a SnapGene-style sequence editor built directly
        into ResearchOS. It holds every DNA, RNA, and protein sequence in your lab
        folder in one indexed library, and it opens those sequences in an editor
        that renders circular plasmid maps, annotated linear maps, and base-level
        sequence views without any external software. The workbench lives
        at <code>/sequences</code> and is always one click away from the rest of
        the app.
      </p>
      <p>
        The point is that your sequences live alongside your experiments and notes,
        not as attachments tucked inside a separate application. A plasmid you
        designed last month, the oligos for a current cloning reaction, the protein
        from a collaborator&apos;s GenBank file. They all land in the same library,
        open in the same editor, and are searchable by the same search box.
      </p>

      <h2>The sequence library</h2>
      <p>
        The left panel of the workbench is the library. It lists every sequence in
        your folder, grouped into collections that map to your projects. A
        collection selector at the top of the panel lets you narrow the list to one
        project or view everything at once. Within a collection, sequences sort by
        name (ascending) by default, and the column headers let you re-sort by
        date added, type, or length. A search box at the top of the list filters
        by name in real time.
      </p>
      <Screenshot
        src="/wiki/screenshots/sequences-library-filter.png"
        alt="The library panel with the collection selector open, showing a list of project names and an All collections option."
        caption="The collection selector scopes the library to one project or opens it to everything at once."
      />
      <p>
        Each library row shows the sequence name, the sequence type (DNA, RNA, or
        protein), the length in base pairs or amino acids, and the topology for DNA
        sequences (circular or linear). Clicking a row opens the sequence in the
        editor. A small button at the top of the library panel opens the New
        Sequence dialog, and an Assemble button launches the Cloning Workspace
        for multi-fragment assembly.
      </p>
      <Callout variant="info" title="Sequences in the trash">
        Deleting a sequence moves it to the{" "}
        <Link href="/wiki/features/trash">Trash</Link> with a 30-day recovery
        window, the same as notes and tasks. The sequence is removed from the
        library immediately, but it is recoverable until the window expires.
      </Callout>

      <h2>Getting sequences into the library</h2>
      <p>
        There are three ways to add a sequence. The New Sequence dialog creates a
        sequence from scratch. You name it, pick a type and topology, and type or
        paste the bases directly. The Import path accepts SnapGene files
        (.dna, .prot), GenBank (.gb, .gbk), FASTA (.fa, .fasta, including
        multi-record FASTA where each record lands as its own sequence), and
        plain-sequence text files by dragging them onto the library panel or
        using the file picker. A paste-from-clipboard option
        in the New Sequence dialog accepts raw base strings and auto-detects the
        type from the characters. Importing a GenBank file preserves the feature
        annotations, qualifiers, and topology flags the file carries, so a
        fully-annotated plasmid map from Addgene or a collaborator arrives
        complete.
      </p>
      <p>
        Sequences produced by the Cloning Workspace land in the library automatically
        when you save the cloning product. Primers you design in the editor are
        saved as <code>primer_bind</code> features on the sequence, not as separate
        library entries, so the oligo stays with the template it belongs to.
      </p>

      <h3>Download from NCBI</h3>
      <p>
        A Download from NCBI button in the library header opens a guided flow that
        pulls a sequence straight from NCBI into the active collection. You can
        fetch a gene by symbol plus organism (for example GAPDH in Homo sapiens),
        a genome or assembly, or any accession, whether a nuccore record like
        NM_002046 or a genome accession like GCF_000005845. The record is fetched
        directly from your browser against NCBI&apos;s public API, so the only
        thing that leaves your machine is the public identifier you ask for, the
        same privacy model as the Primer-BLAST handoff. Annotated records arrive
        with their features intact. Genome downloads are size-capped, and a genome
        larger than the cap is refused with a clear message rather than freezing
        the editor. The downloaded sequence lands as a fully parsed entry carrying
        a &ldquo;From NCBI&rdquo; provenance badge, with its accession kept
        linkable.
      </p>
      <Screenshot
        src="/wiki/screenshots/sequences-ncbi-download.png"
        alt="The Download from NCBI dialog showing a gene-symbol and organism search, a results list, and a size-capped preview before the download."
        caption="The Download from NCBI flow. Fetch a gene, a genome, or any accession; only the public identifier leaves your machine."
      />

      <h2>The tab bar and view modes</h2>
      <p>
        The bottom of the editor panel carries a tab bar with five tabs, Map,
        Sequence, Features, Primers, and History. These tabs are the main view
        switcher for the open sequence, modeled on SnapGene&apos;s bottom navigation.
        The Features and Primers tabs carry a count badge showing how many
        annotations or primer_bind features the sequence currently holds.
      </p>
      <p>
        The Map tab renders the sequence as a circular plasmid map or a linear map,
        depending on the sequence topology and the topology chip in the display
        strip. The Sequence tab renders the bases at nucleotide resolution with the
        complement strand, translation tracks, and ruler. The Features tab opens a
        structured list of every annotation on the sequence, with controls for
        adding, editing, or deleting features. The Primers tab lists every
        primer_bind feature as an oligo entry with its Tm, GC%, and binding site.
        The History tab shows the edit and save history for the sequence.
      </p>

      <h2>The display (Show) strip</h2>
      <p>
        A thin horizontal row of pill chips, labeled Show, sits in the editor
        chrome alongside the tab bar. This is the display strip. Each chip is a
        toggle, and pressing it switches a display layer on or off without changing
        the active tab. The strip carries eight chips. Features toggles the whole
        annotation layer. Primers toggles primer-binding annotations. Enzyme sites
        overlays restriction-enzyme cut sites. Translation shows the amino-acid
        translation of CDS features. Open reading frames is a distinct toggle that
        highlights ATG-to-stop runs (over 30 aa, both strands) in unannotated DNA.
        Ruler / index shows the base-position ruler. Topology relabels in place
        (Circular for a plasmid, Linear for a linear molecule) and overrides a
        circular sequence to a linear layout. Wrap, active when the sequence is
        shown in linear form, switches between a wrapped multi-row layout and a
        single continuous line. On the Features,
        Primers, and History tabs (where there is no canvas to draw on) the chips
        dim and go non-interactive in place rather than disappearing, so nothing
        jumps as you switch tabs.
      </p>
      <Screenshot
        src="/wiki/screenshots/sequences-view-rail.png"
        alt="The horizontal Show strip in the editor chrome, a row of pill-chip toggles with the Features and Ruler chips lit in sky blue."
        caption="The Show strip. Active layers read as a filled sky-blue pill; inactive layers are calm outline pills. A caret on the Features chip opens the per-type show/hide flyout."
      />
      <p>
        The Features chip carries a disclosure caret on its trailing edge. Clicking
        the caret opens a small flyout listing every feature type present on the
        sequence, with an eye icon per type so you can hide specific annotation
        categories (promoters, for example) without hiding everything. An amber
        dot on the Features chip marks when some types are hidden, so you never
        lose track of a non-default visibility state.
      </p>

      <h2>The circular and linear map</h2>
      <p>
        When the Map tab is active, plasmid sequences render as a circular map,
        a color-coded ring where each annotated feature appears as a named arc in
        the color assigned to its feature type. Clicking a feature arc on the map
        selects it and scrolls the Features panel to that entry. The topology
        chip in the display strip switches a circular sequence to a linear
        map if you prefer the linear layout, and a linear molecule always opens in
        linear form.
      </p>
      <Screenshot
        src="/wiki/screenshots/sequences-circular-map.png"
        alt="A circular plasmid map with labeled feature arcs in several colors (blue CDS arcs, green promoter arcs, orange rep_origin arc) and a position ring with tick marks."
        caption="A circular plasmid map. Feature arcs are color-coded by type. Click any arc to select the feature."
      />
      <Callout variant="tip" title="Restriction sites on the map">
        Enable the Enzyme sites chip in the display strip to overlay
        cut sites on the map. The default set of common restriction enzymes is
        pre-loaded; the enzyme picker (accessible from the Enzyme toolbar button)
        lets you filter to any subset.
      </Callout>

      <h2>The base-level sequence view</h2>
      <p>
        The Sequence tab renders the sequence at nucleotide resolution. The forward
        strand runs left to right; a complement strand renders below it; feature
        and primer annotations appear as labeled colored tracks above or below the
        bases; and a coordinate ruler above the bases shows position numbers. At
        high zoom levels the individual characters are readable and editable; at
        lower zoom levels the view summarizes the sequence as a density overview.
        A pinch gesture or the zoom slider at the bottom of the editor adjusts the
        zoom level continuously.
      </p>
      <Screenshot
        src="/wiki/screenshots/sequences-base-view.png"
        alt="The Sequence tab at high zoom, showing individual base characters in monospace with the complement strand beneath, feature arcs above, and the coordinate ruler at the top."
        caption="The Sequence view at base-character resolution. The ruler shows 1-based positions; feature tracks sit above the forward strand."
      />

      <h2>Editing a sequence</h2>
      <p>
        The editor is editable by default. Typing at the cursor inserts bases;
        backspace and delete remove them; and selecting a range and typing replaces
        it. The keyboard shortcuts for copy, cut, paste, select-all, undo, and redo
        all work as they do in a text editor. Cut and paste carry the molecular
        context, so pasting over a selection updates any feature coordinates that span
        the replaced region, and pasting a copied range that included features
        proposes bringing those features along.
      </p>
      <p>
        A toolbar above the editor carries the Undo, Redo, and Save buttons, plus
        dropdown menus for Edit operations, Feature and Primer actions, Enzyme
        management, and Analyze tools. Saving is explicit. The Save button records
        a new checkpoint in the sequence history. The History tab surfaces every
        saved checkpoint with a diff and an optional restore path.
      </p>
      <p>
        A Find box in the toolbar searches by DNA sequence (exact match, with a
        closest-match fallback for near-misses), by feature name, or by protein
        sequence. Each match highlights in the viewer and the arrow keys step
        through multiple hits.
      </p>

      <h2>The live selection readout</h2>
      <p>
        When you click or drag to select bases in the editor, a readout bar at the
        bottom of the editor updates immediately with the selection coordinates,
        the length in base pairs, and the GC content as a percentage. For
        selections between 8 and 50 bp the readout also shows the predicted Tm,
        computed using the same nearest-neighbor thermodynamic model the primer
        tools use. A floating badge near the cursor shows the same information
        while you are still dragging, so you can see the stats before you release.
        Clicking a feature arc rather than dragging shows the feature name alongside
        its coordinates.
      </p>
      <Screenshot
        src="/wiki/screenshots/sequences-selection-readout.png"
        alt="The selection readout bar at the bottom of the editor showing the range coordinates, length in bp, GC percent, and a Tm value for a short selected region."
        caption="The selection readout updates live as you drag. Tm appears for oligo-length selections (8&ndash;50 bp)."
      />
      <Callout variant="info" title="The Tm model">
        The Tm displayed in the selection readout is the same nearest-neighbor
        model that powers the Primer Tm tab in the Lab calculators modal, using
        SantaLucia parameters. Selecting the exact span of a primer you are
        designing is a quick way to sanity-check the Tm before adding it.
      </Callout>

      <h2>Annotating a sequence</h2>
      <p>
        Features are the annotation layer of a sequence. Each feature has a name,
        a type (CDS, promoter, primer_bind, rep_origin, and so on), a strand, a
        color, a set of coordinates, and an optional set of GenBank qualifiers
        (/product, /gene, /note, and others). The Sequences workbench provides
        several paths to add or update features.
      </p>
      <p>
        The most direct path is to select a region on the map or sequence and
        open the feature editor from the context menu or the Feature toolbar menu.
        The feature editor dialog mirrors the SnapGene &ldquo;Edit Feature&rdquo;
        interface, with a name, type, strand, a segment table for multi-segment
        features, a color swatch, and the qualifiers editor. A &ldquo;Translate in sequence
        view&rdquo; toggle marks CDS features for translation display; a
        &ldquo;Prioritize display&rdquo; toggle keeps important features legible
        on dense maps.
      </p>
      <Screenshot
        src="/wiki/screenshots/sequences-feature-dialog.png"
        alt="The feature editor dialog open over the sequence editor, showing name, type, strand, and color fields along with a segment table and qualifiers section."
        caption="The feature editor. Qualifiers follow the GenBank standard; add or remove rows freely."
      />
      <p>
        For sequences without annotations, two automated paths under the Analyze
        menu can propose features. Detect Features runs a local database scan
        against bundled protein and DNA element reference sets. It identifies
        common elements such as fluorescent proteins, origins of replication,
        antibiotic resistance genes, and common promoters, and it reports each
        hit with its position, strand, and percent identity so you can review and
        accept or reject each proposal. Annotate from Reference aligns the open
        sequence against a second sequence you choose from the library and proposes
        to carry over the reference&apos;s features wherever alignment identity
        is high enough. Both paths land their accepted features in a single
        undoable edit.
      </p>

      <h2>Protein analysis</h2>
      <p>
        Selecting a CDS feature opens a protein inspector for the coding region.
        The inspector reads out the protein length in amino acids, the molecular
        mass in kDa, and the isoelectric point, and it offers three actions.
        Translate to protein turns on the amino-acid track on the map. Full protein
        properties opens a deeper view with the amino-acid composition, a
        hydropathy profile, and the extinction coefficient. Find domains runs an
        on-device HMMER scan in the protein panel, with an optional handoff to
        EBI InterProScan for a fuller search. Domain hits are labeled by source
        (EBI InterProScan, an on-device database, or a curated common-domains set)
        so you always know where a call came from.
      </p>
      <p>
        A completed domain scan saves as a result artifact, so you can re-open it
        later from the History tab&apos;s Results section without recomputing it
        (see Sequence history below).
      </p>

      <h2>The cloning engine</h2>
      <p>
        The Cloning Workspace is a multi-fragment assembly tool launched from the
        Assemble button in the library header. It supports four assembly chemistries
        from one method-picker interface.
      </p>
      <p>
        Overlap assembly (Gibson / NEBuilder HiFi) takes two or more fragments from
        the library or pasted directly, designs the junction overlap regions to a
        target length or Tm, and assembles them into a linear or circular product.
        The junction primers needed to amplify each fragment with the overlapping
        tails are computed automatically and offered as a copyable oligo order list
        or as primer_bind features on the product.
      </p>
      <p>
        Restriction and ligation cuts two sequences at chosen restriction enzyme
        sites (from a set of common cutters, EcoRI, BamHI, HindIII, PstI, KpnI,
        SmaI, XhoI, NotI) and ligates the compatible ends, computing all possible
        directional products and letting you pick the intended one.
      </p>
      <p>
        Golden Gate (Type IIS) uses a chosen Type IIS enzyme (BsaI, BsmBI, BbsI,
        or SapI) to assemble fragments via non-palindromic four-base overhangs,
        producing a scarless product at each junction. Gateway (BP or LR) simulates
        the recombination-based transfer between entry and destination vectors,
        computing the att site recombination and the resulting construct.
      </p>
      <Screenshot
        src="/wiki/screenshots/sequences-cloning-methods.png"
        alt="The Cloning Workspace showing the four method pills (Overlap, Restriction, Golden Gate, Gateway) with the Overlap method selected and a fragment picker below."
        caption="The Cloning Workspace. Pick a chemistry from the four method pills, then add fragments from the library or paste them in."
      />
      <p>
        All four chemistries share the same two-step flow. Pick fragments and set
        options, then review the computed product. The review screen shows the
        assembled sequence with its features and any warnings (such as internal cut
        sites that would be severed by the chosen enzyme). Saving the product
        creates a new sequence in the active collection.
      </p>
      <Screenshot
        src="/wiki/screenshots/sequences-cloning-review.png"
        alt="The Cloning Workspace review step showing the assembled product with its features, junction warnings in amber, and a Save to library button."
        caption="The review step. Warnings flag potential problems (internal cut sites, mismatched overhangs). Accept or go back to adjust."
      />

      <h2>Primer design</h2>
      <p>
        The primer tools in the Sequences workbench are built around the binding
        site, not just the sequence. The Add Primer dialog (accessible from the
        Primer toolbar menu or by selecting a region and using the context menu)
        takes a primer sequence by typing, pasting, or seeding from the current
        selection. As you type, it shows the length in nucleotides, the GC content,
        the predicted Tm, the number of binding sites on the template, and a
        visual alignment of the primer against its annealing region, with the
        5&apos; tail dimmed and the annealing bases highlighted over the template.
        A reverse-complement toggle switches the primer orientation without retyping.
      </p>
      <Screenshot
        src="/wiki/screenshots/sequences-primer-design.png"
        alt="The Add Primer dialog showing a primer sequence in the input, live stats (N-mer, GC%, Tm), and a visual alignment of the primer against the template strand below."
        caption="The Add Primer dialog. Stats update live as you type. The alignment shows the annealing region and any 5&apos; tail."
      />
      <p>
        Double-clicking an existing primer_bind feature on the map or sequence
        opens the Edit Primer dialog, which shows the same stats and alignment but
        seeds everything from the stored feature. Editing the oligo in this dialog
        re-derives the binding site and Tm live; saving writes back to the feature.
        Primers can also be given an explicit color independent of the default
        primer type color, so forward and reverse primers on the same template are
        visually distinct.
      </p>
      <p>
        The Primer Design mode in the Add Primer dialog includes a mutagenesis
        path. Opening the dialog in mutagenesis mode lets you specify a substitution,
        insertion, or deletion at a chosen position, and the engine designs a
        primer with the mutation incorporated and the flanking bases selected to
        hit a target Tm.
      </p>

      <h2>Specificity checking via NCBI</h2>
      <p>
        After designing a primer, a specificity check against NCBI BLAST is
        available from the Primers panel. Clicking the BLAST link for a primer
        opens the NCBI Primer-BLAST interface in a new tab with the primer sequence
        pre-filled, handing off to NCBI&apos;s servers to check for off-target
        binding against any genome in their database. This is a handoff, not an
        embedded result. The check runs in the browser against NCBI&apos;s public
        API, and the result stays in the NCBI tab.
      </p>
      <Screenshot
        src="/wiki/screenshots/sequences-ncbi-specificity.png"
        alt="The NCBI Primer-BLAST page open in a browser tab with the primer sequence pre-filled in the forward primer field."
        caption="NCBI Primer-BLAST opens pre-filled with the primer sequence. The specificity check runs on NCBI&apos;s servers."
      />

      <h2>Comparing and aligning sequences</h2>
      <p>
        The Compare / Align dialog (accessible from the Analyze menu in the editor
        or from the library header) accepts two sequences from the library and runs
        a pairwise alignment. Two alignment modes are available, global
        (Needleman-Wunsch, end-to-end alignment) and local (Smith-Waterman, best
        matching region). Scoring is IUPAC-aware for DNA, so degenerate base codes
        in either sequence match their constituent bases correctly, and a BLOSUM62
        protein scoring mode is available for amino acid sequences. The dialog
        auto-detects whether the sequences look like protein or DNA from their
        character content and switches the default scoring accordingly.
      </p>
      <p>
        The result shows the percent identity, the number of mismatches and gaps,
        and the full wrapped alignment with a match/mismatch midline and coordinate
        ticks. For shorter sequences a k-mer dotplot renders below the alignment,
        giving a visual read on repeat structure or structural similarity. Sequences
        longer than roughly 60,000 bases cannot be aligned end-to-end in the
        browser without hanging; the dialog reports this limit and suggests the
        local mode instead.
      </p>
      <Screenshot
        src="/wiki/screenshots/sequences-compare.png"
        alt="The Compare dialog showing a pairwise alignment between two plasmids with a percent identity header, a wrapped monospace alignment with a match midline, and a dotplot below."
        caption="The Compare dialog. Global or local alignment, IUPAC-aware DNA or BLOSUM62 protein scoring, plus an optional dotplot."
      />

      <h2>Mutagenesis</h2>
      <p>
        Site-directed mutagenesis primer design is available directly from the
        sequence editor. Select the target region, open the Add Primer dialog
        from the Primer menu, and switch to Mutagenesis mode. The mutagenesis
        designer accepts three mutation types, substitution (change one or more
        bases to specific alternatives), insertion (add bases at a position), and
        deletion (remove a span of bases). Given the mutation spec and the
        flanking template sequence, the engine computes a primer that incorporates
        the mutation with flanks long enough to hit a target Tm. The resulting
        primer can be added to the sequence as a primer_bind feature or copied
        directly to the clipboard for ordering.
      </p>

      <h2>Sequence history</h2>
      <p>
        Every explicit Save in the sequence editor records a checkpoint in the
        sequence history. The History tab shows these checkpoints as a timeline,
        with the date and time of each save. Selecting a checkpoint shows the
        sequence state at that point and the diff between that checkpoint and the
        current version. Restore from the history tab rolls the sequence back to
        the selected checkpoint in one click, creating a new checkpoint so the
        roll-forward is also preserved.
      </p>
      <p>
        The History tab also carries a Results section above the version timeline.
        Operations that produce something, a completed Compare / Align run or a
        domain scan, persist there as re-openable result artifacts rather than
        throwaway popups. Re-opening one re-renders the stored result without
        recomputing it. Each artifact records a fingerprint of the sequence at the
        moment it was computed, so a result picks up a staleness flag once the
        sequence has changed since the run, telling you the stored result no longer
        reflects the current molecule.
      </p>
      <Callout variant="info" title="History and the version-history system">
        Sequence history uses the same underlying engine as the{" "}
        <Link href="/wiki/features/version-history">Version History</Link> system
        for notes. The checkpoint model and restore path are shared; the sequence
        surface just exposes them through the editor&apos;s History tab rather
        than the per-note timeline panel.
      </Callout>

      <h2>Exporting sequences</h2>
      <p>
        Sequences can be exported in GenBank format or FASTA format from the Export
        menu in the editor toolbar. The GenBank export preserves all features,
        qualifiers, and topology flags in the standard .gb format that any sequence
        analysis tool can read. The FASTA export writes the raw sequence string
        with the sequence name as the header. A selection-to-FASTA option exports
        only the selected region, and a selection-to-protein-FASTA option exports
        the translated amino acid sequence of the selected CDS. The circular map
        can also be exported as a PNG or SVG image from the map view. A saved
        sequence map also drops into the{" "}
        <Link href="/wiki/features/figures">Figure Composer</Link> at{" "}
        <code>/figures</code> as a per-panel-styleable panel, so you can lay it out
        alongside plots, trees, and molecules in a multi-panel publication figure
        and export the whole page as one clean vector SVG.
      </p>

      <h2>Connection to the rest of the app</h2>
      <p>
        Sequences participate in the shared folder structure alongside notes,
        experiments, and methods. A sequence is filed under a project through the
        collection it belongs to, so it shows up in the same project context as
        the experiments that use it. Deleting a sequence goes through the same
        trash flow as every other record type, with the same 30-day recovery window
        and the same restore behavior.
      </p>
      <p>
        A sequence also embeds as a live read-only block inside a note, rendered
        either as a map ribbon or as a bases preview, so a write-up can show the
        construct without leaving the editor. Enriching a sequence&apos;s organism
        from NCBI fills in its taxonomic lineage, and an &ldquo;Explore in
        tree&rdquo; link then opens the tree view centered on that organism.
      </p>
      <p>
        BeakerBot can drive the workbench too. The assistant can compute Tm,
        translate a sequence, take a reverse complement, find open reading frames,
        design primers, fetch a record from NCBI, and run Gibson or
        digest-and-ligate assembly, all through the same engines the editor uses.
      </p>
      <p>
        The primer Tm engine in the Sequences workbench is the same nearest-neighbor
        model used elsewhere in the app. The same nearest-neighbor Tm model powers
        the Primer Tm tab in the Lab calculators modal, so a Tm you compute from a
        selection in the sequence editor and one you compute in the calculator will
        always agree.
      </p>
      <Callout variant="tip" title="Sequences and the Methods Library">
        PCR protocol templates in the{" "}
        <Link href="/wiki/features/methods">Methods Library</Link> store primer
        sequences and annealing temperatures as part of the protocol record. If
        you design primers in the Sequences workbench and then attach the protocol
        to an experiment, the primer fields in the protocol and the primer_bind
        features on the template sequence are separate records. Copy the Tm from
        the selection readout into the PCR protocol&apos;s annealing temperature
        field to keep them consistent.
      </Callout>
    </WikiPage>
  );
}
