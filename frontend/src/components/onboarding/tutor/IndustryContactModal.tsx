"use client";

// Industry contact modal (onboarding interest picker).
//
// There is no dedicated industry edition of ResearchOS yet, so the "Industry"
// role chip must not drop a company into a research-lab onboarding that does not
// fit them. Instead it opens this reach-out form. We are open to building an
// industry edition when a company wants one, so this is a real funnel for those
// conversations, not a dead end.
//
// No backend: the form builds a pre-filled mailto, the same "form and email"
// pattern as /departments/contact. The address is the working gnickles@wisc.edu,
// NOT a research-os.app address, because research-os.app inbound is on a
// new-domain hold until late August and a lead sent there would be dropped.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Sentence case.

import { useState } from "react";

const CONTACT_EMAIL = "gnickles@wisc.edu";

const INPUT =
  "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:border-brand-action focus:outline-none";

export default function IndustryContactModal({
  onClose,
}: {
  /** Dismiss the modal and return to the role picker (no role selected). */
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const mailto = () => {
    const subject = encodeURIComponent("ResearchOS for industry, inquiry");
    const body = encodeURIComponent(
      [
        `Name: ${name}`,
        `Company: ${company}`,
        `Email: ${email}`,
        "",
        message,
      ].join("\n"),
    );
    return `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="industry-contact-title"
        className="ros-popup-card w-full max-w-md rounded-2xl bg-surface-raised p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="industry-contact-title"
          className="text-title font-bold text-foreground"
        >
          ResearchOS for your company
        </h2>
        <p className="mt-2 text-body leading-relaxed text-foreground-muted">
          We do not have a dedicated industry edition yet, but we would love to
          talk if your company wants one. Tell us a little and we will follow up.
          You can also email{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-semibold text-brand-action underline-offset-2 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>{" "}
          directly.
        </p>

        <div className="mt-5 space-y-3">
          <label className="block">
            <span className="text-meta font-semibold text-foreground">
              Your name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={INPUT}
              placeholder="Dr. Jordan Lee"
            />
          </label>
          <label className="block">
            <span className="text-meta font-semibold text-foreground">
              Company
            </span>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className={INPUT}
              placeholder="Acme Biosciences"
            />
          </label>
          <label className="block">
            <span className="text-meta font-semibold text-foreground">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={INPUT}
              placeholder="you@company.com"
              autoComplete="email"
            />
          </label>
          <label className="block">
            <span className="text-meta font-semibold text-foreground">
              What are you looking for (optional)
            </span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className={`${INPUT} min-h-[88px]`}
              placeholder="Team size, what you want to manage, timeline, or questions."
            />
          </label>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <a
            href={mailto()}
            className="ros-btn-raise inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-brand-action px-4 py-2.5 text-body font-semibold text-white"
          >
            Send your inquiry
          </a>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-meta text-foreground-muted hover:text-foreground"
          >
            Maybe later
          </button>
        </div>
        <p className="mt-2 text-meta leading-relaxed text-foreground-muted">
          This opens your email app with the details filled in, so you can review
          before sending.
        </p>
      </div>
    </div>
  );
}
