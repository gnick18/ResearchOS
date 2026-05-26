import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";
import { TryInDemo } from "@/components/wiki/TryInDemo";

export default function MethodsFeaturePage() {
  return (
    <WikiPage
      title="Methods Library"
      intro="A method is a reusable protocol you write once and attach to any experiment as a tab. The library ships ten method types, from free-form Markdown to specialized structured editors for PCR, LC gradients, plate layouts, and more, so a method matches the shape of the work instead of forcing everything into prose."
    >
      {/* methods-library.png needs recapture: predates 10-type rewrite; alt text still lists only 3 types */}
      <Screenshot
        src="/wiki/screenshots/methods-library.png"
        alt="The Methods page showing categories of method cards, with type pills marking the method type on each card."
        caption="The Method Library: cards grouped under category headings, with type pills on each card."
      />

      <TryInDemo href="/methods">Try methods in the demo</TryInDemo>

      <h2>What you see on the page</h2>
      <p>
        The Method Library page lists every protocol you and your lab have
        saved, grouped under category headings (e.g., &quot;Molecular
        Biology&quot;, &quot;Imaging&quot;). Each method is a card with its
        name, a colored type pill (Markdown, PDF, PCR, LC Gradient, Plate
        Layout, and so on), and any tags you added. Click a card to open
        the method in a popup with the editor on the left and a sidebar
        listing every experiment that currently uses it on the right.
      </p>
      <p>
        Two buttons sit in the top-right of the page:{" "}
        <strong>+ New Category</strong> creates an empty category heading you
        can drag methods into later, and <strong>+ New Method</strong> opens
        the create-method modal.
      </p>

      <h2>The ten method types</h2>
      <p>
        The create-method modal groups types into two sections. Each type
        gets its own viewer when the method is opened, its own icon on
        experiment tabs, and its own colored pill on the library card.
      </p>
      <p>
        <strong>Standard methods</strong> are body-only (no structured
        fields beyond title and tags):
      </p>
      <ul>
        <li>
          <strong>Markdown</strong> is the default. Free-form protocol text
          in the same markdown editor used for lab notes and results, with
          toolbars, image drag-drop, and live preview. See{" "}
          <Link href="/wiki/features/markdown-editor">The Markdown Editor</Link>{" "}
          for the full shortcut set.
        </li>
        <li>
          <strong>PDF</strong> lets you upload an existing protocol PDF (a
          kit insert, a published paper). PDFs render in an iframe and
          can&apos;t be edited inline.
        </li>
      </ul>
      <p>
        <strong>Structured methods</strong> swap the markdown body for a
        purpose-built editor:
      </p>
      <ul>
        <li>
          <strong>PCR</strong> opens a thermal-gradient editor and
          reaction-recipe table. Full details on the{" "}
          <Link href="/wiki/features/pcr">PCR Reaction Builder</Link> page.
        </li>
        <li>
          <strong>LC Gradient</strong> opens a solvent-gradient chart
          editor with flow, column, and mobile-phase fields for HPLC and
          LC-MS protocols.
        </li>
        <li>
          <strong>Plate Layout</strong> renders an interactive well-plate
          grid with sample, control, and blank annotations.
        </li>
        <li>
          <strong>Cell culture passaging</strong> tracks a passaging
          schedule, media, and cell line, with per-task passage history.
        </li>
        <li>
          <strong>Mass spec</strong> captures ionization mode, source and
          scan params, and calibration. Pairs with LC for LC-MS workflows.
        </li>
        <li>
          <strong>qPCR analysis</strong> records Cq readouts, melt-curve
          Tm, standard-curve efficiency, and ΔΔCq fold-change.
        </li>
        <li>
          <strong>Coding workflow</strong> stores reusable scripts
          (Python, R, SQL) and Jupyter notebooks alongside protocol text.
        </li>
        <li>
          <strong>Compound method</strong> bundles existing methods into
          one attachable kit (e.g. plate layout plus assay PDF). Reached
          by extending an existing method, not as a standalone picker tile.
        </li>
      </ul>

      <h2>Create a method</h2>
      <Steps>
        <Step>
          Click <strong>+ New Method</strong>. Pick a type from the
          Standard or Structured section and give it a name. The{" "}
          <strong>Folder (optional)</strong> field autocompletes against
          existing categories (the page-level headings) so methods drop
          into the right bucket.
        </Step>
        <Step>
          Fill in the body: write markdown, upload a PDF, draw an LC
          gradient, lay out a plate, or build a PCR program and recipe.
          For markdown methods you can drag images and attachment files
          directly into the editor.
        </Step>
        <Step>
          Click <strong>Create Method</strong>. The new card lands in its
          category on the Method Library page and is immediately available
          to attach to experiments.
        </Step>
      </Steps>

      <h2>Categories and drag-to-organize</h2>
      <p>
        Categories are flat (no sub-folders). To move a method into a
        different category, grab its card by the ⋮⋮ handle and drop it on
        another category heading. The drop target highlights blue while you
        hover. Drop a card on the &quot;Drop here to move to
        Uncategorized&quot; bar at the top to clear its category.
      </p>
      <p>
        Use <strong>+ New Category</strong> to set up an empty bucket before
        you have anything to put in it. Empty categories persist in your
        browser until at least one method lives there or you remove it.
      </p>

      <h2>Sharing a method with the lab</h2>
      <p>
        Every method is private to you by default. To make one visible to the
        rest of the lab, open the method and click the{" "}
        <strong>Private</strong> pill in the header. The share popup opens.
        In the <strong>User</strong> dropdown, select{" "}
        <strong>All Lab Users</strong>. A confirmation box appears below.
        Click <strong>Apply</strong>. The pill updates to{" "}
        <strong>Shared with the lab</strong> and a green message confirms
        the change.
      </p>
      <p>
        Lab-shared methods show a green <strong>Shared</strong> badge on
        their card and appear in every user&apos;s library.
      </p>

      <h3>How method sharing works</h3>
      <p>
        Sharing is stored on the method&apos;s <code>shared_with</code>{" "}
        array. Choosing <strong>All Lab Users</strong> writes the{" "}
        <code>WHOLE_LAB_SENTINEL</code> value into the array, which the
        permission system expands to &quot;every user in this lab folder,
        present and future.&quot; Read access is gated by the{" "}
        <code>canRead</code> primitive: owner, anyone explicitly in{" "}
        <code>shared_with</code>, the sentinel, or a Lab Head. See{" "}
        <Link href="/wiki/features/sharing-and-permissions">
          Sharing and permissions
        </Link>{" "}
        for the full model (including the one-time auto-migration from the
        retired Lab Mode account).
      </p>
      <p>
        Once a <strong>Markdown</strong> method is shared with the lab, the
        inline Edit button disappears for everyone, including the creator,
        and the body becomes read-only. To change a published Markdown
        protocol, flip it back to private via the share popup, edit, then
        republish.
      </p>
      <p>
        <strong>Structured-method editors</strong> (PCR, LC Gradient, Plate
        Layout, and others) behave differently. The creator retains edit
        access even when the method is shared, because the editor is gated
        by <code>canWrite</code> (which passes for the original creator
        regardless of sharing status). Other lab members can read and attach
        the method but cannot modify the shared copy.
      </p>
      <p>
        All users can always attach a shared method to their own experiments
        and record per-run variations without touching the shared library copy.
      </p>

      <h3>Transient read access when a task is shared with you</h3>
      <p>
        There is one more way a method becomes readable: when a user shares
        a task with you and that task references a method, you get a
        transient read on the underlying protocol even if the method
        itself is not in your <code>shared_with</code>. The check lives in{" "}
        <code>canReadMethodViaTask</code> (in{" "}
        <code>lib/sharing/unified.ts</code>) and the method owner sees a{" "}
        <code>method-transient-read</code> entry land in their audit log
        the first time it fires for a given viewer. So sharing a task does
        not silently leak the protocol without a paper trail, and a method
        owner can see who has been reading their protocols through
        someone else&apos;s task. The grant is depth-1 only: compound
        method children are not transitively included, and only the
        directly referenced method is unlocked. See{" "}
        <Link href="/wiki/features/sharing-and-permissions">
          Sharing and permissions
        </Link>{" "}
        for the full rule.
      </p>

      <h2>Attach a method to an experiment</h2>
      <p>
        Inside an experiment popup, methods appear as a row of browser-style
        tabs at the top of the Methods area. Click the <strong>+</strong>{" "}
        button on the tab bar to open the method picker.
      </p>
      <p>
        The picker has a search box at the top (search by name or
        <code>#tag</code>), a <strong>Recently used in this project</strong>{" "}
        section pinned to the top, and a folder-grouped list below. Hover or
        arrow through entries to preview the method body in the right pane,
        then press Enter or click to attach.
      </p>

      <h2>Recording variations on a single experiment</h2>
      <p>
        When you open a method tab on an experiment, the amber{" "}
        <strong>Variation Notes</strong> bar sits at the top. Expand it and
        click <strong>+ Add Note</strong> to add a timestamped{" "}
        <code>### Variation</code> entry where you can describe what you did
        differently for this run (e.g., &quot;halved the elongation time&quot;,
        &quot;substituted Q5 for Phusion&quot;). Each entry gets its own
        delete button on hover.
      </p>
      <p>
        For <strong>PCR methods</strong>, you can also edit the thermal
        gradient or recipe table directly inside the experiment tab. Your
        edits save as an experiment-local copy when you click{" "}
        <strong>Save Changes</strong>, so the original protocol in the
        library stays untouched. A <strong>Reset to Method</strong> button
        reverts the experiment&apos;s copy back to the library version
        whenever you want.
      </p>
      <p>
        Markdown and PDF methods don&apos;t copy the body onto the
        experiment. The Variation Notes panel is the only place where
        per-experiment changes are recorded for those formats.
      </p>

      <Callout variant="tip" title="Search before you write">
        The picker&apos;s search box matches names and tags (prefix with{" "}
        <code>#</code> to search tags only). Many labs end up with five
        slightly different copies of the same protocol. A quick search
        prevents that.
      </Callout>
    </WikiPage>
  );
}
