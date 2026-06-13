// NYT-cooking-style read mode (companion method read mode, 2026-06-13).
//
// A full-screen, big-text presentation of a method the laptop already sent to
// the phone (the same MethodProjection the card viewer renders). Hybrid
// navigation: big-text step cards scroll, the focused one enlarges, Next/Prev
// advance the focus and re-center, progress dots track position, and tapping a
// step focuses it. The method's signature graphic is pinned at the top as a
// "map" with the current phase highlighted (PCR thermocycler profile, LC
// gradient curve). The screen stays awake while read mode is open. Add-variation
// is reachable without leaving the focused step.
//
// Presentation only, the method is never edited here. House style: no em-dashes,
// no emojis, no mid-sentence colons.
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Polyline, Line } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/Button';
import { useTheme, palette } from '@/lib/design';
import type { MethodProjection } from '@/lib/snapshots';
import {
  buildReadModel,
  type GraphicMap,
  type PcrProfileBlock,
  type ReadStep,
  type TempTone,
} from '@/lib/method-read';

// Temp tone colors, matched to the read-mode mockup.
const TONE_COLOR: Record<TempTone, string> = {
  hot: '#ef5350',
  anneal: '#3b82f6',
  extend: '#16a34a',
  hold: '#64748b',
  none: palette.sky,
};

// ---- PCR profile map ------------------------------------------------------
function PcrProfile({
  blocks,
  focusedSeg,
  onSelectSeg,
}: {
  blocks: PcrProfileBlock[];
  focusedSeg?: string;
  onSelectSeg: (seg: string) => void;
}) {
  const { surface } = useTheme();
  // Temp -> bar height (4..95 C maps to 18..82 px).
  const h = (t: number) => 18 + ((Math.max(4, Math.min(95, t)) - 4) / (95 - 4)) * 64;
  const barColor = (t: number) => TONE_COLOR[toneFromTemp(t)];
  return (
    <View style={pstyles.row}>
      {blocks.map((b, i) => {
        const on = focusedSeg === b.id;
        if (b.isCycle) {
          return (
            <Pressable
              key={`cyc-${i}`}
              onPress={() => onSelectSeg(b.id)}
              style={[
                pstyles.cycwrap,
                { borderColor: TONE_COLOR.anneal, opacity: on ? 1 : 0.45 },
              ]}
            >
              <View style={pstyles.cycbars}>
                {(b.cycleBars ?? []).map((cb, j) => (
                  <View
                    key={j}
                    style={{
                      width: 14,
                      height: h(cb.tempC),
                      borderTopLeftRadius: 4,
                      borderTopRightRadius: 4,
                      backgroundColor: barColor(cb.tempC),
                    }}
                  />
                ))}
              </View>
              <ThemedText style={[pstyles.cyclbl, { color: TONE_COLOR.anneal }]}>
                {b.cycleLabel ?? ''}
              </ThemedText>
            </Pressable>
          );
        }
        return (
          <Pressable
            key={`blk-${i}`}
            onPress={() => onSelectSeg(b.id)}
            style={[pstyles.block, { opacity: on ? 1 : 0.45 }]}
          >
            <View
              style={{
                width: 28,
                height: h(b.tempC),
                borderTopLeftRadius: 5,
                borderTopRightRadius: 5,
                backgroundColor: barColor(b.tempC),
              }}
            />
            <ThemedText style={[pstyles.blockT, { color: surface.text }]}>{b.label}</ThemedText>
            <ThemedText style={[pstyles.blockSub, { color: surface.muted }]}>{b.sub}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function toneFromTemp(t: number): TempTone {
  if (t >= 90) return 'hot';
  if (t <= 16) return 'hold';
  if (t >= 68) return 'extend';
  return 'anneal';
}

// ---- LC gradient map ------------------------------------------------------
function LcGradient({
  points,
  focusedIndex,
  width,
}: {
  points: { timeMin: number; percentB: number }[];
  focusedIndex?: number;
  width: number;
}) {
  const W = Math.max(120, width);
  const H = 84;
  const pad = 6;
  const maxT = Math.max(...points.map((p) => p.timeMin), 1);
  const x = (t: number) => pad + (t / maxT) * (W - 2 * pad);
  const y = (b: number) => pad + (1 - Math.max(0, Math.min(100, b)) / 100) * (H - 2 * pad);
  const poly = points.map((p) => `${x(p.timeMin).toFixed(1)},${y(p.percentB).toFixed(1)}`).join(' ');
  const cursorT = focusedIndex != null && points[focusedIndex] ? points[focusedIndex].timeMin : points[0]?.timeMin ?? 0;
  const cx = x(cursorT);
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <Polyline points={poly} fill="none" stroke={palette.sky} strokeWidth={3} strokeLinejoin="round" />
      <Line x1={cx} y1={0} x2={cx} y2={H} stroke={palette.amber} strokeWidth={2} strokeDasharray="4 3" />
    </Svg>
  );
}

// ---- The big step card ----------------------------------------------------
function StepCard({
  step,
  focused,
  reduceMotion,
  onPress,
  onLayout,
}: {
  step: ReadStep;
  focused: boolean;
  reduceMotion: boolean;
  onPress: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  const { surface, radii } = useTheme();
  // Reduced motion: no scale change, just the focus border/opacity.
  const scale = reduceMotion ? 1 : focused ? 1 : 0.98;
  return (
    <Pressable onPress={onPress} onLayout={onLayout}>
      <View
        style={[
          rstyles.step,
          {
            backgroundColor: surface.surface,
            borderColor: focused ? palette.sky : surface.border,
            borderRadius: radii.xl,
            opacity: focused ? 1 : 0.5,
            transform: [{ scale }],
          },
          focused && rstyles.stepFocusedShadow,
        ]}
      >
        <ThemedText style={[rstyles.kicker, { color: palette.sky }]}>{step.kicker}</ThemedText>
        {step.isTemp ? (
          <ThemedText style={[rstyles.tempBig, { color: TONE_COLOR[step.tone] }]}>
            {step.big}
          </ThemedText>
        ) : (
          <ThemedText style={[rstyles.big, { color: surface.text }, focused && rstyles.bigFocused]}>
            {step.big}
          </ThemedText>
        )}
        {step.detail ? (
          <ThemedText style={[rstyles.detail, { color: surface.muted }]}>{step.detail}</ThemedText>
        ) : null}
        {step.checks
          ? step.checks.map((c, i) => (
              <View
                key={i}
                style={[
                  rstyles.check,
                  { borderBottomColor: surface.border },
                  i === step.checks!.length - 1 && { borderBottomWidth: 0 },
                ]}
              >
                <View style={[rstyles.checkBox, { borderColor: surface.border }]} />
                <ThemedText style={[rstyles.checkName, { color: surface.text }]}>{c.name}</ThemedText>
                <ThemedText style={[rstyles.checkAmt, { color: surface.text }]}>{c.amount}</ThemedText>
              </View>
            ))
          : null}
      </View>
    </Pressable>
  );
}

export function MethodReadMode({
  method,
  experimentName,
  onClose,
  onAddVariation,
  variationBusy,
}: {
  method: MethodProjection;
  experimentName?: string;
  onClose: () => void;
  onAddVariation: (methodId: number | undefined, text: string) => Promise<void>;
  variationBusy: boolean;
}) {
  const { surface, spacing, radii } = useTheme();
  const reduceMotion = useReducedMotion() ?? false;
  // Keep the screen awake the whole time read mode is mounted, and only then.
  useKeepAwake();

  const model = useMemo(() => buildReadModel(method), [method]);
  const steps = model.steps;
  const [focus, setFocus] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [variationText, setVariationText] = useState('');
  const [mapWidth, setMapWidth] = useState(280);

  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<number[]>([]);
  const viewportH = useRef(0);

  const recenter = useCallback(
    (i: number) => {
      const y = offsets.current[i];
      if (y == null || !scrollRef.current) return;
      // Center the focused card in the viewport.
      const target = Math.max(0, y - viewportH.current / 2 + 80);
      scrollRef.current.scrollTo({ y: target, animated: !reduceMotion });
    },
    [reduceMotion],
  );

  const goTo = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(steps.length - 1, i));
      setFocus(clamped);
      // Defer until layout offsets are present.
      requestAnimationFrame(() => recenter(clamped));
    },
    [steps.length, recenter],
  );

  const onStepLayout = useCallback((i: number, e: LayoutChangeEvent) => {
    offsets.current[i] = e.nativeEvent.layout.y;
  }, []);

  const submitVariation = useCallback(async () => {
    const text = variationText.trim();
    if (!text) return;
    await onAddVariation(method.methodId, text);
    setVariationText('');
    setComposerOpen(false);
  }, [variationText, method.methodId, onAddVariation]);

  const focusedStep = steps[focus];
  const focusedPcrSeg = focusedStep?.pcrSeg;
  const focusedLcSeg = focusedStep?.lcSeg;
  const atEnd = focus >= steps.length - 1;

  const selectPcrSeg = useCallback(
    (seg: string) => {
      const i = steps.findIndex((s) => s.pcrSeg === seg);
      if (i >= 0) goTo(i);
    },
    [steps, goTo],
  );

  return (
    <View style={[rstyles.root, { backgroundColor: surface.bg }]}>
      {/* Minimal top chrome: close, name, screen-on indicator. */}
      <View style={[rstyles.top, { backgroundColor: surface.surface, borderBottomColor: surface.border }]}>
        <Pressable
          onPress={onClose}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="Exit read mode"
          style={[rstyles.closeBtn, { backgroundColor: surface.sunken }]}
        >
          <Ionicons name="close" size={20} color={surface.muted} />
        </Pressable>
        <View style={rstyles.topName}>
          <ThemedText numberOfLines={1} style={[rstyles.topN, { color: surface.text }]}>
            {method.name ?? 'Method'}
          </ThemedText>
          {experimentName ? (
            <ThemedText numberOfLines={1} style={[rstyles.topExp, { color: surface.muted }]}>
              {experimentName}
            </ThemedText>
          ) : null}
        </View>
        <View style={rstyles.awake}>
          <View style={[rstyles.awakeDot, { backgroundColor: palette.success }]} />
          <ThemedText style={[rstyles.awakeTxt, { color: palette.success }]}>SCREEN ON</ThemedText>
        </View>
      </View>

      {/* Pinned graphic map. */}
      {model.map.kind !== 'none' ? (
        <View
          style={[rstyles.map, { backgroundColor: surface.surface, borderBottomColor: surface.border }]}
          onLayout={(e) => setMapWidth(e.nativeEvent.layout.width - 28)}
        >
          <ThemedText style={[rstyles.mapLbl, { color: surface.muted }]}>{mapLabel(model.map)}</ThemedText>
          {model.map.kind === 'pcr' ? (
            <PcrProfile blocks={model.map.blocks} focusedSeg={focusedPcrSeg} onSelectSeg={selectPcrSeg} />
          ) : (
            <LcGradient points={model.map.points} focusedIndex={focusedLcSeg} width={mapWidth} />
          )}
        </View>
      ) : null}

      {/* Hybrid step scroll. */}
      <ScrollView
        ref={scrollRef}
        style={rstyles.steps}
        contentContainerStyle={rstyles.stepsContent}
        onLayout={(e) => (viewportH.current = e.nativeEvent.layout.height)}
        showsVerticalScrollIndicator={false}
      >
        {steps.map((s, i) => (
          <StepCard
            key={i}
            step={s}
            focused={i === focus}
            reduceMotion={reduceMotion}
            onPress={() => goTo(i)}
            onLayout={(e) => onStepLayout(i, e)}
          />
        ))}
      </ScrollView>

      {/* Bottom controls: progress dots, prev / variation / next. */}
      <View style={[rstyles.foot, { backgroundColor: surface.surface, borderTopColor: surface.border }]}>
        {composerOpen ? (
          <View style={{ gap: 10 }}>
            <TextInput
              value={variationText}
              onChangeText={setVariationText}
              placeholder="What did you change this run? e.g. used 30 cycles not 28"
              placeholderTextColor={surface.placeholder}
              style={[
                rstyles.composerInput,
                {
                  backgroundColor: surface.sunken,
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
            <View style={[rstyles.composerActions, { gap: spacing.sm }]}>
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
                onPress={submitVariation}
                loading={variationBusy}
                disabled={variationBusy || variationText.trim().length === 0}
              />
            </View>
          </View>
        ) : (
          <>
            <View style={rstyles.dots}>
              {steps.map((_, i) => (
                <View
                  key={i}
                  style={[
                    rstyles.dot,
                    { backgroundColor: i === focus ? palette.sky : surface.border, width: i === focus ? 18 : 7 },
                  ]}
                />
              ))}
            </View>
            <View style={rstyles.navRow}>
              <Pressable
                onPress={() => goTo(focus - 1)}
                disabled={focus === 0}
                style={[rstyles.navPrev, { backgroundColor: surface.sunken, opacity: focus === 0 ? 0.4 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Previous step"
              >
                <ThemedText style={[rstyles.navPrevTxt, { color: surface.text }]}>Prev</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setComposerOpen(true)}
                style={[rstyles.varBtn, { backgroundColor: palette.amberDim, borderColor: palette.amberBorder }]}
                accessibilityRole="button"
                accessibilityLabel="Add a variation"
              >
                <Ionicons name="create-outline" size={20} color={palette.warning} />
              </Pressable>
              <Pressable
                onPress={() => (atEnd ? onClose() : goTo(focus + 1))}
                style={[rstyles.navNext, { backgroundColor: palette.sky }]}
                accessibilityRole="button"
                accessibilityLabel={atEnd ? 'Done' : 'Next step'}
              >
                <ThemedText style={rstyles.navNextTxt}>{atEnd ? 'Done' : 'Next step'}</ThemedText>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function mapLabel(map: GraphicMap): string {
  if (map.kind === 'pcr') return map.label;
  if (map.kind === 'lc') return map.label;
  return '';
}

const pstyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, minHeight: 96 },
  block: { alignItems: 'center', gap: 3 },
  blockT: { fontSize: 11, fontWeight: '800' },
  blockSub: { fontSize: 9 },
  cycwrap: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingTop: 4,
    paddingBottom: 3,
    alignItems: 'center',
    gap: 2,
  },
  cycbars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  cyclbl: { fontSize: 9, fontWeight: '800' },
});

const rstyles = StyleSheet.create({
  root: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  closeBtn: { width: 34, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  topName: { flex: 1, minWidth: 0 },
  topN: { fontSize: 15, fontWeight: '800' },
  topExp: { fontSize: 11 },
  awake: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  awakeDot: { width: 6, height: 6, borderRadius: 999 },
  awakeTxt: { fontSize: 9.5, fontWeight: '700' },
  map: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1 },
  mapLbl: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  steps: { flex: 1 },
  stepsContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 140 },
  step: { borderWidth: 1, padding: 16, marginBottom: 12 },
  stepFocusedShadow: {
    shadowColor: palette.sky,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 6,
  },
  kicker: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  big: { fontSize: 24, fontWeight: '800', lineHeight: 30, marginTop: 6 },
  bigFocused: { fontSize: 28, lineHeight: 34 },
  tempBig: { fontSize: 44, fontWeight: '900', marginTop: 4 },
  detail: { fontSize: 17, lineHeight: 24, marginTop: 8 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: 1 },
  checkBox: { width: 24, height: 24, borderRadius: 7, borderWidth: 2 },
  checkName: { fontSize: 18, flex: 1 },
  checkAmt: { fontSize: 18, fontWeight: '800' },
  foot: { borderTopWidth: 1, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 16 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 9 },
  dot: { height: 7, borderRadius: 999 },
  navRow: { flexDirection: 'row', gap: 9, alignItems: 'center' },
  navPrev: { width: 70, borderRadius: 13, paddingVertical: 14, alignItems: 'center' },
  navPrevTxt: { fontSize: 16, fontWeight: '800' },
  varBtn: { width: 52, borderRadius: 13, paddingVertical: 14, alignItems: 'center', borderWidth: 1 },
  navNext: { flex: 1, borderRadius: 13, paddingVertical: 14, alignItems: 'center' },
  navNextTxt: { fontSize: 16, fontWeight: '800', color: palette.white },
  composerInput: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, minHeight: 88 },
  composerActions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
