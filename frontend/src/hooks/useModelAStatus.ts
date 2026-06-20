"use client";

// Shared thin read hook for Model A billing status.
//
// Wraps GET /api/billing/model-a/status so both the account hub Card 2 and
// Settings -> Plan & storage read the IDENTICAL fetch contract. No new logic,
// no new endpoint, no duplication of the status shape. ModelABilling and
// AccountHub both import this so there is exactly one fetch and one cache.
//
// Contract (for the billing lane):
//   const { status, loading, error, refresh } = useModelAStatus();
//   - status: ModelAStatus | null (null while loading or when billing is off)
//   - loading: boolean (true on first fetch)
//   - error: string | null (message if the fetch threw; null when billing is off)
//   - refresh: () => void (re-fire the fetch; e.g. after adding a card)
//
// When the route returns 404 (billing not live), status stays null and error
// stays null (same "off" behavior ModelABilling uses internally). A network
// error sets error to a short human-readable message.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";
import type { ModelAStatus } from "@/components/billing/ModelABilling";

export interface UseModelAStatusResult {
  status: ModelAStatus | null;
  loading: boolean;
  /** null when billing is off (404) or while loading; a message on fetch error */
  error: string | null;
  refresh: () => void;
}

export function useModelAStatus(): UseModelAStatusResult {
  const [status, setStatus] = useState<ModelAStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch("/api/billing/model-a/status");
        if (!alive) return;
        if (res.status === 404) {
          // Billing not live yet. Treat as "off", not an error.
          setStatus(null);
          setError(null);
          return;
        }
        if (!res.ok) {
          setError(`Could not load billing status (HTTP ${res.status}).`);
          return;
        }
        const data = (await res.json()) as ModelAStatus;
        if (!alive) return;
        setStatus(data);
      } catch {
        if (!alive) return;
        setError("Could not reach the billing service. Check your connection.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  return { status, loading, error, refresh };
}
