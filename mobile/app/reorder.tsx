// v0 scan-to-reorder screen. Point the phone at a reagent box barcode, match it
// against the laptop-published inventory snapshot, and send a reorder request to
// the lab inbox over the encrypted relay. On a match the screen shows the item
// card with an "Add to reorder list" button. On no match it shows the raw code
// with a "Send reorder request anyway" button. A manual-code field runs the same
// lookup for boxes that will not scan. v0 only matches an item's existing
// product_barcode, it never sets a barcode from the phone. SDK 54 expo-camera:
// useCameraPermissions() for the grant, CameraView with onBarcodeScanned and
// barcodeScannerSettings.barcodeTypes for the multi-format scanner.
//
// Polished to UI contract 04 (reorder frame). The screen identity is reorder-
// danger (matches the scan flow's "Low, reorder ASAP" affordance and the
// contract's danger-dim thumb + Low pill). Vocabulary borrowed verbatim from the
// polished scan.tsx so the two halves of the same flow read identically: a
// bracketed camera reticle with a glowing sky scanline, a sky gradient hero for
// the matched item with a luminous glow-seam, .kv detail rows, a sky .callout
// routing note, and a contract .success-check sent state. House style: no
// em-dashes, no emojis, no mid-sentence colons.
import { useCallback, useEffect, useState } from 'react';
import {
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

import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useTheme, palette, fonts } from '@/lib/design';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { fetchSnapshot } from '@/lib/snapshots';
import { uploadReorder, type ReorderPayload } from '@/lib/reorder';

// The barcode formats we ask the scanner to detect. Confirmed against the SDK 54
// expo-camera doc BarcodeType union (every value below is a valid member).
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

// One inventory item as it appears in the "inventory" snapshot. Every field is
// tolerated missing so a laptop on an older shape never crashes the screen.
type InventoryItem = {
  id?: number;
  name?: string;
  category?: string;
  vendor?: string | null;
  catalog_number?: string | null;
  product_barcode?: string | null;
  low_at_count?: number | null;
  container_label?: string | null;
};

type InventorySnapshot = {
  generatedAt?: string;
  items?: InventoryItem[];
};

type SyncState =
  | { kind: 'loading' }
  | { kind: 'ready'; count: number; generatedAt?: string }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'failed'; error: string };

// What the user is currently looking at after a scan or manual lookup.
type ScanOutcome =
  | { kind: 'none' }
  | { kind: 'match'; item: InventoryItem; code: string }
  | { kind: 'nomatch'; code: string };

// Contract .input.focus: sky border + soft sky glow. Spread onto a focused
// input. Reads a touch hotter on dark, matching scan.tsx / add-purchase.tsx.
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
// the card body (sky -> #5ec8ff -> sky, with a soft outer glow). Matches scan.tsx.
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

// Light cosmetic grouping for a scanned code, e.g. an EAN-13 into 1 6 6 groups
// so it reads like the contract's "EAN 4 047649 123456". Falls back verbatim.
function formatCode(code: string): string {
  const c = code.trim();
  if (/^\d{13}$/.test(c)) return `EAN ${c[0]} ${c.slice(1, 7)} ${c.slice(7)}`;
  if (/^\d{12}$/.test(c)) return `UPC ${c.slice(0, 6)} ${c.slice(6)}`;
  return c;
}

export default function ReorderScreen() {
  const { pairing } = usePairing();
  const { surface, spacing, radii, dark } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [sync, setSync] = useState<SyncState>({ kind: 'loading' });
  const [outcome, setOutcome] = useState<ScanOutcome>({ kind: 'none' });
  const [send, setSend] = useState<SendState>({ kind: 'idle' });
  const [manualCode, setManualCode] = useState('');
  const [manualFocus, setManualFocus] = useState(false);
  // Latch so a held barcode does not fire the handler repeatedly. Cleared by the
  // "Scan another" reset.
  const [handled, setHandled] = useState(false);

  const paired = !!pairing;

  // Pull the inventory snapshot once on mount when paired. A 404 (null) means the
  // laptop has not published yet, which is the "no inventory" hint, not an error.
  useEffect(() => {
    let cancelled = false;
    if (!pairing) {
      setSync({ kind: 'empty' });
      return;
    }
    (async () => {
      setSync({ kind: 'loading' });
      try {
        const snap = (await fetchSnapshot(
          'inventory',
          pairing,
          signWithDevice,
        )) as InventorySnapshot | null;
        if (cancelled) return;
        const list = Array.isArray(snap?.items) ? snap!.items! : [];
        setItems(list);
        if (!snap || list.length === 0) {
          setSync({ kind: 'empty' });
        } else {
          setSync({
            kind: 'ready',
            count: list.length,
            generatedAt: snap.generatedAt,
          });
        }
      } catch (err) {
        if (cancelled) return;
        setSync({
          kind: 'error',
          message:
            err instanceof Error ? err.message : 'Could not sync inventory.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pairing]);

  // Look up a scanned or typed code against the cached items by product_barcode,
  // trimmed string compare. Sets the outcome and resets any prior send status.
  const lookup = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (code.length === 0) return;
      setSend({ kind: 'idle' });
      const match = items.find(
        (it) =>
          typeof it.product_barcode === 'string' &&
          it.product_barcode.trim() === code,
      );
      setOutcome(match ? { kind: 'match', item: match, code } : { kind: 'nomatch', code });
    },
    [items],
  );

  // Camera callback. Guarded by the latch so a held box fires once. Each scan
  // runs the same lookup a manual code does.
  const onBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (handled) return;
      if (!result?.data) return;
      setHandled(true);
      lookup(result.data);
    },
    [handled, lookup],
  );

  const onManualLookup = useCallback(() => {
    if (manualCode.trim().length === 0) return;
    setHandled(true);
    lookup(manualCode);
  }, [manualCode, lookup]);

  // Reset back to a live scanner after handling a scan.
  const onScanAnother = useCallback(() => {
    setOutcome({ kind: 'none' });
    setSend({ kind: 'idle' });
    setHandled(false);
    setManualCode('');
  }, []);

  const onSend = useCallback(
    async (payload: ReorderPayload) => {
      if (!pairing || send.kind === 'sending') return;
      setSend({ kind: 'sending' });
      const res = await uploadReorder(payload, pairing, signWithDevice);
      if (res.ok) {
        setSend({ kind: 'sent' });
      } else {
        setSend({ kind: 'failed', error: res.error });
      }
    },
    [pairing, send.kind],
  );

  const cameraReady = paired && permission?.granted === true && !handled;

  return (
    <ScreenFrame>
      <ScreenHeader />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Reorder-danger identity chip + title (matches the scan flow's
            "Low, reorder ASAP" affordance). */}
        <View style={styles.titleRow}>
          <View style={styles.titleIcon}>
            <Ionicons name="cart-outline" size={21} color={palette.danger} />
          </View>
          <ThemedText type="title">Scan to reorder</ThemedText>
        </View>
        <ThemedText style={[styles.tagline, { color: surface.muted }]}>
          Point the camera at a reagent box barcode to flag it for your lab
          reorder list.
        </ThemedText>

        <SyncLine sync={sync} paired={paired} />

        {!paired ? (
          <EmptyState
            icon="barcode-outline"
            text="Pair this phone from the home tab to scan and send reorders."
          />
        ) : null}

        {paired && permission && !permission.granted ? (
          <Card style={{ gap: spacing.sm }}>
            <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
              Camera access needed
            </ThemedText>
            <ThemedText style={[styles.cardHint, { color: surface.muted }]}>
              ResearchOS needs the camera to scan reagent barcodes.
            </ThemedText>
            <Button
              variant="primary"
              label="Allow camera"
              onPress={requestPermission}
            />
          </Card>
        ) : null}

        {/* Camera viewfinder (contract .scanframe): white corner brackets, a
            glowing sky scanline, and a centered hint, matching scan.tsx. */}
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
              <ThemedText style={styles.scanHintText}>
                Point at the reagent barcode
              </ThemedText>
            </View>
          </View>
        ) : null}

        {paired && handled ? (
          <OutcomeCard
            outcome={outcome}
            send={send}
            onSend={onSend}
            onScanAnother={onScanAnother}
          />
        ) : null}

        {paired ? (
          <Card style={{ gap: spacing.sm }}>
            <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
              Enter a code by hand
            </ThemedText>
            <ThemedText style={[styles.cardHint, { color: surface.muted }]}>
              For a box that will not scan, type its barcode and look it up.
            </ThemedText>
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
              onPress={onManualLookup}
            />
          </Card>
        ) : null}
      </ScrollView>
    </ScreenFrame>
  );
}

function SyncLine({ sync, paired }: { sync: SyncState; paired: boolean }) {
  const { surface } = useTheme();
  if (!paired) return null;
  if (sync.kind === 'loading') {
    return (
      <ThemedText style={[styles.syncLine, { color: surface.muted }]}>
        Syncing inventory...
      </ThemedText>
    );
  }
  if (sync.kind === 'ready') {
    return (
      <ThemedText style={[styles.syncLine, { color: surface.muted }]}>
        Synced {sync.count} item{sync.count === 1 ? '' : 's'}
        {sync.generatedAt ? ` (updated ${formatTime(sync.generatedAt)})` : ''}
      </ThemedText>
    );
  }
  if (sync.kind === 'empty') {
    return (
      <ThemedText style={[styles.syncLine, { color: surface.muted }]}>
        No inventory yet, open ResearchOS on your laptop to publish it.
      </ThemedText>
    );
  }
  return (
    <ThemedText style={[styles.syncLine, { color: palette.danger }]}>
      {sync.message}
    </ThemedText>
  );
}

function OutcomeCard({
  outcome,
  send,
  onSend,
  onScanAnother,
}: {
  outcome: ScanOutcome;
  send: SendState;
  onSend: (payload: ReorderPayload) => void;
  onScanAnother: () => void;
}) {
  const { surface, spacing, radii } = useTheme();

  if (outcome.kind === 'none') {
    return (
      <Card style={{ gap: spacing.sm }}>
        <ThemedText style={[styles.cardHint, { color: surface.muted }]}>
          No code read yet.
        </ThemedText>
        <Button variant="secondary" label="Scan again" onPress={onScanAnother} />
      </Card>
    );
  }

  const sending = send.kind === 'sending';
  const sent = send.kind === 'sent';

  if (outcome.kind === 'match') {
    const it = outcome.item;
    const lowStock =
      typeof it.low_at_count === 'number' && it.low_at_count !== null;
    const meta = [
      it.vendor ? it.vendor : null,
      it.catalog_number ? it.catalog_number : null,
    ]
      .filter(Boolean)
      .join('  ·  ');
    const payload: ReorderPayload = {
      itemId: it.id,
      name: it.name,
      catalog_number: it.catalog_number ?? null,
      vendor: it.vendor ?? null,
      product_barcode: it.product_barcode ?? outcome.code,
    };
    return (
      <View style={{ gap: spacing.md }}>
        {/* Matched item hero (contract reorder card): sky gradient header with a
            danger "Low" pill when a reorder threshold is set, a glowing seam, and
            a .kv detail body. Mirrors scan.tsx's deduct hero. */}
        <Card style={styles.heroCard} compact>
          <LinearGradient
            colors={[palette.sky, '#39b4ff']}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={styles.hero}
          >
            <View style={styles.heroIcon}>
              <Ionicons name="cube-outline" size={24} color={palette.white} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <ThemedText style={styles.heroEyebrow}>Found in inventory</ThemedText>
              <ThemedText style={styles.heroTitle} numberOfLines={2}>
                {it.name ?? 'Inventory item'}
              </ThemedText>
              {meta ? (
                <ThemedText style={styles.heroCode} numberOfLines={1}>
                  {meta}
                </ThemedText>
              ) : null}
            </View>
            {lowStock ? (
              <View style={styles.heroPill}>
                <ThemedText style={styles.heroPillText}>Low</ThemedText>
              </View>
            ) : null}
          </LinearGradient>
          <GlowLine />
          <View style={styles.heroBody}>
            {it.vendor ? (
              <DetailRow label="Vendor" value={it.vendor} />
            ) : null}
            {it.catalog_number ? (
              <DetailRow label="Catalog" value={it.catalog_number} mono />
            ) : null}
            {it.container_label ? (
              <DetailRow label="Container" value={it.container_label} />
            ) : null}
            {lowStock ? (
              <DetailRow label="Reorder at" value={String(it.low_at_count)} mono />
            ) : null}
            {!it.vendor && !it.catalog_number && !it.container_label && !lowStock ? (
              <ThemedText style={[styles.cardHint, { color: surface.muted }]}>
                Code {formatCode(outcome.code)}
              </ThemedText>
            ) : null}
          </View>
        </Card>

        {/* Routing note (contract reorder card footnote). */}
        {!sent ? (
          <View
            style={[
              styles.callout,
              {
                backgroundColor: palette.skyDim,
                borderColor: palette.skyBorder,
                borderRadius: radii.md,
              },
            ]}
          >
            <Ionicons
              name="information-circle-outline"
              size={17}
              color={palette.sky}
              style={{ marginTop: 1 }}
            />
            <ThemedText style={[styles.calloutText, { color: surface.text }]}>
              Flags it for your PI to order from the laptop.
            </ThemedText>
          </View>
        ) : null}

        {sent ? (
          <SentBlock onScanAnother={onScanAnother} />
        ) : (
          <>
            <Button
              variant="primary"
              accent="danger"
              label="Add to reorder list"
              icon={<Ionicons name="cart-outline" size={18} color={palette.white} />}
              loading={sending}
              onPress={() => onSend(payload)}
              disabled={sending}
            />
            {send.kind === 'failed' ? (
              <ThemedText style={styles.err}>{send.error}</ThemedText>
            ) : null}
            <Button
              variant="ghost"
              label="Scan another"
              onPress={onScanAnother}
            />
          </>
        )}
      </View>
    );
  }

  // No match.
  const payload: ReorderPayload = { product_barcode: outcome.code };
  return (
    <View style={{ gap: spacing.md }}>
      {/* Unmatched code (contract amber "not recognized" callout). */}
      <View
        style={[
          styles.callout,
          {
            backgroundColor: palette.amberDim,
            borderColor: palette.amberBorder,
            borderRadius: radii.md,
          },
        ]}
      >
        <Ionicons
          name="alert-circle-outline"
          size={17}
          color={palette.amber}
          style={{ marginTop: 1 }}
        />
        <ThemedText style={[styles.calloutText, { color: surface.text }]}>
          <ThemedText style={[styles.calloutLead, { color: palette.amber }]}>
            No matching item.{' '}
          </ThemedText>
          {formatCode(outcome.code)}. You can still send a reorder request.
        </ThemedText>
      </View>

      {sent ? (
        <SentBlock onScanAnother={onScanAnother} />
      ) : (
        <>
          <Button
            variant="primary"
            accent="danger"
            label="Send reorder request anyway"
            icon={<Ionicons name="cart-outline" size={18} color={palette.white} />}
            loading={sending}
            onPress={() => onSend(payload)}
            disabled={sending}
          />
          {send.kind === 'failed' ? (
            <ThemedText style={styles.err}>{send.error}</ThemedText>
          ) : null}
          <Button
            variant="ghost"
            label="Scan another"
            onPress={onScanAnother}
          />
        </>
      )}
    </View>
  );
}

// A labelled key/value row (contract .kv), shared with scan.tsx's detail card.
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

function SentBlock({ onScanAnother }: { onScanAnother: () => void }) {
  const { surface, spacing } = useTheme();
  return (
    <View style={{ gap: spacing.lg, alignItems: 'center', paddingTop: spacing.sm }}>
      {/* Contract .success-check: a soft success badge confirming the send. */}
      <View style={styles.successCheck}>
        <Ionicons name="checkmark" size={42} color={palette.success} />
      </View>
      <ThemedText type="title" style={styles.center}>
        Sent to your lab
      </ThemedText>
      <ThemedText style={[styles.tagline, styles.center, { color: surface.muted }]}>
        Your PI will see it on the laptop and can place the order.
      </ThemedText>
      <View style={styles.stretch}>
        <Button variant="primary" label="Scan another" onPress={onScanAnother} />
      </View>
    </View>
  );
}

// Friendly local rendering of an ISO timestamp; falls back to the raw string.
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 16,
  },
  mono: { fontFamily: fonts.mono },
  center: { textAlign: 'center' },
  stretch: { alignSelf: 'stretch', marginTop: 4 },

  // Title row with a reorder-danger identity tile (matches scan/add-purchase).
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: palette.dangerDim,
    alignItems: 'center',
    justifyContent: 'center',
  },

  tagline: {
    fontSize: 14,
    fontFamily: fonts.ui,
    lineHeight: 21,
    maxWidth: 300,
  },
  syncLine: {
    fontSize: 14,
    fontFamily: fonts.ui,
    lineHeight: 20,
    marginTop: -6,
  },

  // Camera viewfinder (contract .scanframe), shared with scan.tsx.
  cameraWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
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

  // Gradient hero for the matched item (contract reorder/deduct hero card).
  heroCard: { padding: 0, overflow: 'hidden', gap: 0 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
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
  // White-glass "Low" pill on the gradient header (contract .pill-low, read on
  // the colored hero so it stays legible).
  heroPill: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
  },
  heroPillText: {
    color: palette.white,
    fontSize: 11.5,
    fontFamily: fonts.bold,
    fontWeight: '700',
  },
  heroBody: { paddingHorizontal: 16, paddingTop: 13, paddingBottom: 15, gap: 9 },

  // Glowing seam line between hero and body.
  glowlineWrap: { height: 2, width: '100%' },
  glowline: { flex: 1, height: 2 },

  // Key/value detail rows (contract .kv).
  kv: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  kvKey: { fontSize: 13, fontFamily: fonts.ui },
  kvVal: { fontSize: 13.5, fontFamily: fonts.semibold, fontWeight: '600', flexShrink: 1, textAlign: 'right' },

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
  calloutLead: { fontFamily: fonts.semibold, fontWeight: '700' },

  // Plain cards (permission / manual-entry).
  cardTitle: {
    fontSize: 15,
    fontFamily: fonts.semibold,
    fontWeight: '600',
    lineHeight: 20,
  },
  cardHint: {
    fontSize: 14,
    fontFamily: fonts.ui,
    lineHeight: 20,
  },

  // Manual-code input (contract .input / .input.focus).
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    minHeight: 48,
  },

  // Sent state (contract .success-check).
  successCheck: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: palette.successDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },

  err: { color: palette.danger, fontSize: 14, fontFamily: fonts.ui, lineHeight: 20 },
});
