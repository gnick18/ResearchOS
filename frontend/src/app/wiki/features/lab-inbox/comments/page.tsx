import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabInboxCommentsPage() {
  return (
    <WikiPage
      title="Comments"
      intro="Comments are short asynchronous messages attached to a record (a task, a note, or a purchase). They keep a conversation tied to the thing it is about, so a question about a PCR recipe lives on that PCR task, not in a separate chat channel. One level of reply nesting keeps threads readable without turning them into Reddit."
    >
      <Screenshot
        src="/wiki/screenshots/lab-inbox-comments-rail.png"
        alt="An experiment popup with the comments rail docked open on the right, showing a threaded conversation with one reply indented, while the experiment dependency chain stays in view on the left."
        caption="Comments dock in a rail on the right of the record, the way Google Docs and Word park comments beside the document. The header comment button carries a count badge when a thread is waiting."
      />

      <h2>Where comments live</h2>
      <p>
        Three record types accept comments today.
      </p>
      <ul>
        <li><strong>Tasks</strong> (experiments, lists, purchase orders).</li>
        <li><strong>Notes</strong> (free-form lab notes outside an experiment).</li>
        <li><strong>Purchases</strong> (individual line items inside a purchase order).</li>
      </ul>
      <p>
        Open any of those records and comments live in a docked rail on the
        right side of the popup, the way Google Docs and Word park comments
        beside the document instead of below it. The thread sits next to the
        record you are reading, so you keep the recipe or the note in view
        while you scan the conversation about it.
      </p>

      <h2>Opening the comments rail</h2>
      <p>
        Each record popup has a <strong>comment button</strong> in its header.
        Click it to slide the rail open on the right. When a record already
        has comments, the button wears a small <strong>count badge</strong> so
        you can tell at a glance whether a thread is waiting before you open
        anything.
      </p>
      <p>
        The comments rail and the version-history rail share the same docked
        spot, so they are <strong>mutually exclusive</strong>. Opening one
        closes the other. Press <strong>Escape</strong> to close whichever
        rail is open, which drops you back to the full-width record without
        closing the popup itself.
      </p>
      <p>
        You can also start a comment without opening the record first.{" "}
        <strong>Right-click an experiment card or a note card</strong> and
        choose <strong>Add a comment</strong> (or <strong>View / add comment</strong>{" "}
        when a thread already exists). That opens the record with the comments
        rail already expanded and the cursor in the composer, so a quick note
        to a labmate is two clicks from the board.
      </p>
      <h2>Threading, one level deep</h2>
      <p>
        Comments support a single level of reply nesting. A top-level comment
        can have replies; a reply cannot have its own reply. This keeps a
        thread legible at a glance and prevents the rabbit-hole shape that
        threaded chat platforms drift into. If a reply itself needs a deeper
        conversation, post a new top-level comment that references it.
      </p>

      <h2>@-mentions</h2>
      <p>
        Type <code>@</code> inside a comment to summon the mention picker.
        Pick a lab member from the dropdown and the editor inserts a mention
        chip. The mention does two things.
      </p>
      <ul>
        <li>
          Renders in the comment body as a styled chip (the member&apos;s
          name, in the member&apos;s color).
        </li>
        <li>
          Pushes the member&apos;s id onto the comment&apos;s{" "}
          <code>mentions: string[]</code> array, a denormalized field that
          the inbox uses to filter for &quot;comments I was mentioned in.&quot;
        </li>
      </ul>
      <Callout variant="info" title="Denormalized array, not regex">
        Earlier prototypes filtered mentions by regex-matching the comment
        body. That fell apart with edits, mention chip styling, and special
        characters. The denormalized <code>mentions</code> array is now the
        only source of truth for &quot;was X mentioned.&quot; The body
        rendering is independent, so it can change layout without breaking the
        filter index.
      </Callout>
      <p>
        Members see their @-mentions in the bell (the personal notification
        queue). On the Lab Overview, the{" "}
        <strong>What needs you</strong> hero shows a live count of @-mentions
        for the PI and links to the notes surface where the relevant records
        live.
      </p>

      <h2>Finding comments across records</h2>
      <p>
        Comments live on the record they were written on. To find a comment,
        open the record it belongs to and the comments rail will show the
        thread. When a bell notification links you to a comment, tapping it
        opens the host record directly with the rail expanded.
      </p>

      <h2>Cross-owner read access</h2>
      <p>
        Comments inherit the read permission of their host record. If you
        have read access to a task that a labmate owns, you also see (and can
        post) comments on it. PIs have implicit read access to
        everything, so they see every comment in the lab. Members only see
        comments on the records they would already see, never anyone
        else&apos;s private threads.
      </p>

      <Callout variant="tip" title="Comments are not the bell">
        Comments are the asynchronous-chat layer of ResearchOS. They are
        low-friction and in-context, with no hard notification unless you
        @-mention someone. If you
        need someone to see something right now, mention them and the bell
        pings. Otherwise, drop the comment and trust that the recipient will
        find it on their next inbox scan.
      </Callout>
    </WikiPage>
  );
}
