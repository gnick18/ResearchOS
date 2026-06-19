"use client";

// /admin Storage inventory section. Shows what is actually stored across the R2
// buckets at any given time, broken down by bucket (icon library vs app data)
// and by key prefix (each lab's hosted site, the sharing relay, and so on), so
// the operator can see exactly what each lab is storing and what the icon
// library weighs. Data comes from /api/admin/storage-inventory (operator-gated).

import { useCallback, useEffect, useState } from "react";
import { StatCard } from "@/components/admin/AdminMetrics";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import type {
  BucketInventory,
  PrefixUsage,
  StorageInventory,
} from "@/lib/library/storage-inventory";

function formatBytes(n: number): string {
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

type State =
  | { phase: "loading" }
  | { phase: "ready"; data: StorageInventory }
  | { phase: "error"; message: string };

function useStorageInventory() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    try {
      const res = await fetch(
        `/api/admin/storage-inventory${force ? "?refresh=1" : ""}`,
      );
      if (!res.ok) {
        setState({ phase: "error", message: `Request failed (HTTP ${res.status}).` });
        return;
      }
      const data = (await res.json()) as StorageInventory;
      setState({ phase: "ready", data });
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "Could not load the inventory.",
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  return { state, refresh: () => load(true), refreshing };
}

export default function StorageInventorySection() {
  const { state, refresh, refreshing } = useStorageInventory();

  if (state.phase === "loading") {
    return <p className="text-meta text-foreground-muted">Walking the buckets...</p>;
  }
  if (state.phase === "error") {
    return (
      <div className="rounded-2xl border border-border bg-surface-raised p-5">
        <p className="text-meta font-medium text-danger">{state.message}</p>
        <button
          type="button"
          onClick={refresh}
          className="mt-3 rounded-lg border border-border-strong px-3 py-1.5 text-meta font-medium hover:border-brand-action"
        >
          Try again
        </button>
      </div>
    );
  }

  const { buckets, generatedAtMs } = state.data;
  const grandObjects = buckets.reduce((s, b) => s + b.totalObjects, 0);
  const grandBytes = buckets.reduce((s, b) => s + b.totalBytes, 0);
  const asOf = new Date(generatedAtMs).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-meta text-foreground-muted">
          Live object count and size across the R2 buckets, as of {asOf}. Cached a
          few minutes, refresh for a fresh walk.
        </p>
        <Tooltip label="Re-walk the buckets now">
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Refresh inventory"
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-meta font-medium text-foreground-muted hover:border-brand-action disabled:opacity-50"
          >
            <Icon name="refresh" className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </Tooltip>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Total objects" value={formatCount(grandObjects)} />
        <StatCard label="Total stored" value={formatBytes(grandBytes)} />
      </div>

      {buckets.map((b) => (
        <BucketCard key={b.bucket} bucket={b} />
      ))}
    </div>
  );
}

function BucketCard({ bucket }: { bucket: BucketInventory }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-body font-bold text-foreground">{bucket.label}</p>
          <p className="text-meta text-foreground-faint">{bucket.bucket}</p>
        </div>
        {bucket.reachable ? (
          <p className="text-meta text-foreground-muted">
            {formatCount(bucket.totalObjects)} objects, {formatBytes(bucket.totalBytes)}
          </p>
        ) : (
          <p className="text-meta font-medium text-warning">Not reachable</p>
        )}
      </div>

      {!bucket.reachable && bucket.error && (
        <p className="mt-2 text-meta text-foreground-faint">{bucket.error}</p>
      )}

      {bucket.reachable && bucket.prefixes.length > 0 && (
        <div className="mt-4 space-y-1">
          {bucket.prefixes.map((p) => (
            <PrefixRow key={p.prefix} prefix={p} total={bucket.totalBytes} />
          ))}
        </div>
      )}
    </div>
  );
}

function PrefixRow({ prefix, total }: { prefix: PrefixUsage; total: number }) {
  const [open, setOpen] = useState(false);
  const pct = total > 0 ? Math.round((prefix.bytes / total) * 100) : 0;
  const hasChildren = prefix.children.length > 0;

  return (
    <div className="rounded-lg border border-border-subtle">
      <button
        type="button"
        onClick={() => hasChildren && setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left ${hasChildren ? "hover:bg-surface-overlay" : "cursor-default"}`}
      >
        <Icon
          name="chevronRight"
          className={`h-3 w-3 shrink-0 text-foreground-faint transition-transform ${open ? "rotate-90" : ""} ${hasChildren ? "" : "opacity-0"}`}
        />
        <span className="flex-1 truncate font-mono text-meta text-foreground">{prefix.prefix}</span>
        <span className="shrink-0 text-meta tabular-nums text-foreground-faint">
          {formatCount(prefix.objects)}
        </span>
        <span className="w-20 shrink-0 text-right text-meta tabular-nums font-medium text-foreground-muted">
          {formatBytes(prefix.bytes)}
        </span>
        <span className="w-10 shrink-0 text-right text-meta tabular-nums text-foreground-faint">
          {pct}%
        </span>
      </button>
      {open && hasChildren && (
        <div className="border-t border-border-subtle px-3 py-1.5">
          {prefix.children.map((c) => (
            <div key={c.prefix} className="flex items-center gap-2 py-1 pl-5">
              <span className="flex-1 truncate font-mono text-meta text-foreground-muted">
                {c.prefix}
              </span>
              <span className="shrink-0 text-meta tabular-nums text-foreground-faint">
                {formatCount(c.objects)}
              </span>
              <span className="w-20 shrink-0 text-right text-meta tabular-nums text-foreground-faint">
                {formatBytes(c.bytes)}
              </span>
              <span className="w-10 shrink-0" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
