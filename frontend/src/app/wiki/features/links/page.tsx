import WikiPage from "@/components/wiki/WikiPage";
import Screenshot from "@/components/wiki/Screenshot";
import Callout from "@/components/wiki/Callout";
import { Steps, Step } from "@/components/wiki/Steps";

export default function LinksFeaturePage() {
  return (
    <WikiPage
      title="Lab Links"
      intro="Your own bookmark wall: link cards with preview images, grouped into categories, stored under your user."
    >
      <Screenshot
        src="/wiki/screenshots/links.png"
        alt="The Lab Links page showing link cards grouped into category sections, each card with a preview image and a title underneath."
        caption="Link cards grouped by category. Each card opens its URL in a new tab when clicked."
      />

      <h2>What the page looks like</h2>
      <p>
        Each saved link is a card with a preview image (or a solid colored
        block if no image), the link title, a short description, and the
        hostname. Cards are grouped into category sections. The section
        header is the category name, and links without a category land
        under <em>Other</em>. Clicking a card opens its URL in a new tab.
      </p>

      <Callout variant="info" title="Per-user, not lab-wide">
        Lab Links sit in your own folder under{" "}
        <code>users/{`<you>`}/lab_links/</code>. Each labmate keeps their own
        wall. Adding a link doesn&apos;t share it with anyone else.
      </Callout>

      <h2>Add a link</h2>
      <Steps>
        <Step>
          Click <strong>Add Link</strong> in the top right of the page. A
          form panel slides open.
        </Step>
        <Step>
          Paste a URL into the <strong>URL</strong> field. Click the small
          image-icon button next to it to fetch a preview. That fills in
          the title, description, and preview image automatically (the
          fields are still editable afterward).
        </Step>
        <Step>
          Give the link a <strong>Title</strong> (required), pick or type a{" "}
          <strong>Category</strong> (the dropdown suggests Protocol,
          Database, Tool, Reference, Supplier, Publication, Software, Other,
          but any text works), and pick one of the eight color swatches.
        </Step>
        <Step>
          Optionally add a <strong>Description</strong> and override the{" "}
          <strong>Preview Image URL</strong> with a custom image.
        </Step>
        <Step>
          Click <strong>Create Link</strong>. The new card appears in its
          category.
        </Step>
      </Steps>

      <h2>Edit or delete a link</h2>
      <p>
        Hover a card. Two small icons appear in the top-right corner of the
        preview image: a pencil to edit (reopens the same form pre-filled),
        and a trash can to delete (prompts for confirmation). The hostname
        line at the bottom of each card is auto-derived from the URL. You
        only ever set the title, not the URL display.
      </p>

      <h2>What each link stores</h2>
      <p>
        Per the on-disk JSON: a title, a URL, an optional description, an
        optional category, a color, and an optional preview image URL.
        That&apos;s it. There&apos;s no per-link sharing toggle, no
        cross-user visibility, no labmate ordering. If a labmate needs the
        same set of URLs, paste them into their own Lab Links page.
      </p>
    </WikiPage>
  );
}
