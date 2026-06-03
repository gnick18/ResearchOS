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
          <strong>Google Chrome</strong> (version 86+) on Windows, macOS,
          Linux, ChromeOS.
        </li>
        <li>
          <strong>Microsoft Edge</strong> (version 86+) on Windows, macOS.
        </li>
        <li>
          Other Chromium-based browsers (e.g., Arc, Vivaldi, Opera) usually
          work but aren&apos;t officially tested.
        </li>
      </ul>

      <h2>Not supported</h2>
      <ul>
        <li>
          <strong>Brave</strong> is built on Chromium but deliberately removes
          the File System Access API for privacy reasons, and there is no
          reliable way to turn it back on. ResearchOS can&apos;t open your
          folder in Brave. Use Chrome or Edge instead.
        </li>
        <li>
          <strong>Firefox</strong> doesn&apos;t implement the File System
          Access API. Your data is still stored in{" "}
          <code>users/&lt;username&gt;/</code> inside your folder, so once
          Firefox ships support, your existing data will load.
        </li>
        <li>
          <strong>Safari (macOS / iOS)</strong> has the same limitation as
          Firefox.
        </li>
        <li>
          <strong>Mobile browsers</strong> (e.g., Chrome / Edge / Brave on iOS
          or Android) won&apos;t work. The API is desktop-only.
        </li>
      </ul>

      <Callout variant="info" title="Why this limitation?">
        ResearchOS uses the <strong>File System Access API</strong> to read and
        write JSON files directly to a folder you pick. This is what lets the
        app run with no server, no account, and no upload of your data. While
        Firefox and Safari haven&apos;t shipped support yet, those browsers
        can&apos;t open ResearchOS folders.
      </Callout>

      <h2>How to switch browsers</h2>
      <ul>
        <li>
          <strong>Chrome</strong>:{" "}
          <a
            href="https://www.google.com/chrome/"
            target="_blank"
            rel="noopener noreferrer"
          >
            google.com/chrome
          </a>
        </li>
        <li>
          <strong>Edge</strong>:{" "}
          <a
            href="https://www.microsoft.com/edge"
            target="_blank"
            rel="noopener noreferrer"
          >
            microsoft.com/edge
          </a>{" "}
          (preinstalled on Windows 10/11)
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
