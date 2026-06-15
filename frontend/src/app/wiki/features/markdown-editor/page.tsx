import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import Kbd from "@/components/wiki/Kbd";
import { Steps, Step } from "@/components/wiki/Steps";
import { TryInDemo } from "@/components/wiki/TryInDemo";

export default function MarkdownEditorPage() {
  return (
    <WikiPage
      title="The Markdown Editor"
      intro="Wherever you write prose in ResearchOS (experiment notes, task descriptions, results write-ups, methods bodies, free-form notes), you're using the same markdown editor. It's one live writing surface where you type plain markdown and watch it render as you go. Learning its toolbar and shortcut set pays off fast."
    >
      <Screenshot
        src="/wiki/screenshots/experiments-editor.png"
        alt="The markdown editor open in an experiment, showing markdown notes rendering live, an Images tab along the bottom, and the helper panel on the left."
        caption="NEEDS RE-CAPTURE: inline editing surface, single Edit / Preview toolbar, Save checkpoint button, and the bottom attachment strip. The same component mounts in task popups, results, methods, and notes."
      />

      <TryInDemo href="/">Open the demo and try Lab Notes</TryInDemo>

      <h2>Where you&apos;ll see it</h2>
      <p>
        The same editor opens in every place you write more than a sentence
        in ResearchOS.
      </p>
      <ul>
        <li>
          The <strong>Lab Notes tab</strong> of any experiment popup (see{" "}
          <Link href="/wiki/features/experiments">Experiments &amp; Notes</Link>).
        </li>
        <li>
          The <strong>Description</strong> field on the task detail popup,
          which you can open from the <Link href="/wiki/features/gantt">Gantt</Link>,
          the left sidebar, search results, or the calendar.
        </li>
        <li>
          The <strong>Results tab</strong> inside the Workbench project view
          (the old standalone Results page was retired; <code>/results</code>{" "}
          now redirects to{" "}
          <Link href="/wiki/features/experiments">Workbench</Link>).
        </li>
        <li>
          The body of every method in the{" "}
          <Link href="/wiki/features/methods">Methods library</Link>.
        </li>
        <li>
          Free-form notes (running logs and standalone notes).
        </li>
      </ul>
      <p>
        Everything you type is plain markdown. The toolbar buttons just
        insert the same characters you&apos;d type by hand (e.g.,{" "}
        <code>**bold**</code>, <code># heading</code>), so opening any of
        these files in a normal text editor outside ResearchOS gets you the
        same content.
      </p>

      <h2>One surface, type markdown and watch it render</h2>
      <p>
        There&apos;s nothing to configure and no block to click into. The
        editor is a single, continuous writing surface, like a normal
        document. You type plain markdown and the editor renders it live around
        your cursor. Headings look like headings, bold looks bold, and images
        show as images, all in one flowing column.
      </p>
      <Screenshot
        src="/wiki/screenshots/editor-inline-mode.png"
        alt="A note open for editing: a single continuous writing column where headings, bold text, and an inline image render live, with the markdown markers on the current line revealed next to the caret."
        caption="NEEDS RE-CAPTURE: the live editing surface mid-edit. One continuous column renders your markdown; the raw markers reveal only on the line your cursor is on."
      />
      <p>
        The key is what happens at your cursor. Markdown markers (the{" "}
        <code>**</code> around bold, the <code>#</code> on a heading, a link
        target) stay hidden while you read, so the line looks finished. Move
        your caret onto that line and the markers reveal themselves, ready to
        edit; move away and they tuck back behind the rendered output. You are
        always editing the real markdown, never a separate rich-text copy.
      </p>
      <Callout variant="info" title="Edit and Preview">
        The toolbar carries a two-way <strong>Edit | Preview</strong> toggle.{" "}
        <strong>Edit</strong> is the live writing surface above and where
        almost all of your work happens. <strong>Preview</strong> is the same
        document as read-only rendered output, handy when you&apos;re sharing
        your screen or reviewing. The choice is purely a viewing preference, it
        doesn&apos;t change what gets saved, so you can flip between the two
        freely. Click any image in Preview to bring up the resize picker.
      </Callout>
      <Callout variant="tip" title="Auto-switch on drop">
        Dropping an image into the editor while you&apos;re in Preview mode
        bounces you back into Edit automatically, since Preview is read-only.
      </Callout>

      <Callout variant="info" title="Code blocks with language picker">
        Type three backticks (<code>```</code>) at the start of a new line and
        a <strong>language picker</strong> popup appears. Start typing a
        language name (e.g., <code>python</code>, <code>bash</code>,{" "}
        <code>sql</code>) and the list narrows. Hit <Kbd>Enter</Kbd> and
        ResearchOS completes the code block with the language tag, ready for
        you to type.
      </Callout>

      <Callout variant="info" title="Languages with syntax highlighting">
        Around 20 popular languages get highlighting on render, including JavaScript,
        TypeScript, Python, Bash, JSON, HTML, CSS, SQL, Java, C, C++, C#, Go,
        Rust, Ruby, PHP, Swift, Kotlin, YAML, Markdown, Dockerfile, and Plain
        Text. Anything else still works, it just renders monospace without
        coloring.
      </Callout>

      <h2>The toolbar</h2>
      <p>
        Every editor has a single toolbar along the top. From left to right it
        carries these controls.
      </p>
      <ul>
        <li>
          The <strong>Edit | Preview</strong> toggle (covered above).
        </li>
        <li>
          <strong>Focus mode</strong>. The expand glyph drops the editor into a
          full-screen distraction-free writing view (also{" "}
          <Kbd>Cmd</Kbd>+<Kbd>Shift</Kbd>+<Kbd>F</Kbd>).
        </li>
        <li>
          <strong>Add Image</strong> (or <strong>Add File</strong> on surfaces
          that accept any file type) to pick attachments from disk.
        </li>
        <li>
          <strong>Browse</strong> to insert an image already attached to this
          record without re-uploading.
        </li>
        <li>
          <strong>Attachments</strong> to show or hide the bottom attachment
          strip (see <a href="#attachments">Attachments</a>).
        </li>
        <li>
          On surfaces that own their own save (the experiment popup&apos;s Lab
          Notes / Results tabs, the task popup), the <strong>Version history</strong>{" "}
          button and the <strong>Save checkpoint</strong> button ride at the
          right end of this same bar (see <a href="#saving">Saving</a>).
        </li>
      </ul>
      <Callout variant="info" title="One bar, not three">
        The toolbar is a single consolidated row. Parent surfaces that used to
        stack their own bars (a save button, a sub-tab switcher) now fold those
        controls into the right end of this one toolbar instead of adding rows
        above the editor.
      </Callout>

      <h2>Keyboard shortcuts</h2>
      <p>
        Use <Kbd>Cmd</Kbd> on macOS and <Kbd>Ctrl</Kbd> on Windows and Linux
        anywhere this table says <Kbd>Cmd</Kbd>.
      </p>
      <div className="not-prose my-4 overflow-x-auto">
        <table className="w-full text-body border-collapse">
          <thead>
            <tr className="bg-surface-sunken border-b border-border text-foreground">
              <th className="text-left px-3 py-2 font-semibold">Action</th>
              <th className="text-left px-3 py-2 font-semibold">Shortcut</th>
            </tr>
          </thead>
          <tbody className="text-foreground [&>tr]:border-b [&>tr]:border-border">
            <tr><td className="px-3 py-1.5">Save checkpoint</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>S</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Undo</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>Z</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Redo</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Z</Kbd> or <Kbd>Ctrl</Kbd>+<Kbd>Y</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Bold</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>B</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Italic</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>I</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Underline</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>U</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Strikethrough</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>Shift</Kbd>+<Kbd>X</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Link</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>K</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Headings 1 through 6</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>1</Kbd> through <Kbd>Cmd</Kbd>+<Kbd>6</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Promote heading (e.g., H2 to H1)</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>Alt</Kbd>+<Kbd>+</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Demote heading (e.g., H2 to H3)</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>Alt</Kbd>+<Kbd>-</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Code block (with language prompt)</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>Shift</Kbd>+<Kbd>C</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Blockquote</td><td className="px-3 py-1.5"><Kbd>Ctrl</Kbd>+<Kbd>Q</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Focus mode</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>Shift</Kbd>+<Kbd>F</Kbd></td></tr>
          </tbody>
        </table>
      </div>
      <Callout variant="info" title="Where shortcuts apply">
        Bold, italic, headings, and the rest work in the Edit surface. They
        don&apos;t do anything in Preview, which is read-only.
      </Callout>

      <h2 id="attachments">Attachments</h2>
      <p>
        Images and files live in one place, a single attachment strip along the
        bottom of the editor, toggled with the toolbar&apos;s{" "}
        <strong>Attachments</strong> button. A small <strong>Images / Files</strong>{" "}
        tab bar above the strip switches it between image thumbnails and file
        tiles. There&apos;s no separate Files panel and no top-of-editor{" "}
        Markdown / Files toggle anymore; everything funnels through this one
        strip.
      </p>
      <Screenshot
        src="/wiki/screenshots/editor-attachment-strip.png"
        alt="The bottom attachment strip open on the Images tab, a row of thumbnails with a small Images / Files tab bar above it."
        caption="NEEDS RE-CAPTURE: the unified bottom attachment strip with its Images / Files tab bar. One place to add, view, delete, and drag-to-insert."
      />

      <h3>Adding an image</h3>
      <p>There are four ways to get a new image in.</p>
      <ul>
        <li>
          <strong>Click the toolbar&apos;s Add Image button</strong> to pick one
          or more files from disk.
        </li>
        <li>
          <strong>Drag image files into the editor body</strong>. While
          you&apos;re dragging from Finder, a blue ring lights up around the
          popup or editor card so you know the drop will be caught. Release
          inside text and the image inserts at that position. Release outside
          text and it appends to the bottom of the document. You can drop
          straight onto a rendered image too, and the new file slots in beside
          it. Chrome&apos;s default replace-image behavior is intercepted, so
          nothing else happens.
        </li>
        <li>
          <strong>Paste from the clipboard</strong>. Copy a screenshot
          (e.g., macOS <Kbd>Cmd</Kbd>+<Kbd>Shift</Kbd>+<Kbd>4</Kbd>, then{" "}
          <Kbd>Cmd</Kbd>+<Kbd>V</Kbd> in the editor) and it lands inline.
        </li>
        <li>
          <strong>Click Browse</strong> to pick from images already attached to
          this record (the gallery picker). Useful when the image is already on
          disk and you just want to insert a reference without re-uploading.
        </li>
      </ul>
      <p>
        Every image lands in an <code>Images/</code> folder adjacent to the
        document on disk (e.g.,{" "}
        <code>users/&lt;you&gt;/results/task-12/Images/gel-2026-05-10.png</code>),
        and the markdown body references it with{" "}
        <code>![caption](Images/gel-2026-05-10.png)</code>. Filenames with
        spaces render inline just fine. The reference looks like{" "}
        <code>![](Images/Emile ID card-1.jpg)</code> and the editor resolves
        it to the right file without any extra escaping.
      </p>

      <h3>The Images tab</h3>
      <p>
        The <strong>Images</strong> tab in the bottom strip lists every image in
        the document&apos;s <code>Images/</code> folder as a row of thumbnails,
        whether or not the body references the image yet. Images already
        referenced look normal. Images that exist on disk but aren&apos;t
        referenced yet (e.g., a fresh arrival from the companion app) show a
        small blue dot in the corner so you can spot them. Here&apos;s what you can do from
        the tab.
      </p>
      <ul>
        <li>
          <strong>Click a thumbnail</strong> to open the image metadata
          popup. The popup shows a larger preview and lets you edit the
          caption, rename the file, delete it from disk, or jump to where
          it&apos;s used in the body. If the image isn&apos;t referenced
          anywhere yet, the jump button is disabled. The popup also has an{" "}
          <strong>Annotate</strong> button that opens the non-destructive{" "}
          <Link href="/wiki/features/image-annotation">image annotation editor</Link>,
          where you can circle a band or label lanes without ever modifying the
          raw photo.
        </li>
        <li>
          <strong>Drag a thumbnail into the editor</strong> to insert that
          image at the cursor position. The thumbnail stays in the strip so
          the same image can appear twice in the document.
        </li>
        <li>
          <strong>Drag a thumbnail to the trash zone</strong> at the bottom
          of the editor. ResearchOS deletes the file from disk and removes
          every reference in the body. The trash zone only appears while you
          are actively dragging a thumbnail.
        </li>
      </ul>

      <h3>Resizing an image</h3>
      <Screenshot
        src="/wiki/screenshots/editor-image-resize.png"
        alt="The image resize popover open over a body image, with 25%, 50%, 75%, and 100% size options."
        caption="Click any rendered image (in Edit or Preview) and the size popover opens. The selected percentage is written into the markdown so it sticks."
      />
      <p>
        Click any rendered image and a size popover appears inline with{" "}
        <em>25%</em>, <em>50%</em>, <em>75%</em>, and <em>100%</em> options. The
        choice writes a width attribute into the markdown so the size persists.
      </p>

      <h3>Broken image references</h3>
      <p>
        If an image reference points at a file that no longer exists (e.g.,
        you renamed the file outside the app, or the relink hasn&apos;t
        synced from a teammate yet), a small red &quot;Image Not Found&quot;
        popup appears in the bottom-right corner of the editor. It lists
        similar-named files in the document&apos;s <code>Images/</code>
        folder. Click one and the reference rewrites in place. If nothing
        looks right, the same popup offers a <em>Remove reference from
        note</em> button to strip the dead snippet entirely, and a{" "}
        <em>Dismiss all</em> button at the bottom to silence the queue.
        Multiple broken refs queue up one at a time, with a <em>Skip</em>{" "}
        link so you can step past one without touching it.
      </p>

      <h3>The Files tab</h3>
      <p>
        Anything that isn&apos;t an image (PDFs, CSVs, sequence files,
        protocols, archives) drops into a sibling <code>Files/</code> folder and
        shows up as a clickable hyperlink in the prose, not as an inline
        preview. Switch the bottom strip to its <strong>Files</strong> tab to
        manage them. The add flow mirrors images, so you drag from Finder,
        paste, or use the toolbar&apos;s <em>Add File</em> button (which replaces{" "}
        <em>Add Image</em> on surfaces that accept any file type, namely
        experiment Lab Notes, Results, and Notes). The chosen file copies into{" "}
        <code>Files/</code> and a markdown link inserts at the cursor.
      </p>
      <ul>
        <li>
          Each tile shows an icon for the file type and the filename. Files
          already linked in the body look normal. Files that exist on disk but
          aren&apos;t referenced yet show a small blue dot and an
          &quot;unlinked&quot; count in the tab header.
        </li>
        <li>
          <strong>Drag a tile into the editor</strong> to insert a link to it at
          the cursor.
        </li>
        <li>
          <strong>Drag a file tile to the red trash zone</strong> at the
          bottom-right of the editor. ResearchOS asks for confirmation, then
          deletes the file from disk and strips every link to it from the
          markdown body, including links that stored the filename URL-encoded
          (so <code>Files/READ%20ME.md</code> gets cleaned up when the
          underlying <em>READ ME.md</em> is dragged out).
        </li>
      </ul>
      <Callout variant="info" title="No metadata popup on file tiles">
        File tiles don&apos;t open a popup on click. The only interactions
        are drag-into-editor (to insert a link) and drag-to-trash (to
        delete). To preview a file, click its link in the rendered prose
        instead.
      </Callout>

      <h3>Clicking a file link</h3>
      <p>
        Click any <code>[name](Files/…)</code> link in Edit or Preview mode
        and a small <strong>View / Download</strong> popup appears centered
        on screen.
      </p>
      <ul>
        <li>
          <strong>Text-like files</strong> (markdown, txt, csv, json, code,
          sequence files like fasta and gbk) get a popup with{" "}
          <em>Cancel</em>, <em>Download</em>, and <em>View</em> buttons.
          Click <em>View</em> and the contents render in an inline monospace
          viewer with its own <em>Download</em> button up top. Click{" "}
          <em>Download</em> from either spot and the file saves locally.
        </li>
        <li>
          <strong>PDFs</strong> get the same popup. Click <em>View</em> and
          ResearchOS opens the PDF in a new browser tab so you can use the
          browser&apos;s built-in PDF viewer. Click <em>Download</em> and a
          copy lands on disk.
        </li>
        <li>
          <strong>Everything else</strong> (zips, office docs, audio, video,
          binaries) downloads immediately without a popup. There&apos;s
          nothing meaningful to render inline.
        </li>
      </ul>
      <Callout variant="tip" title="Filenames with spaces work too">
        Spaces in filenames are stored as <code>%20</code> in the markdown
        link (e.g., <code>[READ ME.md](Files/READ%20ME.md)</code>) so they
        parse as a single, clickable target. The popup and inline viewer
        decode them back to the human-readable name.
      </Callout>

      <h3>Broken file references</h3>
      <p>
        When a <code>[name](Files/…)</code> link points at a file that
        isn&apos;t in the document&apos;s <code>Files/</code> folder, the
        same red corner popup that handles broken images opens with a{" "}
        <em>File Not Found</em> heading. There&apos;s no similar-name search
        for files (the recovery is usually to remove the dead link), so the
        popup goes straight to a <em>Remove reference from note</em> button.{" "}
        <em>Dismiss all</em> closes the queue without touching the markdown,
        and <em>Skip</em> moves to the next broken reference if there&apos;s
        more than one.
      </p>

      <h2>What a real ResearchOS note looks like</h2>
      <Callout variant="tip" title="Lab-recipe, not prose">
        These are lab-recipe examples. Your notes should look like lab work,
        not prose paragraphs. The markdown editor handles tables and code
        blocks well; lean on them.
      </Callout>
      <p>
        A typical note in a working lab is mostly tables, measurements, and
        small annotations. The four examples below are the shape to aim for.
      </p>

      <h3>PCR reaction setup</h3>
      <pre className="text-meta bg-surface-sunken rounded p-3 overflow-x-auto">
        <code>{`## PCR reaction (25 uL, Q5)

| Reagent              | Stock     | Final     | Volume (uL) |
|----------------------|-----------|-----------|-------------|
| Q5 master mix (2x)   | 2x        | 1x        | 12.5        |
| Forward primer F1    | 10 uM     | 0.5 uM    | 1.25        |
| Reverse primer R1    | 10 uM     | 0.5 uM    | 1.25        |
| Template (gDNA)      | 50 ng/uL  | 1 ng/uL   | 0.5         |
| Nuclease-free water  |           |           | 9.5         |
| **Total**            |           |           | **25.0**    |

Program: pcr_program_id = 142  (Tm = 62 C, 30 cycles, 35 s elongation)
Variation: dropped extension to 30 s, single template lot.`}</code>
      </pre>

      <h3>Plasmid metadata</h3>
      <pre className="text-meta bg-surface-sunken rounded p-3 overflow-x-auto">
        <code>{`## pGN-027  (parent: pGN-012)

- Resistance: Kan (50 ug/mL)
- Size: 5.4 kb
- Source: Gibson assembly of pGN-012 backbone + amplicon FN-1
- Sequence: Files/pGN-027.gbk
- Glycerol stock: -80 B, box 4, position B3
- Verified by: Sanger seqs SP1/SP2 (Files/pGN-027-seq.zip)`}</code>
      </pre>

      <h3>Sample measurement record</h3>
      <pre className="text-meta bg-surface-sunken rounded p-3 overflow-x-auto">
        <code>{`## OD600 readings, 2026-05-22 08:14 CT

Instrument: BioTek Synergy H1 (SN 19F-3204)

| Sample  | Strain        | Media | OD600  | QC  |
|---------|---------------|-------|--------|-----|
| A1      | WT            | YPD   | 0.412  | ok  |
| A2      | dADE2         | YPD   | 0.398  | ok  |
| A3      | dADE2-comp    | YPD   | 0.087  | low |
| A4      | media blank   | YPD   | 0.041  | ok  |

Subtracted media blank (0.041) from A1-A3 before plotting.
A3 looks suspect, repeat tomorrow morning.`}</code>
      </pre>

      <h3>Equipment log</h3>
      <pre className="text-meta bg-surface-sunken rounded p-3 overflow-x-auto">
        <code>{`## Centrifuge 5424R service log

- Serial: 5424R-7831
- Location: lab room 314, bench 4
- Last service: 2025-11-09 (annual calibration, certified)
- Belt replaced: 2024-04-02
- Rotor: FA-45-24-11 (max 21,130 x g)
- Notes: unbalanced load alarm fixed 2026-03-15, gasket reseated.`}</code>
      </pre>

      <h2>Tables, lists, and other markdown</h2>
      <p>
        Standard GitHub-flavored markdown all works.
      </p>
      <ul>
        <li>
          <strong>Tables</strong> with the <code>|</code>-and-<code>-</code>
          {" "}syntax.
        </li>
        <li>
          <strong>Bulleted</strong> (<code>-</code>) and{" "}
          <strong>numbered</strong> (<code>1.</code>) lists.
        </li>
        <li>
          <strong>Task lists</strong> with <code>- [ ]</code> and{" "}
          <code>- [x]</code>. Boxes are clickable in Edit and Preview.
        </li>
        <li>
          <strong>Blockquotes</strong> (<code>{">"} text</code>).
        </li>
        <li>
          <strong>Horizontal rules</strong> (<code>---</code>).
        </li>
        <li>
          <strong>Inline code</strong> with single backticks and{" "}
          <strong>code blocks</strong> with triple backticks.
        </li>
      </ul>
      <Callout variant="tip" title="Paste tables from Excel or Sheets">
        Copy a range from Excel, Google Sheets, or Numbers and paste it into
        the editor. The editor converts the tab-separated text into a markdown
        table on the fly, so you don&apos;t have to retype the rows.
      </Callout>

      <h2>The helper panel</h2>
      <p>
        The editor includes a collapsible helper panel on the{" "}
        <strong>left</strong> side with two tabs at the top,{" "}
        <strong>Shortcuts</strong> and <strong>Style Guide</strong>. Click
        the arrow in the panel header to collapse or expand it.
      </p>
      <ul>
        <li>
          <strong>Shortcuts</strong> lists every keyboard shortcut the
          editor responds to, with the key combo on the right. Read-only.
        </li>
        <li>
          <strong>Style Guide</strong> shows example syntax for every
          markdown feature (headings, lists, tables, code blocks, callouts).
          Click any example to insert it at the cursor. Handy when you&apos;ve
          forgotten the table syntax or want to see what callout markdown looks
          like.
        </li>
      </ul>

      <h2 id="saving">Saving is a checkpoint</h2>
      <p>
        The editor doesn&apos;t autosave. You save explicitly, and every save
        is a <strong>checkpoint</strong>, a permanent, revertible version of the
        document. Click <strong>Save checkpoint</strong> in the toolbar (or
        press <Kbd>Cmd</Kbd>+<Kbd>S</Kbd>) to write your edits to disk and record
        a version you can come back to.
      </p>
      <Screenshot
        src="/wiki/screenshots/editor-save-checkpoint.png"
        alt="The right end of the editor toolbar showing a Version history button and a blue Save checkpoint button."
        caption="NEEDS RE-CAPTURE: the Save checkpoint button and the Version history button at the right end of the single toolbar."
      />
      <Callout variant="info" title="Why checkpoints, not autosave">
        Naming the button <strong>Save checkpoint</strong> makes it obvious that
        each save is a deliberate, recoverable snapshot, not a silent background
        write. Nothing lands on disk until you click it, so there&apos;s never
        an ambiguous half-saved state.
      </Callout>

      <h3>Version history and revert</h3>
      <p>
        Next to the save button, the <strong>Version history</strong> button
        opens a docked sidebar listing every checkpoint, newest first, grouped
        by day. Select a version and the editor body flips to a read-only{" "}
        <strong>diff</strong> view showing exactly what changed between that
        checkpoint and the one before it (additions and removals highlighted in
        place). The live document is never altered while you browse.
      </p>
      <p>
        If you have write access, the sidebar footer offers a{" "}
        <strong>Restore</strong> action. Restoring writes the chosen version
        back as the current content and records it as a fresh checkpoint, so the
        restore is itself revertible. You can always roll forward again to the
        pre-restore state. The timeline labels these entries so a restored note
        reads clearly in its own history.
      </p>
      <Callout variant="warning" title="Save before you close">
        Because saves are explicit, force-closing the browser tab in the middle
        of typing drops any edits made since your last checkpoint. Click{" "}
        <strong>Save checkpoint</strong> (or <Kbd>Cmd</Kbd>+<Kbd>S</Kbd>) before
        you leave to be sure the write has landed.
      </Callout>
      <p>
        On save, the editor also runs a quick cleanup pass over the
        document&apos;s <code>Images/</code> and <code>Files/</code> folders:
        anything sitting on disk that nothing in the markdown points at gets
        deleted, so deleted snippets don&apos;t leave dangling files behind.
        The sweep matches links the way the body writes them, so URL-encoded
        file links (<code>Files/READ%20ME.md</code>) protect their on-disk
        counterparts correctly.
      </p>
      <p>
        See <Link href="/wiki/features/version-history">Version History</Link>{" "}
        for the full picture of how checkpoints, diffs, and restore work across
        ResearchOS.
      </p>

      <h2>Object embeds</h2>
      <p>
        A lone <code>[name](ros://&lt;type&gt;/&lt;id&gt;)</code> link on its own
        line renders as a live card instead of a plain hyperlink. Trees,
        sequences, molecules, and notes each have their own card style. The card
        pulls from the same source the full viewer does, so a tree embed is the
        same rendering engine as the Tree Studio, not a screenshot.
      </p>
      <Screenshot
        src="/wiki/screenshots/editor-embed-card.png"
        alt="A note in the markdown editor containing a lone ros:// link that has rendered as a live phylogenetic tree card, with the tree visible inline in the note body."
        caption="A ros:// link alone on its line renders as a live object card. The same note stays portable plain markdown when opened outside ResearchOS."
      />
      <p>
        You get an embed link whenever you insert a reference from the{" "}
        <strong>@mention</strong> picker and it resolves to a block-embed type.
        The link is still valid markdown outside ResearchOS, it just opens as a
        normal link in a text editor. Inside ResearchOS, the renderer at{" "}
        <code>RenderedMarkdown.tsx</code> detects the <code>ros://</code> scheme
        and mounts the live card in place of the raw link text.
      </p>
      <Callout variant="info" title="One link, one card">
        Only a lone link on its own paragraph triggers the block-embed view. A
        ros:// link in the middle of a sentence stays as a chip (an inline
        mention pill), not a card, so you can reference an object inline without
        forcing a full card break.
      </Callout>

      <h2>Things people miss</h2>
      <ul>
        <li>
          <strong>Undo / redo across the whole document</strong>. The editor
          maintains its own undo stack. <Kbd>Cmd</Kbd>+<Kbd>Z</Kbd> steps back
          through edits, including image drops and deletions.{" "}
          <Kbd>Cmd</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Z</Kbd> (or{" "}
          <Kbd>Ctrl</Kbd>+<Kbd>Y</Kbd> on Windows) steps forward.
        </li>
        <li>
          <strong>Promote/demote a heading</strong> in place with{" "}
          <Kbd>Cmd</Kbd>+<Kbd>Alt</Kbd>+<Kbd>+</Kbd> or{" "}
          <Kbd>Cmd</Kbd>+<Kbd>Alt</Kbd>+<Kbd>-</Kbd>. You don&apos;t need to
          retype the <code>#</code> marks.
        </li>
        <li>
          <strong>Focus mode</strong> (<Kbd>Cmd</Kbd>+<Kbd>Shift</Kbd>+<Kbd>F</Kbd>{" "}
          or the toolbar expand glyph) gives you a full-screen, distraction-free
          writing view with a compact top bar. That top bar carries a width
          control with four presets (Narrow, Comfortable, Wide, Full-bleed) so
          you can set how wide the text column runs, from a tight ~60-character
          measure up to the full available width. Your choice is remembered.
          Exit returns you to the popup.
        </li>
        <li>
          <strong>The Attachments button</strong> in the toolbar toggles the
          bottom attachment strip (its Images and Files tabs) on and off. Click
          it again to bring the strip back.
        </li>
        <li>
          <strong>Drag a thumbnail back into the editor</strong> to insert the
          same image a second time. The file isn&apos;t duplicated, only the
          reference is.
        </li>
        <li>
          <strong>Spell-check your prose</strong> by turning on{" "}
          <Link href="/wiki/features/settings">Settings &rsaquo; Behavior</Link>{" "}
          &rsaquo; Spell-check in the editor (off by default). When on, the
          editor underlines likely misspellings and offers click-to-fix
          suggestions, and its dictionary already knows common lab terms so
          science words aren&apos;t flagged. Anything it does flag can be added
          to your own dictionary. Code spans, link URLs, and numbers stay quiet.
        </li>
      </ul>
    </WikiPage>
  );
}
