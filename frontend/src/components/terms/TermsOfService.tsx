"use client";

/**
 * Terms of service page body (rendered at /terms).
 *
 * A plain-English terms of service for ResearchOS. The load-bearing facts are
 * that the software is free and open source under the AGPLv3 (the license
 * governs the code, these terms govern the hosted service and the optional paid
 * services), that the everyday app is local-first so the user's data stays in
 * their own folder, and that the only paid parts are optional cloud storage and
 * the metered AI assistant. Whether those services are currently free during the
 * beta or live and billed is determined by storageBillingOn and aiBillingOn,
 * which are read from server env flags by the page and passed in as props.
 *
 * The science-tool honesty note (verify analytical and AI output before you rely
 * on it) is deliberate and matches the validation-gate posture.
 *
 * This is an informational / legal page, not a documented app feature. Like
 * /privacy and /open-source it renders without the AppShell or a connected data
 * folder so anyone can read it, and it is excluded from the wiki-coverage map.
 *
 * DRAFT pending Grant's (and ideally a lawyer's) review before it ships. The
 * billing terms mirror docs/branding/BILLING_FACTS.md; the privacy split mirrors
 * /privacy. Set the real EFFECTIVE_DATE at publish.
 *
 * Voice rules: warm and concept-first. No em-dashes, no emojis, no mid-sentence
 * colons. Contractions are fine.
 */

import Link from "next/link";

import MarketingFooter from "@/components/MarketingFooter";
import MarketingNav from "@/components/MarketingNav";
import Kicker from "@/components/marketing/Kicker";
import Reveal from "@/components/marketing/Reveal";

const EFFECTIVE_DATE = "June 12, 2026";
const CONTACT_EMAIL = "gnickles@wisc.edu";

/** One titled section of the terms. */
function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-12 scroll-mt-24">
      <Reveal>
        <h2 className="mb-3 text-heading font-semibold text-foreground">{title}</h2>
        <div className="space-y-4 text-body leading-relaxed text-foreground">
          {children}
        </div>
      </Reveal>
    </section>
  );
}

export interface TermsOfServiceProps {
  /** True when BILLING_ENABLED is on and cloud storage is a live paid service. */
  storageBillingOn: boolean;
  /** True when AI_BILLING_ENABLED is on and the AI assistant is a live paid service. */
  aiBillingOn: boolean;
}

export default function TermsOfService({
  storageBillingOn,
  aiBillingOn,
}: TermsOfServiceProps) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-sunken text-foreground">
      <div aria-hidden className="brand-rainbow-bg h-2 w-full" />
      <MarketingNav />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        {/* Intro */}
        <section className="mb-12">
          <div className="mb-4">
            <Kicker>Terms of service</Kicker>
          </div>
          <h1 className="mb-6 text-display font-bold tracking-tight text-foreground sm:text-4xl">
            The deal, in plain language
          </h1>
          <div className="space-y-4 text-title leading-relaxed text-foreground">
            <p>
              These terms cover using the hosted ResearchOS app at
              research-os.app and the optional paid services. We have tried to
              write them the way we write everything else here, plainly, so you
              can actually read them. The software itself is free and open
              source, your everyday work stays on your own computer, and the
              only things that ever cost money are optional.
            </p>
            <p className="rounded-lg border border-brand-action/30 bg-brand-action/[0.06] px-4 py-3 text-body text-foreground">
              Effective {EFFECTIVE_DATE}. ResearchOS is free and open-source
              software written by a researcher at the University of
              Wisconsin-Madison and operated by ResearchOS LLC, a registered
              Wisconsin company. If anything here is unclear, write to{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-semibold text-brand-action underline underline-offset-2"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </div>
        </section>

        <Section id="short-version" title="The short version">
          <ul className="ml-5 list-disc space-y-2">
            <li>
              The app is free and open source under the AGPLv3. You can use it,
              read it, and modify it under that license. These terms are about
              the hosted service we run, not a restriction on the software.
            </li>
            <li>
              Your research data is yours. It lives in a folder on your own
              machine, we do not claim any ownership of it, and you are
              responsible for keeping your own backups.
            </li>
            <li>
              {storageBillingOn || aiBillingOn ? (
                <>
                  The only paid parts are optional cloud storage and the metered
                  AI assistant. Both are optional services billed at cost, with
                  no lock-in, and you can stop at any time.
                </>
              ) : (
                <>
                  The only paid parts are optional cloud storage and the metered
                  AI assistant, and both are free during the beta. You can stop
                  using them at any time, with no lock-in.
                </>
              )}
            </li>
            <li>
              ResearchOS is a tool, not a guarantee. Always check an analysis, a
              calculated value, or anything the AI hands you before you rely on
              it in your work or a publication.
            </li>
            <li>
              The service is provided as-is, especially during the beta. We do
              the work to make it correct and reliable, but we cannot promise it
              is error-free or always available.
            </li>
          </ul>
        </Section>

        <Section id="who" title="Who provides ResearchOS">
          <p>
            ResearchOS is built by a researcher at the University of
            Wisconsin-Madison and operated by ResearchOS LLC, a registered
            Wisconsin company. The hosted version lives at research-os.app, and
            the source code is public on GitHub. You can also run it yourself
            from that source.
          </p>
        </Section>

        <Section
          id="software-vs-service"
          title="The open-source license and these terms"
        >
          <p>
            The ResearchOS software is licensed to everyone under the GNU Affero
            General Public License, version 3 (AGPLv3). That license governs
            your rights to use, study, modify, and redistribute the code, and
            nothing in these terms takes those rights away. You can read the full
            license and the third-party credits on the{" "}
            <Link
              href="/open-source"
              className="font-semibold text-sky-700 dark:text-sky-300 underline-offset-2 hover:underline"
            >
              open source page
            </Link>
            .
          </p>
          <p>
            These terms instead govern the optional service we operate for you,
            the hosted app at research-os.app, the sharing and collaboration
            features, and the paid cloud storage and AI assistant. If anything
            here ever appears to conflict with the AGPLv3 as it applies to the
            software itself, the license controls for the software.
          </p>
        </Section>

        <Section id="your-data" title="Your data and your content">
          <p>
            When you use the everyday app, your notes, experiments, methods,
            images, and other files are written directly to a folder you pick on
            your own computer. You own that content. We do not claim any license
            to it, we do not analyze it, and for the core app there is no copy on
            our servers, because there is no database we control that holds it.
          </p>
          <p>
            Because your data is yours and lives with you, keeping backups is
            your responsibility. We recommend storing your folder somewhere that
            is itself backed up, such as a synced drive. If you turn on optional
            sharing or live collaboration, a narrow set of data is involved on
            our side, and exactly what and why is spelled out in the{" "}
            <Link
              href="/privacy"
              className="font-semibold text-sky-700 dark:text-sky-300 underline-offset-2 hover:underline"
            >
              privacy policy
            </Link>
            .
          </p>
        </Section>

        <Section id="eligibility" title="Who can use ResearchOS">
          <p>
            ResearchOS is a tool for researchers and is meant for people who are
            at least 13 years old. It is not directed to children under 13, and
            we do not knowingly collect their information. If you use ResearchOS
            on behalf of a lab, department, or institution, you confirm that you
            have the authority to agree to these terms for that group.
          </p>
        </Section>

        <Section id="acceptable-use" title="Using the service responsibly">
          <p>
            ResearchOS is a tool for research, and we ask that you use it that
            way. By using the hosted service you agree not to do the following.
          </p>
          <ul className="ml-5 list-disc space-y-2">
            <li>
              Break the law, infringe someone else&apos;s rights, or use the
              service to store or send content you have no right to.
            </li>
            <li>
              Misuse the sharing relay or collaboration features to send
              unwanted, harmful, or abusive content to other people.
            </li>
            <li>
              Attempt to disrupt, overload, reverse the security of, or gain
              unauthorized access to the service or other users&apos; data.
            </li>
            <li>
              Use the service in a way that violates your own institution&apos;s
              rules or any regulatory obligations that apply to your work.
            </li>
          </ul>
          <p>
            You are responsible for the compliance side of your own research.
            ResearchOS is a place to do the work, but decisions about regulated
            data, human-subjects rules, your institution&apos;s data-management
            requirements, and similar obligations remain yours.
          </p>
        </Section>

        <Section id="copyright" title="Copyright and takedowns">
          <p>
            We respect intellectual property. Because the everyday app keeps
            your files on your own machine, most content never touches us. If
            you believe something shared or collaborated through our service
            infringes your copyright, write to{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-semibold text-sky-700 dark:text-sky-300 underline-offset-2 hover:underline"
            >
              {CONTACT_EMAIL}
            </a>{" "}
            with enough detail to identify the work and where it appears, and we
            will remove or disable access to infringing material. We may end the
            accounts of people who repeatedly infringe. If you believe something
            was removed by mistake, you can write back to explain and we will
            take another look.
          </p>
        </Section>

        <Section
          id="paid"
          title={
            storageBillingOn || aiBillingOn
              ? "Optional paid services"
              : "Optional paid services, free during the beta"
          }
        >
          <p>
            The local-first app is free forever. Two optional services can cost
            money.
            {!storageBillingOn && !aiBillingOn && (
              <> Both are free right now during the beta.</>
            )}
            {(storageBillingOn || aiBillingOn) &&
              !storageBillingOn && (
                <> Cloud storage is not yet billing. The AI assistant is a live
                paid service.</>
              )}
            {(storageBillingOn || aiBillingOn) &&
              !aiBillingOn && (
                <> Cloud storage is a live paid service. The AI assistant is not
                yet billing.</>
              )}
          </p>
          <ul className="ml-5 list-disc space-y-2">
            <li>
              <strong>Cloud storage.</strong> If you choose to sync or share a
              copy of your work in the cloud, that storage is the paid part.
              Individuals and labs pay what the storage actually costs us, and
              larger departments and institutions pay a modest sustaining rate
              above cost that keeps the free tiers free. There is a real free
              tier, not a trial.
              {!storageBillingOn && (
                <> Cloud storage is free during the beta.</>
              )}
              {storageBillingOn && (
                <> Pricing is shown on the{" "}
                <Link
                  href="/pricing"
                  className="font-semibold text-sky-700 dark:text-sky-300 underline-offset-2 hover:underline"
                >
                  pricing page
                </Link>
                . Sales tax, where applicable, is computed and collected
                automatically by our payment processor, Stripe.</>
              )}
            </li>
            <li>
              <strong>The AI assistant.</strong> BeakerBot is metered because
              each task calls a hosted model that costs real money. Every account
              starts with a free batch of tokens, and after that you buy prepaid
              top-ups priced near our actual cost. You always see your balance
              and what the last task cost.
              {!aiBillingOn && (
                <> The AI assistant is free during the beta.</>
              )}
              {aiBillingOn && (
                <> Sales tax, where applicable, is computed and collected
                automatically by Stripe.</>
              )}
            </li>
          </ul>
          <p>
            You can cancel, downgrade, or stop buying at any time, with no
            annual contract and no lock-in. Because consumed AI tokens and used
            storage reflect costs we have already paid to provide them, they are
            generally not refundable, but stopping is always immediate and you
            are never billed for a period you did not use.
            {!(storageBillingOn || aiBillingOn) && (
              <> Final prices for the paid plans are still being set from real
              usage data, and we will show them clearly before any charge ever
              applies.</>
            )}{" "}
            For the full pricing picture, see the{" "}
            <Link
              href="/pricing"
              className="font-semibold text-sky-700 dark:text-sky-300 underline-offset-2 hover:underline"
            >
              pricing page
            </Link>
            .
          </p>
          <p>
            We also run a hard monthly budget cap on our side. If cloud spending
            ever approaches it, cloud writes pause while your local-first app
            keeps working, so a runaway bill cannot be run up and handed to you.
          </p>
        </Section>

        <Section id="beta" title="Beta status and availability">
          <p>
            ResearchOS is under active development. Features can change, be
            added, or be removed, and during the beta especially you should
            expect rough edges and occasional downtime. We do not currently
            offer a uptime guarantee or service-level commitment. We will give
            reasonable notice of a significant change where we can, and because
            the app is local-first, your data stays with you even when the
            hosted service is unavailable.
          </p>
        </Section>

        <Section id="warranty" title="No warranty, and verify your science">
          <p>
            The software and the service are provided as-is and as-available,
            without warranties of any kind, whether express or implied,
            including any implied warranties of merchantability, fitness for a
            particular purpose, or non-infringement. This mirrors the
            no-warranty terms of the AGPLv3 (sections 15 and 16) for the software
            itself, and it applies to the hosted service too.
          </p>
          <p>
            This matters most for the science. We validate our analytical
            engines against established references and we work hard to get the
            numbers right, but you are responsible for checking any statistical
            result, calculated value, sequence operation, or anything the AI
            assistant produces before you rely on it in your research or a
            publication. The AI can make mistakes, so treat its output as a
            draft to review, not a final answer. ResearchOS does not provide
            professional, medical, or legal advice, and nothing it produces is a
            substitute for your own professional judgment or your
            institution&apos;s review.
          </p>
        </Section>

        <Section id="liability" title="Limitation of liability">
          <p>
            To the fullest extent permitted by law, ResearchOS LLC and the
            project&apos;s contributors will not be liable for any indirect,
            incidental, special, or consequential damages, or for any loss of
            data, loss of research, or lost profits, arising out of or related to
            your use of the software or the service. Because your data lives in
            your own folder and backups are your responsibility, please keep your
            own copies.
          </p>
          <p>
            Where liability cannot be excluded by law, the total liability of
            ResearchOS LLC for any claim arising out of or related to the
            software or the service is limited to the greater of (a) the amount
            you paid us in the twelve months before the claim, or (b) one
            hundred US dollars.
          </p>
          <p>
            Some jurisdictions do not allow the exclusion of certain warranties
            or the limitation of certain damages, so some of the above may not
            apply to you. In those places our warranties and our liability are
            limited to the fullest extent permitted by law, and nothing in these
            terms takes away a consumer right you have that cannot be waived.
          </p>
        </Section>

        <Section id="termination" title="Stopping and termination">
          <p>
            You can stop using ResearchOS at any time. For the everyday app you
            simply disconnect the folder or quit, and your data stays on your
            disk untouched. You can cancel any paid service whenever you like.
          </p>
          <p>
            We may suspend or end access to the hosted service for an account
            that abuses it, breaks these terms, or puts other users or the
            service at risk. If we ever discontinue the hosted service, your
            local data is unaffected, because it was never dependent on us to
            begin with.
          </p>
        </Section>

        <Section id="changes" title="Changes to these terms">
          <p>
            If these terms change in a meaningful way, we will update the
            effective date at the top and, where appropriate, note the change in
            the app. Because ResearchOS is open source, the full history of this
            page is visible in the public repository. If you keep using the
            service after a change takes effect, that means you accept the
            updated terms.
          </p>
        </Section>

        <Section id="feedback" title="Feedback">
          <p>
            If you send us feedback, ideas, or bug reports about ResearchOS, we
            may use them to improve the product without any obligation to you and
            without owing you anything for them. You never have to send feedback,
            and doing so does not hand us any rights to your own research, only
            permission to act on the suggestion.
          </p>
        </Section>

        <Section id="general" title="The general legal bits">
          <p>
            These terms, together with the{" "}
            <Link
              href="/privacy"
              className="font-semibold text-sky-700 dark:text-sky-300 underline-offset-2 hover:underline"
            >
              privacy policy
            </Link>{" "}
            and the AGPLv3 license where it governs the software, are the whole
            agreement between you and ResearchOS LLC about the hosted service,
            and they replace any earlier understanding on the subject. If any
            part of these terms is found unenforceable, the rest stays in effect
            and the unenforceable part is narrowed only as far as the law
            requires.
          </p>
          <p>
            If we do not enforce a part of these terms right away, that is not a
            waiver of our right to do so later. You may not transfer your rights
            under these terms without our consent. We may transfer ours to a
            successor, for example if the project or company changes hands, in a
            way that does not reduce your rights. We are also not responsible for
            a failure or delay caused by something outside our reasonable
            control, such as a network outage, an upstream provider, or another
            event we cannot prevent.
          </p>
        </Section>

        <Section id="law" title="Governing law">
          <p>
            These terms are governed by the laws of the State of Wisconsin,
            without regard to its conflict-of-laws rules, and any dispute that
            cannot be resolved informally will be handled by the state or federal
            courts located in Wisconsin. We would much rather sort out any
            problem directly, so please reach out first and we will do our best
            to make it right.
          </p>
        </Section>

        <Section id="contact" title="Contact">
          <p>
            Questions about these terms, the paid services, or anything else
            covered here can go to{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-semibold text-sky-700 dark:text-sky-300 underline-offset-2 hover:underline"
            >
              {CONTACT_EMAIL}
            </a>
            . ResearchOS is operated by ResearchOS LLC, a registered Wisconsin
            company.
          </p>
        </Section>
      </main>

      <MarketingFooter />
    </div>
  );
}
