import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import Kbd from "@/components/wiki/Kbd";
import { Steps, Step } from "@/components/wiki/Steps";

export default function MarkdownEditorPage() {
  return (
    <WikiPage
      title="The Markdown Editor"
      intro="Wherever you write prose in ResearchOS (experiment notes, task descriptions, results write-ups, methods bodies, free-form notes), you're using the same markdown editor. Learning its three modes and shortcut set pays off fast."
    >
      <Screenshot
        src="/wiki/screenshots/experiments-editor.png"
        alt="The markdown editor open in an experiment, showing markdown notes, an image strip, and the side panel."
        caption="The editor as it appears inside an experiment. The same component mounts in task popups, results, methods, and notes."
      />

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
          The right-side write-up panel on the{" "}
          <Link href="/wiki/features/results">Results</Link> page.
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
        The toolbar in the top-right of every editor has a three-way mode
        toggle. The choice of mode is purely a viewing preference, it
        doesn&apos;t change what gets saved.
      </p>
      <ul>
        <li>
          <strong>Edit</strong>: raw markdown source in a monospace textarea.
          All keyboard shortcuts are active here. Best when you want to type
          or paste markdown directly, work with code blocks, or eyeball the
          underlying syntax.
        </li>
        <li>
          <strong>Hybrid</strong> (the default): the rendered view, but every
          block is click-to-edit. Single-click a paragraph or heading to select
          it, double-click (or <Kbd>Enter</Kbd>) to edit just that block, and{" "}
          <Kbd>Esc</Kbd> to commit and deselect. This is the right mode for
          most prose work.
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
          Type your edits. <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> inserts a line
          break without leaving edit mode.
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

      <h2>Writing in Edit mode</h2>
      <p>
        Edit mode is a plain markdown textarea. Type as you would in any
        markdown editor. The toolbar buttons and keyboard shortcuts all
        apply, and most have a one-key alternative in the markdown syntax
        itself.
      </p>
      <p>
        One feature unique to Edit mode: type three backticks (
        <code>```</code>) at the start of a new line and a <strong>language
        picker</strong> popup appears. Start typing a language name (e.g.,
        <code>python</code>, <code>bash</code>, <code>sql</code>) and the
        list narrows. Hit <Kbd>Enter</Kbd> and ResearchOS completes the code
        block with the language tag, ready for you to type.
      </p>
      <Callout variant="info" title="Languages with syntax highlighting">
        Around 20 popular languages get highlighting on render: JavaScript,
        TypeScript, Python, Bash, JSON, HTML, CSS, SQL, Java, C, C++, C#, Go,
        Rust, Ruby, PHP, Swift, Kotlin, YAML, Markdown, Dockerfile, and Plain
        Text. Anything else still works, it just renders monospace without
        coloring.
      </Callout>

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
        Bold, italic, headings, and the rest work in <strong>Edit</strong>{" "}
        mode and inside the inline edit textarea on a selected Hybrid block.
        They don&apos;t do anything in Preview, which is read-only.
      </Callout>

      <h2>Images</h2>
      <p>
        Images are first-class. Every editor has a strip of image thumbnails
        at the bottom (toggleable from the toolbar) and a set of ways to get
        new images in:
      </p>
      <ul>
        <li>
          <strong>Click the toolbar&apos;s image button</strong> to pick one
          or more files from disk.
        </li>
        <li>
          <strong>Drag image files into the editor body</strong>. If you drop
          inside text, the image inserts at that position. If you drop outside
          text, it appends to the document.
        </li>
        <li>
          <strong>Paste from the clipboard</strong>. Copy a screenshot
          (e.g., macOS <Kbd>Cmd</Kbd>+<Kbd>Shift</Kbd>+<Kbd>4</Kbd>, then
          <Kbd>Cmd</Kbd>+<Kbd>V</Kbd> in the editor) and it lands inline.
        </li>
        <li>
          <strong>Click <em>Browse</em></strong> to pick from images already
          attached to other documents (the gallery picker). Useful when you
          want to reference the same gel image from two experiments without
          duplicating the file.
        </li>
      </ul>
      <p>
        Every image lands in an <code>Images/</code> folder adjacent to the
        document on disk (e.g.,{" "}
        <code>users/&lt;you&gt;/results/task-12/Images/gel-2026-05-10.png</code>),
        and the markdown body references it with{" "}
        <code>![caption](Images/gel-2026-05-10.png)</code>.
      </p>

      <h3>The image strip</h3>
      <p>
        Below the editor, a horizontal strip lists every image referenced in
        the current document. Useful things you can do from the strip:
      </p>
      <ul>
        <li>
          <strong>Click a thumbnail</strong> to scroll the preview to that
          image&apos;s position in the body.
        </li>
        <li>
          <strong>Drag a thumbnail into the editor</strong> to insert that
          image at the cursor position. The original reference stays in place
          too, so you can have the same image appear twice in the document.
        </li>
        <li>
          <strong>Right-click (or click the info icon)</strong> to see the
          caption and a &quot;jump to occurrence&quot; button.
        </li>
        <li>
          <strong>Drag a thumbnail to the trash zone</strong> at the bottom of
          the editor. ResearchOS deletes the file from disk and removes every
          reference in the body. The trash zone only appears while you&apos;re
          actively dragging from the strip.
        </li>
      </ul>

      <h3>Resizing an image</h3>
      <p>
        Two ways:
      </p>
      <ul>
        <li>
          <strong>In Preview mode</strong>: click any rendered image to bring
          up a size popover with <em>50%</em>, <em>75%</em>, <em>100%</em>,{" "}
          <em>125%</em>, and <em>150%</em> options. The choice writes a width
          attribute into the markdown so the size persists.
        </li>
        <li>
          <strong>In Edit mode</strong>: select the markdown image syntax
          (e.g., <code>![…](Images/file.png)</code>) and click the{" "}
          <strong>Resize Image</strong> toolbar button. Same percentage
          options, applied to the selected reference.
        </li>
      </ul>

      <h3>Broken image auto-fix</h3>
      <p>
        If an image reference points at a file that no longer exists (e.g.,
        you renamed the file outside the app, or the relink hasn&apos;t
        synced from a teammate yet), the editor shows a small &quot;fix
        this&quot; popup with a list of similar-named files in the
        document&apos;s <code>Images/</code> folder. Pick one and the
        reference updates in place.
      </p>

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
        Edit mode. The editor converts the tab-separated text into a markdown
        table on the fly, so you don&apos;t have to retype the rows.
      </Callout>

      <h2>The style-guide helper</h2>
      <p>
        Edit mode includes a collapsible <strong>Style Guide</strong> panel
        on the right with example syntax for every markdown feature. Click
        any example to insert it at the cursor. Handy when you&apos;ve
        forgotten the table syntax or want to see what callout markdown
        looks like.
      </p>

      <h2>Saving</h2>
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

      <h2>Things people miss</h2>
      <ul>
        <li>
          <strong>Promote/demote a heading</strong> in place with{" "}
          <Kbd>Cmd</Kbd>+<Kbd>Ctrl</Kbd>+<Kbd>+</Kbd> or{" "}
          <Kbd>Cmd</Kbd>+<Kbd>Ctrl</Kbd>+<Kbd>-</Kbd>. You don&apos;t need to
          retype the <code>#</code> marks.
        </li>
        <li>
          <strong>The image strip toggles off</strong> from the toolbar if it
          gets in the way. Toggle it back on the same way.
        </li>
        <li>
          <strong>Drag a thumbnail back into the editor</strong> to insert the
          same image a second time. The file isn&apos;t duplicated, only the
          reference is.
        </li>
        <li>
          <strong>There&apos;s no global undo / redo</strong>. The editor
          relies on the textarea&apos;s native undo (<Kbd>Cmd</Kbd>+<Kbd>Z</Kbd>{" "}
          inside a textarea) but actions that happen outside the textarea
          (like dropping an image) don&apos;t go on the undo stack. If you
          delete a block by accident, paste it back from your last copy or
          fish the image out of the trash on disk.
        </li>
      </ul>
    </WikiPage>
  );
}
