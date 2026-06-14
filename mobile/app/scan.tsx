// Scan flow (receive, track, deduct, reorder). Point the phone at a package
// barcode. A tracked barcode opens the deduct view (big 1, one-tap Deduct, quick
// multi-use). An unknown barcode opens the new-package view, match a recent
// order (marks it arrived + links inventory), add a new purchase order, or add
// plain inventory, each barcode-prefilled and confirmed. After arriving or
// adding, an optional "track this barcode" step sets units-per-scan + total. A
// tracked item always offers "Low, reorder ASAP". All writes are device-signed
// actions over the capture relay the laptop applies (docs/proposals/
// MOBILE_SCAN_FLOW.md). House style: no em-dashes, no emojis, no mid-sentence
// colons.
import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from 'expo-camera';
import * as Haptics from 'expo-haptics';

import { hapticImpact } from '@/lib/interaction-prefs';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useTheme, palette, fonts, radii as globalRadii } from '@/lib/design';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { fetchSnapshot } from '@/lib/snapshots';
import {
  markArrived,
  registerTracker,
  deductUnits,
  reorderFromPurchase,
  createPurchase,
  createInventory,
  type ActionResult,
  type InventorySnapshot,
  type TrackedStock,
  type RecentPurchase,
} from '@/lib/scan';
import { parseBarcode, barcodesMatch, type ParsedBarcode } from '@/lib/barcode';

const BARCODE_TYPES = [
  'qr',
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'code128',
  'code39',
  'code93',
  'codabar',
  'itf14',
  'datamatrix',
] as const;

const UNIT_CHIPS = ['reaction', 'tube', 'mL', 'well', 'use'];
const QTY_CHIPS = [1, 2, 3, 5];

type Step = 'scan' | 'tracked' | 'newpkg' | 'track' | 'done';
type CreateMode = 'purchase' | 'inventory';

type Sync =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

// What collecting units in the track step applies to. A matched purchase tracks
// by purchaseItemId. A create draft bundles the tracking into the create action.
type TrackContext =
  | { kind: 'purchase'; purchase: RecentPurchase }
  | { kind: 'create'; mode: CreateMode; name: string; vendor?: string | null; catalog?: string | null; quantity: number };

function buzz(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  hapticImpact(style);
}

// Contract .input.focus: sky border + soft sky glow. Spread onto a focused
// input/field. Glow reads a touch hotter on dark, matching note.tsx.
function focusRing(dark: boolean) {
  return {
    shadowColor: palette.sky,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: dark ? 0.5 : 0.28,
    shadowRadius: 6,
    elevation: 0,
  } as const;
}

// Contract .glowline: a luminous sky hairline that seams the gradient hero to
// the card body (sky -> #5ec8ff -> sky, with a soft outer glow).
function GlowLine() {
  return (
    <View style={styles.glowlineWrap}>
      <LinearGradient
        colors={['transparent', palette.sky, '#5ec8ff', palette.sky, 'transparent']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.glowline}
      />
    </View>
  );
}

// Contract .callout: tinted inset with an accent lead word. Sky by default,
// amber for the "not recognized" warning. Optional leading sparkle/icon.
function Callout({
  tone = 'sky',
  icon,
  children,
}: {
  tone?: 'sky' | 'amber';
  icon?: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}) {
  const { radii, surface } = useTheme();
  const accent = tone === 'amber' ? palette.amber : palette.sky;
  const bg = tone === 'amber' ? palette.amberDim : palette.skyDim;
  const border = tone === 'amber' ? palette.amberBorder : palette.skyBorder;
  return (
    <View
      style={[
        styles.callout,
        { backgroundColor: bg, borderColor: border, borderRadius: radii.md },
      ]}
    >
      {icon ? (
        <Ionicons name={icon} size={17} color={accent} style={{ marginTop: 1 }} />
      ) : null}
      <ThemedText style={[styles.calloutText, { color: surface.text }]}>
        {children}
      </ThemedText>
    </View>
  );
}

// Contract .stockbar: a sunken track with an ok/low gradient fill (clamped).
function StockBar({ ratio, low }: { ratio: number; low: boolean }) {
  const { surface } = useTheme();
  const pct = Math.max(0, Math.min(1, ratio));
  return (
    <View style={[styles.stockbar, { backgroundColor: surface.sunken }]}>
      <LinearGradient
        colors={low ? [palette.danger, '#ff6b6f'] : [palette.success, '#34d27b']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.stockfill, { width: `${Math.round(pct * 100)}%` }]}
      />
    </View>
  );
}

// Sky-gradient hero header (contract: linear-gradient(140deg, sky, #39b4ff)),
// white text, a translucent icon tile, item name, and a mono code line.
function GradientHero({
  icon,
  eyebrow,
  title,
  code,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  eyebrow?: string;
  title: string;
  code?: string | null;
}) {
  return (
    <LinearGradient
      colors={[palette.sky, '#39b4ff']}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={styles.hero}
    >
      <View style={styles.heroIcon}>
        <Ionicons name={icon} size={24} color={palette.white} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {eyebrow ? <ThemedText style={styles.heroEyebrow}>{eyebrow}</ThemedText> : null}
        <ThemedText style={styles.heroTitle} numberOfLines={2}>
          {title}
        </ThemedText>
        {code ? (
          <ThemedText style={styles.heroCode} numberOfLines={1}>
            {code}
          </ThemedText>
        ) : null}
      </View>
    </LinearGradient>
  );
}

export default function ScanScreen() {
  const { pairing } = usePairing();
  const { surface, spacing, radii, dark } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [manualFocus, setManualFocus] = useState(false);

  const [snap, setSnap] = useState<InventorySnapshot | null>(null);
  const [sync, setSync] = useState<Sync>({ kind: 'loading' });

  const [step, setStep] = useState<Step>('scan');
  const [handled, setHandled] = useState(false);
  const [manualCode, setManualCode] = useState('');

  // Resolved scan context.
  const [code, setCode] = useState('');
  const [parsed, setParsed] = useState<ParsedBarcode | null>(null);
  const [tracked, setTracked] = useState<TrackedStock | null>(null);
  const [trackCtx, setTrackCtx] = useState<TrackContext | null>(null);
  const [arrivedLabel, setArrivedLabel] = useState<string | null>(null);

  // Deduct inputs.
  const [deductQty, setDeductQty] = useState(1);

  // Track-step inputs.
  const [unitsPerScan, setUnitsPerScan] = useState(1);
  const [totalInBox, setTotalInBox] = useState('');
  const [unitLabel, setUnitLabel] = useState('reaction');

  const [send, setSend] = useState<ActionResult | { ok: 'idle' } | { ok: 'sending' }>({ ok: 'idle' });
  const [doneMsg, setDoneMsg] = useState('');

  const paired = !!pairing;

  // Pull the inventory snapshot on mount when paired.
  useEffect(() => {
    let cancelled = false;
    if (!pairing) {
      setSync({ kind: 'empty' });
      return;
    }
    (async () => {
      setSync({ kind: 'loading' });
      try {
        const data = (await fetchSnapshot(
          'inventory',
          pairing,
          signWithDevice,
        )) as InventorySnapshot | null;
        if (cancelled) return;
        setSnap(data);
        setSync(data ? { kind: 'ready' } : { kind: 'empty' });
      } catch (err) {
        if (cancelled) return;
        setSync({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Could not sync inventory.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pairing]);

  const resolve = useCallback(
    (raw: string) => {
      const c = raw.trim();
      if (!c) return;
      buzz();
      setCode(c);
      setSend({ ok: 'idle' });
      // Layer 2: parse the payload (GS1-128 AIs, or a plain UPC/EAN normalized to
      // a canonical GTIN). Layer 1: match the lab's own tracked stock by GTIN so
      // a UPC-A stored item still matches an EAN-13 scan of the same product, and
      // a GS1-128 box matches by its embedded GTIN. Non-GTIN catalog codes fall
      // back to the exact-string match they always used.
      const info = parseBarcode(c);
      setParsed(info);
      const stocks = Array.isArray(snap?.trackedStocks) ? snap!.trackedStocks! : [];
      const hit = stocks.find((s) => barcodesMatch(s.productBarcode, c));
      if (hit) {
        setTracked(hit);
        setDeductQty(1);
        setStep('tracked');
        return;
      }
      // Unknown, prefill the new-package guess from the barcode index (try the
      // canonical GTIN first, then the raw code).
      const guess =
        (info.gtin14 ? snap?.barcodeIndex?.[info.gtin14] : undefined) ?? snap?.barcodeIndex?.[c];
      if (guess) {
        setUnitLabel('reaction');
      }
      setStep('newpkg');
    },
    [snap],
  );

  const onBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (handled || !result?.data) return;
      setHandled(true);
      resolve(result.data);
    },
    [handled, resolve],
  );

  const restart = useCallback(() => {
    setStep('scan');
    setHandled(false);
    setManualCode('');
    setCode('');
    setParsed(null);
    setTracked(null);
    setTrackCtx(null);
    setArrivedLabel(null);
    setDeductQty(1);
    setUnitsPerScan(1);
    setTotalInBox('');
    setUnitLabel('reaction');
    setSend({ ok: 'idle' });
    setDoneMsg('');
  }, []);

  const run = useCallback(
    async (fn: () => Promise<ActionResult>, successMsg: string) => {
      if (!pairing) return;
      setSend({ ok: 'sending' });
      const res = await fn();
      setSend(res);
      if (res.ok === true) {
        setDoneMsg(successMsg);
        setStep('done');
      }
    },
    [pairing],
  );

  // --- match path -----------------------------------------------------------
  const onPickPurchase = useCallback(
    async (p: RecentPurchase) => {
      if (!pairing || p.purchaseItemId == null) return;
      buzz(Haptics.ImpactFeedbackStyle.Medium);
      setSend({ ok: 'sending' });
      const res = await markArrived(
        { purchaseItemId: p.purchaseItemId },
        p.name ?? 'Package',
        pairing,
        signWithDevice,
      );
      setSend(res);
      if (res.ok === true) {
        setArrivedLabel(p.name ?? 'Package');
        setTrackCtx({ kind: 'purchase', purchase: p });
        setUnitLabel('reaction');
        setUnitsPerScan(1);
        setTotalInBox('');
        setStep('track');
      }
    },
    [pairing],
  );

  // --- deduct ---------------------------------------------------------------
  const onDeduct = useCallback(() => {
    if (!tracked) return;
    buzz(Haptics.ImpactFeedbackStyle.Medium);
    const label = tracked.itemName ?? 'item';
    void run(
      () =>
        deductUnits(
          {
            stockId: tracked.stockId,
            productBarcode: tracked.productBarcode ?? code,
            amount: deductQty,
          },
          `Used ${deductQty} ${tracked.unitLabel ?? 'unit'}${deductQty === 1 ? '' : 's'} of ${label}`,
          pairing!,
          signWithDevice,
        ),
      `Deducted ${deductQty} ${tracked.unitLabel ?? 'unit'}${deductQty === 1 ? '' : 's'}`,
    );
  }, [tracked, code, deductQty, run, pairing]);

  const onReorder = useCallback(() => {
    if (!tracked || tracked.purchaseItemId == null) return;
    buzz(Haptics.ImpactFeedbackStyle.Medium);
    void run(
      () =>
        reorderFromPurchase(
          { purchaseItemId: tracked.purchaseItemId! },
          `Reorder ${tracked.itemName ?? 'item'}`,
          pairing!,
          signWithDevice,
        ),
      'Reorder added to purchasing',
    );
  }, [tracked, run, pairing]);

  // --- track step confirm ---------------------------------------------------
  const onStartTracking = useCallback(() => {
    if (!trackCtx || !pairing) return;
    const total = Number.parseInt(totalInBox, 10);
    const totalUnits = Number.isFinite(total) && total > 0 ? total : unitsPerScan;
    buzz(Haptics.ImpactFeedbackStyle.Medium);
    if (trackCtx.kind === 'purchase') {
      void run(
        () =>
          registerTracker(
            {
              purchaseItemId: trackCtx.purchase.purchaseItemId,
              productBarcode: code,
              unitsPerScan,
              totalUnits,
              unitLabel,
            },
            `Track ${trackCtx.purchase.name ?? 'item'}`,
            pairing,
            signWithDevice,
          ),
        `Now tracking ${trackCtx.purchase.name ?? 'this item'}`,
      );
    } else {
      const fn = trackCtx.mode === 'purchase' ? createPurchase : createInventory;
      void run(
        () =>
          fn(
            {
              name: trackCtx.name,
              vendor: trackCtx.vendor,
              catalog: trackCtx.catalog,
              productBarcode: code,
              quantity: trackCtx.quantity,
              unitsPerScan,
              totalUnits,
              unitLabel,
            },
            trackCtx.name,
            pairing,
            signWithDevice,
          ),
        `Saved and tracking ${trackCtx.name}`,
      );
    }
  }, [trackCtx, pairing, totalInBox, unitsPerScan, unitLabel, code, run]);

  // "No thanks", apply the create/arrival without tracking.
  const onSkipTracking = useCallback(() => {
    if (!trackCtx || !pairing) return;
    if (trackCtx.kind === 'purchase') {
      // The purchase was already marked arrived when picked. Nothing more to do.
      setDoneMsg(`${trackCtx.purchase.name ?? 'Package'} marked arrived`);
      setStep('done');
      return;
    }
    const fn = trackCtx.mode === 'purchase' ? createPurchase : createInventory;
    void run(
      () =>
        fn(
          {
            name: trackCtx.name,
            vendor: trackCtx.vendor,
            catalog: trackCtx.catalog,
            productBarcode: code,
            quantity: trackCtx.quantity,
          },
          trackCtx.name,
          pairing,
          signWithDevice,
        ),
      trackCtx.mode === 'purchase' ? `Order saved for ${trackCtx.name}` : `${trackCtx.name} added to inventory`,
    );
  }, [trackCtx, pairing, code, run]);

  // Enter the create flow (add new PO / add inventory), prefilled from the guess.
  const startCreate = useCallback(
    (mode: CreateMode) => {
      const guess = snap?.barcodeIndex?.[code];
      buzz();
      setTrackCtx({
        kind: 'create',
        mode,
        name: guess?.name ?? '',
        vendor: guess?.vendor ?? null,
        catalog: guess?.catalog ?? null,
        quantity: 1,
      });
      setArrivedLabel(guess?.name ?? null);
      setUnitsPerScan(1);
      setTotalInBox('');
      setUnitLabel('reaction');
      setStep('track');
    },
    [snap, code],
  );

  const sending = send.ok === 'sending';
  const errorMsg = send.ok === false ? send.error : null;
  const cameraReady = paired && permission?.granted === true && step === 'scan' && !handled;

  return (
    <ScreenFrame>
      <ScreenHeader />
      <ScrollView style={styles.fill} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Not paired */}
          {!paired ? (
            <EmptyState
              icon="barcode-outline"
              text="Pair this phone from Today to scan packages and track inventory."
            />
          ) : null}

          {/* Camera permission */}
          {paired && permission && !permission.granted ? (
            <Card style={{ gap: spacing.sm }}>
              <ThemedText style={[styles.h, { color: surface.text }]}>Camera access needed</ThemedText>
              <ThemedText style={[styles.sub, { color: surface.muted }]}>
                ResearchOS uses the camera to scan package barcodes.
              </ThemedText>
              <Button variant="primary" label="Allow camera" onPress={requestPermission} />
            </Card>
          ) : null}

          {/* Step, scan */}
          {paired && step === 'scan' ? (
            <View style={{ gap: spacing.lg }}>
              <ThemedText type="title">Scan a package</ThemedText>
              <SyncLine sync={sync} />
              {cameraReady ? (
                <View style={[styles.cameraWrap, { borderRadius: radii.lg }]}>
                  <CameraView
                    style={StyleSheet.absoluteFill}
                    facing="back"
                    onBarcodeScanned={onBarcodeScanned}
                    barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
                  />
                  <View style={styles.reticle} pointerEvents="none">
                    <View style={[styles.corner, styles.c1]} />
                    <View style={[styles.corner, styles.c2]} />
                    <View style={[styles.corner, styles.c3]} />
                    <View style={[styles.corner, styles.c4]} />
                    <View style={styles.scanline} />
                  </View>
                  <View style={styles.scanHint} pointerEvents="none">
                    <ThemedText style={styles.scanHintText}>Point at the package barcode</ThemedText>
                  </View>
                </View>
              ) : null}
              <Card style={{ gap: spacing.sm }}>
                <ThemedText style={[styles.fieldLabelLg, { color: surface.text }]}>Enter a code by hand</ThemedText>
                <TextInput
                  value={manualCode}
                  onChangeText={setManualCode}
                  onFocus={() => setManualFocus(true)}
                  onBlur={() => setManualFocus(false)}
                  placeholder="Barcode"
                  placeholderTextColor={surface.placeholder}
                  style={[
                    styles.input,
                    styles.mono,
                    {
                      backgroundColor: manualFocus ? surface.surface : surface.surface2,
                      borderColor: manualFocus ? palette.sky : surface.borderStrong,
                      borderRadius: radii.md,
                      color: surface.text,
                    },
                    manualFocus ? focusRing(dark) : null,
                  ]}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Button
                  variant="secondary"
                  label="Look up code"
                  onPress={() => {
                    if (manualCode.trim()) {
                      setHandled(true);
                      resolve(manualCode);
                    }
                  }}
                />
              </Card>
            </View>
          ) : null}

          {/* Step, tracked item deduct */}
          {paired && step === 'tracked' && tracked ? (
            <DeductView
              tracked={tracked}
              qty={deductQty}
              setQty={setDeductQty}
              onDeduct={onDeduct}
              onReorder={onReorder}
              onCancel={restart}
              sending={sending}
              errorMsg={errorMsg}
            />
          ) : null}

          {/* Step, new package */}
          {paired && step === 'newpkg' ? (
            <NewPackageView
              code={code}
              parsed={parsed}
              guess={snap?.barcodeIndex?.[code]}
              purchases={Array.isArray(snap?.recentPurchases) ? snap!.recentPurchases! : []}
              onPick={onPickPurchase}
              onAddPurchase={() => startCreate('purchase')}
              onAddInventory={() => startCreate('inventory')}
              onCancel={restart}
              sending={sending}
              errorMsg={errorMsg}
            />
          ) : null}

          {/* Step, track this barcode */}
          {paired && step === 'track' && trackCtx ? (
            <TrackView
              title={arrivedLabel}
              isArrived={trackCtx.kind === 'purchase'}
              unitsPerScan={unitsPerScan}
              setUnitsPerScan={setUnitsPerScan}
              totalInBox={totalInBox}
              setTotalInBox={setTotalInBox}
              unitLabel={unitLabel}
              setUnitLabel={setUnitLabel}
              onStart={onStartTracking}
              onSkip={onSkipTracking}
              sending={sending}
              errorMsg={errorMsg}
            />
          ) : null}

          {/* Step, done */}
          {paired && step === 'done' ? (
            <DoneView message={doneMsg} onAgain={restart} />
          ) : null}
      </ScrollView>
    </ScreenFrame>
  );
}

// ---------------------------------------------------------------------------
// Sub-views
// ---------------------------------------------------------------------------
function SyncLine({ sync }: { sync: Sync }) {
  const { surface } = useTheme();
  if (sync.kind === 'loading')
    return <ThemedText style={[styles.sub, { color: surface.muted }]}>Syncing inventory...</ThemedText>;
  if (sync.kind === 'error')
    return <ThemedText style={[styles.sub, { color: palette.danger }]}>{sync.message}</ThemedText>;
  if (sync.kind === 'empty')
    return (
      <ThemedText style={[styles.sub, { color: surface.muted }]}>
        No inventory synced yet. Open ResearchOS on your laptop. You can still scan to receive a package.
      </ThemedText>
    );
  return null;
}

function DeductView({
  tracked,
  qty,
  setQty,
  onDeduct,
  onReorder,
  onCancel,
  sending,
  errorMsg,
}: {
  tracked: TrackedStock;
  qty: number;
  setQty: (n: number) => void;
  onDeduct: () => void;
  onReorder: () => void;
  onCancel: () => void;
  sending: boolean;
  errorMsg: string | null;
}) {
  const { surface, spacing, radii } = useTheme();
  const unit = tracked.unitLabel ?? 'unit';
  const remaining = typeof tracked.unitsRemaining === 'number' ? tracked.unitsRemaining : undefined;
  const total = typeof tracked.totalUnits === 'number' ? tracked.totalUnits : undefined;
  const plural = qty === 1 ? unit : `${unit}s`;
  const low =
    tracked.lowAtCount != null && remaining != null && remaining <= tracked.lowAtCount;
  const ratio = total != null && total > 0 && remaining != null ? remaining / total : 1;
  const code = tracked.productBarcode ?? null;
  return (
    <View style={{ gap: spacing.md }}>
      {/* Color hero with glowing line, count, and a stock bar (contract 2). */}
      <Card style={styles.heroCard} compact>
        <GradientHero
          icon="cube-outline"
          title={tracked.itemName ?? 'Tracked item'}
          code={code ? formatCode(code) : tracked.vendor ?? null}
        />
        <GlowLine />
        <View style={styles.heroBody}>
          <View style={styles.countRow}>
            <View style={styles.countLine}>
              <ThemedText style={[styles.bigNum, { color: surface.text }]}>
                {remaining != null ? remaining : '–'}
              </ThemedText>
              {total != null ? (
                <ThemedText style={[styles.countUnit, { color: surface.muted }]}>
                  {' '}/ {total} {unit}s
                </ThemedText>
              ) : (
                <ThemedText style={[styles.countUnit, { color: surface.muted }]}> {unit}s</ThemedText>
              )}
            </View>
            <View
              style={[
                styles.pill,
                { backgroundColor: low ? palette.dangerDim : palette.successDim },
              ]}
            >
              <ThemedText
                style={[styles.pillText, { color: low ? palette.danger : palette.success }]}
              >
                {low ? 'Low' : 'In stock'}
              </ThemedText>
            </View>
          </View>
          {total != null ? <StockBar ratio={ratio} low={low} /> : null}
        </View>
      </Card>

      <ThemedText style={[styles.sectionLabel, { color: surface.faint }]}>HOW MANY DID YOU USE?</ThemedText>
      <View style={styles.chips}>
        {QTY_CHIPS.map((n) => {
          const on = qty === n;
          return (
            <Pressable
              key={n}
              onPress={() => setQty(n)}
              style={[
                styles.chip,
                {
                  backgroundColor: on ? palette.sky : surface.surface,
                  borderColor: on ? palette.sky : surface.border,
                  borderRadius: radii.pill,
                },
              ]}
            >
              <ThemedText style={[styles.chipText, { color: on ? palette.white : surface.muted }]}>{n}</ThemedText>
            </Pressable>
          );
        })}
      </View>

      <Button variant="primary" label={`Deduct ${qty} ${plural}`} loading={sending} disabled={sending} onPress={onDeduct} />
      {tracked.purchaseItemId != null ? (
        <Pressable
          onPress={onReorder}
          disabled={sending}
          style={({ pressed }) => [
            styles.dangerBtn,
            {
              backgroundColor: palette.dangerDim,
              borderColor: palette.dangerBorder,
              borderRadius: radii.md,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons name="alert-circle-outline" size={18} color={palette.danger} />
          <ThemedText style={styles.dangerLabel}>Low, reorder ASAP</ThemedText>
        </Pressable>
      ) : null}
      {errorMsg ? <ThemedText style={[styles.err]}>{errorMsg}</ThemedText> : null}
      <Button variant="ghost" label="Cancel" onPress={onCancel} />
    </View>
  );
}

function NewPackageView({
  code,
  parsed,
  guess,
  purchases,
  onPick,
  onAddPurchase,
  onAddInventory,
  onCancel,
  sending,
  errorMsg,
}: {
  code: string;
  parsed?: ParsedBarcode | null;
  guess?: { name?: string; vendor?: string | null; catalog?: string | null };
  purchases: RecentPurchase[];
  onPick: (p: RecentPurchase) => void;
  onAddPurchase: () => void;
  onAddInventory: () => void;
  onCancel: () => void;
  sending: boolean;
  errorMsg: string | null;
}) {
  const { surface, spacing, radii } = useTheme();
  const guessName = guess?.name;
  const hasParsed =
    !!parsed && (!!parsed.gtin14 || !!parsed.ai.lot || !!parsed.ai.expiry || !!parsed.ai.serial);
  return (
    <View style={{ gap: spacing.md }}>
      <ThemedText type="title">New barcode</ThemedText>

      {/* Contract: amber "not recognized" callout when unknown; a sky
          prefill callout when the barcode index gave us a head start. */}
      {guessName ? (
        <Callout tone="sky" icon="sparkles-outline">
          <ThemedText style={styles.calloutLead}>{guessName}</ThemedText>
          {guess?.vendor ? `  ·  ${guess.vendor}` : ''}. We will prefill the details, you confirm.
        </Callout>
      ) : (
        <Callout tone="amber">
          <ThemedText style={[styles.calloutLead, { color: palette.amber }]}>Not recognized. </ThemedText>
          {formatCode(code)}. What is it?
        </Callout>
      )}

      {hasParsed ? (
        <Card compact style={{ gap: spacing.sm }}>
          {parsed!.gtin14 ? (
            <DetailRow
              label="GTIN"
              value={`${parsed!.gtin14}${parsed!.region ? `  ·  ${parsed!.region}` : ''}`}
              mono
            />
          ) : null}
          {parsed!.ai.lot ? <DetailRow label="Lot" value={parsed!.ai.lot} mono /> : null}
          {parsed!.ai.expiry ? <DetailRow label="Expires" value={parsed!.ai.expiry} /> : null}
          {parsed!.ai.serial ? <DetailRow label="Serial" value={parsed!.ai.serial} mono /> : null}
        </Card>
      ) : null}

      {purchases.length > 0 ? (
        <>
          <ThemedText style={[styles.sectionLabel, { color: surface.faint }]}>MATCH TO A RECENT ORDER</ThemedText>
          <Card style={styles.listCard}>
            {purchases.map((p, i) => {
              const likely =
                (!!guessName && p.name === guessName) || barcodesMatch(p.productBarcode, code);
              const last = i === purchases.length - 1;
              return (
                <Pressable
                  key={String(p.purchaseItemId ?? i)}
                  onPress={() => onPick(p)}
                  disabled={sending}
                  style={({ pressed }) => [
                    styles.matchRow,
                    { borderBottomColor: surface.hairline },
                    last ? { borderBottomWidth: 0 } : null,
                    pressed ? { opacity: 0.7 } : null,
                  ]}
                >
                  <View
                    style={[
                      styles.thumb,
                      likely
                        ? { backgroundColor: palette.successDim, borderColor: 'transparent' }
                        : { backgroundColor: palette.skyDim, borderColor: palette.skyBorder },
                    ]}
                  >
                    <Ionicons
                      name="receipt-outline"
                      size={18}
                      color={likely ? palette.success : palette.sky}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <ThemedText style={[styles.rowTitle, { color: surface.text }]} numberOfLines={1}>
                      {p.name ?? 'Order'}
                    </ThemedText>
                    <ThemedText style={[styles.rowMeta, { color: surface.muted }]} numberOfLines={1}>
                      {[p.vendor, p.orderedDate ? `ordered ${formatShort(p.orderedDate)}` : null]
                        .filter(Boolean)
                        .join('  ·  ')}
                    </ThemedText>
                  </View>
                  {likely ? (
                    <View style={[styles.pill, { backgroundColor: palette.successDim }]}>
                      <ThemedText style={[styles.pillText, { color: palette.success }]}>likely</ThemedText>
                    </View>
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={surface.faint} />
                  )}
                </Pressable>
              );
            })}
          </Card>
        </>
      ) : (
        <ThemedText style={[styles.sub, { color: surface.muted }]}>No recent orders awaiting arrival.</ThemedText>
      )}

      <ThemedText style={[styles.sectionLabel, { color: surface.faint }]}>OR ADD IT YOURSELF</ThemedText>
      {/* Contract sheet-opt rows: icon tile + label + sub, one tap each. */}
      <SheetOption
        icon="add-circle-outline"
        tint="violet"
        label="Add a purchase item"
        sub="Order and track at once"
        onPress={onAddPurchase}
        disabled={sending}
      />
      <SheetOption
        icon="cube-outline"
        tint="success"
        label="Just track in stock"
        sub="Add to inventory only"
        onPress={onAddInventory}
        disabled={sending}
      />
      {errorMsg ? <ThemedText style={styles.err}>{errorMsg}</ThemedText> : null}
      <Button variant="ghost" label="Cancel" onPress={onCancel} />
    </View>
  );
}

// A labelled key/value row (contract .kv) used for parsed barcode details.
function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const { surface } = useTheme();
  return (
    <View style={styles.kv}>
      <ThemedText style={[styles.kvKey, { color: surface.muted }]}>{label}</ThemedText>
      <ThemedText
        style={[styles.kvVal, { color: surface.text }, mono ? styles.mono : null]}
        numberOfLines={1}
      >
        {value}
      </ThemedText>
    </View>
  );
}

// Contract .sheet-opt: an icon-tile action row inside a card surface.
function SheetOption({
  icon,
  tint,
  label,
  sub,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: 'sky' | 'violet' | 'success';
  label: string;
  sub: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { surface, radii } = useTheme();
  const accent =
    tint === 'violet' ? palette.violet : tint === 'success' ? palette.success : palette.sky;
  const bg =
    tint === 'violet' ? palette.violetDim : tint === 'success' ? palette.successDim : palette.skyDim;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
    >
      <Card compact style={styles.sheetOpt}>
        <View style={[styles.sheetIcon, { backgroundColor: bg }]}>
          <Ionicons name={icon} size={20} color={accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <ThemedText style={[styles.rowTitle, { color: surface.text }]}>{label}</ThemedText>
          <ThemedText style={[styles.rowMeta, { color: surface.muted }]}>{sub}</ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={surface.faint} />
      </Card>
    </Pressable>
  );
}

function TrackView({
  title,
  isArrived,
  unitsPerScan,
  setUnitsPerScan,
  totalInBox,
  setTotalInBox,
  unitLabel,
  setUnitLabel,
  onStart,
  onSkip,
  sending,
  errorMsg,
}: {
  title: string | null;
  isArrived: boolean;
  unitsPerScan: number;
  setUnitsPerScan: (n: number) => void;
  totalInBox: string;
  setTotalInBox: (s: string) => void;
  unitLabel: string;
  setUnitLabel: (s: string) => void;
  onStart: () => void;
  onSkip: () => void;
  sending: boolean;
  errorMsg: string | null;
}) {
  const { surface, spacing, radii, dark } = useTheme();
  const [totalFocus, setTotalFocus] = useState(false);
  const perScanText = unitsPerScan === 1 ? `1 ${unitLabel}` : `${unitsPerScan} ${unitLabel}s`;
  return (
    <View style={{ gap: spacing.md }}>
      {isArrived ? (
        <View style={{ alignItems: 'center', gap: spacing.sm }}>
          <View style={styles.okBadge}>
            <Ionicons name="checkmark" size={34} color={palette.success} />
          </View>
          <ThemedText type="title">Marked arrived</ThemedText>
        </View>
      ) : (
        <ThemedText type="title">Track this item</ThemedText>
      )}
      {title ? <ThemedText style={[styles.sub, { color: surface.muted, textAlign: 'center' }]}>{title}</ThemedText> : null}

      <ThemedText style={[styles.sectionLabel, { color: surface.faint }]}>TRACK THIS BARCODE?</ThemedText>
      <Card style={{ gap: spacing.lg }}>
        <View>
          <ThemedText style={[styles.fieldLabel, { color: surface.muted }]}>Counts as</ThemedText>
          <View style={styles.chips}>
            {UNIT_CHIPS.map((u) => {
              const on = unitLabel === u;
              return (
                <Pressable
                  key={u}
                  onPress={() => setUnitLabel(u)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: on ? palette.sky : surface.surface,
                      borderColor: on ? palette.sky : surface.border,
                      borderRadius: radii.pill,
                    },
                  ]}
                >
                  <ThemedText style={[styles.chipText, { color: on ? palette.white : surface.muted }]}>{u}</ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.calcRow}>
          <View style={styles.field}>
            <ThemedText style={[styles.fieldLabel, { color: surface.muted }]}>One scan uses</ThemedText>
            <View style={[styles.stepperBox, { borderWidth: 1, borderColor: surface.borderStrong }]}>
              <Pressable
                onPress={() => setUnitsPerScan(Math.max(1, unitsPerScan - 1))}
                style={[styles.stepBtn, { backgroundColor: surface.surface2, borderRightWidth: 1, borderRightColor: surface.border }]}
              >
                <Ionicons name="remove" size={18} color={palette.sky} />
              </Pressable>
              <ThemedText style={[styles.stepVal, { color: surface.text }]}>{unitsPerScan}</ThemedText>
              <Pressable
                onPress={() => setUnitsPerScan(unitsPerScan + 1)}
                style={[styles.stepBtn, { backgroundColor: surface.surface2, borderLeftWidth: 1, borderLeftColor: surface.border }]}
              >
                <Ionicons name="add" size={18} color={palette.sky} />
              </Pressable>
            </View>
          </View>
          <View style={styles.field}>
            <ThemedText style={[styles.fieldLabel, { color: surface.muted }]}>Total in box</ThemedText>
            <TextInput
              value={totalInBox}
              onChangeText={(t) => setTotalInBox(t.replace(/[^0-9]/g, ''))}
              onFocus={() => setTotalFocus(true)}
              onBlur={() => setTotalFocus(false)}
              placeholder="50"
              placeholderTextColor={surface.placeholder}
              keyboardType="number-pad"
              style={[
                styles.numInput,
                styles.mono,
                {
                  backgroundColor: totalFocus ? surface.surface : surface.surface2,
                  borderColor: totalFocus ? palette.sky : surface.borderStrong,
                  borderRadius: radii.md,
                  color: surface.text,
                },
                totalFocus ? focusRing(dark) : null,
              ]}
            />
          </View>
        </View>
      </Card>

      <Callout tone="sky">
        Each scan deducts <ThemedText style={styles.calloutLead}>{perScanText}</ThemedText>. We will warn you when it runs low.
      </Callout>

      <Button variant="primary" label="Start tracking" loading={sending} disabled={sending} onPress={onStart} />
      <Button variant="secondary" label="No thanks" onPress={onSkip} disabled={sending} />
      {errorMsg ? <ThemedText style={styles.err}>{errorMsg}</ThemedText> : null}
    </View>
  );
}

function DoneView({ message, onAgain }: { message: string; onAgain: () => void }) {
  const { surface, spacing } = useTheme();
  return (
    <View style={{ gap: spacing.lg, alignItems: 'center', paddingTop: spacing['3xl'] }}>
      <View style={styles.successCheck}>
        <Ionicons name="checkmark" size={42} color={palette.success} />
      </View>
      <ThemedText type="title" style={{ textAlign: 'center' }}>{message || 'Done'}</ThemedText>
      <ThemedText style={[styles.sub, { color: surface.muted, textAlign: 'center', maxWidth: 260 }]}>
        Synced to your lab. Your laptop will apply it on its next check.
      </ThemedText>
      <View style={{ alignSelf: 'stretch' }}>
        <Button variant="primary" label="Scan another" onPress={onAgain} />
      </View>
    </View>
  );
}

function formatShort(value?: string): string {
  if (!value) return '';
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Light cosmetic grouping for a scanned code, e.g. an EAN-13 into 1 6 6 groups
// so it reads like the contract's "EAN 4 047649 123456". Falls back verbatim.
function formatCode(code: string): string {
  const c = code.trim();
  if (/^\d{13}$/.test(c)) return `EAN ${c[0]} ${c.slice(1, 7)} ${c.slice(7)}`;
  if (/^\d{12}$/.test(c)) return `UPC ${c.slice(0, 6)} ${c.slice(6)}`;
  return c;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40, gap: 16 },
  h: { fontSize: 16, fontFamily: fonts.bold, fontWeight: '700', lineHeight: 22 },
  sub: { fontSize: 14, fontFamily: fonts.ui, lineHeight: 20 },
  mono: { fontFamily: fonts.mono },
  sectionLabel: {
    fontSize: 12,
    fontFamily: fonts.bold,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    lineHeight: 16,
    marginTop: 2,
    marginBottom: -4,
    paddingHorizontal: 2,
  },

  // Inputs (contract .input / .input.focus). Focus ring spread on via focusRing().
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    minHeight: 48,
  },
  numInput: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
    textAlign: 'right',
  },
  fieldLabelLg: { fontSize: 15, fontFamily: fonts.semibold, fontWeight: '600', lineHeight: 20 },

  // Camera viewfinder (contract .scanframe): white corner brackets + a glowing
  // sky scanline, with a centered hint line below.
  cameraWrap: { width: '100%', aspectRatio: 3 / 4, overflow: 'hidden', backgroundColor: '#000000' },
  reticle: { position: 'absolute', top: '32%', left: '16%', right: '16%', bottom: '38%' },
  corner: { position: 'absolute', width: 30, height: 30, borderColor: '#ffffff', opacity: 0.95 },
  c1: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 9 },
  c2: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 9 },
  c3: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 9 },
  c4: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 9 },
  scanline: {
    position: 'absolute',
    left: '7%',
    right: '7%',
    top: '50%',
    height: 2,
    backgroundColor: palette.sky,
    shadowColor: palette.sky,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 7,
    elevation: 0,
  },
  scanHint: { position: 'absolute', left: 0, right: 0, bottom: '14%', alignItems: 'center' },
  scanHintText: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13.5,
    fontFamily: fonts.semibold,
    fontWeight: '600',
  },

  // Gradient hero (contract deduct/match hero card).
  heroCard: { padding: 0, overflow: 'hidden', gap: 0 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 18, paddingVertical: 16 },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEyebrow: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 10.5,
    fontFamily: fonts.bold,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  heroTitle: { color: palette.white, fontSize: 17, fontFamily: fonts.bold, fontWeight: '700', lineHeight: 22 },
  heroCode: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    fontFamily: fonts.mono,
    marginTop: 2,
  },
  heroBody: { paddingHorizontal: 16, paddingTop: 13, paddingBottom: 15, gap: 9 },

  // Glowing seam line between hero and body.
  glowlineWrap: { height: 2, width: '100%' },
  glowline: { flex: 1, height: 2 },

  // Big mono count line (contract .bigcount): remaining / total unit.
  countRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  countLine: { flexDirection: 'row', alignItems: 'baseline' },
  bigNum: { fontSize: 32, fontFamily: fonts.monoSemibold, fontWeight: '600', letterSpacing: -0.6, lineHeight: 36 },
  countUnit: { fontSize: 14, fontFamily: fonts.medium, fontWeight: '500', lineHeight: 20 },

  // Stock bar (contract .stockbar / .fill).
  stockbar: { height: 10, borderRadius: 999, overflow: 'hidden' },
  stockfill: { height: '100%', borderRadius: 999 },

  // Chips (contract .ch / .ch.on): pill, 1px border, sky-fill when active.
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    minWidth: 44,
    paddingHorizontal: 16,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontFamily: fonts.semibold, fontWeight: '600' },

  // Reorder danger button (contract: tinted, bordered, danger label + icon).
  dangerBtn: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    borderWidth: 1,
  },
  dangerLabel: { color: palette.danger, fontFamily: fonts.semibold, fontWeight: '700', fontSize: 15 },

  // Callout (contract .callout): tinted inset, accent lead word.
  callout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  calloutText: { flex: 1, fontSize: 13, fontFamily: fonts.ui, lineHeight: 19 },
  calloutLead: { fontFamily: fonts.semibold, fontWeight: '700', color: palette.sky },

  // Match-order list rows + new-item detail card.
  listCard: { padding: 0, paddingHorizontal: 14 },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 15, fontFamily: fonts.semibold, fontWeight: '600', lineHeight: 20 },
  rowMeta: { fontSize: 12.5, fontFamily: fonts.ui, lineHeight: 17, marginTop: 2 },
  pill: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999 },
  pillText: { fontSize: 11.5, fontFamily: fonts.bold, fontWeight: '700' },

  // Key/value detail rows (contract .kv).
  kv: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  kvKey: { fontSize: 13, fontFamily: fonts.ui },
  kvVal: { fontSize: 13.5, fontFamily: fonts.semibold, fontWeight: '600', flexShrink: 1, textAlign: 'right' },

  // Sheet option rows (contract .sheet-opt).
  sheetOpt: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  sheetIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Track-step fields (contract .field + .calc-row + .stepper).
  calcRow: { flexDirection: 'row', gap: 12 },
  field: { flex: 1, gap: 7 },
  fieldLabel: { fontSize: 12, fontFamily: fonts.semibold, fontWeight: '600', lineHeight: 16, marginBottom: 7 },
  stepperBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: globalRadii.md,
    overflow: 'hidden',
    height: 48,
  },
  stepBtn: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  stepVal: { flex: 1, textAlign: 'center', fontSize: 18, fontFamily: fonts.monoSemibold, fontWeight: '600' },

  // Success states.
  okBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: palette.successDim, alignItems: 'center', justifyContent: 'center' },
  successCheck: { width: 84, height: 84, borderRadius: 42, backgroundColor: palette.successDim, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  err: { color: palette.danger, fontSize: 14, fontFamily: fonts.ui, lineHeight: 20 },
});
