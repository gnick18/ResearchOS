/**
 * Pricing FAQ for /pricing. The saas-landing-pages pricing framework calls for
 * an FAQ that answers the billing and switching objections, and those are also
 * where the positioning converts hardest (ownership, no lock-in, the
 * guardrails). Static native <details> accordions, so this stays a server
 * component with no client JS. Answers ladder up to POSITIONING.md and
 * MESSAGING.md (the Ownership and Trust pillars).
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import { Section, SectionHeading } from "./Section";

interface PricingFaqProps {
  billingEnabled: boolean;
}

const FAQ_STATIC: { q: string; a: string }[] = [
  {
    q: "Is the app really free?",
    a: "Yes. The local app and every feature are free, with no per-seat fee. The only paid part is optional cloud storage above a generous free pool, which most people never need to pass.",
  },
  {
    q: "What happens to my data if I stop paying or leave?",
    a: "Nothing happens to it. Your research lives in a folder on your own computer, so leaving is just closing a folder. If cloud sync ever pauses, the local app keeps working against your disk and nothing is deleted.",
  },
  {
    q: "Will I get a surprise bill?",
    a: "No. Plans are a flat monthly price, not a per-gigabyte meter, so the bill is a known number. If usage approaches a plan's limit, sync slows or pauses before any overage, and a hard cost cap stops runaway spend.",
  },
  {
    q: "Who pays in a lab?",
    a: "Only the principal investigator. The free tier and any paid plan are one shared pool for the whole lab, on one invoice. Members never see a bill and never enter a card.",
  },
  {
    q: "How do departments and institutions pay?",
    a: "An automated recurring invoice to your procurement office on net terms, with a PO number, paid by bank transfer or card. A smaller department or a PI fronting the cost can instead put a card or bank account on file and have it charged each cycle. The amount is adjustable any month with no lock-in, and institutions outside the US can pay too.",
  },
  {
    q: "Is it cheaper to pay by bank transfer?",
    a: "Yes, a little, everywhere on the site. A bank transfer (ACH) costs us far less to process than a card, so we pass that saving back as a lower price rather than charging a card fee on top. It is a discount for the cheaper method, the same way a cash discount works, and you can always pay by card instead.",
  },
  {
    q: "Why is this so much cheaper than LabArchives or Benchling?",
    a: "Because the app is local-first, your everyday work never touches our servers, so our infrastructure cost is small. For individuals and labs we only recover what the storage costs us, with no markup.",
  },
  {
    q: "Is my editing or collaboration metered?",
    a: "No. Editing and real-time collaboration come with your plan. There is no per-edit or per-sync charge, and nothing watches what you type.",
  },
];

export default function PricingFaq({ billingEnabled }: PricingFaqProps) {
  const plusProAnswer = billingEnabled
    ? "We hold the exact figure until a few weeks of real usage show what storage actually costs, so we set it from data instead of guessing high."
    : "We hold the exact figure until a few weeks of real usage show what storage actually costs, so we set it from data instead of guessing high. During the beta every plan is free.";

  const faq = [
    ...FAQ_STATIC.slice(0, 6),
    {
      q: "Why are the Plus and Pro prices not shown yet?",
      a: plusProAnswer,
    },
    ...FAQ_STATIC.slice(6),
  ];

  return (
    <Section>
      <SectionHeading
        title="Questions about the bill"
        subtitle="The honest answers to what people ask before they trust a price. The short version, your data is yours and nothing charges you by surprise."
      />
      <div className="mx-auto max-w-2xl divide-y divide-border border-y border-border">
        {faq.map(({ q, a }) => (
          <details key={q} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-left text-[13.5px] font-semibold text-foreground [&::-webkit-details-marker]:hidden sm:py-3.5 sm:text-[14px]">
              {q}
              <span
                aria-hidden
                className="ml-2 block h-2.5 w-2.5 shrink-0 rotate-45 border-b-2 border-r-2 border-foreground-muted transition-transform group-open:rotate-[-135deg]"
              />
            </summary>
            <p className="pb-4 pr-6 text-[13px] leading-relaxed text-foreground-muted">
              {a}
            </p>
          </details>
        ))}
      </div>
    </Section>
  );
}
