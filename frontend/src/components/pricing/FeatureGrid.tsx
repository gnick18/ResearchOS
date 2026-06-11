/**
 * A grid of icon + title + body feature cards, reused by the metering, labs,
 * guardrails, and support sections on /pricing. Mirrors the mockup's .frow /
 * .fbox / .fbicon. Icons render via the verified <Icon> registry.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons/registry";

export interface FeatureItem {
  icon: IconName;
  title: string;
  /** One or more paragraphs of body copy. */
  body: string[];
}

export default function FeatureGrid({
  items,
  columns = 2,
}: {
  items: FeatureItem[];
  columns?: 2;
}) {
  return (
    <div
      className={`mx-auto grid max-w-3xl grid-cols-1 gap-4 ${
        columns === 2 ? "sm:grid-cols-2" : ""
      }`}
    >
      {items.map((item) => (
        <div
          key={item.title}
          className="rounded-2xl border border-border bg-surface-raised p-5"
        >
          <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-[9px] bg-brand-action/[0.11] text-brand-action">
            <Icon name={item.icon} className="h-[19px] w-[19px]" />
          </div>
          <h3 className="mb-1.5 text-sm font-extrabold text-foreground">
            {item.title}
          </h3>
          {item.body.map((p, idx) => (
            <p
              key={idx}
              className={`text-[12.5px] leading-relaxed text-foreground-muted ${
                idx > 0 ? "mt-2" : ""
              }`}
            >
              {p}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
