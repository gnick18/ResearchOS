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
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
import { useTheme, palette } from '@/lib/design';
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

export default function ScanScreen() {
  const { pairing } = usePairing();
  const { surface, spacing, radii } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();

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
                  </View>
                </View>
              ) : null}
              <Card style={{ gap: spacing.sm }}>
                <ThemedText style={[styles.h, { color: surface.text }]}>Enter a code by hand</ThemedText>
                <TextInput
                  value={manualCode}
                  onChangeText={setManualCode}
                  placeholder="Barcode"
                  placeholderTextColor={surface.placeholder}
                  style={[styles.input, { backgroundColor: surface.surface, borderColor: surface.border, borderRadius: radii.md, color: surface.text }]}
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
  return (
    <View style={{ gap: spacing.md }}>
      <ThemedText type="title">{tracked.itemName ?? 'Tracked item'}</ThemedText>
      <ThemedText style={[styles.sub, { color: surface.muted }]}>
        {remaining != null ? `${remaining}${total != null ? ` of ${total}` : ''} ${unit}s left` : `${tracked.vendor ?? ''}`}
      </ThemedText>

      <Card style={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg }}>
        <ThemedText style={[styles.sub, { color: surface.muted, fontWeight: '600' }]}>Use how many?</ThemedText>
        <View style={styles.qtyRow}>
          <Pressable onPress={() => setQty(Math.max(1, qty - 1))} style={[styles.qBtn, { backgroundColor: surface.sunken }]}>
            <Ionicons name="remove" size={22} color={palette.sky} />
          </Pressable>
          <ThemedText style={[styles.bigNum, { color: surface.text }]}>{qty}</ThemedText>
          <Pressable onPress={() => setQty(qty + 1)} style={[styles.qBtn, { backgroundColor: surface.sunken }]}>
            <Ionicons name="add" size={22} color={palette.sky} />
          </Pressable>
        </View>
        <ThemedText style={[styles.sub, { color: surface.muted }]}>{plural}</ThemedText>
        <View style={styles.chips}>
          {QTY_CHIPS.map((n) => (
            <Pressable
              key={n}
              onPress={() => setQty(n)}
              style={[
                styles.chip,
                { backgroundColor: qty === n ? palette.sky : surface.sunken, borderRadius: radii.sm },
              ]}
            >
              <ThemedText style={{ color: qty === n ? palette.white : surface.muted, fontWeight: '700' }}>{n}</ThemedText>
            </Pressable>
          ))}
        </View>
      </Card>

      <Button variant="primary" label={`Deduct ${qty} ${plural}`} loading={sending} disabled={sending} onPress={onDeduct} />
      {tracked.purchaseItemId != null ? (
        <Pressable
          onPress={onReorder}
          disabled={sending}
          style={[styles.dangerBtn, { backgroundColor: palette.dangerLight, borderRadius: radii.md }]}
        >
          <ThemedText style={{ color: palette.danger, fontWeight: '700', fontSize: 16 }}>Low, reorder ASAP</ThemedText>
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
  return (
    <View style={{ gap: spacing.md }}>
      <ThemedText type="title">New package</ThemedText>
      {guessName ? (
        <View style={[styles.guess, { borderRadius: radii.lg }]}>
          <ThemedText style={styles.guessLabel}>From this barcode</ThemedText>
          <ThemedText style={[styles.guessName, { color: surface.text }]}>
            {guessName}
            {guess?.vendor ? `  -  ${guess.vendor}` : ''}
          </ThemedText>
          <ThemedText style={[styles.sub, { color: surface.muted }]}>we will prefill the details, you confirm</ThemedText>
        </View>
      ) : (
        <ThemedText style={[styles.sub, { color: surface.muted }]}>Scanned {code}</ThemedText>
      )}

      {parsed && (parsed.gtin14 || parsed.ai.lot || parsed.ai.expiry || parsed.ai.serial) ? (
        <View style={{ gap: 2 }}>
          {parsed.gtin14 ? (
            <ThemedText style={[styles.sub, { color: surface.muted }]}>
              GTIN {parsed.gtin14}
              {parsed.region ? `  -  ${parsed.region}` : ''}
            </ThemedText>
          ) : null}
          {parsed.ai.lot ? (
            <ThemedText style={[styles.sub, { color: surface.muted }]}>Lot {parsed.ai.lot}</ThemedText>
          ) : null}
          {parsed.ai.expiry ? (
            <ThemedText style={[styles.sub, { color: surface.muted }]}>Expires {parsed.ai.expiry}</ThemedText>
          ) : null}
          {parsed.ai.serial ? (
            <ThemedText style={[styles.sub, { color: surface.muted }]}>Serial {parsed.ai.serial}</ThemedText>
          ) : null}
        </View>
      ) : null}

      {purchases.length > 0 ? (
        <>
          <ThemedText style={[styles.sectionLabel, { color: surface.muted }]}>MATCH TO A RECENT ORDER</ThemedText>
          {purchases.map((p, i) => {
            const likely =
              (!!guessName && p.name === guessName) || barcodesMatch(p.productBarcode, code);
            return (
              <Pressable key={String(p.purchaseItemId ?? i)} onPress={() => onPick(p)} disabled={sending}>
                <Card compact style={styles.purchaseRow}>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={[styles.rowTitle, { color: surface.text }]} numberOfLines={1}>
                      {p.name ?? 'Order'}
                    </ThemedText>
                    <ThemedText style={[styles.rowMeta, { color: surface.muted }]}>
                      {[p.vendor, p.orderedDate ? `ordered ${formatShort(p.orderedDate)}` : null].filter(Boolean).join('  -  ')}
                    </ThemedText>
                  </View>
                  {likely ? (
                    <View style={[styles.pill, { backgroundColor: palette.successLight }]}>
                      <ThemedText style={{ color: palette.success, fontSize: 12, fontWeight: '700' }}>likely</ThemedText>
                    </View>
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={surface.muted} />
                  )}
                </Card>
              </Pressable>
            );
          })}
        </>
      ) : (
        <ThemedText style={[styles.sub, { color: surface.muted }]}>No recent orders awaiting arrival.</ThemedText>
      )}

      <Button variant="secondary" label="Add a new purchase order" onPress={onAddPurchase} disabled={sending} />
      <Button variant="secondary" label="Not a purchase, just add to inventory" onPress={onAddInventory} disabled={sending} />
      {errorMsg ? <ThemedText style={styles.err}>{errorMsg}</ThemedText> : null}
      <Button variant="ghost" label="Cancel" onPress={onCancel} />
    </View>
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
  const { surface, spacing, radii } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      {isArrived ? (
        <View style={{ alignItems: 'center', gap: spacing.sm }}>
          <View style={styles.okBadge}>
            <Ionicons name="checkmark" size={30} color={palette.success} />
          </View>
          <ThemedText type="title">Marked arrived</ThemedText>
        </View>
      ) : (
        <ThemedText type="title">Almost done</ThemedText>
      )}
      {title ? <ThemedText style={[styles.sub, { color: surface.muted, textAlign: 'center' }]}>{title}</ThemedText> : null}

      <ThemedText style={[styles.sectionLabel, { color: surface.muted }]}>TRACK THIS BARCODE?</ThemedText>
      <Card style={{ gap: spacing.md }}>
        <View style={styles.field}>
          <ThemedText style={[styles.fieldLabel, { color: surface.text }]}>One scan uses</ThemedText>
          <View style={styles.stepperInline}>
            <Pressable onPress={() => setUnitsPerScan(Math.max(1, unitsPerScan - 1))} style={[styles.qBtnSm, { backgroundColor: surface.sunken }]}>
              <Ionicons name="remove" size={18} color={palette.sky} />
            </Pressable>
            <ThemedText style={[styles.fieldValue, { color: surface.text }]}>{unitsPerScan}</ThemedText>
            <Pressable onPress={() => setUnitsPerScan(unitsPerScan + 1)} style={[styles.qBtnSm, { backgroundColor: surface.sunken }]}>
              <Ionicons name="add" size={18} color={palette.sky} />
            </Pressable>
          </View>
        </View>
        <View style={styles.field}>
          <ThemedText style={[styles.fieldLabel, { color: surface.text }]}>Total in box</ThemedText>
          <TextInput
            value={totalInBox}
            onChangeText={(t) => setTotalInBox(t.replace(/[^0-9]/g, ''))}
            placeholder="50"
            placeholderTextColor={surface.placeholder}
            keyboardType="number-pad"
            style={[styles.numInput, { backgroundColor: surface.surface, borderColor: surface.border, borderRadius: radii.sm, color: surface.text }]}
          />
        </View>
        <View>
          <ThemedText style={[styles.fieldLabel, { color: surface.text, marginBottom: spacing.sm }]}>Unit</ThemedText>
          <View style={styles.chips}>
            {UNIT_CHIPS.map((u) => (
              <Pressable
                key={u}
                onPress={() => setUnitLabel(u)}
                style={[styles.chip, { backgroundColor: unitLabel === u ? palette.sky : surface.sunken, borderRadius: radii.sm }]}
              >
                <ThemedText style={{ color: unitLabel === u ? palette.white : surface.muted, fontWeight: '600' }}>{u}</ThemedText>
              </Pressable>
            ))}
          </View>
        </View>
      </Card>

      <Button variant="primary" label="Start tracking" loading={sending} disabled={sending} onPress={onStart} />
      <Button variant="secondary" label="No thanks" onPress={onSkip} disabled={sending} />
      {errorMsg ? <ThemedText style={styles.err}>{errorMsg}</ThemedText> : null}
    </View>
  );
}

function DoneView({ message, onAgain }: { message: string; onAgain: () => void }) {
  const { surface, spacing } = useTheme();
  return (
    <View style={{ gap: spacing.lg, alignItems: 'center', paddingTop: spacing.xl }}>
      <View style={styles.okBadge}>
        <Ionicons name="checkmark" size={30} color={palette.success} />
      </View>
      <ThemedText type="title" style={{ textAlign: 'center' }}>{message || 'Done'}</ThemedText>
      <ThemedText style={[styles.sub, { color: surface.muted, textAlign: 'center' }]}>
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

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40, gap: 16 },
  h: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
  sub: { fontSize: 14, lineHeight: 20 },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
  input: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, minHeight: 48 },
  numInput: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, minWidth: 80, textAlign: 'right' },
  cameraWrap: { width: '100%', aspectRatio: 3 / 4, overflow: 'hidden', backgroundColor: '#000000' },
  reticle: { position: 'absolute', top: '33%', left: '18%', right: '18%', bottom: '33%' },
  corner: { position: 'absolute', width: 26, height: 26, borderColor: '#ffffff' },
  c1: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  c2: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  c3: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
  c4: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  bigNum: { fontSize: 64, fontWeight: '800', lineHeight: 70, minWidth: 70, textAlign: 'center' },
  qBtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  qBtnSm: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  chip: { minWidth: 44, paddingHorizontal: 12, paddingVertical: 9, alignItems: 'center' },
  dangerBtn: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  guess: { padding: 14, backgroundColor: palette.skyDim },
  guessLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, color: palette.sky, textTransform: 'uppercase' },
  guessName: { fontSize: 16, fontWeight: '700', marginTop: 2 },
  purchaseRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowTitle: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  rowMeta: { fontSize: 13, lineHeight: 18 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  field: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { fontSize: 15, fontWeight: '500' },
  fieldValue: { fontSize: 16, fontWeight: '700', minWidth: 28, textAlign: 'center' },
  stepperInline: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  okBadge: { width: 60, height: 60, borderRadius: 30, backgroundColor: palette.successLight, alignItems: 'center', justifyContent: 'center' },
  err: { color: palette.danger, fontSize: 14, lineHeight: 20 },
});
