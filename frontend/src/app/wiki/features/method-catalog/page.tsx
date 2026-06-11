import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function MethodCatalogPage() {
  return (
    <WikiPage
      title="Template Library"
      intro="A blank protocol is a slow way to start. The Template Library ships a set of pre-built, ready-to-use protocols, from a Q5 PCR recipe to a 384-well viability plate to an LC-MS run, that you can drop straight into your Methods library and edit. Many of them carry the vendor PDF they were transcribed from, so you can check any number against the original insert."
    >
      <h2>What a template is, and why</h2>
      <p>
        A <strong>template</strong> is a starting point for a{" "}
        <Link href="/wiki/features/methods">method</Link>. It is a complete,
        structured protocol someone has already written, with the right method
        type (PCR, plate layout, LC gradient, free-form markdown), the reagent
        table filled in, the cycling program set, and the steps written out. When
        you use a
        template, ResearchOS copies it into your own Methods library as a new
        method you fully own and can edit. The original template is never touched,
        and your copy is yours to adapt for your bench.
      </p>
      <p>
        The point is twofold. First comes speed. You should not have to retype a
        standard agarose-gel procedure or rebuild a colony-PCR program from
        memory every time. Second, and just as important, comes{" "}
        <strong>fidelity</strong>. A transcribed protocol from a known source is
        less error-prone than one reconstructed from memory or copied out of an
        old lab notebook, and when the template carries its source document you
        can verify it (more on that below).
      </p>

      <h2>What is in the library</h2>
      <p>
        The library ships <strong>91 templates</strong> grouped by the kind of
        lab task they cover. Each one targets a specific method type, so it opens
        in the right editor with the right fields the moment you use it.
      </p>
      <ul>
        <li>
          <strong>Molecular biology</strong> is the largest group, with PCR setups
          (Q5, Taq, colony-PCR screens), gel electrophoresis, cloning and
          assembly steps, and similar bench protocols.
        </li>
        <li>
          <strong>qPCR</strong> covers dye-based and probe-based master-mix
          protocols (Luna, QuantiNova, and others), each with the primer
          concentrations, cycling, and melt-curve guidance from the kit handbook.
        </li>
        <li>
          <strong>Cell culture</strong> covers passaging schedules, media, and
          viability assays.
        </li>
        <li>
          <strong>LC-MS</strong> covers liquid-chromatography gradients and mass
          spec acquisition, including a few that pair the two into one unit
          (see <a href="#lcms">LC-MS combination templates</a>).
        </li>
        <li>
          <strong>Plate layouts</strong> are ready-to-annotate 96- and 384-well
          grids for dose-response and assay work.
        </li>
        <li>
          <strong>Protein biochemistry, cell biology, analytical chemistry,</strong>{" "}
          and a <strong>general</strong> blank-protocol skeleton round out the
          set.
        </li>
      </ul>
      <Screenshot
        src="/wiki/screenshots/method-catalog-library.png"
        alt="The Template Library picker showing template cards grouped by lab-task category, each card with a title, a short description, a method-type pill, and a small badge marking templates that bundle a source PDF."
        caption="The Template Library picker. Cards are grouped by lab-task category, with a method-type pill and a search box that filters by name, type, or tag."
      />

      <h2>The verifiable source PDF</h2>
      <p>
        This is what makes these templates trustworthy and not only convenient.
        A growing subset of the library, <strong>52 of the 91 templates today</strong>{" "}
        and rolling out further, <strong>bundles the actual vendor document</strong>{" "}
        the protocol was transcribed from, whether that is the kit insert, the
        manufacturer handbook, or the published method PDF. The file
        ships with ResearchOS and is recorded with its original source URL and a
        SHA-256 checksum, so the copy you have is verifiably the document it
        claims to be.
      </p>
      <Callout variant="tip" title="Verify any number against the original">
        Transcription can introduce errors, and a protocol you cannot check is a
        protocol you have to trust blindly. With the bundled PDF one click away,
        you can confirm an annealing temperature, a reagent volume, or a primer
        concentration against the manufacturer&apos;s own insert before you run
        the bench. The template is the convenient form, and the PDF is the proof.
      </Callout>
      <p>
        Two buttons in the template detail make that comparison one click each.{" "}
        <strong>View full protocol</strong> opens the complete extracted method
        rendered the way it will look once it is in your library, the full reagent
        table and cycling program rather than the compact summary the preview
        shows. <strong>View vendor PDF</strong> opens the bundled source document.
        Side by side, they let you read our transcription against the
        manufacturer&apos;s original, which is also how we audit the library
        ourselves.
      </p>
      <Screenshot
        src="/wiki/screenshots/method-catalog-source-pdf.png"
        alt="A template detail with its bundled source PDF open side by side, showing the transcribed reagent table next to the same values in the original vendor insert."
        caption="The structured template beside the vendor PDF it came from. Any value in the template can be checked against the original."
      />
      <Callout variant="info" title="Not every template, and that is honest">
        Source-PDF bundling is a rollout, not a finished state. 52 of the 91
        templates carry their document today. Templates without a bundled PDF
        still cite their source in the protocol text (a URL and a reference), so
        you always know where a procedure came from, even when the document is
        not shipped inline yet.
      </Callout>

      <h2>How to use a template</h2>
      <p>
        Templates live one step away from your own{" "}
        <Link href="/wiki/features/methods">Methods library</Link>. You browse
        them, preview them, and pull the one you want into your library as an
        editable method.
      </p>
      <Steps>
        <Step>
          From the Methods library, open the template browser. Use the{" "}
          <strong>segmented control</strong> to switch between your method types
          and the template catalog, and the <strong>category filter</strong> and{" "}
          <strong>search box</strong> (by name, type, or tag) to narrow the list.
        </Step>
        <Step>
          <strong>Select a template</strong> to preview it in the detail pane. A
          compact preview shows the shape of the protocol, and two buttons open
          the full view, <strong>View full protocol</strong> for the complete
          rendered method and (for the 52 with a bundled document){" "}
          <strong>View vendor PDF</strong> for the original.
        </Step>
        <Step>
          Pick a <strong>destination category</strong> for where the new method
          should land in your library (the detail pane shows &quot;Will be added
          to&quot; so there is no surprise), then click{" "}
          <strong>Use template</strong>.
        </Step>
        <Step>
          The template is copied into your Methods library as a brand-new method
          you own. Edit it freely, attach it to experiments, and share it with
          the lab if you like. None of that touches the original template.
        </Step>
      </Steps>
      <Screenshot
        src="/wiki/screenshots/method-catalog-template-detail.png"
        alt="A template detail pane showing the structured protocol body, the method-type pill, the destination-category control reading Will be added to, and the Use template button."
        caption="A template detail. Preview the full protocol, choose where it lands, then Use template to copy it into your library."
      />

      <h2 id="plates">384-well plates</h2>
      <p>
        Plate-layout templates are not just a picture of a grid. They are an
        interactive, annotated layout for the exact plate format you work in,
        including <strong>384-well</strong> plates (16 rows A through P by 24
        columns). The 384-well viability template, for example, ships with the
        blank, vehicle, and max-kill control columns marked and a 20-point dose
        series laid across the plate, following standard assay-guidance practice.
        You start from a real, sensible layout instead of an empty grid, then
        adjust it for your samples.
      </p>
      <Screenshot
        src="/wiki/screenshots/method-catalog-384-plate.png"
        alt="A 384-well plate-layout template rendered as a 16-by-24 interactive grid, with control columns and a dose-response series annotated by color."
        caption="A 384-well plate-layout template. Control columns, blanks, and a dose series come pre-annotated; you adjust from there."
      />

      <h2 id="lcms">LC-MS combination templates</h2>
      <p>
        A few of the LC-MS templates are <strong>combinations</strong>, packaging
        a liquid-chromatography gradient and a mass spec acquisition
        method into one attachable unit, because in practice the two are run
        together and the parameters are tuned as a pair. Three of these LC-MS
        combination templates ship today (peptide, metabolite, and intact-protein
        workflows). Using one drops both halves into your library together, ready
        to attach to an experiment as a single coherent method. The structured
        instrument parameters in these were transcribed verbatim from the vendor
        documentation. If one half ever fails to copy (a missing file, an
        interrupted run), ResearchOS leaves the part that did land in place and
        tags it <code>incomplete-kit</code> so you can find and remove it rather
        than ending up with a silent half-built method.
      </p>

      <h2>Provenance and open formats</h2>
      <p>
        Everything about a template is plain, inspectable data. The protocol body
        is markdown, the structured fields are JSON, and the bundled source PDFs
        are ordinary PDFs recorded with their origin URL and checksum. A method you
        create from a template is stored the same open way as any other method on
        disk, so it is portable, diff-able, and readable without ResearchOS. The
        bundled-PDF provenance, a verifiable link from a working protocol back to
        the document it came from, is exactly the kind of integrity trail the NIH
        data-management expectations are written around. See the{" "}
        <Link href="/wiki/compliance/nih-data-management">
          NIH Data Management and Sharing
        </Link>{" "}
        page for how this fits, and{" "}
        <Link href="/wiki/features/sharing-and-permissions">
          Sharing and permissions
        </Link>{" "}
        for who can see a method once it is in your library.
      </p>
    </WikiPage>
  );
}
