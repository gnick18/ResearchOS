// BeakerBot working bubble (method phone projection reformatter, Phase 2 phone
// trigger, 2026-06-14).
//
// A persistent pill in the upper-right corner that appears whenever a metered-AI
// job is in flight (right now only the method reformat). It shows the living
// BeakerBot mark plus a live countdown, and tapping it expands a small card with
// the estimated time left and, on completion, the real token count. It mounts
// once at the app root and renders null when no job is running.
//
// It also OWNS the job lifecycle on the phone: while a job is "working" it polls
// the laptop's lean ai-job status snapshot every couple of seconds, lands on the
// real outcome + token count, nudges the open method screen to refetch (so the
// tidied steps appear in place), then auto-dismisses a few seconds later.
//
// No em-dashes, no emojis, no mid-sentence colons.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BeakerBot } from '@/components/ui/BeakerBot';
import { useTheme } from '@/lib/design';
import { getPairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { fetchSnapshot } from '@/lib/snapshots';
import {
  useBeakerBotJob,
  setBeakerBotJob,
  clearBeakerBotJob,
  fireMethodRefresh,
} from '@/lib/beakerbot-job';

// Mirror of the laptop's AiJobStatus payload (frontend ai-job-status.ts). Kept
// local since mobile and frontend are separate packages.
type AiJobStatus = {
  kind?: string;
  jobId?: string;
  status?: 'working' | 'done' | 'error';
  methodId?: number;
  taskId?: number;
  outcome?: 'reformatted' | 'kept-plain';
  tokens?: number;
  errorReason?: string;
  at?: string;
};

const POLL_MS = 2200;
const AUTO_DISMISS_MS = 5000;

function errorLine(reason: string | null): string {
  switch (reason) {
    case 'out_of_credits':
      return 'Out of AI credits.';
    case 'no_body':
      return 'This method has no text to tidy.';
    case 'timeout':
      return 'Took too long. Tap the method to try again.';
    default:
      return 'Could not finish. Tap the method to try again.';
  }
}

export default function BeakerBotWorkingBubble() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const job = useBeakerBotJob();
  const [expanded, setExpanded] = useState(false);
  // A 1Hz tick to re-render the countdown while working.
  const [, setTick] = useState(0);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  // ── Status watcher: poll the laptop's ai-job snapshot while working. ────────
  useEffect(() => {
    if (job.status !== 'working' || !job.jobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = job.startedAt;
    const jobId = job.jobId;
    const etaSeconds = job.etaSeconds;

    const poll = async () => {
      if (!active) return;
      try {
        const pairing = await getPairing();
        if (pairing && !pairing.demo) {
          const s = (await fetchSnapshot('ai-job', pairing, signWithDevice)) as AiJobStatus | null;
          if (active && s && s.jobId === jobId && (s.status === 'done' || s.status === 'error')) {
            setBeakerBotJob({
              status: s.status,
              tokens: typeof s.tokens === 'number' ? s.tokens : null,
              outcome: s.outcome ?? null,
              errorReason: s.errorReason ?? null,
            });
            if (s.status === 'done') fireMethodRefresh();
            return; // landed, stop polling
          }
        }
      } catch {
        // transient relay/unseal hiccup, just try again next tick
      }
      if (!active) return;
      // Safety net: if the laptop never answers (asleep, unpaired), fail the job
      // rather than spin forever.
      if (Date.now() - startedAt > (etaSeconds + 75) * 1000) {
        setBeakerBotJob({ status: 'error', errorReason: 'timeout' });
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, 1400);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [job.status, job.jobId, job.startedAt, job.etaSeconds]);

  // ── Countdown ticker (1Hz) while working. ───────────────────────────────────
  useEffect(() => {
    if (job.status !== 'working') return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [job.status]);

  // ── Auto-dismiss a finished job (unless the user has it expanded). ───────────
  useEffect(() => {
    if (job.status !== 'done' && job.status !== 'error') return;
    if (expanded) return;
    const id = setTimeout(() => {
      clearBeakerBotJob();
      setExpanded(false);
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [job.status, expanded]);

  const close = useCallback(() => {
    setExpanded(false);
    if (job.status === 'done' || job.status === 'error') clearBeakerBotJob();
  }, [job.status]);

  if (job.status === 'idle') return null;

  const working = job.status === 'working';
  const done = job.status === 'done';
  const isError = job.status === 'error';

  const elapsed = (Date.now() - job.startedAt) / 1000;
  const secsLeft = Math.max(0, Math.ceil(job.etaSeconds - elapsed));

  const accent = isError ? t.palette.danger : done ? t.palette.success : t.palette.sky;
  const pillText = working
    ? secsLeft > 0
      ? `~${secsLeft}s`
      : 'wrapping up'
    : done
      ? job.outcome === 'kept-plain'
        ? 'Done'
        : 'Ready'
      : '!';

  const headline = working
    ? 'Tidying for the bench'
    : done
      ? job.outcome === 'kept-plain'
        ? 'Kept the plain steps'
        : 'Phone version ready'
      : 'Reformat stopped';

  const detail = working
    ? job.label
      ? `Restructuring "${job.label}" into clean steps. Every value stays exactly as written.`
      : 'Restructuring into clean steps. Every value stays exactly as written.'
    : done
      ? job.outcome === 'kept-plain'
        ? 'The tidy version did not pass the verbatim check, so the phone keeps the plain steps. Nothing was changed.'
        : 'This method now reads as clean steps on the phone.'
      : errorLine(job.errorReason);

  const top = insets.top + 6;

  return (
    <>
      {/* Tap-away scrim, only while expanded, so the card feels like a popover. */}
      {expanded ? (
        <Pressable
          style={[StyleSheet.absoluteFill, styles.scrim]}
          onPress={close}
          accessibilityLabel="Close BeakerBot status"
        />
      ) : null}

      {/* The pill. */}
      <Pressable
        onPress={() => setExpanded((e) => !e)}
        style={[
          styles.pill,
          {
            top,
            right: t.spacing.md,
            backgroundColor: t.surface.surface,
            borderColor: t.surface.border,
            borderRadius: t.radii.pill,
          },
          t.shadow.sm,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`BeakerBot ${headline}`}
      >
        <View pointerEvents="none" style={styles.botWrap}>
          <BeakerBot size={26} alive={working} />
        </View>
        <Text
          style={[
            t.type.meta,
            { color: accent, fontFamily: t.fonts.semibold },
          ]}
        >
          {pillText}
        </Text>
      </Pressable>

      {/* The expanded card. */}
      {expanded ? (
        <View
          style={[
            styles.card,
            {
              top: top + 44,
              right: t.spacing.md,
              backgroundColor: t.surface.surface,
              borderColor: t.surface.border,
              borderRadius: t.radii.lg,
            },
            t.shadow.md,
          ]}
        >
          <View style={styles.cardHead}>
            <View style={[styles.dot, { backgroundColor: accent }]} />
            <Text style={[t.type.caption, { color: t.surface.text, fontFamily: t.fonts.semibold, flex: 1 }]}>
              {headline}
            </Text>
          </View>

          <Text style={[t.type.caption, { color: t.surface.muted, marginTop: 6 }]}>{detail}</Text>

          <View style={[styles.statRow, { borderTopColor: t.surface.hairline, marginTop: t.spacing.md }]}>
            <Text style={[t.type.meta, { color: t.surface.faint }]}>Time left</Text>
            <Text style={[t.type.meta, { color: t.surface.text, fontFamily: t.fonts.mono }]}>
              {working ? (secsLeft > 0 ? `~${secsLeft}s` : 'a moment') : '—'}
            </Text>
          </View>
          <View style={[styles.statRow, { borderTopColor: t.surface.hairline }]}>
            <Text style={[t.type.meta, { color: t.surface.faint }]}>Tokens used</Text>
            <Text style={[t.type.meta, { color: t.surface.text, fontFamily: t.fonts.mono }]}>
              {job.tokens != null ? job.tokens.toLocaleString() : working ? 'counting' : '—'}
            </Text>
          </View>

          {!working ? (
            <Pressable onPress={close} style={[styles.closeBtn, { backgroundColor: t.surface.sunken, borderRadius: t.radii.md }]}>
              <Text style={[t.type.meta, { color: t.surface.text, fontFamily: t.fonts.semibold }]}>Close</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { zIndex: 57, backgroundColor: 'transparent' },
  pill: {
    position: 'absolute',
    zIndex: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  botWrap: { width: 26, height: 26 },
  card: {
    position: 'absolute',
    zIndex: 59,
    width: 250,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  closeBtn: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 9,
  },
});
