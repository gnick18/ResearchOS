import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";

export default function BrowserRequirementsPage() {
  return (
    <WikiPage
      intro="ResearchOS reads and writes files directly on your computer, which only some browsers can do."
    >
      <h2>Supported browsers</h2>
      <ul>
        <li>
          <strong>Google Chrome</strong> (version 86+) — Windows, macOS, Linux,
          ChromeOS
        </li>
        <li>
          <strong>Microsoft Edge</strong> (version 86+) — Windows, macOS
        </li>
        <li>
          <strong>Brave</strong> — Windows, macOS, Linux
        </li>
        <li>
          Other Chromium-based browsers (Arc, Vivaldi, Opera) generally work but
          are not officially tested.
        </li>
      </ul>

      <h2>Not supported</h2>
      <ul>
        <li>
          <strong>Firefox</strong> — does not implement the File System Access
          API. The same data is stored in <code>users/&lt;username&gt;/</code>
          inside your folder, so once it ships, your existing data will load.
        </li>
        <li>
          <strong>Safari (macOS / iOS)</strong> — same limitation as Firefox.
        </li>
        <li>
          <strong>Mobile browsers</strong> (Chrome / Edge / Brave on iOS or
          Android) — the API is desktop-only.
        </li>
      </ul>

      <Callout variant="info" title="Why this limitation?">
        ResearchOS uses the <strong>File System Access API</strong> to read and
        write JSON files directly to a folder you pick. This is what lets the
        app run with no server, no account, and no upload of your data. Until
        Firefox and Safari ship support, those browsers can&apos;t open
        ResearchOS folders.
      </Callout>

      <h2>How to switch browsers</h2>
      <ul>
        <li>
          <strong>Chrome</strong> —{" "}
          <a
            href="https://www.google.com/chrome/"
            target="_blank"
            rel="noopener noreferrer"
          >
            google.com/chrome
          </a>
        </li>
        <li>
          <strong>Edge</strong> —{" "}
          <a
            href="https://www.microsoft.com/edge"
            target="_blank"
            rel="noopener noreferrer"
          >
            microsoft.com/edge
          </a>{" "}
          (preinstalled on Windows 10/11)
        </li>
        <li>
          <strong>Brave</strong> —{" "}
          <a href="https://brave.com/" target="_blank" rel="noopener noreferrer">
            brave.com
          </a>
        </li>
      </ul>

      <Callout variant="tip" title="Keep Firefox or Safari as your daily driver">
        You only need a Chromium browser open <em>while you&apos;re using
        ResearchOS</em>. Many users keep Firefox or Safari for everyday browsing
        and open Chrome only for ResearchOS.
      </Callout>
    </WikiPage>
  );
}
