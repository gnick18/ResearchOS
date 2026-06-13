"use client";

/**
 * Privacy policy page body (rendered at /privacy).
 *
 * A plain-English privacy policy for ResearchOS. The load-bearing fact is that
 * the core app is local-first and stores nothing about the user on our servers,
 * so most of this page explains the one place that changes, the optional
 * cross-boundary sharing system, which stores a salted hash of a verified
 * email, public keys, and an opt-in searchable profile, plus an end-to-end
 * encrypted relay we cannot read. It also covers the third-party logins
 * (Google, GitHub, Microsoft, LinkedIn), the email we send via Resend, and the
 * privacy-respecting analytics.
 *
 * This is an informational / legal page, not a documented app feature. Like
 * /open-source and /transparency it renders without the AppShell or a connected
 * data folder so anyone (including an OAuth provider's reviewer) can read it,
 * and it is excluded from the wiki-coverage map.
 *
 * Voice rules: warm and concept-first. No em-dashes, no emojis, no mid-sentence
 * colons. Every icon would be an inline SVG. The substance mirrors section 12
 * of docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md and the /wiki/security
 * posture.
 */

import Link from "next/link";

import MarketingFooter from "@/components/MarketingFooter";
import MarketingNav from "@/components/MarketingNav";
import Kicker from "@/components/marketing/Kicker";

const EFFECTIVE_DATE = "June 4, 2026";
const CONTACT_EMAIL = "gnickles@wisc.edu";

/** One titled section of the policy. */
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
      <h2 className="mb-3 text-heading font-semibold text-foreground">{title}</h2>
      <div className="space-y-4 text-body leading-relaxed text-foreground">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPolicy() {
  return (
    <div className="flex min-h-screen flex-col bg-surface-sunken text-foreground">
      <div aria-hidden className="brand-rainbow-bg h-2 w-full" />
      <MarketingNav />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        {/* Intro */}
        <section className="mb-12">
          <div className="mb-4">
            <Kicker>Privacy policy</Kicker>
          </div>
          <h1 className="mb-6 text-display font-bold tracking-tight text-foreground sm:text-4xl">
            Your research stays yours
          </h1>
          <div className="space-y-4 text-title leading-relaxed text-foreground">
            <p>
              ResearchOS is built so that your work lives on your own computer,
              not on ours. For the everyday app there is no account, no upload,
              and nothing about you stored on a server we control. This page
              explains that in plain language, and it is honest about the one
              place it changes, the optional feature that lets you share with
              researchers outside your folder.
            </p>
            <p className="rounded-lg border border-brand-action/30 bg-brand-action/[0.06] px-4 py-3 text-body text-foreground">
              Effective {EFFECTIVE_DATE}. ResearchOS is free and open-source
              software written by a researcher at the University of
              Wisconsin-Madison. If anything here is unclear, write to{" "}
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
              The core app keeps all of your research data in a folder you pick
              on your own machine. We never see it, because there is no database
              we control that holds it.
            </li>
            <li>
              We store something about you only if you turn on sharing with
              people outside your folder, and even then it is a salted hash of
              your email and your public keys, never your research content.
            </li>
            <li>
              When you send work to someone outside your folder, it travels
              end-to-end encrypted through a relay that cannot read it and deletes
              it on a short timer. Live real-time collaboration works differently,
              it keeps a synced copy of the shared document on our servers so edits
              appear instantly, and that copy is not end-to-end encrypted.
            </li>
            <li>
              We do not sell your data, we do not run advertising, and we never
              post anything on your behalf to any service you connect.
            </li>
          </ul>
        </Section>

        <Section id="local-first" title="What the everyday app collects, nothing">
          <p>
            When you open ResearchOS you pick a folder on your computer, and the
            app reads and writes your notes, experiments, methods, images, and
            attachments directly to that folder. Those bytes never leave your
            machine. You can open the folder in Finder or Explorer at any time
            and see every file sitting there. Quit the app and your data stays
            exactly where it is.
          </p>
          <p>
            Because of this design there is no sign-up, no profile, and no
            server-side copy of your work for the core experience. The narrow
            exceptions below exist only for specific features you choose to use.
            For the full technical account, see the{" "}
            <Link
              href="/wiki/security"
              className="font-semibold text-sky-700 dark:text-sky-300 underline-offset-2 hover:underline"
            >
              security page
            </Link>
            .
          </p>
        </Section>

        <Section
          id="sharing"
          title="When you share outside your folder, the only time we store an identity"
        >
          <p>
            Sharing with a researcher who is not in your folder needs a way to
            find them and to encrypt to them. To make that possible, and only
            when you set it up, we store a small directory record about you.
          </p>
          <p>It holds the following, and nothing else.</p>
          <ul className="ml-5 list-disc space-y-2">
            <li>
              <strong>A salted hash of your email.</strong> We never store your
              email address in readable form in the directory. We store
              <code className="mx-1 rounded bg-surface-sunken px-1.5 py-0.5 text-meta">
                HMAC(secret, your-email)
              </code>
              , a one-way fingerprint that lets someone who already knows your
              email reach you, but cannot be reversed into a list of addresses
              or used to enumerate who has an account.
            </li>
            <li>
              <strong>Your public keys.</strong> These are the public halves of
              an encryption keypair generated on your device. They let others
              encrypt to you. The private halves never leave your machine, and
              your encrypted key backup is stored as a blob we cannot read.
            </li>
            <li>
              <strong>Optional profile information, only if you opt in.</strong>{" "}
              If you choose to publish a searchable profile, it holds the name
              and affiliation you enter so other ResearchOS users can find you
              by institution. This is off by default, it never includes your
              email, and you can delete it at any time. You decide what to put
              there.
            </li>
          </ul>
          <p>
            We treat even the hashed email as personal data, consistent with
            current regulatory guidance, and handle it accordingly.
          </p>
        </Section>

        <Section
          id="oauth"
          title="Signing in with Google, GitHub, Microsoft, or LinkedIn"
        >
          <p>
            To set up sharing you prove you control an email address. You can do
            that with a one-time code we email you, or by signing in with
            Google, GitHub, Microsoft, or LinkedIn. When you use one of those
            providers, we receive your verified email address and your name from
            them, and we use them for two things only.
          </p>
          <ul className="ml-5 list-disc space-y-2">
            <li>
              The verified email is turned into the salted hash described above,
              so the address itself is not retained in the directory.
            </li>
            <li>
              Your name is used only if you choose to publish a profile. If you
              do not, it is not stored.
            </li>
          </ul>
          <p>
            We request the minimum scope needed to read your email and basic
            profile. We do not request permission to post, read your contacts,
            or access anything else, and we never take any action on those
            accounts on your behalf. Your session is kept in a signed cookie on
            your device, not in a server-side session table.
          </p>
        </Section>

        <Section id="relay" title="The encrypted relay for one-time sends">
          <p>
            When you send a note, method, experiment, project, or sequence to
            someone outside your folder, ResearchOS encrypts it on your device
            before it ever leaves, then hands the encrypted bundle to a relay
            that simply holds it until the recipient picks it up. The relay
            stores only ciphertext. It has no keys, sees no filenames, and
            cannot read any of the contents.
          </p>
          <p>
            Bundles auto-expire on a short timer (about 30 days) and are deleted
            when the recipient retrieves them, whichever comes first. The only
            metadata recorded is what is needed to route and expire a pending
            delivery. There is an abuse-report path so a recipient can flag
            unwanted content, and because the relay holds only encrypted bytes,
            we act on the account rather than the content we cannot see.
          </p>
          <p>
            <strong>Live real-time collaboration is the one exception.</strong>{" "}
            When you co-edit a note or a shared notebook with someone live, the app
            keeps a synced copy of that document on our servers so every change
            reaches the other person right away. That copy is held in readable
            form, not end-to-end encrypted, so unlike a one-time send, our servers
            can read what you collaborate on there. Anything you do not put into a
            live shared document stays on your machine and is never uploaded.
          </p>
        </Section>

        <Section id="email" title="Email we send">
          <p>
            We send transactional email only, the one-time sign-in code and, if
            someone shares with you by email, the notification with a link to
            retrieve your encrypted bundle. These are delivered through Resend,
            our email provider, and we do not send marketing email or add you to
            any list.
          </p>
        </Section>

        <Section id="analytics" title="Analytics">
          <p>
            The hosted app uses Vercel Web Analytics and Speed Insights to
            understand page performance and rough traffic. These are
            privacy-respecting and do not use cross-site tracking cookies or
            build advertising profiles. They never have access to your research
            data, which the app never sends anywhere. If you run ResearchOS
            locally from source, even this is absent.
          </p>
        </Section>

        <Section id="retention-deletion" title="Keeping and deleting your data">
          <p>
            Your research data lives in your folder, so you delete it the way
            you delete any file, and you can revoke the app&apos;s access to the
            folder in your browser at any time. For the sharing directory, you
            can remove your published profile yourself, and you can ask us to
            delete your directory record and any pending relay bundles by
            writing to{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-semibold text-sky-700 dark:text-sky-300 underline-offset-2 hover:underline"
            >
              {CONTACT_EMAIL}
            </a>
            . Encrypted relay bundles expire on their own regardless.
          </p>
        </Section>

        <Section id="your-rights" title="Your rights">
          <p>
            You can request access to, correction of, or deletion of the limited
            directory data described above. Because the core app stores nothing
            about you on our servers, most of your data is already entirely in
            your own hands. The lawful basis for processing the sharing-directory
            data is performing the sharing feature you asked for, together with
            your consent, and we minimize what we hold to the salted email hash,
            public keys, and whatever profile fields you choose to publish.
          </p>
        </Section>

        <Section id="children" title="Children">
          <p>
            ResearchOS is a tool for researchers and is not directed to children
            under 13, and we do not knowingly collect personal information from
            them.
          </p>
        </Section>

        <Section id="changes" title="Changes to this policy">
          <p>
            If this policy changes in a meaningful way, we will update the
            effective date at the top and, where appropriate, note the change in
            the app. Because ResearchOS is open source, the full history of this
            page is visible in the public repository.
          </p>
        </Section>

        <Section id="contact" title="Contact">
          <p>
            Questions about privacy, a deletion request, or anything else covered
            here can go to{" "}
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
