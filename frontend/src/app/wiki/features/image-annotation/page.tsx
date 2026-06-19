import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function ImageAnnotationFeaturePage() {
  return (
    <WikiPage
      title="Image annotation"
      intro="Circle a gel band, arrow a feature on a micrograph, label the lanes. The image annotation editor lets you mark up a photo right where it lives in your notes, and it doesn't touch the original file to do it. Your markup is a separate, re-editable layer you can change or remove at any time."
    >
      <p>
        Lab images carry meaning that the pixels alone do not. A reviewer needs
        to know which band is the product, which colony you picked, which cell
        in the field is the one you counted. ResearchOS gives you a drawing
        surface for exactly that, and it treats your raw image as something you
        don&apos;t ever want corrupted.
      </p>

      <Screenshot
        src="/wiki/screenshots/image-annotation-gel.png"
        alt="The full-screen annotation editor open over a gel photo. A red ellipse circles one band, a blue arrow points to a feature, and three small text labels read 'Lane 1', 'Lane 2', and 'Lane 3' across the top of the gel."
        caption="The editor over a gel photo. An ellipse circles the product band, an arrow flags a feature, and text labels mark the lanes."
      />
      {/* SCREENSHOT TODO: capture the annotation editor open over a gel fixture
       *  image (ellipse around a band, arrow, and a couple of lane labels) with
       *  ?wikiCapture=1 against fixture data. Save to
       *  frontend/public/wiki/screenshots/image-annotation-gel.png */}

      <h2>The raw image is never modified</h2>
      <p>
        This is the part worth understanding before anything else. When you
        annotate an image, ResearchOS doesn&apos;t flatten your shapes into the
        photo. The original file stays byte-for-byte identical on disk. Your
        markup is written to a small companion file next to it, called a
        sidecar, named <code>Images/{"{filename}"}.annot.json</code>. A gel
        photo named <code>gel-day3.png</code> gets a{" "}
        <code>gel-day3.png.annot.json</code> sidecar holding your shapes, and
        the photo itself is left untouched.
      </p>
      <p>
        Because the markup lives in its own file, two things follow that matter
        for trustworthy records. Your annotations stay re-editable, since every
        shape comes back as a live object you can move, recolor, or delete. And
        to revert, you delete the sidecar. That returns the image to its
        original with no quality loss and no trace of the edit baked in.
      </p>

      <Callout variant="tip" title="Vector shapes, not painted pixels">
        Annotations are stored as vector shapes (an ellipse, an arrow, a line
        of text) recorded in the image&apos;s own pixel coordinates, not as a
        new bitmap painted over your photo. That keeps the sidecar tiny, keeps
        the markup sharp at any zoom, and is what makes a one-file delete a
        clean revert.
      </Callout>

      <h2>Opening the editor</h2>
      <p>
        There are two ways into the annotation surface, both starting from a
        thumbnail of the image you want to mark up.
      </p>
      <Steps>
        <Step>
          <p>
            Click a thumbnail to open its image metadata popup (the same popup
            covered in{" "}
            <Link href="/wiki/features/markdown-editor">the editor guide</Link>),
            then press the <strong>Annotate</strong> button.
          </p>
        </Step>
        <Step>
          <p>
            Or, on an image strip thumbnail, click the small{" "}
            <strong>pencil</strong> control to jump straight into the editor.
          </p>
        </Step>
      </Steps>
      <p>
        Either path opens a full-screen editor with the image fit to your
        viewport and a toolbar across the top. If the image already has
        annotations, they load back in ready to edit.
      </p>

      <h2>The tools</h2>
      <p>
        The toolbar holds a focused set of marking tools, each suited to a
        common lab gesture.
      </p>
      <ul>
        <li>
          <strong>Arrow</strong> and <strong>Line</strong>: point at a feature
          or connect two things. The arrow draws a head, and the line is a plain
          segment.
        </li>
        <li>
          <strong>Rectangle</strong> and <strong>Ellipse</strong>: box a region
          of interest or circle a band, a colony, a cell.
        </li>
        <li>
          <strong>Freehand pen</strong>: trace an irregular outline, like the
          edge of a tissue section.
        </li>
        <li>
          <strong>Polygon</strong>: click vertex by vertex to bound a region
          with straight edges, then close it by pressing Enter or clicking back
          on the first point (Escape cancels a polygon in progress).
        </li>
        <li>
          <strong>Text label</strong>: drop a caption directly on the image, for
          example to name lanes on a gel or stages on a time-course.
        </li>
      </ul>
      <p>
        Each shape carries its own <strong>color</strong> and{" "}
        <strong>stroke width</strong> (text labels use a font size instead), so
        you can use red for the result and a thinner gray for context. Pick a
        tool, draw on the image, and the new shape is selected so you can nudge
        it into place immediately. Double-click a text label to retype it.
      </p>

      <h2>Adjusting what you have drawn</h2>
      <p>
        Nothing you place is final. Switch to the select tool to drag any shape,
        and grab the handles on a box or line to resize it. The color and size
        controls in the toolbar re-edit whichever shape is selected, so you can
        recolor an existing arrow without redrawing it. A full{" "}
        <strong>undo</strong> and <strong>redo</strong> history covers every
        change, and the delete control (or the Delete key) removes the selected
        shape.
      </p>
      <p>
        When you zoom past the fit point, a small <strong>navigator</strong>{" "}
        appears in the corner with a preview of the whole image and a green box
        marking the region you are looking at. Click or drag inside it to jump
        the view to another part of the image without zooming back out.
      </p>
      <p>
        When the markup looks right, press <strong>Save</strong> and the editor
        writes your shapes to the sidecar and closes. <strong>Cancel</strong>{" "}
        discards everything since you opened the editor. Saving never writes the
        raw image.
      </p>

      <h2>Annotated images render everywhere</h2>
      <p>
        Because the markup is a layer, ResearchOS can paint it on top of the
        photo wherever the photo appears, and it does. Your circled band and
        labeled lanes show up in the note&apos;s markdown preview, in the image
        strips, and in the results gallery. The overlay even renders down to
        thumbnails, so a marked-up image is recognizable at a glance without
        opening it.
      </p>
      <p>
        The shapes are stored in the image&apos;s natural pixel space, so a
        single saved annotation scales correctly from a full-width figure all
        the way down to a 64-pixel thumbnail. Annotate it once and it reads
        right at every size.
      </p>

      <Screenshot
        src="/wiki/screenshots/image-annotation-in-note.png"
        alt="A note in preview mode showing the annotated gel inline, with the same ellipse, arrow, and lane labels rendered over the image at full figure width."
        caption="The same annotation rendered in a note&apos;s preview. The overlay follows the image into every surface, down to thumbnails."
      />
      {/* SCREENSHOT TODO: capture an annotated gel rendered inline in a note
       *  preview with ?wikiCapture=1. Save to
       *  frontend/public/wiki/screenshots/image-annotation-in-note.png */}

      <Callout variant="info" title="A typical workflow">
        You run a gel, snap a photo at the bench, and it lands in your note (see{" "}
        <Link href="/wiki/features/markdown-editor">the editor guide</Link> for
        how images get there). You open the annotation editor, circle the
        product band with an ellipse, arrow a non-specific band you want a
        labmate to ignore, and add three small text labels for the lanes. You
        save. From then on the gel reads correctly everywhere it appears, and
        the original photo is still exactly the file your camera produced.
      </Callout>
    </WikiPage>
  );
}
