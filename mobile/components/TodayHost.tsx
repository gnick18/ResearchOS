/**
 * TodayHost. Mounted once in app/_layout so the Today dropdown can open from the
 * header trio on any tab root. It owns the single 'today' snapshot fetch and
 * renders the shared TodayPanel, both driven by lib/today-store. The header's
 * Today button just calls openToday(); this host fetches fresh on open and on
 * pairing change, and on requestTodayReload() (pull-to-refresh / sync).
 *
 * Native-only mount (the panel uses Skia bits via shared components) is handled
 * by the caller in app/_layout, matching the other overlay hosts.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
import { useCallback, useEffect, useRef } from 'react';

import { TodayPanel } from '@/components/TodayPanel';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { fetchSnapshot, type TodaySnapshot, type SnapshotTask } from '@/lib/snapshots';
import { recordSyncSuccess, recordSyncFailure } from '@/lib/connection-status';
import {
  useTodayState,
  setTodayData,
  closeToday,
} from '@/lib/today-store';

function formatSynced(value: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function TodayHost() {
  const { pairing } = usePairing();
  const { open, snapshot, loading, loaded, error, reloadNonce } = useTodayState();

  const load = useCallback(async () => {
    if (!pairing) {
      setTodayData({ snapshot: null, loaded: true, loading: false, error: null });
      return;
    }
    setTodayData({ loading: true, error: null });
    try {
      const data = (await fetchSnapshot(
        'today',
        pairing,
        signWithDevice,
      )) as TodaySnapshot | null;
      setTodayData({ snapshot: data, loaded: true });
      recordSyncSuccess();
    } catch {
      setTodayData({ error: 'Could not sync. Pull down to try again.' });
      recordSyncFailure();
    } finally {
      setTodayData({ loading: false });
    }
  }, [pairing]);

  // Always call the freshest load (avoids stale closures without re-running on
  // every identity change).
  const loadRef = useRef(load);
  loadRef.current = load;

  // Fetch on mount + whenever the pairing changes.
  const pairingKey = pairing ? `${pairing.u}:${pairing.relayUrl}` : 'none';
  useEffect(() => {
    void loadRef.current();
  }, [pairingKey]);

  // Explicit reloads: openToday() and requestTodayReload() bump reloadNonce.
  useEffect(() => {
    if (reloadNonce > 0) void loadRef.current();
  }, [reloadNonce]);

  const tasks: SnapshotTask[] = Array.isArray(snapshot?.tasks) ? snapshot!.tasks! : [];
  const overdueTasks: SnapshotTask[] = Array.isArray(snapshot?.overdueTasks)
    ? snapshot!.overdueTasks!
    : [];
  const upcomingTasks: SnapshotTask[] = Array.isArray(snapshot?.upcomingTasks)
    ? snapshot!.upcomingTasks!
    : [];
  const overdue = typeof snapshot?.overdue === 'number' ? snapshot.overdue : 0;
  const upcoming = typeof snapshot?.upcoming === 'number' ? snapshot.upcoming : 0;
  const syncedLabel = snapshot?.generatedAt ? formatSynced(snapshot.generatedAt) : null;

  return (
    <TodayPanel
      visible={open}
      onClose={closeToday}
      snapshot={snapshot}
      tasks={tasks}
      overdueTasks={overdueTasks}
      upcomingTasks={upcomingTasks}
      overdue={overdue}
      upcoming={upcoming}
      loading={loading}
      loaded={loaded}
      error={error}
      syncedLabel={syncedLabel}
    />
  );
}
