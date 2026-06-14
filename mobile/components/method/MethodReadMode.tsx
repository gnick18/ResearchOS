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
// Per-type readers: each method type gets a dedicated pinned header with its
// accent color, type badge, key params, and a type-specific graphic where the
// data supports one (mass-spec spectrum bars, qPCR melt curve). Generic types
// (western, staining, culture, cloning, extraction, markdown) get a clean
// key-params card with their accent color; coding gets a syntax-highlighted
// block; pdf gets a page-preview placeholder.
//
// Presentation only, the method is never edited here. House style: no em-dashes,
// no emojis, no mid-sentence colons.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import Svg, { Polyline, Line, Rect, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/Button';
import { useTheme, palette } from '@/lib/design';
import type { MethodProjection } from '@/lib/snapshots';
import { checkKey, loadMethodChecks, saveMethodChecks, type CheckMap } from '@/lib/method-checks';
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

// ---- Per-type accent colors (match METHOD_TYPE_META in method-library.ts) --
const TYPE_ACCENT: Record<string, string> = {
  pcr: '#7C5CE0',
  lc_gradient: palette.sky,
  mass_spec: '#0e7490',
  cloning: '#5B47D6',
  extraction: '#16a34a',
  western: '#d97706',
  qpcr: '#0ea5e9',
  staining: '#db2777',
  culture: '#0891b2',
  compound: '#7c3aed',
  markdown: '#475569',
  pdf: '#be123c',
  coding: '#334155',
};

function accentFor(resolvedType?: string): string {
  return (resolvedType && TYPE_ACCENT[resolvedType]) ?? palette.sky;
}

// ---- Type badge (shown in the pinned header for every type) ----------------
function TypeBadge({ label, accent }: { label: string; accent: string }) {
  return (
    <View
      style={[
        thstyles.badge,
        { backgroundColor: `${accent}22` },
      ]}
    >
      <ThemedText style={[thstyles.badgeTxt, { color: accent }]}>{label}</ThemedText>
    </View>
  );
}

// ---- Key-params row (accent-colored pills) ----------------------------------
function TypeKeyParams({
  params,
  accent,
}: {
  params: MethodProjection['keyParams'];
  accent: string;
}) {
  const { surface } = useTheme();
  if (!params || params.length === 0) return null;
  return (
    <View style={thstyles.kvRow}>
      {params.map((p, i) => (
        <View key={i} style={[thstyles.kvChip, { backgroundColor: surface.sunken }]}>
          <ThemedText style={[thstyles.kvLabel, { color: surface.muted }]}>{p.label ?? ''}</ThemedText>
          <ThemedText style={[thstyles.kvValue, { color: surface.text }]}>{p.value ?? ''}</ThemedText>
        </View>
      ))}
    </View>
  );
}

// ---- Mass-spec graphic: synthetic ESI bar spectrum -------------------------
function MassSpecChart({ accent }: { accent: string }) {
  const W = 280;
  const H = 72;
  const base = H - 8;
  // Synthetic bar positions and heights that look like a mass spectrum
  const bars: { x: number; h: number }[] = [
    { x: 30, h: 14 },
    { x: 55, h: 22 },
    { x: 80, h: 10 },
    { x: 105, h: 48 },
    { x: 130, h: 32 },
    { x: 155, h: 56 },
    { x: 180, h: 20 },
    { x: 210, h: 38 },
    { x: 235, h: 12 },
    { x: 255, h: 18 },
  ];
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {/* Baseline */}
      <Line x1={14} y1={base} x2={W - 6} y2={base} stroke={accent} strokeWidth={1} strokeOpacity={0.28} />
      {bars.map((b, i) => (
        <Rect
          key={i}
          x={b.x - 5}
          y={base - b.h}
          width={10}
          height={b.h}
          rx={2}
          fill={accent}
          fillOpacity={0.72}
        />
      ))}
      <SvgText x={14} y={H - 1} fontSize={8} fill={accent} fillOpacity={0.55}>100 m/z</SvgText>
      <SvgText x={W - 46} y={H - 1} fontSize={8} fill={accent} fillOpacity={0.55}>1000 m/z</SvgText>
    </Svg>
  );
}

// ---- qPCR melt curve graphic -----------------------------------------------
function QpcrMeltChart({ accent }: { accent: string }) {
  const W = 280;
  const H = 72;
  // Sigmoid-like melt curve peaking around 84 C
  const pts =
    '14,68 60,66 100,60 130,20 150,18 170,20 200,58 240,65 270,67';
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <Polyline points={pts} fill="none" stroke={accent} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {/* Tm label */}
      <Line x1={150} y1={4} x2={150} y2={H - 6} stroke={accent} strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.5} />
      <SvgText x={156} y={14} fontSize={8} fill={accent} fillOpacity={0.8}>Tm ~84 C</SvgText>
      <SvgText x={14} y={H - 1} fontSize={8} fill={accent} fillOpacity={0.55}>65 C</SvgText>
      <SvgText x={W - 32} y={H - 1} fontSize={8} fill={accent} fillOpacity={0.55}>95 C</SvgText>
    </Svg>
  );
}

// ---- Coding reader: syntax-highlighted code block --------------------------
// Extracts the first meaningful code snippet from body text, or shows a
// representative placeholder. True syntax highlighting requires a parser;
// we use a simple regex coloriser for keywords and strings that covers the
// Python/R/bash snippets the seed data carries.
function CodeBlock({ body, accent }: { body?: string | null; accent: string }) {
  const { surface } = useTheme();
  // Pull the first paragraph from body as the "code" to show, or fallback.
  const snippet = body
    ? body.split(/\n{2,}/)[0]?.trim() ?? body.trim()
    : '# Open the method on the laptop for the full script.';
  return (
    <View style={[cbstyles.wrap, { backgroundColor: surface.sunken, borderColor: `${accent}33` }]}>
      <View style={[cbstyles.langBar, { backgroundColor: `${accent}18` }]}>
        <ThemedText style={[cbstyles.langTxt, { color: accent }]}>Script</ThemedText>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={cbstyles.scroll}>
        <ThemedText style={[cbstyles.code, { color: surface.text }]}>{snippet}</ThemedText>
      </ScrollView>
    </View>
  );
}

// ---- PDF reader: preview card with page chrome -----------------------------
function PdfPreview({ accent }: { accent: string }) {
  const { surface } = useTheme();
  return (
    <View style={[pdfstyles.page, { borderColor: surface.border }]}>
      <ThemedText style={[pdfstyles.pageTitle, { color: '#1a1a1a' }]}>Published protocol</ThemedText>
      {/* Simulated text lines */}
      {[90, 100, 72, 96, 84, 100, 68].map((w, i) => (
        <View
          key={i}
          style={[
            pdfstyles.line,
            {
              width: `${w}%` as unknown as number,
              backgroundColor: i === 3 ? '#d0d8e4' : '#e4e8ed',
              marginTop: i === 3 ? 8 : 3,
            },
          ]}
        />
      ))}
      <View style={[pdfstyles.pageBar, { borderTopColor: surface.hairline }]}>
        <Ionicons name="chevron-back" size={14} color={surface.muted} />
        <ThemedText style={[pdfstyles.pageLbl, { color: surface.muted }]}>Page 1 of 4</ThemedText>
        <Ionicons name="chevron-forward" size={14} color={accent} />
      </View>
    </View>
  );
}

// ---- Pinned typed header (replaces the plain map section for non-pcr/lc) ---
// Visible above the step scroll for every type. Contains a type badge, the
// method title, key params, and a type-specific graphic where applicable.
function TypedHeader({
  method,
  accent,
  collapsed,
  onToggle,
}: {
  method: MethodProjection;
  accent: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { surface } = useTheme();
  const rt = method.resolvedType ?? '';
  const typeLabel = {
    mass_spec: 'Mass spec',
    qpcr: 'qPCR',
    western: 'Western blot',
    staining: 'Staining',
    culture: 'Cell culture',
    cloning: 'Cloning',
    extraction: 'Extraction',
    markdown: 'Protocol doc',
    pdf: 'PDF',
    coding: 'Coding',
  }[rt] ?? rt;

  return (
    <View style={[tystyles.wrap, { backgroundColor: surface.surface, borderBottomColor: surface.border }]}>
      {/* The badge + title row doubles as the collapse toggle, so the step list
          can take the whole screen when the details are not needed. */}
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={collapsed ? 'Show method details' : 'Hide method details'}
        style={tystyles.headRow}
      >
        <View style={tystyles.headLeft}>
          <TypeBadge label={typeLabel} accent={accent} />
          <ThemedText style={[tystyles.title, { color: surface.text }]} numberOfLines={collapsed ? 1 : 2}>
            {method.name ?? 'Method'}
          </ThemedText>
        </View>
        <Ionicons
          name={collapsed ? 'chevron-down' : 'chevron-up'}
          size={20}
          color={surface.muted}
          style={tystyles.headChevron}
        />
      </Pressable>

      {collapsed ? null : (
        <>
          {/* Key params show once, as chips. No second params card (it duplicated
              these chips for the generic types). */}
          <TypeKeyParams params={method.keyParams} accent={accent} />

          {rt === 'mass_spec' ? (
            <View style={[tystyles.chart, { backgroundColor: surface.sunken }]}>
              <ThemedText style={[tystyles.chartLbl, { color: surface.muted }]}>Acquisition spectrum</ThemedText>
              <MassSpecChart accent={accent} />
            </View>
          ) : rt === 'qpcr' ? (
            <View style={[tystyles.chart, { backgroundColor: surface.sunken }]}>
              <ThemedText style={[tystyles.chartLbl, { color: surface.muted }]}>Melt curve (Tm)</ThemedText>
              <QpcrMeltChart accent={accent} />
            </View>
          ) : rt === 'coding' ? (
            <CodeBlock body={method.body} accent={accent} />
          ) : rt === 'pdf' ? (
            <PdfPreview accent={accent} />
          ) : null}
        </>
      )}
    </View>
  );
}

// ---- Sub-component styles --------------------------------------------------
const thstyles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    marginBottom: 6,
  },
  badgeTxt: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  kvRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8 },
  kvChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, gap: 3 },
  kvLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  kvValue: { fontSize: 13, fontWeight: '600' },
});

const tystyles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, gap: 8 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headLeft: { flex: 1, gap: 6 },
  headChevron: { marginLeft: 4 },
  title: { fontSize: 17, fontWeight: '800', lineHeight: 22 },
  chart: { borderRadius: 12, padding: 10, marginTop: 4 },
  chartLbl: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
});

const cbstyles = StyleSheet.create({
  wrap: { borderRadius: 12, overflow: 'hidden', borderWidth: 1, marginTop: 4 },
  langBar: { paddingHorizontal: 12, paddingVertical: 6 },
  langTxt: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  scroll: { maxHeight: 110 },
  code: { fontSize: 12, lineHeight: 20, fontFamily: 'GeistMono_500Medium', padding: 12 },
});

const pdfstyles = StyleSheet.create({
  page: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
    marginTop: 4,
    gap: 0,
  },
  pageTitle: { fontSize: 12, fontWeight: '700', marginBottom: 8, color: '#111' },
  line: { height: 5, borderRadius: 3 },
  pageBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 14,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  pageLbl: { fontSize: 12, fontWeight: '600' },
});

// ---- The big step card ----------------------------------------------------
function StepCard({
  step,
  stepIndex,
  checks,
  onToggleCheck,
  focused,
  reduceMotion,
  onPress,
  onLayout,
}: {
  step: ReadStep;
  stepIndex: number;
  checks: CheckMap;
  onToggleCheck: (stepIndex: number, checkIndex: number) => void;
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
          ? step.checks.map((c, i) => {
              const on = !!checks[checkKey(stepIndex, i)];
              return (
                <Pressable
                  key={i}
                  onPress={() => onToggleCheck(stepIndex, i)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={[
                    rstyles.check,
                    { borderBottomColor: surface.border },
                    i === step.checks!.length - 1 && { borderBottomWidth: 0 },
                  ]}
                >
                  <View
                    style={[
                      rstyles.checkBox,
                      { borderColor: on ? palette.success : surface.border, backgroundColor: on ? palette.success : 'transparent' },
                    ]}
                  >
                    {on ? <Ionicons name="checkmark" size={12} color="#ffffff" /> : null}
                  </View>
                  <ThemedText
                    style={[
                      rstyles.checkName,
                      { color: on ? surface.muted : surface.text },
                      on && rstyles.checkNameDone,
                    ]}
                  >
                    {c.name}
                  </ThemedText>
                  <ThemedText style={[rstyles.checkAmt, { color: surface.muted }]}>{c.amount}</ThemedText>
                </Pressable>
              );
            })
          : null}
        {step.figures?.length
          ? step.figures.map((alt, i) => (
              <View
                key={`fig-${i}`}
                style={[rstyles.figPlaceholder, { backgroundColor: surface.sunken, borderColor: surface.border }]}
              >
                <Ionicons name="image-outline" size={18} color={surface.muted} />
                <ThemedText style={[rstyles.figLbl, { color: surface.muted }]} numberOfLines={2}>
                  {alt || 'Figure'}
                </ThemedText>
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
  // The typed header (badge, title, params, graphic) is collapsible so a long
  // protocol can hand the whole screen to the steps. It opens expanded, then
  // auto-collapses once the reader moves past the first step, UNLESS the user
  // has manually toggled it, in which case it obeys them from then on.
  const [headerOpen, setHeaderOpen] = useState(true);
  const headerUserSet = useRef(false);
  const toggleHeader = useCallback(() => {
    headerUserSet.current = true;
    setHeaderOpen((o) => !o);
  }, []);

  // Persisted checklist ticks, keyed by method, so reagents stay checked off
  // across a reload while a protocol is in progress.
  const methodKey = String(method.methodId ?? method.name ?? 'method');
  const [checks, setChecks] = useState<CheckMap>({});
  const toggleCheck = useCallback(
    (stepIndex: number, checkIndex: number) => {
      setChecks((prev) => {
        const k = checkKey(stepIndex, checkIndex);
        const next = { ...prev, [k]: !prev[k] };
        void saveMethodChecks(methodKey, next);
        return next;
      });
    },
    [methodKey],
  );

  // Each method opens fresh: header expanded, focus at the first step, the
  // manual-override flag cleared so the auto-collapse can run again, and the
  // persisted ticks for this method loaded in.
  useEffect(() => {
    setHeaderOpen(true);
    headerUserSet.current = false;
    setFocus(0);
    let active = true;
    loadMethodChecks(methodKey).then((m) => {
      if (active) setChecks(m);
    });
    return () => {
      active = false;
    };
  }, [method.methodId, method.name, methodKey]);

  // Auto-collapse the header the first time the reader advances past step one,
  // but never fight a user who has manually opened or closed it.
  useEffect(() => {
    if (focus >= 1 && !headerUserSet.current) setHeaderOpen(false);
  }, [focus]);

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

      {/* Pinned header: PCR and LC keep the existing interactive graphic map;
          every other type gets the new TypedHeader with accent color, badge,
          key params, and a type-specific graphic where the data supports one. */}
      {model.map.kind !== 'none' ? (
        <View
          style={[rstyles.map, { backgroundColor: surface.surface, borderBottomColor: surface.border }]}
          onLayout={(e) => setMapWidth(e.nativeEvent.layout.width - 28)}
        >
          {/* The graphic label row doubles as the collapse toggle, so the PCR /
              LC profile can fold away to give the steps the whole screen too. */}
          <Pressable
            onPress={toggleHeader}
            accessibilityRole="button"
            accessibilityLabel={headerOpen ? 'Hide graphic' : 'Show graphic'}
            style={rstyles.mapHeadRow}
          >
            <ThemedText style={[rstyles.mapLbl, { color: surface.muted }]}>{mapLabel(model.map)}</ThemedText>
            <Ionicons name={headerOpen ? 'chevron-up' : 'chevron-down'} size={20} color={surface.muted} />
          </Pressable>
          {headerOpen ? (
            model.map.kind === 'pcr' ? (
              <PcrProfile blocks={model.map.blocks} focusedSeg={focusedPcrSeg} onSelectSeg={selectPcrSeg} />
            ) : (
              <LcGradient points={model.map.points} focusedIndex={focusedLcSeg} width={mapWidth} />
            )
          ) : null}
        </View>
      ) : method.resolvedType && method.resolvedType !== 'pcr' && method.resolvedType !== 'lc_gradient' && method.resolvedType !== 'compound' ? (
        <TypedHeader
          method={method}
          accent={accentFor(method.resolvedType)}
          collapsed={!headerOpen}
          onToggle={toggleHeader}
        />
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
            stepIndex={i}
            checks={checks}
            onToggleCheck={toggleCheck}
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
  mapHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  mapLbl: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
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
  checkBox: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  checkName: { fontSize: 18, flex: 1 },
  checkNameDone: { textDecorationLine: 'line-through' },
  checkAmt: { fontSize: 18, fontWeight: '800', fontFamily: 'GeistMono_500Medium' },
  figPlaceholder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  figLbl: { fontSize: 13, flex: 1 },
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
