"use client";

// PI-Mode lab inventory browse (RS-4). The lab head's counter-view to the
// per-supply default: every member's inventory items grouped BY OWNER, so a PI
// can see what reagents and supplies the whole lab holds in one place. Read-only;
// per-item editing stays on each owner's own inventory surface. Members never see
// this lens (the page gates the chip on isLabHead).
//
// Reuses the lab-wide fetch (labApi.getInventoryItemsFull) + the shared profile
// map for owner display names. No new data shape.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useMemo, useState } from "react";
import type { InventoryItem } from "@/lib/types";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import UserAvatar from "@/components/UserAvatar";
import { Icon } from "@/components/icons";

export type LabInventoryItem = InventoryItem & { owner: string };

interface OwnerGroup {
  owner: string;
  items: LabInventoryItem[];
}

export default function LabInventoryLens({
  items,
  query,
}: {
  items: LabInventoryItem[];
  /** The shared search box value, applied across name / vendor / catalog / CAS. */
  query: string;
}) {
  const profiles = useLabUserProfileMap();

  const groups = useMemo<OwnerGroup[]>(() => {
    const q = query.trim().toLowerCase();
    const byOwner = new Map<string, LabInventoryItem[]>();
    for (const it of items) {
      if (q) {
        const hay = [it.name, it.vendor, it.catalog_number, it.cas]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const list = byOwner.get(it.owner) ?? [];
      list.push(it);
      byOwner.set(it.owner, list);
    }
    return Array.from(byOwner.entries())
      .map(([owner, list]) => ({
        owner,
        items: list.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.owner.localeCompare(b.owner));
  }, [items, query]);

  if (groups.length === 0) {
    return (
      <p className="py-12 text-center text-body text-foreground-muted">
        {items.length === 0
          ? "No lab inventory yet. Items appear here as members add them."
          : "No lab inventory matches this search."}
      </p>
    );
  }

  return (
    <div className="space-y-5" data-testid="lab-inventory-lens">
      {groups.map((g) => {
        const label = profiles[g.owner]?.displayName?.trim() || g.owner;
        return (
          <section key={g.owner}>
            <div className="mb-2 flex items-center gap-2">
              <UserAvatar username={g.owner} size="sm" />
              <h3 className="text-body font-medium text-foreground">{label}</h3>
              <span className="text-meta text-foreground-muted">
                {g.items.length} {g.items.length === 1 ? "item" : "items"}
              </span>
            </div>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {g.items.map((it) => (
                <li
                  key={`${it.owner}:${it.id}`}
                  className="flex flex-wrap items-center gap-2 bg-surface px-4 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-foreground">
                      {it.name}
                    </span>
                    <span className="text-meta text-foreground-muted">
                      {[it.vendor, it.catalog_number].filter(Boolean).join(" · ") ||
                        "No vendor on file"}
                    </span>
                  </span>
                  {it.hazard_note || it.storage_class ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-meta font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                      <Icon name="alert" className="h-3 w-3" />
                      {it.storage_class || "Hazard"}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
