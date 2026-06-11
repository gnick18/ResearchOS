/**
 * Two-part model on /pricing. Two cards, the free local notebook (green folder)
 * and the optional cloud storage (blue cloud). Knowing which part is which is
 * the whole pricing model, the local-first design is why cloud stays cheap.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import { Icon } from "@/components/icons";

export default function TwoPartModel() {
  return (
    <div className="mx-auto grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
      {/* Free local notebook */}
      <div className="rounded-2xl border border-border bg-surface-raised p-5 ring-1 ring-green-600/25 dark:ring-green-500/25">
        <div className="mb-3 inline-flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-green-600 text-white dark:bg-green-500">
          <Icon name="folder" className="h-[19px] w-[19px]" />
        </div>
        <h3 className="mb-1 text-[15px] font-extrabold text-foreground">
          Your local notebook
        </h3>
        <p className="mb-2 text-[12px] font-bold text-green-700 dark:text-green-400">
          Free and open source forever
        </p>
        <p className="text-[13px] leading-relaxed text-foreground-muted">
          Your notes, methods, experiments and files live in a folder on your own
          disk, under the AGPLv3 license. No account, no internet, nothing to pay.
          This is the whole app, not a limited trial.
        </p>
      </div>

      {/* Optional cloud storage */}
      <div className="rounded-2xl border border-border bg-surface-raised p-5">
        <div className="mb-3 inline-flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-brand-action text-white">
          <Icon name="cloud" className="h-[19px] w-[19px]" />
        </div>
        <h3 className="mb-1 text-[15px] font-extrabold text-foreground">
          Optional cloud storage
        </h3>
        <p className="mb-2 text-[12px] font-bold text-brand-action">
          Low cost, only what it costs us
        </p>
        <p className="text-[13px] leading-relaxed text-foreground-muted">
          Only the documents you choose to share or co-edit in real time get a
          synced cloud copy. That copy is the one thing we charge for, and only to
          cover the storage. Local-first keeps those costs small, so the price
          stays small too.
        </p>
      </div>
    </div>
  );
}
