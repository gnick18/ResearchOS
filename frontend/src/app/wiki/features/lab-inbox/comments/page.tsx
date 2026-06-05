import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabInboxCommentsPage() {
  return (
    <WikiPage
      title="Comments"
      intro="Comments are short asynchronous messages attached to a record (a task, a note, or a purchase). They keep a conversation tied to the thing it is about: a question about a PCR recipe lives on that PCR task, not in a separate chat channel. One level of reply nesting keeps threads readable without turning them into Reddit."
    >
      {/* TODO screenshot agent: capture the comments thread on a task popup with one reply.
          Route: open a task popup with two comments + one reply
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: lab_head fixture; task with a top-level comment from member, a reply from
                 lab_head, and an @-mention chip rendered inline
          Save to: frontend/public/wiki/screenshots/lab-inbox-comments-thread.png
      */}
      <Screenshot
        src="/wiki/screenshots/lab-inbox-comments-thread.png"
        alt="A comments thread inside a task popup showing two top-level comments, one with an indented reply, and an @-mention chip inside one of the bodies."
        caption="A thread on a task: top-level comments with one level of reply indent. @-mentions render as inline chips."
      />

      <h2>Where comments live</h2>
      <p>
        Three record types accept comments today:
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
        while you scan the conversation about it. The Lab Inbox is the
        aggregator. The same comments appear in the inbox stream so you can
        read everything written today without opening each record one at a
        time.
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
      {/* SCREENSHOT TODO: fresh capture of the comments rail docked open on the
          right of an experiment (task) popup, with a short thread visible and the
          header comment button showing its count badge. Fixture: ?wikiCapture=1,
          desktop 1440x900. Save to:
          frontend/public/wiki/screenshots/lab-inbox-comments-rail.png */}

      <h2>Threading: one level deep</h2>
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
        chip. The mention does two things:
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
        rendering is independent: it can change layout without breaking the
        filter index.
      </Callout>
      <p>
        Members see their @-mentions both in the bell (the personal queue)
        and in the @-mentions filter of the Lab Inbox.
      </p>

      <h2>The in-place source-record popup</h2>
      <p>
        Clicking a comment row in the Lab Inbox opens the host record in a
        popup on top of the inbox. The inbox itself stays mounted underneath,
        so closing the host popup drops you straight back into the inbox at
        the same scroll position. This is the Lab Inbox R1 affordance: you can
        triage a stream of comments by opening each host record, leaving a
        reply, and closing it without losing your place in the stream.
      </p>
      <p>
        The same affordance works the other way around. Open a task from any
        other surface (Gantt, Workbench, Home), click the header comment
        button to open the rail, and the same comment object is there with the
        same thread.
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
        Comments are the asynchronous-chat layer of ResearchOS: low-friction,
        in-context, no hard notification unless you @-mention someone. If you
        need someone to see something right now, mention them and the bell
        pings. Otherwise, drop the comment and trust that the recipient will
        find it on their next inbox scan.
      </Callout>
    </WikiPage>
  );
}
