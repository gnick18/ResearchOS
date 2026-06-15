// View method on phone, the read-mode method viewer (View method on phone,
// 2026-06-10). The laptop publishes a sealed read projection of the focused
// experiment's method(s) when the researcher clicks "View method on phone".
// This screen fetches + unseals it and renders a bench-friendly protocol view:
// large type, scrollable, ordered steps / reagents / key params. The method
// itself is NOT editable here (read mode only); the researcher can add a
// VARIATION (e.g. "this batch I used 30 cycles not 28") which posts a sealed
// add-variation command back to the laptop, where it lands on the experiment's
// method as a timestamped variation note.
//
// Why read-only: editing the method at the bench risks divergent edits between
// phone and laptop. Following the recipe and jotting a variation is the bench
// need; the canonical method stays on the laptop.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { MethodReadMode } from '@/components/method/MethodReadMode';
import { useTheme, palette, fonts } from '@/lib/design';
import { typeMeta } from '@/lib/method-library';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { fetchSnapshot, type MethodSnapshot, type MethodProjection } from '@/lib/snapshots';
import { getCachedMethod } from '@/lib/method-library-store';
import { getDemoMethod } from '@/lib/method-library';
import { postAddVariation } from '@/lib/add-variation';
import { postReformatMethod, estimateReformatSeconds } from '@/lib/reformat-method';
import { startBeakerBotJob, subscribeMethodRefresh } from '@/lib/beakerbot-job';
import { postMethodChecks } from '@/lib/add-method-check';
import type { CheckMap } from '@/lib/method-checks';

// ── Per-type read renderers ──────────────────────────────────────────────────

// One source of truth for type color: the SAME METHOD_TYPE_META the library list
// paints rows with, so the card carries the type's accent consistently.
function accentFor(method: MethodProjection): string {
  const t = method.resolvedType ?? method.methodType ?? undefined;
  return t ? typeMeta(t).color : palette.sky;
}

// A translucent wash of a #rrggbb accent, readable on light AND dark.
function accentWash(hex: string, alpha = 0.14): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(26,160,230,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  pcr: 'thermometer-outline',
  lc_gradient: 'analytics-outline',
  mass_spec: 'pulse-outline',
  qpcr: 'pulse-outline',
  cloning: 'git-branch-outline',
  extraction: 'flask-outline',
  western: 'layers-outline',
  staining: 'color-fill-outline',
  culture: 'cellular-outline',
  compound: 'cube-outline',
  markdown: 'document-text-outline',
  pdf: 'document-outline',
  coding: 'code-slash-outline',
};

// Contract .typebadge: an accent-washed pill with the type accent, a glyph, and
// a 700-weight label. Shown above the method title on the card.
function TypeBadge({ method, accent }: { method: MethodProjection; accent: string }) {
  const t = method.resolvedType ?? method.methodType ?? undefined;
  const label = t ? typeMeta(t).label : 'Method';
  const icon = t ? TYPE_ICON[t] : undefined;
  return (
    <View style={[styles.badge, { backgroundColor: accentWash(accent, 0.14) }]}>
      {icon ? <Ionicons name={icon} size={13} color={accent} /> : null}
      <ThemedText style={[styles.badgeTxt, { color: accent }]}>{label}</ThemedText>
    </View>
  );
}

function KeyParamRow({ params }: { params: MethodProjection['keyParams'] }) {
  const { surface, spacing, radii } = useTheme();
  if (!params || params.length === 0) return null;
  return (
    <View style={styles.chipRow}>
      {params.map((p, i) => (
        <View
          key={i}
          style={[
            styles.chip,
            { backgroundColor: surface.sunken, borderColor: surface.border, borderRadius: radii.sm, paddingHorizontal: spacing.md },
          ]}
        >
          <ThemedText style={[styles.chipLabel, { color: surface.faint }]}>
            {p.label ?? ''}
          </ThemedText>
          <ThemedText style={[styles.chipValue, { color: surface.text }]}>
            {p.value ?? ''}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

function PcrStepLine({
  label,
  temperature,
  duration,
}: {
  label: string;
  temperature?: number;
  duration?: string;
}) {
  const { surface } = useTheme();
  const temp = typeof temperature === 'number' ? `${temperature} C` : '';
  const detail = [temp, duration].filter(Boolean).join('  ');
  return (
    <View style={styles.stepLine}>
      <ThemedText style={[styles.stepName, { color: surface.text }]}>{label}</ThemedText>
      <ThemedText style={[styles.stepDetail, { color: surface.muted }]}>{detail}</ThemedText>
    </View>
  );
}

function PcrView({ method }: { method: MethodProjection }) {
  const { surface } = useTheme();
  const pcr = method.pcr;
  if (!pcr) return null;
  return (
    <View style={styles.section}>
      {pcr.initial && pcr.initial.length > 0 ? (
        <>
          <ThemedText style={[styles.subhead, { color: surface.faint }]}>Initial</ThemedText>
          {pcr.initial.map((s, i) => (
            <PcrStepLine key={`init-${i}`} label={s.name ?? 'Step'} temperature={s.temperature} duration={s.duration} />
          ))}
        </>
      ) : null}

      {(pcr.cycles ?? []).map((cycle, ci) => (
        <View key={`cyc-${ci}`} style={styles.cycleBlock}>
          <ThemedText style={[styles.subhead, { color: surface.faint }]}>
            {`Cycle x${cycle.repeats ?? 1}`}
          </ThemedText>
          {(cycle.steps ?? []).map((s, i) => (
            <PcrStepLine key={`cyc-${ci}-${i}`} label={s.name ?? 'Step'} temperature={s.temperature} duration={s.duration} />
          ))}
        </View>
      ))}

      {pcr.final && pcr.final.length > 0 ? (
        <>
          <ThemedText style={[styles.subhead, { color: surface.faint }]}>Final</ThemedText>
          {pcr.final.map((s, i) => (
            <PcrStepLine key={`fin-${i}`} label={s.name ?? 'Step'} temperature={s.temperature} duration={s.duration} />
          ))}
        </>
      ) : null}

      {pcr.hold ? (
        <>
          <ThemedText style={[styles.subhead, { color: surface.faint }]}>Hold</ThemedText>
          <PcrStepLine label={pcr.hold.name ?? 'Hold'} temperature={pcr.hold.temperature} duration={pcr.hold.duration} />
        </>
      ) : null}

      {pcr.ingredients && pcr.ingredients.length > 0 ? (
        <>
          <ThemedText style={[styles.subhead, { color: surface.faint }]}>Reaction mix</ThemedText>
          {pcr.ingredients.map((ing, i) => (
            <View key={`ing-${i}`} style={styles.stepLine}>
              <ThemedText style={[styles.stepName, { color: surface.text }]}>
                {ing.name ?? ''}
                {ing.concentration ? `  ${ing.concentration}` : ''}
              </ThemedText>
              <ThemedText style={[styles.stepDetail, { color: surface.muted }]}>
                {ing.amountPerReaction ?? ''}
              </ThemedText>
            </View>
          ))}
        </>
      ) : null}

      {pcr.notes ? (
        <ThemedText style={[styles.bodyText, { color: surface.muted }]}>{pcr.notes}</ThemedText>
      ) : null}
    </View>
  );
}

function LcView({ method }: { method: MethodProjection }) {
  const { surface } = useTheme();
  const lc = method.lc;
  if (!lc) return null;
  const col = lc.column ?? {};
  const colParts = [col.manufacturer, col.model].filter(Boolean).join(' ');
  const colDims = [
    col.lengthMm != null ? `${col.lengthMm} mm` : null,
    col.innerDiameterMm != null ? `${col.innerDiameterMm} mm ID` : null,
    col.particleSizeUm != null ? `${col.particleSizeUm} um` : null,
  ]
    .filter(Boolean)
    .join('  ');
  return (
    <View style={styles.section}>
      {lc.steps && lc.steps.length > 0 ? (
        <>
          <ThemedText style={[styles.subhead, { color: surface.faint }]}>Gradient</ThemedText>
          <View style={styles.stepLine}>
            <ThemedText style={[styles.stepDetail, { color: surface.muted, flex: 1 }]}>min</ThemedText>
            <ThemedText style={[styles.stepDetail, { color: surface.muted, flex: 1 }]}>%A</ThemedText>
            <ThemedText style={[styles.stepDetail, { color: surface.muted, flex: 1 }]}>%B</ThemedText>
            <ThemedText style={[styles.stepDetail, { color: surface.muted, flex: 1 }]}>mL/min</ThemedText>
          </View>
          {lc.steps.map((s, i) => (
            <View key={`lc-${i}`} style={styles.stepLine}>
              <ThemedText style={[styles.cellText, { color: surface.text }]}>{s.timeMin ?? ''}</ThemedText>
              <ThemedText style={[styles.cellText, { color: surface.text }]}>{s.percentA ?? ''}</ThemedText>
              <ThemedText style={[styles.cellText, { color: surface.text }]}>{s.percentB ?? ''}</ThemedText>
              <ThemedText style={[styles.cellText, { color: surface.text }]}>{s.flowMlMin ?? ''}</ThemedText>
            </View>
          ))}
        </>
      ) : null}

      {colParts || colDims ? (
        <>
          <ThemedText style={[styles.subhead, { color: surface.faint }]}>Column</ThemedText>
          {colParts ? (
            <ThemedText style={[styles.bodyText, { color: surface.text }]}>{colParts}</ThemedText>
          ) : null}
          {colDims ? (
            <ThemedText style={[styles.bodyText, { color: surface.muted }]}>{colDims}</ThemedText>
          ) : null}
        </>
      ) : null}

      {lc.ingredients && lc.ingredients.length > 0 ? (
        <>
          <ThemedText style={[styles.subhead, { color: surface.faint }]}>Mobile phase</ThemedText>
          {lc.ingredients.map((ing, i) => (
            <View key={`lci-${i}`} style={styles.stepLine}>
              <ThemedText style={[styles.stepName, { color: surface.text }]}>
                {ing.name ?? ''}
                {ing.role ? `  (${ing.role})` : ''}
              </ThemedText>
              <ThemedText style={[styles.stepDetail, { color: surface.muted }]}>
                {ing.concentration ?? ''}
              </ThemedText>
            </View>
          ))}
        </>
      ) : null}

      {lc.description ? (
        <ThemedText style={[styles.bodyText, { color: surface.muted }]}>{lc.description}</ThemedText>
      ) : null}
    </View>
  );
}

function CompoundView({ method, accent }: { method: MethodProjection; accent: string }) {
  const { surface } = useTheme();
  const children = method.compound?.children ?? [];
  if (children.length === 0) return null;
  return (
    <View style={styles.section}>
      <ThemedText style={[styles.subhead, { color: surface.faint }]}>Components</ThemedText>
      {/* Contract .kit-item: each bundled method is an ordered, openable card with
          an accent-tinted step number, the step type, and a chevron affordance. */}
      {children.map((child, i) => {
        const childType = child.methodType ?? undefined;
        const childAccent = childType ? typeMeta(childType).color : accent;
        const childLabel = childType ? typeMeta(childType).label : 'Step';
        return (
          <View
            key={`child-${i}`}
            style={[styles.kitItem, { backgroundColor: surface.surface2, borderColor: surface.border }]}
          >
            <View style={[styles.kitNum, { backgroundColor: accentWash(childAccent, 0.14) }]}>
              <ThemedText style={[styles.kitNumTxt, { color: childAccent }]}>{i + 1}</ThemedText>
            </View>
            <View style={styles.kitBody}>
              <ThemedText numberOfLines={1} style={[styles.kitName, { color: surface.text }]}>
                {child.label ?? 'Step'}
              </ThemedText>
              <ThemedText style={[styles.kitSub, { color: surface.muted }]}>{childLabel}</ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={surface.faint} />
          </View>
        );
      })}
      <ThemedText style={[styles.kitNote, { color: surface.muted }]}>
        Open the kit on the laptop for each step's full recipe.
      </ThemedText>
    </View>
  );
}

/** Generic / markdown read view: just the protocol text. */
function BodyView({ method }: { method: MethodProjection }) {
  const { surface } = useTheme();
  if (!method.body) {
    return (
      <ThemedText style={[styles.bodyText, { color: surface.muted }]}>
        No protocol text to show for this method. Open it on the laptop for the full view.
      </ThemedText>
    );
  }
  return (
    <View style={styles.section}>
      <ThemedText style={[styles.bodyText, { color: surface.text }]}>{method.body}</ThemedText>
    </View>
  );
}

function MethodCard({
  method,
  onAddVariation,
  variationBusy,
  onEnterRead,
}: {
  method: MethodProjection;
  onAddVariation: (methodId: number | undefined, text: string) => Promise<void>;
  variationBusy: boolean;
  onEnterRead: () => void;
}) {
  const { surface, spacing, radii } = useTheme();
  const [variationText, setVariationText] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);

  const onSubmit = useCallback(async () => {
    const text = variationText.trim();
    if (!text) return;
    await onAddVariation(method.methodId, text);
    setVariationText('');
    setComposerOpen(false);
  }, [variationText, method.methodId, onAddVariation]);

  const accent = accentFor(method);

  return (
    <Card style={styles.methodCard}>
      {/* Contract masthead: type badge, then the big method title. */}
      <TypeBadge method={method} accent={accent} />
      <ThemedText type="title" style={styles.methodName}>
        {method.name ?? 'Method'}
      </ThemedText>

      {/* Prominent full-screen big-text read mode (NYT-cooking-style). The
          method already lives here; read mode is an enhanced presentation. It
          carries the type accent so the entry point matches the reader. */}
      <Pressable
        onPress={onEnterRead}
        accessibilityRole="button"
        accessibilityLabel="Open read mode"
        style={({ pressed }) => [
          styles.readBtn,
          { backgroundColor: accent, borderRadius: radii.lg },
          pressed && { opacity: 0.9 },
        ]}
      >
        <Ionicons name="play" size={18} color={palette.white} />
        <ThemedText style={styles.readBtnTxt}>Read mode</ThemedText>
      </Pressable>

      <KeyParamRow params={method.keyParams} />

      {method.resolvedType === 'pcr' ? (
        <PcrView method={method} />
      ) : method.resolvedType === 'lc_gradient' ? (
        <LcView method={method} />
      ) : method.resolvedType === 'compound' ? (
        <CompoundView method={method} accent={accent} />
      ) : (
        <BodyView method={method} />
      )}

      {/* Add-variation composer. Read-mode method, but the researcher can record
          a deviation that routes back to the experiment's variation notes. */}
      {composerOpen ? (
        <View style={styles.composer}>
          <TextInput
            value={variationText}
            onChangeText={setVariationText}
            placeholder="What did you change this run? e.g. used 30 cycles not 28"
            placeholderTextColor={surface.placeholder}
            style={[
              styles.composerInput,
              {
                backgroundColor: surface.surface,
                borderColor: surface.border,
                borderRadius: radii.md,
                color: surface.text,
              },
            ]}
            editable={!variationBusy}
            multiline
            autoFocus
            textAlignVertical="top"
          />
          <View style={[styles.composerActions, { gap: spacing.sm }]}>
            <Button
              variant="secondary"
              label="Cancel"
              onPress={() => {
                setVariationText('');
                setComposerOpen(false);
              }}
              disabled={variationBusy}
            />
            <Button
              variant="primary"
              label="Send variation"
              onPress={onSubmit}
              loading={variationBusy}
              disabled={variationBusy || variationText.trim().length === 0}
            />
          </View>
        </View>
      ) : (
        <Button
          variant="secondary"
          accent="amber"
          label="Add a variation"
          onPress={() => setComposerOpen(true)}
        />
      )}
    </Card>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

type VariationStatus = { kind: 'idle' } | { kind: 'sent' } | { kind: 'queued' } | { kind: 'failed' };

export default function MethodScreen() {
  const { surface } = useTheme();
  const router = useRouter();
  const { pairing } = usePairing();
  // The library tab can deep-link two ways:
  //   ?read=1        open read mode for the focused experiment's (single)
  //                  published "method" snapshot (active-experiment rec).
  //   ?uid=<owner:id> open read mode for ONE method resolved from the offline
  //                  library cache (any library row, works with no signal).
  //   ?demo=<uid>    open read mode for a seeded demo method (one per type),
  //                  resolved from the bundled DEMO_METHOD_DETAILS fixture.
  const params = useLocalSearchParams<{ read?: string; uid?: string; demo?: string }>();

  const [snapshot, setSnapshot] = useState<MethodSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variationBusy, setVariationBusy] = useState(false);
  const [variationStatus, setVariationStatus] = useState<VariationStatus>({ kind: 'idle' });
  // Index of the method shown full-screen in read mode, or null for the list.
  const [readIndex, setReadIndex] = useState<number | null>(null);
  // A single LIBRARY method resolved from the offline cache (the ?uid path).
  // When set, the whole screen is its read mode, no experiment snapshot needed.
  const [cachedMethod, setCachedMethod] = useState<MethodProjection | null>(null);
  const [cachedLoaded, setCachedLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!pairing) {
      setSnapshot(null);
      setLoaded(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = (await fetchSnapshot('method', pairing, signWithDevice)) as MethodSnapshot | null;
      setSnapshot(data);
      setLoaded(true);
    } catch {
      setError('Could not sync. Pull down to try again.');
    } finally {
      setLoading(false);
    }
  }, [pairing]);

  // Reload whenever the screen regains focus (the researcher publishes from the
  // laptop, then opens this screen, so a focus-time fetch picks up the snapshot).
  // Skip the experiment fetch entirely when this is a library (?uid) open, since
  // a library method is resolved from the offline cache, not the focused
  // experiment snapshot.
  useFocusEffect(
    useCallback(() => {
      if (!params.uid) void load();
    }, [load, params.uid]),
  );

  // Library (?uid) open: resolve the one method from the offline cache. Works
  // with no signal, the cache is the source of truth at the bench.
  useFocusEffect(
    useCallback(() => {
      const uid = params.uid;
      if (!uid) {
        setCachedMethod(null);
        setCachedLoaded(false);
        return;
      }
      let active = true;
      void (async () => {
        const m = await getCachedMethod(uid);
        if (active) {
          setCachedMethod(m);
          setCachedLoaded(true);
        }
      })();
      return () => {
        active = false;
      };
    }, [params.uid]),
  );

  const onAddVariation = useCallback(
    async (methodId: number | undefined, text: string) => {
      if (!pairing || !snapshot?.taskId || !snapshot?.owner) return;
      setVariationBusy(true);
      setVariationStatus({ kind: 'idle' });
      try {
        const result = await postAddVariation(
          snapshot.taskId,
          snapshot.owner,
          text,
          pairing.userX25519PubHex ?? '',
          methodId,
          pairing.relayUrl,
        );
        setVariationStatus(
          result === 'sent'
            ? { kind: 'sent' }
            : result === 'queued'
              ? { kind: 'queued' }
              : { kind: 'failed' },
        );
      } catch {
        setVariationStatus({ kind: 'failed' });
      } finally {
        setVariationBusy(false);
      }
    },
    [pairing, snapshot?.taskId, snapshot?.owner],
  );

  // When a reformat lands, the laptop republishes the method snapshot and the
  // working bubble fires this nudge, so this screen reloads in place and the
  // tidied steps appear without navigating away.
  useEffect(() => subscribeMethodRefresh(() => void load()), [load]);

  // Offer to make a body-type method phone-friendly (metered AI). Confirms first
  // so there is no surprise token spend, then starts the working bubble + sends
  // the reformat command to the laptop. Guarded to a real paired experiment.
  const onMakePhoneFriendly = useCallback(
    (method: MethodProjection) => {
      if (!pairing || !snapshot?.taskId || !snapshot?.owner) return;
      if (typeof method.methodId !== 'number') return;
      const taskId = snapshot.taskId;
      const owner = snapshot.owner;
      const methodId = method.methodId;
      const eta = estimateReformatSeconds((method.body ?? '').length);
      Alert.alert(
        'Make a phone version?',
        `BeakerBot will restructure "${method.name ?? 'this method'}" into clean steps for the bench. Every number and reagent stays exactly as written. This uses AI credits and takes about ${eta} seconds.`,
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Make it',
            style: 'default',
            onPress: () => {
              const jobId = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
              startBeakerBotJob({
                kind: 'reformat-method',
                jobId,
                label: method.name ?? '',
                methodId,
                taskId,
                etaSeconds: eta,
                startedAt: Date.now(),
              });
              void postReformatMethod(
                taskId,
                owner,
                methodId,
                jobId,
                pairing.userX25519PubHex ?? '',
                pairing.relayUrl,
              );
            },
          },
        ],
      );
    },
    [pairing, snapshot?.taskId, snapshot?.owner],
  );

  // Sync the gathered checklist state to the laptop's attached method (rides the
  // offline outbox, last-write-wins). No-op until paired with a real experiment.
  const onSyncChecks = useCallback(
    (methodId: number | undefined, checks: CheckMap, total: number) => {
      if (!pairing || !snapshot?.taskId || !snapshot?.owner) return;
      void postMethodChecks(
        snapshot.taskId,
        snapshot.owner,
        pairing.userX25519PubHex ?? '',
        checks,
        total,
        methodId,
        pairing.relayUrl,
      );
    },
    [pairing, snapshot?.taskId, snapshot?.owner],
  );

  const paired = !!pairing;
  const methods = snapshot?.methods ?? [];

  // Open read mode for the published method when deep-linked with ?read=1.
  useFocusEffect(
    useCallback(() => {
      if (params.read && methods.length > 0) setReadIndex(0);
      // We only auto-open once per focus when the flag is present.
    }, [params.read, methods.length]),
  );

  // Library (?uid) open: the whole screen is the one cached method's read mode.
  // A library method is not tied to an experiment, so add-variation is disabled
  // (it would have nowhere to route). We still resolve it the same way the card
  // viewer does, from a full MethodProjection, so PCR / LC / compound / body all
  // render offline.
  // Demo (?demo) open: resolve the seeded method synchronously from the bundled
  // fixture and render its read mode. No pairing or network, works in demo mode.
  if (params.demo) {
    const demoMethod = getDemoMethod(params.demo);
    if (!demoMethod) {
      return (
        <ScreenFrame>
          <ScreenHeader />
          <EmptyState icon="flask-outline" text="This demo method is not available." />
        </ScreenFrame>
      );
    }
    return (
      <ScreenFrame edges={['top', 'bottom']}>
        <MethodReadMode
          method={demoMethod}
          onClose={() => router.back()}
          onAddVariation={async () => {
            // No-op: a demo method has no experiment to route a variation to.
          }}
          variationBusy={false}
        />
      </ScreenFrame>
    );
  }

  if (params.uid) {
    if (!cachedLoaded) {
      return (
        <ScreenFrame>
          <ScreenHeader />
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={surface.muted} />
          </View>
        </ScreenFrame>
      );
    }
    if (!cachedMethod) {
      return (
        <ScreenFrame>
          <ScreenHeader />
          <EmptyState
            icon="flask-outline"
            text="This method is not downloaded yet. Open the Methods tab and download your library for offline use."
          />
        </ScreenFrame>
      );
    }
    return (
      <ScreenFrame edges={['top', 'bottom']}>
        <MethodReadMode
          method={cachedMethod}
          onClose={() => router.back()}
          onAddVariation={async () => {
            // No-op: a library method has no experiment to route a variation to.
          }}
          variationBusy={false}
        />
      </ScreenFrame>
    );
  }

  // Full-screen read mode takes over the whole screen (no header, no tab chrome
  // since this is a pushed stack screen). expo-keep-awake fires inside it.
  if (readIndex != null && methods[readIndex]) {
    const opened = methods[readIndex];
    // Offer the reformat only for body-type methods with text (the structured
    // pcr/lc/compound types already read as steps and have no markdown to tidy).
    const rt = opened.resolvedType;
    const canReformat =
      !!opened.body &&
      rt !== 'pcr' &&
      rt !== 'lc_gradient' &&
      rt !== 'compound' &&
      !!snapshot?.taskId;
    return (
      <ScreenFrame edges={['top', 'bottom']}>
        <MethodReadMode
          method={opened}
          experimentName={snapshot?.experimentName}
          onClose={() => setReadIndex(null)}
          onAddVariation={onAddVariation}
          onSyncChecks={onSyncChecks}
          onMakePhoneFriendly={canReformat ? () => onMakePhoneFriendly(opened) : undefined}
          variationBusy={variationBusy}
        />
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame>
      <ScreenHeader />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={surface.muted} />
        }
      >
        <ThemedText type="title">Method</ThemedText>
        {snapshot?.experimentName ? (
          <ThemedText style={[styles.tagline, { color: surface.muted }]}>
            {snapshot.experimentName}
          </ThemedText>
        ) : (
          <ThemedText style={[styles.tagline, { color: surface.muted }]}>
            Follow your experiment's recipe at the bench.
          </ThemedText>
        )}

        {!paired ? (
          <Card>
            <ThemedText style={[styles.cardHint, { color: surface.muted }]}>
              Pair this phone from the home tab to view your experiment methods.
            </ThemedText>
          </Card>
        ) : null}

        {variationStatus.kind === 'sent' ? (
          <Card style={[styles.statusCard, { borderColor: palette.successLight }]}>
            <ThemedText style={[styles.statusText, { color: palette.success }]}>
              Variation sent to the experiment.
            </ThemedText>
          </Card>
        ) : null}
        {variationStatus.kind === 'queued' ? (
          <Card style={[styles.statusCard, { borderColor: palette.warningLight }]}>
            <ThemedText style={[styles.statusText, { color: palette.warning }]}>
              Saved. It will sync to the experiment when this phone is back online.
            </ThemedText>
          </Card>
        ) : null}
        {variationStatus.kind === 'failed' ? (
          <Card style={[styles.statusCard, { borderColor: palette.danger }]}>
            <ThemedText style={[styles.statusText, { color: palette.danger }]}>
              Could not send the variation. Try again.
            </ThemedText>
          </Card>
        ) : null}

        {error ? (
          <ThemedText style={[styles.errorText, { color: palette.danger }]}>{error}</ThemedText>
        ) : null}

        {paired && !loaded ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={surface.muted} />
          </View>
        ) : null}

        {paired && loaded && methods.length === 0 ? (
          <EmptyState
            icon="flask-outline"
            text="No method to show yet. Open an experiment on the laptop and tap View method on phone."
          />
        ) : null}

        {methods.length > 0 ? (
          <>
            <SectionHeader title={methods.length === 1 ? 'Protocol' : 'Protocols'} />
            {methods.map((m, i) => (
              <MethodCard
                key={m.methodId ?? i}
                method={m}
                onAddVariation={onAddVariation}
                variationBusy={variationBusy}
                onEnterRead={() => setReadIndex(i)}
              />
            ))}
          </>
        ) : null}
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 48,
    gap: 12,
  },
  tagline: { lineHeight: 22 },
  cardHint: { lineHeight: 20 },
  loadingWrap: { paddingVertical: 32, alignItems: 'center' },
  errorText: { lineHeight: 20 },
  statusCard: { borderWidth: 1 },
  statusText: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  methodCard: { gap: 8 },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    marginBottom: 2,
  },
  badgeTxt: { fontSize: 12, fontFamily: fonts.bold, fontWeight: '700', letterSpacing: 0.2 },
  readBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 14,
    marginTop: 6,
  },
  readBtnTxt: { fontSize: 16, fontFamily: fonts.extrabold, fontWeight: '800', color: '#ffffff' },
  methodName: { fontSize: 20 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { paddingVertical: 7, alignItems: 'center', flexDirection: 'row', gap: 6, borderWidth: 1, borderColor: 'transparent' },
  chipLabel: { fontSize: 11.5, fontFamily: fonts.medium },
  chipValue: { fontSize: 14, fontFamily: fonts.monoSemibold, fontWeight: '700' },
  section: { gap: 6, marginTop: 6 },
  subhead: { fontSize: 12, fontFamily: fonts.bold, fontWeight: '700', marginTop: 10, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.6 },
  cycleBlock: { gap: 6 },
  stepLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  stepName: { fontSize: 16, flex: 1 },
  stepDetail: { fontSize: 15 },
  cellText: { fontSize: 15, flex: 1 },
  bodyText: { fontSize: 16, lineHeight: 24, marginTop: 4 },
  // Contract .kit-item: ordered, openable component cards.
  kitItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, marginTop: 8 },
  kitNum: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  kitNumTxt: { fontSize: 16, fontFamily: fonts.monoSemibold, fontWeight: '700' },
  kitBody: { flex: 1, minWidth: 0 },
  kitName: { fontSize: 15, fontFamily: fonts.semibold, fontWeight: '600' },
  kitSub: { fontSize: 12, fontFamily: fonts.medium, marginTop: 2 },
  kitNote: { fontSize: 13, lineHeight: 19, marginTop: 12 },
  composer: { gap: 10, marginTop: 4 },
  composerInput: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, minHeight: 96 },
  composerActions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
