import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function FeedbackFeaturePage() {
  return (
    <WikiPage
      title="Feedback"
      intro="The feedback button is a thin layer over GitHub Issues. Click it, pick a type (Bug, Feature request, General feedback), fill in the modal, and ResearchOS opens a pre-filled GitHub issue URL in a new tab. Nothing submits automatically. You see the body, you edit it, you click Submit. It's the most privacy-respecting bug-tracking flow we could think of."
    >
      {/* TODO screenshot agent: capture the FeedbackModal with the Bug type selected.
          Route: any page; click the FeedbackButton at the bottom
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: any user fixture; modal mounted with Bug type radio selected, the auto-attached
                 error details section visible at the bottom
          Save to: frontend/public/wiki/screenshots/feedback-modal-bug.png
      */}
      <Screenshot
        src="/wiki/screenshots/feedback-modal-bug.png"
        alt="The FeedbackModal with the Bug radio selected, an editable Title field, an editable description, and an Auto-attached error details section at the bottom."
        caption="The FeedbackModal with Bug selected. The body is editable; nothing leaves your machine until you click through to GitHub."
      />

      <h2>Where the button lives</h2>
      <p>
        Every page in ResearchOS carries a <strong>FeedbackButton</strong> in
        the bottom toolbar (or the corresponding floating cluster on
        dashboards). Click it and the FeedbackModal mounts. The button is
        always available because every surface in the app is a fair target
        for feedback.
      </p>

      <h2>The three feedback types</h2>
      <p>
        Pick a type at the top of the modal. The modal remembers your
        last-used type across sessions, so the choice you make most is the one
        already selected next time (an error-triggered open is the exception,
        it locks to Bug so you see the crash context you came to report).
      </p>
      <ul>
        <li>
          <strong>Bug.</strong> Something is broken, like a crash, a wrong
          number, or a misrendering. The modal auto-attaches the current route, the
          browser/OS string, and any recent uncaught error details so the
          report has enough context for a fix.
        </li>
        <li>
          <strong>Feature request.</strong> A new capability you wish existed.
          The modal walks a lighter template (what you want, why) and routes to
          the enhancement label on GitHub.
        </li>
        <li>
          <strong>General feedback.</strong> Anything that does not fit the
          first two, like a comment on UX, a typo, or a confused-by-naming
          note. Routes to the feedback label.
        </li>
      </ul>

      <h2>Auto-capture, no auto-submit</h2>
      <p>
        On submit, the modal does not POST to a server. It builds a GitHub
        issue URL with the title, body, and label pre-filled in the query
        string, then opens that URL in a new tab. You see the body GitHub
        is about to create, you can edit any of it, and the issue does not
        exist until you click <strong>Submit</strong> on the GitHub side.
        A few things follow from that.
      </p>
      <ul>
        <li>Nothing on your machine moves until you intentionally submit.</li>
        <li>You can sanitize anything that landed in the auto-attached error details before posting.</li>
        <li>The full report shape is determined by <code>feedback.yml</code> in the repo, so the GitHub side renders a templated form rather than a raw markdown body.</li>
        <li>If you would rather not open a new tab, a Copy Link button puts the same pre-filled issue URL on your clipboard so you can open it yourself.</li>
      </ul>

      <Callout variant="info" title="feedback.yml routing">
        The GitHub Issues template at{" "}
        <code>.github/ISSUE_TEMPLATE/feedback.yml</code> defines the form
        fields and label routing on the receiving side. The modal sends a
        type query parameter that GitHub uses to pre-select the matching
        template. The result is one consistent shape regardless of who
        clicked Bug, Feature request, or General feedback.
      </Callout>

      <h2>Attaching screenshots</h2>
      <p>
        Every feedback type lets you attach screenshots, by dropping them on
        the modal, pasting from the clipboard, or clicking to pick files. The
        images stay in memory and never leave your machine on their own. A
        GitHub new-issue URL is text only, so the images cannot ride along with
        the rest of the report. Instead, when you submit with screenshots
        attached, the modal opens the issue tab and then shows a short last
        step that keeps your thumbnails handy. The clipboard holds one image at
        a time, so you copy each thumbnail and paste it into the GitHub
        description under the Screenshots heading, one at a time.
      </p>

      <h2>The BugStomp scene</h2>
      <p>
        The BugStomp scene (a small BeakerBot moment you might hit after a
        crash recovery) ends with the same feedback flow. Stomping the bug
        opens the FeedbackModal pre-set to Bug type and prefilled with a hint
        from the crash context. It&apos;s the same modal as the manual entry
        point, just with an auto-populated body. If you have reduced motion
        turned on, the animation is skipped and you get a static aftermath
        tableau instead.
      </p>

      <Callout variant="tip" title="Why a pre-filled URL instead of a POST">
        We could have POSTed feedback straight to a webhook or a server we
        run, and the user would not have to see the body before submission.
        We did not, because the moment a POST endpoint exists, every typed
        word is a thing that left your machine before you saw the final
        copy. The pre-filled URL pattern keeps the auditable boundary
        crisp. Nothing leaves until you click Submit on the GitHub page.
        See <Link href="/wiki/security">Security</Link> for the broader
        no-server posture this fits into.
      </Callout>
    </WikiPage>
  );
}
