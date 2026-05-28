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
        Every photo (or album) triggers an inline-keyboard prompt in your
        Telegram chat: the bot asks where the photo should go, you tap a
        button, and it lands there within a couple of seconds. Nothing routes
        silently on its own.
      </p>
      <p>
        After you confirm the destination, the bot asks for a caption. Type one
        back and it is stored alongside the image. Send{" "}
        <code>/skip</code> to leave the photo without one.
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
          Send any photo to the bot. The bot replies with an inline keyboard
          asking where to send it. Tap a button and the photo appears in
          ResearchOS within a couple of seconds.
        </Step>
      </Steps>

      <Callout
        variant="info"
        title="Pairing isn't saved until your bot receives a message"
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
        The bot can route to a lot of places, and showing the full
        destination picker on your very first send (before you have your
        bearings) is more overwhelming than helpful. So while you are walking
        through setup, the bot keeps it simple: the first photo you send gets
        a single <strong>Place in Inbox</strong> button and lands in your
        Inbox, no caption or style prompts. Once you finish the walkthrough,
        the bot switches to its full behavior and starts offering to attach
        photos to whatever experiment you have open or active.
      </Callout>

      <h2>Where photos arrive</h2>
      <p>
        Every inbound photo triggers the same inline-keyboard routing flow,
        regardless of what is open in ResearchOS at the time. The bot never
        silently auto-attaches.
      </p>
      <p>
        The bot&apos;s first message reads{" "}
        <strong>&quot;Got a photo. Where should it go?&quot;</strong> and
        presents a keyboard layout that depends on which surface, if any,
        is open in ResearchOS when the photo arrives:
      </p>
      <ul>
        <li>
          <strong>An experiment is open in ResearchOS.</strong> The
          keyboard shows two quick-pick options for that experiment:{" "}
          <strong>Lab Notes</strong> (saves into{" "}
          <code>notes.md</code>&apos;s image folder) or{" "}
          <strong>Results</strong> (saves into the{" "}
          <code>results.md</code> image folder), plus a{" "}
          <strong>Pick another</strong> escape hatch.
        </li>
        <li>
          <strong>A note popup is open.</strong> The keyboard offers a
          one-tap shortcut to attach to that note plus an escape to the
          full picker.
        </li>
        <li>
          <strong>Both an experiment and a note are open.</strong> The
          bot disambiguates with an A/B/C prompt asking which surface you
          mean before proceeding.
        </li>
        <li>
          <strong>Nothing is open.</strong> The bot shows the full picker:
          your active and in-progress experiments (each with Lab Notes /
          Results rows), a Notes section listing your most recent notes,
          and a <strong>📥</strong> Inbox option at the bottom.
        </li>
      </ul>

      <h3>Lab Notes vs Results</h3>
      <p>
        Each experiment in the picker shows up as two lettered rows, one
        for Lab Notes and one for Results, so the destination is committed
        in a single tap. When you use the quick-pick from an open
        experiment, the Lab Notes / Results choice is right there as
        buttons A and B.
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
        note popup is open in ResearchOS, the bot offers a one-tap{" "}
        <strong>&quot;Attach to <em>this note</em>&quot;</strong> shortcut.
        When nothing is open, the full picker has a separate{" "}
        <strong>Notes</strong> section listing your most recent notes; tap
        a lettered row to drop the photo there. Notes do not have a Lab
        Notes vs Results split, so picking a note commits the
        destination directly. The photo lands in{" "}
        <code>users/&lt;owner&gt;/notes/&lt;id&gt;/Images/</code> and a
        markdown image link is appended to the note&apos;s most recent
        entry. If the note has no entries yet, the bot creates a fresh
        entry dated today and drops the link there.
      </p>

      <h3>When both an experiment and a note are open</h3>
      <p>
        If you have an experiment popup AND a note popup open at the same
        time, the bot asks first which surface to use:{" "}
        <strong>A) the experiment</strong>,{" "}
        <strong>B) the note</strong>, or{" "}
        <strong>C) pick another experiment or note</strong>. Picking the
        experiment then runs the usual Lab Notes / Results follow-up
        prompt; picking the note commits straight to the style step.
      </p>

      <Screenshot
        src="/wiki/screenshots/telegram-inbox.png"
        alt="The Inbox modal listing photos sent via Telegram with their captions, timestamps, and Move to active / Delete buttons."
        caption="The Inbox modal, opened from the Inbox badge in the top bar."
      />

      <h2>The inbox</h2>
      <p>
        If you tap <strong>📥 Inbox</strong> in the bot&apos;s keyboard, the
        photo lands at <code>users/&lt;you&gt;/inbox/Images/</code> and the{" "}
        <strong>Inbox</strong> badge in the top bar increments. Click the badge
        to open the inbox modal. Each row shows a thumbnail, the caption you
        sent, and when it arrived. From here you can move a photo into the
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
        Every photo begins with the same opener from the bot:{" "}
        <strong>&quot;Got a photo. Where should it go?&quot;</strong> followed
        by the inline keyboard. After you tap a destination (and optionally a
        sub-tab), the bot saves the file and asks for a caption. Reply with a
        sentence and it is stored as the image&apos;s caption. Send{" "}
        <code>/skip</code> to leave the photo without one.
      </p>
      <p>
        Albums (multiple photos sent together) are bundled into a single
        routing prompt instead of one prompt per photo. After the destination
        is confirmed you can choose to name the batch in one go or caption each
        photo individually.
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
