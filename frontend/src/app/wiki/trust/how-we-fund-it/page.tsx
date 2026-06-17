import MadeInMadison from "@/components/MadeInMadison";
import Callout from "@/components/wiki/Callout";
import WikiPage from "@/components/wiki/WikiPage";

export default function HowWeFundItPage() {
  return (
    <WikiPage
      intro="Who pays for a tool shapes who it serves. The local app is open source, local-first, and free forever. The cloud services are a pay-for-what-you-use business, a small base fee plus your actual usage, so the tool stays reachable without a per-seat subscription."
    >
      <h2>Why it costs so little to run</h2>
      <p>
        ResearchOS is local-first. Your notebook lives in a folder on your own
        disk, not on our servers, so there is almost nothing to host and almost
        nothing to pay for in the first place. The code is open source under
        AGPLv3, maintained by its author rather than a company that needs the
        user base monetized. It is not backed by venture capital, it is not
        chasing an acquisition, and it does not answer to investors who need
        payment extracted per user. That is a fundamentally different incentive
        than software built to maximize revenue per seat.
      </p>
      <p>
        ResearchOS grew out of work begun during a UW-Madison Distinguished
        Research Fellowship. The fellowship is where the project started; it does
        not fund the tool today.
      </p>

      <h2>What that means for your lab</h2>
      <p>
        Because keeping the tool running does not depend on extracting payment
        from the people using it, ResearchOS does not have the usual levers a
        commercial ELN reaches for.
      </p>
      <ul>
        <li>
          <strong>No paywalled local features.</strong> The whole local app is
          free. The cloud services are pay-for-what-you-use, a small base fee
          plus your actual usage at a fair markup, with storage at roughly cost.
        </li>
        <li>
          <strong>No fixed per-seat license.</strong> You pay a flat lab base
          fee plus the usage your lab actually generates, instead of a fixed
          price per head whether or not they use the cloud.
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
        Building the tool to be local-first and open removes that barrier at the
        point of use. The lab that most needs a free tool is the lab least able
        to argue for a software line item, and ResearchOS is built so those labs
        are not left out.
      </p>

      <Callout variant="info" title="Honest framing">
        The local app is free and open source. The cloud services are a real
        pay-for-what-you-use business that funds development, and there is always
        a free network tier and a free self-host path so no lab is locked out.
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
        behind the design. The local app and a free network tier stay free and
        open, the license guarantees the code can never be taken back, and the
        paid cloud services fund the work rather than locking anyone in.
      </p>
    </WikiPage>
  );
}
