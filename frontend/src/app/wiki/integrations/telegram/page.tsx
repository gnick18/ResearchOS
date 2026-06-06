import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function TelegramIntegrationPage() {
  return (
    <WikiPage
      title="Telegram Bot"
      intro="Pair your account with a Telegram bot so phone photos from the bench are routed to the right experiment with a single tap."
    >
      <Screenshot
        src="/wiki/screenshots/telegram-pairing.png"
        alt="The Telegram pairing modal with the bot-token field, opened from the Telegram pill in the top bar."
        caption="Click the Telegram pill in the top bar to open this pairing modal."
      />

      <h2>What it does</h2>
      <p>
        Once paired, you send photos to a single Telegram bot from your phone.
        Where a photo lands depends on one thing: what you have open in
        ResearchOS when it arrives. The routing is deliberately small, two
        cases instead of a long destination menu:
      </p>
      <ul>
        <li>
          <strong>An experiment is open.</strong> The bot asks one quick
          question, <strong>Lab Notes</strong> or <strong>Results</strong>,
          and saves the photo to that experiment once you tap.
        </li>
        <li>
          <strong>Nothing is open.</strong> The photo goes straight to your
          Inbox and the bot just replies <em>&quot;Saved to inbox.&quot;</em>{" "}
          No buttons, no picker. You sort it later from the in-app Inbox.
        </li>
      </ul>
      <p>
        When you pick Lab Notes or Results, the bot then asks for a caption.
        Type one back and it is stored alongside the image. Send{" "}
        <code>/skip</code> to leave the photo without one. Photos that go
        straight to the Inbox skip the caption round, since sorting (and
        captioning) happens in the app.
      </p>

      <h2>The Telegram pill</h2>
      <p>
        At the top of every page in ResearchOS there&apos;s a small pill
        that either reads &quot;Connect Telegram&quot; (gray, when no bot is
        paired) or <code>Telegram: @yourbot</code> with a green pulsing dot
        when polling is healthy. The pill turns amber if another tab is
        already polling the same bot, and red if Telegram has rejected the
        token (i.e., you need to re-pair). Click it any time to open the
        pairing or disconnect modal.
      </p>

      <h3>The &quot;retrying&quot; state</h3>
      <p>
        If the bridge hits a transient hiccup like a token refresh blip, a
        flaky Wi-Fi connection, or a brief Telegram API timeout, the pill
        switches to amber with a pulsing dot and adds a small{" "}
        <code>RETRYING</code> label next to the bot username. The poller
        backs off and retries on its own, doubling the delay up to a 30-second
        cap. The pill flips back to the steady green dot the moment a request
        succeeds, so there&apos;s nothing to click. If the label sticks around
        for more than a minute or two, opening the pill and re-pairing is the
        usual fix.
      </p>

      <h3>The &quot;+N&quot; recent-photos chip</h3>
      <p>
        Each time a new photo arrives over Telegram while this tab is open,
        the pill grows a green <code>+N</code> counter on the right (e.g.,{" "}
        <code>+3</code> after three photos have come in). It&apos;s a quick
        confirmation that the bridge is alive and that the photos you just
        sent from your phone actually made it across. The counter resets
        whenever the tab reloads, so it tracks &quot;photos this session&quot;
        rather than &quot;unread photos&quot;, that&apos;s what the Inbox
        badge next to the pill is for.
      </p>

      <h2>Create a bot</h2>
      <Steps>
        <Step>
          Open Telegram on your phone or desktop and start a chat with{" "}
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noopener noreferrer"
          >
            @BotFather
          </a>
          .
        </Step>
        <Step>
          Send <code>/newbot</code>. BotFather first asks for a display name
          (anything you want), then a username (must end in <code>bot</code>,
          e.g., <code>my_lab_camera_bot</code>).
        </Step>
        <Step>
          BotFather replies with the bot&apos;s API token, a string like{" "}
          <code>1234567:ABCdef…</code>. Copy it.
        </Step>
      </Steps>

      <h2>Pair with ResearchOS</h2>
      <Steps>
        <Step>
          Click the <strong>Connect Telegram</strong> pill in the top bar of
          any page in ResearchOS.
        </Step>
        <Step>
          Paste the bot token into the <strong>Bot token</strong> field and
          click <strong>Connect</strong>. The modal validates the token with
          Telegram and shows the bot&apos;s username.
        </Step>
        <Step>
          On your phone, open a chat with your new bot and send any message
          (e.g., <code>/start</code>). ResearchOS picks up the message,
          captures your chat id, and the modal flips to a green
          &quot;Paired&quot; confirmation.
        </Step>
        <Step>
          Send any photo to the bot. With nothing open in ResearchOS it lands
          in your Inbox within a couple of seconds and the bot replies{" "}
          <em>&quot;Saved to inbox.&quot;</em> Open an experiment first and the
          bot will instead ask Lab Notes or Results.
        </Step>
      </Steps>

      <Callout
        variant="info"
        title="Pairing isn't saved until you send your bot a message"
      >
        The &quot;send a message&quot; step is how the bot learns which
        Telegram chat belongs to you. Until that first message arrives, the
        modal sits at the &quot;waiting&quot; screen. You can cancel from
        that screen at any time.
      </Callout>

      <Callout
        variant="tip"
        title="During setup, your first photo just goes to the Inbox"
      >
        While you are still walking through setup, the bot keeps it extra
        simple: the first photo you send lands in your Inbox with a short
        acknowledgement, no questions, so you can confirm the bridge works
        before you have your bearings. Once you finish the walkthrough, the
        bot switches to its normal behavior: Lab Notes or Results when an
        experiment is open, straight to the Inbox when nothing is.
      </Callout>

      <h2>Where photos arrive</h2>
      <p>
        Routing keys off what you have open in ResearchOS when the photo
        arrives. There&apos;s no big destination menu anymore. The old
        &quot;pick from a list of every experiment&quot; picker was removed:
        sorting now happens in a beefed-up in-app Inbox (see below), so the
        bot only ever has to handle two cases:
      </p>
      <ul>
        <li>
          <strong>An experiment is open in ResearchOS.</strong> The bot
          asks one question: <strong>Lab Notes</strong> (saves into{" "}
          <code>notes.md</code>&apos;s image folder) or{" "}
          <strong>Results</strong> (saves into the{" "}
          <code>results.md</code> image folder). Tap one and it lands in
          that experiment.
        </li>
        <li>
          <strong>Only a note popup is open.</strong> The photo attaches
          straight to that note, no Lab Notes / Results split (notes
          don&apos;t have one).
        </li>
        <li>
          <strong>Nothing is open.</strong> The photo goes straight to your
          Inbox and the bot replies <em>&quot;Saved to inbox.&quot;</em> No
          buttons. Open the in-app Inbox to file it whenever you are back at
          your desk.
        </li>
      </ul>

      <h3>Lab Notes vs Results</h3>
      <p>
        When an experiment is open, the bot&apos;s only question is Lab
        Notes or Results, shown as two buttons. One tap commits the
        destination.
      </p>
      <ul>
        <li>
          <strong>Lab Notes</strong> routes the photo into the{" "}
          <code>Images/</code> folder under <code>notes.md</code>.
        </li>
        <li>
          <strong>Results</strong> routes it into the{" "}
          <code>Images/</code> folder under <code>results.md</code>.
        </li>
      </ul>
      <Callout variant="info" title="Photos render inline, even with spaces in the name">
        Whatever the photo ends up named, once it lands in Lab Notes or
        Results it shows up inline in the markdown rather than as a broken
        link. Filenames with spaces (a phone document called{" "}
        <code>gel run 2.jpg</code>, say, or a batch name you typed) used to
        trip up the markdown image reference and quietly drop the picture.
        The reference is now written so the image displays correctly in the
        editor regardless of spaces in the filename, both for photos that come
        in over Telegram and for images you drag in from the bottom strip.
      </Callout>

      <h3>Attaching to a Note</h3>
      <p>
        Notes are first-class destinations alongside experiments. When a
        note popup is the only thing open in ResearchOS, the photo attaches
        straight to that note. Notes do not have a Lab Notes vs Results
        split, so there&apos;s nothing to pick. The photo lands in{" "}
        <code>users/&lt;owner&gt;/notes/&lt;id&gt;/Images/</code> and a
        markdown image link is appended to the note&apos;s most recent
        entry. If the note has no entries yet, the bot creates a fresh
        entry dated today and drops the link there. To attach to a note you
        do not have open, let the photo land in the Inbox and use{" "}
        <strong>Send to note&hellip;</strong> from there (see below).
      </p>

      <h3>When both an experiment and a note are open</h3>
      <p>
        If you have an experiment popup AND a note popup open at the same
        time, the experiment wins. The bot runs the usual Lab Notes /
        Results question for that experiment. If you actually meant the
        note, close the experiment popup first, or let the photo go to the
        Inbox and file it to the note from there.
      </p>

      <Screenshot
        src="/wiki/screenshots/telegram-inbox.png"
        alt="The Inbox modal listing photos sent via Telegram with their captions, timestamps, and Move to active / Delete buttons."
        caption="The Inbox modal, opened from the Inbox badge in the top bar."
      />

      <h2>The inbox</h2>
      <p>
        Whenever a photo arrives with nothing open in ResearchOS, it lands
        at <code>users/&lt;you&gt;/inbox/Images/</code> and the{" "}
        <strong>Inbox</strong> badge in the top bar increments. This is now
        the main sorting surface: instead of the bot making you choose a
        destination from a long list on your phone, you batch your unsorted
        photos in the Inbox and file them in the app, where you can see them.
        Click the badge to open the inbox modal. Each row shows a thumbnail,
        the caption you sent, and when it arrived. From here you can move a
        photo into the
        currently-open surface with one click (<strong>Move to active</strong>{" "}
        routes to either the open experiment or the open note; when both are
        open at once a small dropdown next to the button lets you pick which
        one). You can also click the row to rename or edit the caption, or
        delete it. A small <strong>⋯</strong> button fades in on hover and
        opens the same menu as right-click.
      </p>

      <h3>Filing a batch of photos</h3>
      <p>
        When you come back to your desk with a stack of phone photos that
        all belong to the same experiment, the inbox lets you file them in
        one move instead of clicking <strong>Move to active</strong> on each
        row:
      </p>
      <ul>
        <li>
          <strong>Shift-click</strong> a second row to select the contiguous
          range from your last anchor row to this one.
        </li>
        <li>
          <strong>Cmd-click</strong> (or <strong>Ctrl-click</strong> on
          Windows / Linux) to toggle individual rows in and out of the
          selection without disturbing the rest.
        </li>
        <li>
          Selected rows pick up a blue border and ring. Clicking the empty
          area of the modal clears the selection.
        </li>
      </ul>
      <p>
        With one or more rows selected, <strong>right-click any selected
        row</strong> (or click the <strong>⋯</strong> button) to open a
        context menu. The top two items read <strong>Send to task&hellip;</strong>{" "}
        and <strong>Send to note&hellip;</strong> for a single row, or{" "}
        <strong>Send N items to task&hellip;</strong> /{" "}
        <strong>Send N items to note&hellip;</strong> when multiple are
        selected. The task picker is sorted by most-recent start date and
        lands the batch in the task&apos;s Lab Notes folder; the note picker
        is sorted by most-recently-updated and appends a markdown image link
        to each note&apos;s latest entry as the photo lands. If any filename
        collides with an image already in the destination, the
        duplicate-resolution dialog walks you through{" "}
        <strong>Rename</strong>, <strong>Replace</strong>, or{" "}
        <strong>Cancel</strong> per collision (task destinations only; the
        note destination dedupes filenames internally). A green toast in
        the bottom-right of the modal confirms how many photos landed.
      </p>
      <Callout
        variant="tip"
        title="Right-click works on a single row too"
      >
        You don&apos;t need to select multiple rows first. Right-click any
        inbox row and pick <strong>Send to task&hellip;</strong> to file
        that one photo into any experiment, even one you don&apos;t have
        open. It saves opening the experiment&apos;s popup just to use the{" "}
        <strong>Move to active</strong> button.
      </Callout>

      <h2>The bot&apos;s reply flow</h2>
      <p>
        The reply depends on what is open. With an experiment open, the bot
        asks <strong>Lab Notes</strong> or <strong>Results</strong>; after
        you tap, it saves the file and asks for a caption. Reply with a
        sentence and it is stored as the image&apos;s caption, or send{" "}
        <code>/skip</code> to leave the photo without one. With nothing open,
        there&apos;s no question at all: the bot saves the photo to your Inbox
        and replies <em>&quot;Saved to inbox.&quot;</em> Captioning that one
        happens in the app.
      </p>
      <p>
        Albums (multiple photos sent together) are handled as one batch
        rather than prompted per photo. With an experiment open, you answer
        Lab Notes or Results once for the whole batch, then name the batch in
        one go or caption each photo individually. With nothing open, the
        whole batch drops into the Inbox with a single{" "}
        <em>&quot;Saved N photos to inbox&quot;</em> ack.
      </p>
      <p>
        Send <code>/help</code> to the bot at any time for a refresher on
        how it behaves.
      </p>

      <Callout variant="danger" title="Keep your bot token private">
        Anyone with this token can send messages and receive photos as your
        bot. ResearchOS writes the token to{" "}
        <code>users/&lt;you&gt;/_telegram.json</code> in your data folder
        and auto-appends a <code>.gitignore</code> rule so it isn&apos;t
        committed if the data folder is a git repo. Treat the token like a
        password.
      </Callout>

      <h2>Disconnecting</h2>
      <p>
        Click the Telegram pill again. The modal lists the current pairing
        with a <strong>Disconnect bot</strong> button. Clicking it deletes
        your local <code>_telegram.json</code> and polling stops. Existing
        photos and notes aren&apos;t touched.
      </p>
      <p>
        The bot itself stays alive on Telegram&apos;s side. To delete the
        bot entirely, send <code>/deletebot</code> to{" "}
        <a
          href="https://t.me/BotFather"
          target="_blank"
          rel="noopener noreferrer"
        >
          @BotFather
        </a>{" "}
        and confirm with the bot&apos;s username.
      </p>

      <h2>Multiple tabs</h2>
      <p>
        Polling Telegram from two ResearchOS tabs at once would have them
        fight over the same message cursor. The app holds a cross-tab lock
        in <code>localStorage</code>, so only one tab polls at a time. The
        other tabs show an amber pill with the label{" "}
        <code>ANOTHER TAB IS POLLING</code> and pick up automatically if
        the active tab closes.
      </p>
    </WikiPage>
  );
}
