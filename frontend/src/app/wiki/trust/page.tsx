import Callout from "@/components/wiki/Callout";
import WikiPage from "@/components/wiki/WikiPage";

export default function TrustPage() {
  return (
    <WikiPage
      intro="Trust is not a feeling you can market your way into. It is a set of claims a lab can check. This section lays out the four claims ResearchOS makes about itself and points you at the public, verifiable evidence behind each one."
    >
      <h2>Why this section exists</h2>
      <p>
        Picking an electronic lab notebook means handing it years of
        irreplaceable work. That is a big ask, and the honest answer to
        &ldquo;why should I trust this&rdquo; should never be &ldquo;because
        we said so.&rdquo; ResearchOS is built so that the important promises
        are things you can confirm yourself, either by reading the code, by
        opening a public page in your browser, or by watching the app behave
        in DevTools.
      </p>
      <p>
        There are four pillars. Each one has its own page below, and most of
        them link out to a live, public page that anyone can open without an
        account.
      </p>

      <h2>The four pillars</h2>

      <h3>1. Your data never leaves your machine</h3>
      <p>
        ResearchOS reads and writes a folder you pick on your own computer.
        There is no database we control, so there is nothing for us to lose,
        sell, or get breached.{" "}
        <a href="/wiki/trust/how-your-data-and-privacy-work">
          How your data and privacy work
        </a>{" "}
        walks through it with a clickable explainer, including the three ways
        work can be shared and why all of this keeps the tool cheap. The{" "}
        <a href="/wiki/security">Security</a> section is the audit-grade
        version, including the narrow exceptions and how to verify it in your
        browser.
      </p>

      <h3>2. The science is validated against tools labs already trust</h3>
      <p>
        Every sequence and lab calculation ResearchOS performs is checked,
        on every commit, against the peer-reviewed reference tools the field
        already relies on (Biopython, primer3, pydna). The numbers cannot
        silently drift, because a drift fails the build.{" "}
        <a href="/wiki/trust/method-validation">Method validation</a>{" "}
        explains how, and links to the public agreement page.
      </p>

      <h3>3. The code is open</h3>
      <p>
        ResearchOS is licensed under AGPLv3, which means a lab can read the
        whole thing, fork it, and self-host it. The project also credits and
        thanks the open-source work it builds on.{" "}
        <a href="/wiki/trust/open-source">Open source and license</a> covers
        what the license gives you and where the credits live.
      </p>

      <h3>4. The incentives are clean</h3>
      <p>
        ResearchOS is open source and local-first, not venture-backed. The
        local app is free with every feature included. Cloud services are
        pay-for-what-you-use, a small base fee plus your usage at a fair markup,
        with storage at roughly cost, so the tool stays reachable for
        low-resource labs.{" "}
        <a href="/wiki/trust/how-we-fund-it">How it stays free</a> explains
        the model honestly.
      </p>

      <Callout variant="tip" title="The short version">
        Your data stays with you, the math is checked against the references
        your field trusts, the code is open for anyone to read or run, and
        the money behind the project does not depend on locking you in.
      </Callout>
    </WikiPage>
  );
}
