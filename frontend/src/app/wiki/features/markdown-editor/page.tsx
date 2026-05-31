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
      intro="Wherever you write prose in ResearchOS (experiment notes, task descriptions, results write-ups, methods bodies, free-form notes), you're using the same markdown editor. Learning its modes and shortcut set pays off fast."
    >
      <Screenshot
        src="/wiki/screenshots/experiments-editor.png"
        alt="The markdown editor open in an experiment, showing markdown notes, an Images tab at the bottom, and the helper panel on the left."
        caption="The editor as it appears inside an experiment. The same component mounts in task popups, results, methods, and notes."
      />

      <TryInDemo href="/">Open the demo and try Lab Notes</TryInDemo>

      <h2>Where you&apos;ll see it</h2>
      <p>
        The same editor opens in every place you write more than a sentence
        in ResearchOS:
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

      <h2>The three modes</h2>
      <p>
        The toolbar in the top-right of every editor has a mode toggle. The
        choice of mode is purely a viewing preference, it doesn&apos;t change
        what gets saved. Two modes show everywhere; a third, <strong>Inline</strong>,
        is an opt-in pilot that currently appears only on free-form Notes (see{" "}
        <a href="#inline-mode">Inline mode</a> below).
      </p>
      <ul>
        <li>
          <strong>Hybrid</strong> (the default): the rendered view, but every
          block is click-to-edit. Single-click a paragraph or heading to select
          it, double-click (or <Kbd>Enter</Kbd>) to edit just that block, and{" "}
          <Kbd>Esc</Kbd> to commit and deselect. This is the right mode for
          most prose work.
        </li>
        <li>
          <strong>Inline</strong> (opt-in, Notes pilot): one continuous live
          surface where you type markdown and watch it render as you go, instead
          of selecting a block at a time. Available today only on free-form
          Notes. Covered in detail under <a href="#inline-mode">Inline mode</a>.
        </li>
        <li>
          <strong>Preview</strong>: read-only rendered output. Click any image
          in this mode to bring up the resize picker. Use it when you&apos;re
          sharing the screen or reviewing.
        </li>
      </ul>
      <Callout variant="tip" title="Auto-switch on drop">
        Dropping an image into the editor while you&apos;re in Preview mode
        bounces you into Hybrid automatically, since Preview is read-only.
      </Callout>

      <h2>Writing in Hybrid mode</h2>
      <Screenshot
        src="/wiki/screenshots/editor-hybrid-selected.png"
        alt="A paragraph block in Hybrid mode with a blue selection ring around it and inline Edit and Delete buttons in the top-right corner."
        caption="A single click on a block selects it. The blue ring marks the selection, and the inline Edit and Delete buttons act on just that block."
      />
      <p>
        Hybrid is the default and where most editing happens. The editor
        parses your markdown into logical blocks (paragraphs, headings, code
        blocks, lists, tables) and each block is a click target:
      </p>
      <Steps>
        <Step>
          <strong>Click a block once</strong> to select it. A blue ring
          appears around the block, plus inline <em>Edit</em> and{" "}
          <em>Delete</em> buttons in the top-right corner of the block.
        </Step>
        <Step>
          <strong>Double-click</strong> (or press <Kbd>Enter</Kbd>) on a
          selected block to start editing. The block converts into an inline
          textarea pre-filled with its markdown source.
        </Step>
        <Step>
          Type your edits. Plain <Kbd>Enter</Kbd> inserts a CommonMark soft
          line break (<code>{"  \\n"}</code>) and stays in the inline
          textarea. <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> performs a hard
          paragraph split (<code>\n\n</code>), commits the edit, and exits
          the textarea so the next re-parse produces two separate blocks.
        </Step>
        <Step>
          Press <Kbd>Esc</Kbd> to commit the edit and deselect, or click
          outside the block.
        </Step>
      </Steps>
      <p>
        Other Hybrid-mode shortcuts on a selected (but not yet editing) block:
      </p>
      <ul>
        <li>
          <Kbd>Delete</Kbd> or <Kbd>Backspace</Kbd> removes the block.
        </li>
        <li>
          <Kbd>Esc</Kbd> deselects.
        </li>
      </ul>

      <Callout variant="info" title="Code blocks with language picker">
        Type three backticks (<code>```</code>) at the start of a new line
        inside any Hybrid inline textarea and a <strong>language picker</strong>{" "}
        popup appears. Start typing a language name (e.g., <code>python</code>,{" "}
        <code>bash</code>, <code>sql</code>) and the list narrows. Hit{" "}
        <Kbd>Enter</Kbd> and ResearchOS completes the code block with the
        language tag, ready for you to type.
      </Callout>

      <Callout variant="info" title="Languages with syntax highlighting">
        Around 20 popular languages get highlighting on render: JavaScript,
        TypeScript, Python, Bash, JSON, HTML, CSS, SQL, Java, C, C++, C#, Go,
        Rust, Ruby, PHP, Swift, Kotlin, YAML, Markdown, Dockerfile, and Plain
        Text. Anything else still works, it just renders monospace without
        coloring.
      </Callout>

      <h2 id="inline-mode">Inline mode (opt-in, Notes pilot)</h2>
      <Callout variant="info" title="An opt-in pilot on Notes">
        Inline mode is a rolling-out pilot. The third <strong>Inline</strong>{" "}
        pill appears today only on free-form <strong>Notes</strong>; every other
        surface (experiment Lab Notes, Results, methods, task descriptions) shows
        the usual Hybrid and Preview toggle. Hybrid stays the default everywhere,
        including on Notes, so nothing changes unless you reach for the Inline
        pill yourself.
      </Callout>
      <p>
        Hybrid edits one block at a time: you click a paragraph, edit it in an
        inline textarea, and commit. <strong>Inline mode</strong> takes a
        different approach. It is a single, continuous writing surface, more like
        a normal document, where you type plain markdown and the editor renders
        it live around your cursor. Headings look like headings, bold looks bold,
        and images show as images, all in one flowing column, without the
        block-select-then-edit step.
      </p>
      <Screenshot
        src="/wiki/screenshots/editor-inline-mode.png"
        alt="A free-form note open in Inline mode mid-edit: a single continuous writing column where headings, bold text, and an inline image render live, with the markdown markers on the current line revealed next to the caret."
        caption="Inline mode on a Note. One continuous surface renders your markdown live; the raw markers reveal only on the line your cursor is on."
      />
      <p>
        The key to inline mode is what happens at your cursor. Markdown markers
        (the <code>**</code> around bold, the <code>#</code> on a heading, a link
        target) stay hidden while you read, so the line looks finished. Move your
        caret onto that line and the markers reveal themselves, ready to edit;
        move away and they tuck back behind the rendered output. You are always
        editing the real markdown, never a separate rich-text copy.
      </p>
      <Callout variant="info" title="What stays exactly the same">
        Inline mode is a third way to <em>view and type</em> the same document,
        not a different document. It writes the same plain markdown to the same
        file, takes the same dragged-and-pasted images into the same{" "}
        <code>Images/</code> folder, and saves through the same parent-driven
        flow described under <a href="#saving">Saving</a>. The familiar editing
        shortcuts (bold, italic, headings, and the rest) work here too. Switching
        between Hybrid, Inline, and Preview never changes what gets stored, so you
        can move between them freely.
      </Callout>
      <Screenshot
        src="/wiki/screenshots/editor-mode-toggle-three.png"
        alt="The editor toolbar mode toggle on a Note, a segmented control with three options reading Hybrid, Inline, and Preview, with Inline selected."
        caption="On Notes, the mode toggle gains a third Inline pill. Everywhere else it stays a two-way Hybrid / Preview control."
      />

      <h2>Keyboard shortcuts</h2>
      <p>
        Use <Kbd>Cmd</Kbd> on macOS and <Kbd>Ctrl</Kbd> on Windows and Linux
        anywhere this table says <Kbd>Cmd</Kbd>.
      </p>
      <div className="not-prose my-4 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-gray-700">
              <th className="text-left px-3 py-2 font-semibold">Action</th>
              <th className="text-left px-3 py-2 font-semibold">Shortcut</th>
            </tr>
          </thead>
          <tbody className="text-gray-800 [&>tr]:border-b [&>tr]:border-gray-100">
            <tr><td className="px-3 py-1.5">Undo</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>Z</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Redo</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Z</Kbd> or <Kbd>Ctrl</Kbd>+<Kbd>Y</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Bold</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>B</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Italic</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>I</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Underline</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>U</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Strikethrough</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>Shift</Kbd>+<Kbd>X</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Link</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>K</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Headings 1 through 6</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>1</Kbd> through <Kbd>Cmd</Kbd>+<Kbd>6</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Promote heading (e.g., H2 to H1)</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>Ctrl</Kbd>+<Kbd>+</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Demote heading (e.g., H2 to H3)</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>Ctrl</Kbd>+<Kbd>-</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Code block (with language prompt)</td><td className="px-3 py-1.5"><Kbd>Cmd</Kbd>+<Kbd>Ctrl</Kbd>+<Kbd>C</Kbd></td></tr>
            <tr><td className="px-3 py-1.5">Blockquote</td><td className="px-3 py-1.5"><Kbd>Ctrl</Kbd>+<Kbd>Q</Kbd></td></tr>
          </tbody>
        </table>
      </div>
      <Callout variant="info" title="Where shortcuts apply">
        Bold, italic, headings, and the rest work inside the inline edit
        textarea on a selected Hybrid block. They don&apos;t do anything in
        Preview, which is read-only.
      </Callout>

      <h2>Images</h2>
      <p>
        Images are first-class. Every editor has an attachments area along
        the bottom (toggleable from the toolbar) with two tabs,{" "}
        <strong>Images</strong> and <strong>Files</strong>. The Images tab
        shows thumbnails for every image in the document&apos;s{" "}
        <code>Images/</code> folder, whether or not the body references the
        image yet. There are four ways to get a new image in:
      </p>
      <ul>
        <li>
          <strong>Click the toolbar&apos;s image button</strong> to pick one
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
          (e.g., macOS <Kbd>Cmd</Kbd>+<Kbd>Shift</Kbd>+<Kbd>4</Kbd>, then
          <Kbd>Cmd</Kbd>+<Kbd>V</Kbd> in the editor) and it lands inline.
        </li>
        <li>
          <strong>Click <em>Browse</em></strong> to pick from images already
          attached to this experiment (the gallery picker). Useful when the
          image is already on disk and you just want to insert a reference
          to it without re-uploading.
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
        The Images tab at the bottom of the editor lists every image in the
        document&apos;s <code>Images/</code> folder as a row of thumbnails.
        Images already referenced in the body look normal. Images that exist
        on disk but aren&apos;t referenced yet (e.g., a fresh arrival from
        Telegram) show a small blue dot in the corner so you can spot them.
        Useful things you can do from the tab:
      </p>
      <ul>
        <li>
          <strong>Click a thumbnail</strong> to open the image metadata
          popup. The popup shows a larger preview and lets you edit the
          caption, rename the file, delete it from disk, or jump to where
          it&apos;s used in the body. If the image isn&apos;t referenced
          anywhere yet, the jump button is disabled.
        </li>
        <li>
          <strong>Drag a thumbnail into the editor</strong> to insert that
          image at the cursor position. The thumbnail stays in the tab so
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
        caption="Click any rendered image in Hybrid or Preview mode and the size popover opens. The selected percentage is written into the markdown so it sticks."
      />
      <p>
        Click any rendered image in Hybrid or Preview mode and a size popover
        appears inline with <em>25%</em>, <em>50%</em>, <em>75%</em>, and{" "}
        <em>100%</em> options. The choice writes a width attribute into the
        markdown so the size persists.
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

      <h2>PDFs and other file attachments</h2>
      <p>
        Anything that isn&apos;t an image (PDFs, CSVs, sequence files,
        protocols, archives) drops into a sibling{" "}
        <code>Files/</code> folder and shows up as a clickable hyperlink in
        the prose, not as an inline preview. The flow mirrors the image
        flow: drag from Finder, paste, or pick from the toolbar.
      </p>
      <ul>
        <li>
          <strong>Click the toolbar&apos;s <em>Add File</em> button</strong>{" "}
          to pick one or more non-image files from disk. The button appears
          in place of <em>Add Image</em> when the editor is configured to
          accept any file type (experiment Lab Notes, Results, and Notes).
          The chosen file copies into <code>Files/</code> and a markdown
          link inserts at the cursor.
        </li>
        <li>
          <strong>Drag a file from Finder</strong> anywhere over the editor.
          The blue ring lights up while the file is hovering. On release the
          file copies into <code>Files/</code> and a markdown link inserts at
          the cursor (or appends to the document if you dropped outside
          text).
        </li>
        <li>
          <strong>The Files tab</strong> sits next to the Images tab at the
          bottom of the editor. Click the <strong>Files</strong> tab to swap
          the strip from image thumbnails to file tiles. Each tile shows an
          emoji for the file type and the filename. Files already linked in
          the body look normal. Files that exist on disk but aren&apos;t
          referenced yet show a small blue dot and an &quot;unlinked&quot;
          count in the tab header. Drag a tile into the editor to insert a
          link to it.
        </li>
        <li>
          <strong>Drag a file tile to the red trash zone</strong> at the
          bottom-right of the editor. ResearchOS asks for confirmation, then
          deletes the file from disk and strips every link to it from the
          markdown body, including links that stored the filename
          URL-encoded (so <code>Files/READ%20ME.md</code> gets cleaned up
          when the underlying <em>READ ME.md</em> is dragged out).
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
        Click any <code>[name](Files/…)</code> link in Hybrid or Preview mode
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
      <pre className="text-xs bg-gray-100 rounded p-3 overflow-x-auto">
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
      <pre className="text-xs bg-gray-100 rounded p-3 overflow-x-auto">
        <code>{`## pGN-027  (parent: pGN-012)

- Resistance: Kan (50 ug/mL)
- Size: 5.4 kb
- Source: Gibson assembly of pGN-012 backbone + amplicon FN-1
- Sequence: Files/pGN-027.gbk
- Glycerol stock: -80 B, box 4, position B3
- Verified by: Sanger seqs SP1/SP2 (Files/pGN-027-seq.zip)`}</code>
      </pre>

      <h3>Sample measurement record</h3>
      <pre className="text-xs bg-gray-100 rounded p-3 overflow-x-auto">
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
      <pre className="text-xs bg-gray-100 rounded p-3 overflow-x-auto">
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
        Standard GitHub-flavored markdown all works:
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
          <code>- [x]</code>. Boxes are clickable in Hybrid and Preview.
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
        an inline edit textarea in Hybrid mode. The editor converts the
        tab-separated text into a markdown table on the fly, so you
        don&apos;t have to retype the rows.
      </Callout>

      <h2>The helper panel</h2>
      <p>
        The Hybrid editor includes a collapsible helper panel on the{" "}
        <strong>left</strong> side of the editor with two tabs at the top,{" "}
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
          Click any example to insert it at the cursor inside the active
          inline textarea. Handy when you&apos;ve forgotten the table syntax
          or want to see what callout markdown looks like.
        </li>
      </ul>

      <h2 id="saving">Saving</h2>
      <p>
        The editor doesn&apos;t autosave on every keystroke. The parent
        surface (the experiment popup, the task popup, the results page)
        decides when to flush to disk. As a rule of thumb:
      </p>
      <ul>
        <li>
          <strong>Closing a popup</strong> (e.g., the task detail popup) saves
          first.
        </li>
        <li>
          <strong>Switching to another task or experiment</strong> saves the
          current one.
        </li>
        <li>
          <strong>Standalone editors</strong> (Results, Methods, Notes) save
          on a short debounce as you type. There&apos;s no &quot;Save&quot;
          button to hunt for.
        </li>
      </ul>
      <Callout variant="warning" title="Don't kill the tab mid-edit">
        Because saves are parent-driven, force-closing the browser tab in the
        middle of typing can drop the last second or two of edits. Click
        outside the editor (or close the popup) to be sure the write has
        landed.
      </Callout>
      <p>
        On save, the editor also runs a quick cleanup pass over the
        document&apos;s <code>Images/</code> and <code>Files/</code> folders:
        anything sitting on disk that nothing in the markdown points at gets
        deleted, so deleted snippets don&apos;t leave dangling files behind.
        The sweep matches links the way the body writes them, so
        URL-encoded file links (<code>Files/READ%20ME.md</code>) protect
        their on-disk counterparts correctly.
      </p>
      <Callout variant="info" title="Every save is recorded">
        On the surfaces where{" "}
        <Link href="/wiki/features/version-history">Version History</Link> is on
        (free-form Notes today, rolling out further), each of these saves also
        appends one entry to the note&apos;s history timeline, so you can scroll
        back through past states and, in the restore pilot, roll the note back to
        an earlier one. Saving is unchanged; the history is recorded alongside it.
      </Callout>

      <h2>Things people miss</h2>
      <ul>
        <li>
          <strong>Undo / redo across the whole document</strong>: the editor
          maintains its own undo stack (not the browser&apos;s textarea
          native undo). <Kbd>Cmd</Kbd>+<Kbd>Z</Kbd> steps back through
          edits, including block deletions and image drops.{" "}
          <Kbd>Cmd</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Z</Kbd> (or{" "}
          <Kbd>Ctrl</Kbd>+<Kbd>Y</Kbd> on Windows) steps forward.
        </li>
        <li>
          <strong>Promote/demote a heading</strong> in place with{" "}
          <Kbd>Cmd</Kbd>+<Kbd>Ctrl</Kbd>+<Kbd>+</Kbd> or{" "}
          <Kbd>Cmd</Kbd>+<Kbd>Ctrl</Kbd>+<Kbd>-</Kbd>. You don&apos;t need to
          retype the <code>#</code> marks.
        </li>
        <li>
          <strong>Split here</strong>: while editing a paragraph block inline,
          a <em>Split here</em> button appears at the cursor position. Clicking
          it is the same as pressing <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd>: it
          inserts a hard paragraph break at that point, commits, and produces
          two separate blocks.
        </li>
        <li>
          <strong>+ Add paragraph</strong> button at the bottom of the editor
          body. Click it to append a fresh empty paragraph block without
          scrolling or clicking in the body.
        </li>
        <li>
          <strong>The <em>Strip</em> button</strong> in the toolbar toggles the
          attachments strip (Images and Files tabs) on and off. Click it again
          to bring the strip back. It hides both tabs at once.
        </li>
        <li>
          <strong>Drag a thumbnail back into the editor</strong> to insert the
          same image a second time. The file isn&apos;t duplicated, only the
          reference is.
        </li>
      </ul>
    </WikiPage>
  );
}
