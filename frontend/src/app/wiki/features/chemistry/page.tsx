import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { TryInDemo } from "@/components/wiki/TryInDemo";

export default function ChemistryFeaturePage() {
  return (
    <WikiPage
      title="Chemistry"
      intro="The Chemistry workbench is where you draw structures, build a molecule library, and find the papers and patents that mention a compound, all in the browser and all filed alongside your projects."
    >
      <Screenshot
        src="/wiki/screenshots/chemistry-workbench-overview.png"
        alt="The Chemistry workbench showing the molecule library rail on the left, a list of molecules with structure thumbnails, and a selected molecule's detail view on the right with its structure depiction and identity facts."
        caption="The Chemistry workbench. The molecule library sits on the left, and the selected molecule opens in the detail view on the right."
      />

      <TryInDemo href="/chemistry">Try the Chemistry workbench</TryInDemo>

      <h2>What the workbench is</h2>
      <p>
        The Chemistry workbench gives you two tools that chemists normally pay a
        per-seat license for. The first is a structure editor in the style of
        ChemDraw, a full drawing surface for molecules that runs entirely in your
        browser. The second is a literature and patent search in the style of
        SciFinder, where you pick a compound or draw a fragment and see the papers
        and patents that mention it. Both are free, both keep your structures in
        your own folder, and neither needs an account or a server. The workbench
        lives at <code>/chemistry</code> and is one click away from the rest of the
        app.
      </p>
      <p>
        The reason it works without a backend is that the chemistry itself runs in
        your browser. The drawing surface, the structure cleanup, the molecular
        formula and weight, the canonical SMILES and InChIKey, all of it is computed
        locally by chemistry libraries compiled to run in the page. Your structures
        are written to your data folder as standard MDL Molfiles, the same format
        ChemDraw and every other tool reads, so nothing is locked inside ResearchOS.
      </p>

      <h2>The molecule library</h2>
      <p>
        The left rail of the workbench is your molecule library. It lists every
        molecule in your folder, each row carrying a small rendered structure
        thumbnail, the name, and the molecular formula and average weight. This is
        the same signature left-rail layout the{" "}
        <Link href="/wiki/features/sequences">Sequences</Link> and{" "}
        <Link href="/wiki/features/datahub">Data Hub</Link> workbenches use, so
        clicking through your collection feels the same everywhere.
      </p>
      <Screenshot
        src="/wiki/screenshots/chemistry-library-rail.png"
        alt="The molecule library rail with the collection selector open, showing All molecules, Unfiled, and a list of project names each with a molecule count."
        caption="The collection selector scopes the library to one project, to the unfiled molecules, or to everything at once."
      />
      <p>
        A collection selector at the top of the rail groups molecules by project,
        so you can narrow the list to one project, view the molecules not yet filed
        under any project, or open the library to everything at once. Each option
        carries a live count. Below the selector, a search box filters the list by
        name as you type, and a sort control orders the list by most recent or by
        name. Clicking a row opens that molecule in the detail view on the right.
        The rail can be collapsed to a thin edge when you want the detail view full
        width, and the divider between the rail and the detail view drags to set the
        rail width, which is remembered for next time.
      </p>

      <p>
        <strong>Search by structure.</strong> Beyond the name filter, a
        search-by-structure mode finds molecules in your own library by chemistry
        rather than text. You type a SMILES or SMARTS query and pick one of two
        modes. Substructure match returns every molecule that contains that
        fragment, and Similarity ranks the library by Tanimoto score against your
        query, with the match shown as a percent on each result, so the analogs you
        already have surface even when their names give nothing away.
      </p>
      <p>
        <strong>Right-click and bulk actions.</strong> Right-clicking a molecule in
        the rail opens quick actions to rename it, duplicate it, send it to a note,
        experiment, or method, or delete it. Selecting several rows with their
        checkboxes lets you delete a batch or file it all under a project at once.
      </p>

      <h2>Getting molecules into the library</h2>
      <p>
        There are three ways to add a molecule, surfaced as the New, PubChem, and
        Import actions at the top of the library rail.
      </p>

      <p>
        <strong>Draw a new structure.</strong> The New action opens the structure
        editor on a blank canvas. You draw the molecule with bonds, rings,
        templates, and the periodic table, then save it to the library. The editor
        is the same surface described under{" "}
        <Link href="#editing">Drawing and editing structures</Link> below.
      </p>

      <p>
        <strong>Import from PubChem.</strong> The PubChem action opens a search box.
        Type a compound name and the search returns a grid of candidate compounds
        from PubChem, each with its structure, formula, and weight, so you can pick
        the right one rather than guessing from a name alone. Importing a candidate
        pulls its structure into your library and records its PubChem compound id
        alongside the locally computed identity, which is what lets the literature
        search find its linked papers and patents later.
      </p>
      <Screenshot
        src="/wiki/screenshots/chemistry-pubchem-import.png"
        alt="The PubChem import dialog with the word caffeine typed in the search box and a grid of candidate compounds below, each showing a rendered structure, name, formula, and molecular weight."
        caption="PubChem import returns a grid of candidates so you can choose the right compound, not just the first name match."
      />

      <p>
        <strong>Import a structure file.</strong> The Import action accepts MDL
        Molfiles (.mol), SDF files (.sdf, where each record lands as its own
        molecule), and SMILES files (.smi, .smiles). A plain <code>.txt</code> file
        is treated as one SMILES per line, so a column of structures comes in as a
        batch. ChemDraw&apos;s own <code>.cdxml</code> and <code>.cdx</code> files
        are recognized too, though they are not parsed directly, so the workbench
        asks you to export them as MOL or SMILES from ChemDraw first and import
        that. Everything is parsed in your browser, so the file never leaves your
        machine. A single-molecule import drops you straight onto the new molecule
        in the detail view.
      </p>
      <Callout variant="info" title="Where molecules are stored">
        Each molecule is written to your folder as
        a <code>.mol</code> Molfile (the source of truth) next to a small
        <code>.meta.json</code> sidecar holding the name, the source, the project
        links, and the computed identity. The Molfile is a standard format, so your
        structures stay readable by ChemDraw, RDKit, Open Babel, and anything else,
        with or without ResearchOS.
      </Callout>

      <h2>The molecule detail view</h2>
      <p>
        Clicking a molecule in the rail opens its detail view. This is the fast
        browse surface, and it does not load the heavy editor, so moving between
        molecules is instant. At the top is a large rendered depiction of the
        structure. Below it is an identity table with the molecular formula, the
        average molecular weight, the canonical SMILES, and the InChIKey, all
        computed locally from the structure rather than stored blindly from
        whatever the source provided.
      </p>
      <Screenshot
        src="/wiki/screenshots/chemistry-molecule-detail.png"
        alt="The molecule detail view showing a large structure depiction on the left, an identity table with formula, average molecular weight, canonical SMILES, and InChIKey on the right, copy actions beneath, and a linked-projects section."
        caption="The detail view. Identity facts are computed locally from the structure; the copy actions put the SMILES, InChIKey, or a note reference on your clipboard."
      />
      <p>
        Quick copy actions put the canonical SMILES, the InChIKey, or a reference to
        the molecule on your clipboard, and a Send to action pushes the molecule
        straight into a note, experiment, or method. The molecule reference pastes
        into a note as a chip that links back to this molecule, so a synthesis note
        can point directly at the compound it describes. A linked-projects section
        shows which projects the molecule belongs to, with controls to add or remove
        a project link, a Referenced in panel lists everywhere the molecule is
        already cited across your notes, experiments, and methods, and a literature
        panel loads on demand. An Edit structure button opens the molecule in the
        full editor.
      </p>
      <p>
        Alongside the core identity, the detail view shows a properties panel with
        calculated druglikeness numbers, the cLogP, the topological polar surface
        area, hydrogen-bond donors and acceptors, aromatic rings, and rotatable
        bonds, next to a Lipinski Rule-of-Five badge that flags at a glance whether
        the molecule sits inside the usual oral-druglikeness limits. For a molecule
        imported from PubChem, some of these descriptors are carried from PubChem
        itself, while the core identity is always recomputed locally.
      </p>
      <Callout variant="info" title="Deleting a molecule is recoverable">
        The Delete action in the detail view asks for confirmation, then moves the
        molecule to the{" "}
        <Link href="/wiki/features/trash">Trash</Link> rather than erasing it. You
        can undo it straight away from the toast that appears, or restore it later
        from the Trash, the same recovery window notes and sequences get. The
        confirmation step lands focus on Cancel so the destructive button is never
        the default.
      </Callout>

      <h2 id="editing">Drawing and editing structures</h2>
      <p>
        The structure editor opens in a panel over the workbench, launched by the
        New action or the Edit structure button. It is a full molecular drawing
        surface with bond and ring tools, a template library of common scaffolds
        and functional groups, the periodic table for any element, charges and
        radicals, stereochemistry, and reaction arrows. You can paste a SMILES or a
        Molfile straight onto the canvas, and a structure cleanup pass tidies bond
        lengths and angles.
      </p>
      <Screenshot
        src="/wiki/screenshots/chemistry-editor.png"
        alt="The structure editor open over the workbench, showing a drawing canvas with a molecule, a vertical bond and template toolbar on the left, and Save and Cancel actions."
        caption="The structure editor. Draw with bonds, rings, and templates, or paste a SMILES or Molfile onto the canvas."
      />
      <p>
        When you save, the structure is written to your folder as a Molfile and the
        identity facts are recomputed from what you drew, so the formula, weight,
        SMILES, and InChIKey always match the structure on the canvas. The editor is
        a heavier surface than the detail view because it loads a complete drawing
        engine, which is why browsing molecules uses the lightweight detail view and
        the editor opens only when you actually draw or edit.
      </p>

      <p>
        The editor keeps a version history. Every time you save, it records a
        version, and a History tab in the editor rail lists them so you can look back
        at an earlier structure and restore it. This mirrors the{" "}
        <Link href="/wiki/features/version-history">version history</Link> notes get,
        so an edit that turned out wrong is never a dead end.
      </p>

      <h2>Literature and patents</h2>
      <p>
        The literature search is the free answer to the feature chemists pay
        SciFinder for. You pick a compound or draw a fragment, and it shows the
        papers and patents that mention it. It is assembled entirely in your browser
        from three public, no-key sources, so there is no server in the middle and
        nothing to log in to.
      </p>
      <p>
        The per-molecule view lives in the detail panel. Opening the literature
        panel for a molecule pulls its linked PubMed papers and patent identifiers
        from PubChem, and its full-text chemical mentions from Europe PMC, the open
        European biomedical literature index. Each paper links out to its article
        page and each patent links to Google Patents. A common compound returns tens
        of thousands of results, so the panel ranks and paginates them and always
        shows the total rather than dumping everything. You can star a paper or a
        patent, and the star persists on the molecule, so the next time you open it
        your saved references surface as a one-click strip above the live results.
      </p>
      <Screenshot
        src="/wiki/screenshots/chemistry-literature.png"
        alt="The literature panel for a molecule, with a Papers section listing article titles from Europe PMC and a Patents section listing patent numbers, each linking out, and a total count at the top of each list."
        caption="Papers and patents for a molecule, drawn live from PubChem and Europe PMC. Each result links out to its source."
      />
      <p>
        The Literature action in the library rail opens the same search as a
        standalone surface, so you can look up a compound by name without first
        adding it to your library. Below the name search sits a substructure patent
        search powered by SureChEMBL, which indexes compounds extracted from 28
        million patents. You type a SMILES or SMARTS fragment, and it finds patent
        compounds that contain that substructure. The search runs asynchronously on
        SureChEMBL, submitting the fragment and polling until the results are ready.
      </p>
      <Screenshot
        src="/wiki/screenshots/chemistry-substructure-patents.png"
        alt="The standalone literature surface with a compound search box and example chips, and below it the SureChEMBL substructure patent search with a SMILES fragment entered, ready to find patent compounds that contain it."
        caption="The standalone literature surface. Search a compound by name, or use the SureChEMBL substructure search to find patent compounds that contain a fragment."
      />
      <Callout variant="info" title="What the free search does and does not cover">
        These sources are the free 90 percent, not a replacement for the curated
        databases. PubChem links are depositor and co-occurrence data, Europe PMC
        mines open-access and Creative Commons full text plus abstracts rather than
        every paywalled paper, and SureChEMBL indexes specific extracted compounds
        rather than the generic Markush claims a service like CAS deconstructs by
        hand. The workbench states this limit in the search itself so you always
        know what you are looking at.
      </Callout>

      <h2>How identity is computed</h2>
      <p>
        Every molecule carries a set of identity facts, the molecular formula, the
        average molecular weight, the canonical SMILES, and the InChIKey. These are
        not taken on faith from the source of the structure. They are computed
        locally from the Molfile by RDKit running in your browser, so a structure
        you drew, one you imported from PubChem, and one you loaded from a file all
        get their identity the same way. The InChIKey in particular is a stable
        hash of the structure, which is what makes it a reliable key for looking a
        compound up in an external database.
      </p>

      <h2>Connection to the rest of the app</h2>
      <p>
        Molecules participate in the shared folder structure alongside notes,
        experiments, and sequences. A molecule is filed under a project through the
        linked-projects control in its detail view, and each project surface carries
        a Molecules section listing the structures linked to that project, so the
        compound shows up in the same project context as the experiments that use it.
      </p>
      <Screenshot
        src="/wiki/screenshots/chemistry-project-molecules.png"
        alt="A project surface with a Molecules section showing structure thumbnails and names for the molecules linked to that project, each linking back into the Chemistry workbench."
        caption="The Molecules section on a project surface. Each entry links back to the molecule in the Chemistry workbench."
      />
      <p>
        Because a molecule has its own reference, you can mention it from a note. The
        molecule reference pastes as a chip that deep-links back to the structure,
        opening it in the workbench when clicked, the same way a note can reference a
        sequence or an experiment. This keeps the structure and the writing about it
        in one connected place rather than as a screenshot pasted into a document.
      </p>
      <p>
        A molecule also drops into the figure composer at <code>/figures</code> as a
        panel, depicted by the same renderer the workbench uses, so a structure sits
        in a publication layout next to your plots and sequence panels. Chemistry
        panels carry no per-panel styling controls, by design, since the depiction is
        the structure itself.
      </p>

      <h2>Working with BeakerBot</h2>
      <p>
        BeakerBot, the assistant that runs throughout the app, can operate the
        Chemistry workbench for you. It can create a molecule from a SMILES you give
        it, pull one in from PubChem by name or CID, read a molecule&apos;s identity
        back to you, rename it, edit its structure from a SMILES you provide, and
        delete it to the Trash. When you have a molecule selected in the rail, it
        resolves &quot;this molecule&quot; to that selection, so you can ask it to
        rename or read the one you are looking at without naming it.
      </p>
      <p>
        The line BeakerBot will not cross is inventing chemistry. It operates the
        app and relays what the on-device engine computes, so a formula, weight, or
        canonical form always comes from RDKit, never from the model&apos;s memory,
        and a structure edit only ever uses a SMILES you actually provided. Every
        write shows a preview first, and a delete asks for a confirmation, so nothing
        changes in your library without your say-so.
      </p>

      <h2>What it is built on</h2>
      <p>
        The Chemistry workbench stands on open-source chemistry. The drawing surface
        is Ketcher from EPAM, the structure perception and identity calculations are
        RDKit, and the literature search draws on PubChem, Europe PMC, and SureChEMBL.
        All of it runs in your browser against public data, which is what keeps the
        feature free and your structures local. These projects and the rest of the
        open-source software ResearchOS is built on are credited on the{" "}
        <Link href="/wiki/trust/open-source">open-source page</Link>.
      </p>
      <Callout variant="tip" title="Your structures stay on your machine">
        Drawing, editing, and identity calculation all happen in the browser, so a
        structure you draw never leaves your computer on its own. The only time
        anything about a molecule is sent anywhere is when you run a literature or
        patent search, which sends the compound name or the drawn fragment to the
        public PubChem, Europe PMC, or SureChEMBL service to ask for matches. If you
        never open the literature search, nothing about your structures is
        transmitted.
      </Callout>
    </WikiPage>
  );
}
