import MadeInMadison from "@/components/MadeInMadison";
import Callout from "@/components/wiki/Callout";
import WikiPage from "@/components/wiki/WikiPage";

export default function HowWeFundItPage() {
  return (
    <WikiPage
      intro="Who pays for a tool shapes who it serves. ResearchOS is grant-funded, not venture-backed, and that single fact is why it can stay free and open for labs that could never afford a per-seat subscription."
    >
      <h2>Where the money comes from</h2>
      <p>
        ResearchOS is funded by a UW-Madison RISE fellowship. It is not backed
        by venture capital, it is not chasing an acquisition, and it does not
        answer to investors who need the user base monetized. The work is paid
        for as research infrastructure, which is a fundamentally different
        incentive than software built to maximize revenue per user.
      </p>

      <h2>What that means for your lab</h2>
      <p>
        Because the funding does not depend on extracting payment from the
        people using the tool, ResearchOS does not have the usual levers a
        commercial ELN reaches for.
      </p>
      <ul>
        <li>
          <strong>No paywalled features.</strong> Every feature is free. The
          only thing that can cost money is optional cloud storage for a lab
          that uses a lot of it, priced to cover what it costs us to run, and
          only if the lab chooses a larger plan.
        </li>
        <li>
          <strong>No per-seat fees.</strong> Adding a student or a
          collaborator does not raise a bill, so the cost of the tool does not
          grow with the size of your lab.
        </li>
        <li>
          <strong>Open by license.</strong> ResearchOS is AGPLv3, so even if
          you never pay anything, you keep the right to read, fork, and
          self-host the code. The copyright is held by the author, Grant R.
          Nickles.
        </li>
      </ul>

      <h2>Why this keeps it reachable for low-resource labs</h2>
      <p>
        A per-seat ELN subscription is a real barrier. For a small lab, a
        teaching lab, a lab at an under-resourced institution, or a researcher
        in a setting where the field&apos;s standard tools are out of budget,
        the price is often the reason good data management never happens.
        Grant funding removes that barrier at the point of use. The lab that
        most needs a free tool is the lab least able to argue for a software
        line item, and ResearchOS is built so those labs are not left out.
      </p>

      <Callout variant="info" title="Honest framing">
        ResearchOS is free and open, grant-funded today, with donations welcome
        to help sustain it over time. The grant covers the near term, and
        voluntary support can extend the runway without ever turning the tool
        into a product that charges low-resource labs to use it.
      </Callout>

      {/* Wisconsin LLC badge: soft tone on this formal trust page, no California
          jab, just the plain accountable-business statement. */}
      <div className="my-4 flex justify-center">
        <MadeInMadison variant="badge" tone="soft" />
      </div>

      <h2>What we are careful not to promise</h2>
      <p>
        It would be easy, and dishonest, to promise the project will never cost
        anything under any circumstances. No one can guarantee the funding
        landscape years out. What ResearchOS can say plainly is the commitment
        behind the design. The project is built to stay free and open for the
        labs that depend on that, the license guarantees the code can never be
        taken back, and the goal of every funding decision is to keep the tool
        reachable rather than to extract from the people using it.
      </p>
    </WikiPage>
  );
}
