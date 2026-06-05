import Callout from "@/components/wiki/Callout";
import WikiPage from "@/components/wiki/WikiPage";

export default function OpenSourcePage() {
  return (
    <WikiPage
      intro="Closed software asks you to trust a promise. Open software lets you trust the source. ResearchOS is licensed under AGPLv3, which means a lab can read the whole codebase, fork it, and run its own copy."
    >
      <h2>What AGPLv3 gives a lab</h2>
      <p>
        ResearchOS is released under the GNU Affero General Public License,
        version 3 (AGPLv3). In plain terms, that license gives every lab three
        durable rights.
      </p>
      <ul>
        <li>
          <strong>Read it.</strong> The entire codebase is public. Nothing
          about how ResearchOS stores your data, computes a melting
          temperature, or talks to the network is hidden behind a binary.
        </li>
        <li>
          <strong>Fork it.</strong> You can take the code, change it, and build
          the version your lab needs. You are not waiting on a vendor's
          roadmap.
        </li>
        <li>
          <strong>Self-host it.</strong> You can run your own copy on your own
          infrastructure. If the hosted version ever disappeared, the project
          could not be taken away from the labs already running it.
        </li>
      </ul>
      <p>
        The copyleft nature of AGPLv3 also means those rights travel forward.
        Anyone who distributes a modified version, including over a network,
        has to offer the same freedoms to their users. The openness is not a
        one-time gift, it is a property the license keeps enforcing.
      </p>

      <Callout variant="info" title="Why AGPL specifically">
        A weaker license would let someone take ResearchOS, lock it behind a
        paywall, and never share their changes back. AGPLv3 is the version that
        closes the network-service loophole, so a lab-grade tool stays open
        even when it is offered as a service.
      </Callout>

      <h2>Crediting the work we build on</h2>
      <p>
        ResearchOS does not exist in a vacuum. It is built on top of a large
        body of open-source software and published science, and the project
        takes the obligation to credit that work seriously, both as a matter of
        courtesy and as a matter of license.
      </p>
      <p>
        The public{" "}
        <a href="/open-source" target="_blank" rel="noopener noreferrer">
          Built on open source
        </a>{" "}
        page opens with a sincere thank-you to the open-source and scientific
        community, then credits the specific projects ResearchOS depends on. It
        groups the highlights by area, calls out the code vendored directly
        (such as SeqViz, the TeselaGen tg-oss components, and the Biopython
        melting-temperature port), names the scientific references behind the
        calculators, and includes the full auto-generated dependency list. The
        page lives in{" "}
        <code>frontend/src/components/open-source/</code> and pulls its facts
        from a file generated off the installed dependency tree, so the
        versions and licenses are never hand-guessed.
      </p>

      <h2>The attribution we owe</h2>
      <p>
        Many open-source licenses require attribution as a condition of use.
        MIT and BSD code must carry its copyright notice, and Apache-2.0 code
        requires a NOTICE. ResearchOS satisfies those requirements in the{" "}
        <code>THIRD_PARTY_NOTICES</code> file at the repository root, which
        lists every third-party package it ships and the license each is
        distributed under. That file is generated from the dependency tree by a
        committed script, not maintained by hand, so it stays honest as
        dependencies change.
      </p>

      <Callout variant="tip" title="Read it yourself">
        The{" "}
        <a href="/open-source" target="_blank" rel="noopener noreferrer">
          Built on open source
        </a>{" "}
        page is public and needs no account. It is the warm, human-readable
        companion to the machine-generated notices file in the repo.
      </Callout>
    </WikiPage>
  );
}
