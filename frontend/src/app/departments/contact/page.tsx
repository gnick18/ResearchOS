"use client";

/**
 * Department reach-out form (/departments/contact). Department pricing is
 * contact/TBD (Grant 2026-06-19), so this collects who is asking, their
 * institution, and roughly how many labs, then opens a pre-filled email so the
 * person can review and send. No backend: the form builds a mailto, which is the
 * "form and email" combined. The address is the working gnickles@wisc.edu, NOT a
 * research-os.app address, because research-os.app inbound is on a new-domain
 * hold until late August.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons. Sentence case.
 */

import { useState } from "react";

import MarketingFooter from "@/components/MarketingFooter";
import MarketingNav from "@/components/MarketingNav";
import Kicker from "@/components/marketing/Kicker";

const CONTACT_EMAIL = "gnickles@wisc.edu";

const INPUT =
  "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground focus:border-brand-action focus:outline-none";

export default function DepartmentContactPage() {
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [labs, setLabs] = useState("");
  const [message, setMessage] = useState("");

  const mailto = () => {
    const subject = encodeURIComponent("Department pricing inquiry");
    const body = encodeURIComponent(
      [
        `Name: ${name}`,
        `Institution: ${institution}`,
        `Approximate number of labs: ${labs}`,
        "",
        message,
      ].join("\n"),
    );
    return `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  };

  return (
    <div className="flex min-h-screen flex-col bg-surface-sunken">
      <div aria-hidden className="brand-rainbow-bg h-2 w-full" />
      <MarketingNav />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
        <Kicker>Departments</Kicker>
        <h1 className="mt-3 text-display font-bold tracking-tight text-foreground sm:text-4xl">
          Let us scope a department plan with you
        </h1>
        <p className="mt-4 text-title leading-relaxed text-foreground-muted">
          Department pricing depends on how many labs come aboard and the
          governance you need, so we set it together rather than off a list. Tell
          us a little and we will follow up. You can also email{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-semibold text-brand-action underline-offset-2 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>{" "}
          directly.
        </p>

        <div className="mt-8 space-y-4 rounded-2xl border border-border bg-surface-raised p-6 shadow-sm">
          <label className="block">
            <span className="text-meta font-semibold text-foreground">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={INPUT}
              placeholder="Dr. Jordan Lee"
            />
          </label>
          <label className="block">
            <span className="text-meta font-semibold text-foreground">Institution or department</span>
            <input
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              className={INPUT}
              placeholder="Department of Biochemistry, State University"
            />
          </label>
          <label className="block">
            <span className="text-meta font-semibold text-foreground">Approximate number of labs</span>
            <input
              value={labs}
              onChange={(e) => setLabs(e.target.value)}
              className={INPUT}
              inputMode="numeric"
              placeholder="8"
            />
          </label>
          <label className="block">
            <span className="text-meta font-semibold text-foreground">Anything else (optional)</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className={`${INPUT} min-h-[96px]`}
              placeholder="Timeline, compliance needs, or questions."
            />
          </label>
          <a
            href={mailto()}
            className="btn-brand inline-flex min-h-[44px] items-center gap-2 px-6 py-3 text-body"
          >
            Send your inquiry
          </a>
          <p className="text-meta leading-relaxed text-foreground-muted">
            This opens your email app with the details filled in, so you can review
            before sending.
          </p>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
