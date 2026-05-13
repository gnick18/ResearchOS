import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function TelegramIntegrationPage() {
  return (
    <WikiPage
      title="Telegram Bot"
      intro="Pair your account with a Telegram bot so phone photos from the bench land directly in your inbox."
    >
      <Screenshot
        src="/wiki/screenshots/telegram-pairing.png"
        alt="The Telegram pairing modal showing the bot-token field and a paired status."
        caption="The Telegram pairing modal, reached from Settings → Profile."
      />

      <h2>What this gets you</h2>
      <p>
        Take a photo at the bench, send it to your Telegram bot, and a few
        seconds later it appears inside ResearchOS in two places: an{" "}
        <strong>inbox tray</strong> in the bottom-right of the window, and a{" "}
        <strong>toast</strong> at the same corner so you notice it. From the
        tray you can drag the photo straight into any experiment&apos;s notes
        or its results gallery.
      </p>
      <p>
        Each photo card in the tray shows the caption you sent with it, when
        it arrived, and a small preview. Click the card to enlarge, or drag
        it onto the editor where you want it filed.
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
          Send <code>/newbot</code>. BotFather asks for a display name (any)
          and a username (must end in <code>bot</code>, e.g.,{" "}
          <code>my_lab_camera_bot</code>).
        </Step>
        <Step>
          BotFather replies with the bot&apos;s <strong>API token</strong>, a
          string like <code>1234567:ABCdef…</code>. Copy it.
        </Step>
      </Steps>

      <h2>Pair with ResearchOS</h2>
      <Steps>
        <Step>
          In ResearchOS, open <strong>Settings → Profile → Connect Telegram</strong>.
        </Step>
        <Step>
          Paste the bot token. The modal validates it and shows the bot&apos;s
          name.
        </Step>
        <Step>
          On your phone, open a chat with your new bot and send{" "}
          <code>/start</code>. ResearchOS sees the message, captures your chat
          ID, and confirms the pair.
        </Step>
        <Step>
          Send any photo to the bot. It should appear in the ResearchOS inbox
          tray within a few seconds.
        </Step>
      </Steps>

      <Callout variant="danger" title="Keep your bot token private">
        Anyone with this token can send messages and receive photos as your
        bot. ResearchOS writes it to{" "}
        <code>users/&lt;you&gt;/_telegram.json</code> and auto-appends a{" "}
        <code>.gitignore</code> rule so it isn&apos;t committed to git. Treat
        the token like a password.
      </Callout>

      <h2>Disconnecting</h2>
      <p>
        Reopen the Telegram pairing modal and click{" "}
        <strong>Disconnect</strong>. That removes the local token. The bot
        itself stays alive on Telegram&apos;s side. To delete the bot
        entirely, send <code>/deletebot</code> to BotFather.
      </p>
    </WikiPage>
  );
}
