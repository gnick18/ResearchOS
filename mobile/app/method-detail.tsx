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
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { MethodReadMode } from '@/components/method/MethodReadMode';
import { useTheme, palette } from '@/lib/design';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { fetchSnapshot, type MethodSnapshot, type MethodProjection } from '@/lib/snapshots';
import { postAddVariation } from '@/lib/add-variation';

// ── Per-type read renderers ──────────────────────────────────────────────────

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
            { backgroundColor: surface.sunken, borderRadius: radii.sm, paddingHorizontal: spacing.sm },
          ]}
        >
          <ThemedText style={[styles.chipLabel, { color: surface.muted }]}>
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
          <ThemedText style={[styles.subhead, { color: surface.muted }]}>Initial</ThemedText>
          {pcr.initial.map((s, i) => (
            <PcrStepLine key={`init-${i}`} label={s.name ?? 'Step'} temperature={s.temperature} duration={s.duration} />
          ))}
        </>
      ) : null}

      {(pcr.cycles ?? []).map((cycle, ci) => (
        <View key={`cyc-${ci}`} style={styles.cycleBlock}>
          <ThemedText style={[styles.subhead, { color: surface.muted }]}>
            {`Cycle x${cycle.repeats ?? 1}`}
          </ThemedText>
          {(cycle.steps ?? []).map((s, i) => (
            <PcrStepLine key={`cyc-${ci}-${i}`} label={s.name ?? 'Step'} temperature={s.temperature} duration={s.duration} />
          ))}
        </View>
      ))}

      {pcr.final && pcr.final.length > 0 ? (
        <>
          <ThemedText style={[styles.subhead, { color: surface.muted }]}>Final</ThemedText>
          {pcr.final.map((s, i) => (
            <PcrStepLine key={`fin-${i}`} label={s.name ?? 'Step'} temperature={s.temperature} duration={s.duration} />
          ))}
        </>
      ) : null}

      {pcr.hold ? (
        <>
          <ThemedText style={[styles.subhead, { color: surface.muted }]}>Hold</ThemedText>
          <PcrStepLine label={pcr.hold.name ?? 'Hold'} temperature={pcr.hold.temperature} duration={pcr.hold.duration} />
        </>
      ) : null}

      {pcr.ingredients && pcr.ingredients.length > 0 ? (
        <>
          <ThemedText style={[styles.subhead, { color: surface.muted }]}>Reaction mix</ThemedText>
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
          <ThemedText style={[styles.subhead, { color: surface.muted }]}>Gradient</ThemedText>
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
          <ThemedText style={[styles.subhead, { color: surface.muted }]}>Column</ThemedText>
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
          <ThemedText style={[styles.subhead, { color: surface.muted }]}>Mobile phase</ThemedText>
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

function CompoundView({ method }: { method: MethodProjection }) {
  const { surface } = useTheme();
  const children = method.compound?.children ?? [];
  if (children.length === 0) return null;
  return (
    <View style={styles.section}>
      <ThemedText style={[styles.subhead, { color: surface.muted }]}>Steps in this kit</ThemedText>
      {children.map((child, i) => (
        <View key={`child-${i}`} style={styles.stepLine}>
          <ThemedText style={[styles.stepName, { color: surface.text }]}>
            {`${i + 1}. ${child.label ?? 'Step'}`}
          </ThemedText>
          <ThemedText style={[styles.stepDetail, { color: surface.muted }]}>
            {child.methodType ?? ''}
          </ThemedText>
        </View>
      ))}
      <ThemedText style={[styles.bodyText, { color: surface.muted }]}>
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

  const typeLabel = method.methodType ?? method.resolvedType ?? '';

  return (
    <Card style={styles.methodCard}>
      <ThemedText type="title" style={styles.methodName}>
        {method.name ?? 'Method'}
      </ThemedText>
      {typeLabel ? (
        <ThemedText style={[styles.methodType, { color: surface.muted }]}>{typeLabel}</ThemedText>
      ) : null}

      {/* Prominent full-screen big-text read mode (NYT-cooking-style). The
          method already lives here; read mode is an enhanced presentation. */}
      <Pressable
        onPress={onEnterRead}
        accessibilityRole="button"
        accessibilityLabel="Open read mode"
        style={[styles.readBtn, { backgroundColor: palette.sky, borderRadius: radii.lg }]}
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
        <CompoundView method={method} />
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

type VariationStatus = { kind: 'idle' } | { kind: 'sent' } | { kind: 'failed' };

export default function MethodScreen() {
  const { surface } = useTheme();
  const { pairing } = usePairing();
  // The library tab can deep-link with ?read=1 to open read mode straight away
  // for the (single) published method.
  const params = useLocalSearchParams<{ read?: string }>();

  const [snapshot, setSnapshot] = useState<MethodSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variationBusy, setVariationBusy] = useState(false);
  const [variationStatus, setVariationStatus] = useState<VariationStatus>({ kind: 'idle' });
  // Index of the method shown full-screen in read mode, or null for the list.
  const [readIndex, setReadIndex] = useState<number | null>(null);

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
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onAddVariation = useCallback(
    async (methodId: number | undefined, text: string) => {
      if (!pairing || !snapshot?.taskId || !snapshot?.owner) return;
      setVariationBusy(true);
      setVariationStatus({ kind: 'idle' });
      try {
        const ok = await postAddVariation(
          snapshot.taskId,
          snapshot.owner,
          text,
          pairing.userX25519PubHex ?? '',
          methodId,
          pairing.relayUrl,
        );
        setVariationStatus(ok ? { kind: 'sent' } : { kind: 'failed' });
      } catch {
        setVariationStatus({ kind: 'failed' });
      } finally {
        setVariationBusy(false);
      }
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

  // Full-screen read mode takes over the whole screen (no header, no tab chrome
  // since this is a pushed stack screen). expo-keep-awake fires inside it.
  if (readIndex != null && methods[readIndex]) {
    return (
      <ScreenFrame edges={['top', 'bottom']}>
        <MethodReadMode
          method={methods[readIndex]}
          experimentName={snapshot?.experimentName}
          onClose={() => setReadIndex(null)}
          onAddVariation={onAddVariation}
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
  readBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 14,
    marginTop: 4,
  },
  readBtnTxt: { fontSize: 16, fontWeight: '800', color: '#ffffff' },
  methodName: { fontSize: 20 },
  methodType: { fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { paddingVertical: 6, alignItems: 'center', flexDirection: 'row', gap: 6 },
  chipLabel: { fontSize: 12 },
  chipValue: { fontSize: 14, fontWeight: '700' },
  section: { gap: 6, marginTop: 4 },
  subhead: { fontSize: 13, fontWeight: '700', marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  cycleBlock: { gap: 6 },
  stepLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  stepName: { fontSize: 16, flex: 1 },
  stepDetail: { fontSize: 15 },
  cellText: { fontSize: 15, flex: 1 },
  bodyText: { fontSize: 16, lineHeight: 24, marginTop: 4 },
  composer: { gap: 10, marginTop: 4 },
  composerInput: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, minHeight: 96 },
  composerActions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
