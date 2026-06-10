import WikiPage from "@/components/wiki/WikiPage";
import Screenshot from "@/components/wiki/Screenshot";
import Callout from "@/components/wiki/Callout";
import { Steps, Step } from "@/components/wiki/Steps";

export default function LinksFeaturePage() {
  return (
    <WikiPage
      title="Links"
      intro="Your own bookmark wall, link cards with preview images, grouped into categories, stored under your user. Keep a link to yourself, or share it with the whole lab."
    >
      {/* links.png needs recapture: predates Q7-conditional label */}
      <Screenshot
        src="/wiki/screenshots/links.png"
        alt="The Links page showing link cards grouped into category sections, each card with a preview image and a title underneath."
        caption="Link cards grouped by category. Each card opens its URL in a new tab when clicked."
      />

      <Callout variant="info" title="Q7 opt-in, Links is only visible if you enabled it">
        The Links tab only appears if you answered &quot;Yes&quot; to the
        setup wizard question about storing bookmarks (Q7). If you
        don&apos;t see the tab, open Settings and re-run the setup
        wizard to enable it.
      </Callout>

      <h2>What the page looks like</h2>
      <p>
        Each saved link is a card with a preview image (or a solid colored
        block if no image), the link title, a short description, and the
        hostname. When a link has a category, the card shows it as a small
        badge in the top-left corner of the preview. Cards are grouped into
        category sections. The section header is the category name, and links
        without a category land under <em>Other</em>. Clicking a card opens its
        URL in a new tab. To narrow the board to one category, filter by it from
        the search palette. A banner with a <strong>Clear</strong> button shows
        which filter is active.
      </p>
      <Callout variant="info" title="Color swatch vs. preview image">
        The color swatch only appears when no preview image is set. If you
        supply both a color and a preview image URL, the image takes
        precedence and the color is not shown.
      </Callout>

      <Callout variant="info" title="Private by default, shareable per link">
        Links sit in your own folder under{" "}
        <code>users/{`<you>`}/lab_links/</code>, so each labmate keeps their own
        wall. A new link is private to you. If you want, you can flip a single
        link to <strong>Whole lab</strong> so everyone in the lab sees it on
        their own page. There&apos;s no all-or-nothing switch, you choose this
        link by link.
      </Callout>

      <h2>Add a link</h2>
      <Steps>
        <Step>
          Click <strong>Add Link</strong> in the top right of the page. A
          form expands inline below the button.
        </Step>
        <Step>
          Paste a URL into the <strong>URL</strong> field. Click the small
          image-icon button next to it and, if the title is still blank, it
          seeds the title with the site&apos;s hostname (for example{" "}
          <em>addgene.org</em>). It does this in your browser, with no server
          call, so nothing is sent off and no description or thumbnail is
          scraped. The card shows the site&apos;s favicon on its own. Every
          field stays editable afterward.
        </Step>
        <Step>
          Give the link a <strong>Title</strong> (required), pick or type a{" "}
          <strong>Category</strong> (the dropdown suggests Protocol,
          Database, Tool, Reference, Supplier, Publication, Software, Other,
          but any text works), and pick one of the eight color swatches.
        </Step>
        <Step>
          Set <strong>Visibility</strong>. <strong>Just me</strong> (the
          default) keeps the link private to you. <strong>Whole lab</strong>{" "}
          puts it on every lab member&apos;s Links page, where they can see and
          open it. You stay the owner, so only you can edit or remove it.
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
        preview image, a pencil to edit (reopens the same form pre-filled),
        and a trash can to delete (prompts for confirmation). The hostname
        line at the bottom of each card is auto-derived from the URL. You
        only ever set the title, not the URL display.
      </p>

      <h2>Links a labmate shared</h2>
      <p>
        When someone sets a link to <strong>Whole lab</strong>, it shows up on
        your Links page too, carrying their avatar and a <em>Shared by</em>{" "}
        label so you can tell it apart from your own. The pencil and trash
        icons stay hidden on a shared-in card, only the person who owns it can
        edit or remove it, or switch its Visibility back to{" "}
        <strong>Just me</strong>.
      </p>

      <h2>What each link stores</h2>
      <p>
        Per the on-disk JSON, a link is a title, a URL, an optional
        description, an optional category, a color, and an optional preview
        image URL, plus who owns it and whether it&apos;s shared with the whole
        lab. There&apos;s no labmate ordering. Links you keep private stay in
        your own folder, and a labmate who wants the same private set adds them
        to their own Links page.
      </p>
    </WikiPage>
  );
}
