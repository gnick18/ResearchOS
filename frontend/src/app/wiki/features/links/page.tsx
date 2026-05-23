import WikiPage from "@/components/wiki/WikiPage";
import Screenshot from "@/components/wiki/Screenshot";
import Callout from "@/components/wiki/Callout";
import { Steps, Step } from "@/components/wiki/Steps";

export default function LinksFeaturePage() {
  return (
    <WikiPage
      title="Links / Lab Links"
      intro="Your own bookmark wall: link cards with preview images, grouped into categories, stored under your user."
    >
      {/* links.png needs recapture: predates Q7-conditional label */}
      <Screenshot
        src="/wiki/screenshots/links.png"
        alt="The Links page showing link cards grouped into category sections, each card with a preview image and a title underneath."
        caption="Link cards grouped by category. Each card opens its URL in a new tab when clicked."
      />

      <Callout variant="info" title="Solo vs. lab label">
        Solo accounts see this surface labeled &quot;Links&quot; in the
        nav and page header. Lab accounts see &quot;Lab Links&quot;.
        The feature is identical either way.
      </Callout>

      <Callout variant="info" title="Q7 opt-in: Links is only visible if you enabled it">
        The Links tab only appears if you answered &quot;Yes&quot; to the
        setup wizard question about storing bookmarks (Q7). If you
        don&apos;t see the tab, open Settings and re-run the setup
        wizard to enable it.
      </Callout>

      <h2>What the page looks like</h2>
      <p>
        Each saved link is a card with a preview image (or a solid colored
        block if no image), the link title, a short description, and the
        hostname. Cards are grouped into category sections. The section
        header is the category name, and links without a category land
        under <em>Other</em>. Clicking a card opens its URL in a new tab.
      </p>
      <Callout variant="info" title="Color swatch vs. preview image">
        The color swatch only appears when no preview image is set. If you
        supply both a color and a preview image URL, the image takes
        precedence and the color is not shown.
      </Callout>

      <Callout variant="info" title="Per-user, not lab-wide">
        Links sit in your own folder under{" "}
        <code>users/{`<you>`}/lab_links/</code>. Each labmate keeps their own
        wall. Adding a link doesn&apos;t share it with anyone else. There
        is no per-link public or shared toggle in the data model.
      </Callout>

      <h2>Add a link</h2>
      <Steps>
        <Step>
          Click <strong>Add Link</strong> in the top right of the page. A
          form expands inline below the button.
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
        That&apos;s it. There is no per-link sharing toggle, no
        cross-user visibility, no labmate ordering. If a labmate needs the
        same set of URLs, they add them to their own Links page.
      </p>
    </WikiPage>
  );
}
