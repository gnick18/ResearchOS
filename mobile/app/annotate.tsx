// Photo annotation editor. Draw vector markup on a bench photo before sending,
// using react-native-svg (already a dep) plus the built-in PanResponder. NO new
// native module. The SVG overlay mirrors the web app's annotation renderer 1:1
// (same shape schema, same arrowhead math, same viewBox-in-natural-pixels), so a
// photo annotated here stays editable on the laptop.
//
// Coordinate model: every stored shape lives in NATURAL image pixels (the size
// the camera produced, from Image.getSize). The image is drawn fit-to-width, and
// we capture the rendered box with onLayout. screenToNatural converts a finger
// touch (box-relative screen px) into natural px on the way in; the SVG itself
// renders natural-px shapes via viewBox="0 0 imageW imageH" so the renderer
// scales them back to the box with zero per-shape math.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { renderSpec } from '@/components/AnnotationOverlay';
import { Button } from '@/components/ui/Button';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useTheme, palette, fonts } from '@/lib/design';
import {
  ANNOTATION_SCHEMA_VERSION,
  docToSvgElements,
  makeShapeId,
  type AnnotationDoc,
  type AnnotationShape,
  type SvgElementSpec,
} from '@/lib/annotations';
import { setAnnotateResult, takeAnnotateTarget } from '@/lib/annotate-handoff';

type Tool = 'freehand' | 'arrow' | 'rect' | 'ellipse' | 'text';
type StrokeName = 'thin' | 'medium' | 'thick';

// A few lab-friendly markup colors plus the brand sky. These render well on gels,
// plates, and bench photos.
const COLORS = [
  '#1AA0E6', // brand sky
  '#dc2626', // red
  '#16a34a', // green
  '#f59e0b', // amber
  '#a855f7', // purple
  '#ffffff', // white
  '#111827', // near-black
];

const STROKES: { name: StrokeName; width: number }[] = [
  { name: 'thin', width: 3 },
  { name: 'medium', width: 6 },
  { name: 'thick', width: 10 },
];

const TOOLS: { tool: Tool; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { tool: 'freehand', icon: 'pencil', label: 'Draw' },
  { tool: 'arrow', icon: 'arrow-forward', label: 'Arrow' },
  { tool: 'rect', icon: 'square-outline', label: 'Box' },
  { tool: 'ellipse', icon: 'ellipse-outline', label: 'Oval' },
  { tool: 'text', icon: 'text', label: 'Text' },
];

// The Annotate screen is the one deliberate deviation from the flat app canvas:
// a dark full-focus markup studio (contract .screen.cam = #0a0d12), so the photo
// reads first and the chrome recedes. These dark tokens are local to this screen.
const CAM = {
  bg: '#0a0d12',
  // Toolbar surface sits one step up from the canvas so the controls read as a
  // panel, with a hairline top edge. Mirrors the contract anno-toolbar/.anno-tool.
  panel: '#11161f',
  toolBg: 'rgba(255,255,255,0.05)',
  toolBorder: 'rgba(255,255,255,0.10)',
  border: 'rgba(255,255,255,0.09)',
  text: '#EAF0F7',
  muted: 'rgba(234,240,247,0.55)',
} as const;

// The rendered image box, in screen px, captured via onLayout.
type Box = { width: number; height: number };

export default function AnnotateScreen() {
  const router = useRouter();
  const { surface, radii, shadow } = useTheme();

  // The target uri stashed by the caller before navigating here. Taken once on
  // mount so a back-and-forward does not re-open a stale target.
  const [uri] = useState<string | null>(() => takeAnnotateTarget());

  // Natural image size, from Image.getSize. Null until resolved.
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  // Rendered box size, from onLayout on the image wrapper.
  const [box, setBox] = useState<Box | null>(null);

  // Committed shapes (natural px) and the in-progress shape being drawn.
  const [shapes, setShapes] = useState<AnnotationShape[]>([]);
  const draftRef = useRef<AnnotationShape | null>(null);
  const [draft, setDraft] = useState<AnnotationShape | null>(null);

  // Toolbar state.
  const [tool, setTool] = useState<Tool>('freehand');
  const [color, setColor] = useState<string>(COLORS[0]);
  const [stroke, setStroke] = useState<StrokeName>('medium');
  const strokeWidth = STROKES.find((s) => s.name === stroke)?.width ?? 6;

  // Text tool modal.
  const [textModal, setTextModal] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState('');

  // Resolve natural size once we have a uri.
  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    Image.getSize(
      uri,
      (w, h) => {
        if (!cancelled) setNatural({ w, h });
      },
      () => {
        // Fall back to a square so the editor still opens if sizing fails.
        if (!cancelled) setNatural({ w: 1000, h: 1000 });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const onBoxLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox({ width, height });
  }, []);

  // Box height that preserves the natural aspect ratio at the measured width.
  const boxHeight = useMemo(() => {
    if (!natural || !box) return undefined;
    return (box.width * natural.h) / natural.w;
  }, [natural, box]);

  // Convert a box-relative touch (screen px) into natural image px. The box may
  // not be perfectly aspect-matched on the very first layout pass, so we scale x
  // and y independently against the box's own width/height.
  const screenToNatural = useCallback(
    (sx: number, sy: number): { x: number; y: number } => {
      if (!natural || !box || box.width <= 0) return { x: sx, y: sy };
      const renderedH = boxHeight ?? box.height;
      const scaleX = natural.w / box.width;
      const scaleY = natural.h / (renderedH > 0 ? renderedH : box.width);
      const x = clamp(sx * scaleX, 0, natural.w);
      const y = clamp(sy * scaleY, 0, natural.h);
      return { x, y };
    },
    [natural, box, boxHeight],
  );

  const commitDraft = useCallback(() => {
    const d = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!d) return;
    // Drop a degenerate shape (a tap that produced no extent).
    if (isDegenerate(d)) return;
    setShapes((prev) => [...prev, d]);
  }, []);

  // PanResponder drives drawing. We read locationX/Y (box-relative) and convert
  // to natural px for every stored coordinate. freehand accumulates points;
  // arrow/rect/ellipse use start + current; text drops a label at the tap.
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e: GestureResponderEvent) => {
          const { locationX, locationY } = e.nativeEvent;
          const p = screenToNatural(locationX, locationY);
          if (tool === 'text') {
            // Defer to the modal; remember where the tap landed (natural px).
            setTextValue('');
            setTextModal({ x: p.x, y: p.y });
            return;
          }
          const id = makeShapeId();
          let shape: AnnotationShape;
          if (tool === 'freehand') {
            shape = { id, type: 'freehand', points: [p.x, p.y], color, strokeWidth };
          } else if (tool === 'arrow') {
            shape = { id, type: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, strokeWidth };
          } else if (tool === 'rect') {
            shape = { id, type: 'rect', x: p.x, y: p.y, w: 0, h: 0, color, strokeWidth };
          } else {
            shape = { id, type: 'ellipse', x: p.x, y: p.y, w: 0, h: 0, color, strokeWidth };
          }
          draftRef.current = shape;
          setDraft(shape);
        },
        onPanResponderMove: (
          e: GestureResponderEvent,
          _g: PanResponderGestureState,
        ) => {
          const current = draftRef.current;
          if (!current) return;
          const { locationX, locationY } = e.nativeEvent;
          const p = screenToNatural(locationX, locationY);
          let next: AnnotationShape;
          if (current.type === 'freehand') {
            next = { ...current, points: [...current.points, p.x, p.y] };
          } else if (current.type === 'arrow') {
            next = { ...current, x2: p.x, y2: p.y };
          } else if (current.type === 'rect' || current.type === 'ellipse') {
            // Anchor stays at the grant point; width/height can go negative while
            // dragging, normalized on commit so x/y is always top-left.
            next = { ...current, w: p.x - current.x, h: p.y - current.y };
          } else {
            return;
          }
          draftRef.current = next;
          setDraft(next);
        },
        onPanResponderRelease: () => {
          if (draftRef.current) {
            draftRef.current = normalizeBox(draftRef.current);
          }
          commitDraft();
        },
        onPanResponderTerminate: () => {
          commitDraft();
        },
      }),
    [tool, color, strokeWidth, screenToNatural, commitDraft],
  );

  const onConfirmText = useCallback(() => {
    if (!textModal) return;
    const value = textValue.trim();
    if (value.length > 0) {
      const fontSize = Math.max(16, strokeWidth * 6);
      setShapes((prev) => [
        ...prev,
        {
          id: makeShapeId(),
          type: 'text',
          x: textModal.x,
          y: textModal.y,
          text: value,
          color,
          fontSize,
        },
      ]);
    }
    setTextModal(null);
    setTextValue('');
  }, [textModal, textValue, color, strokeWidth]);

  const onUndo = useCallback(() => {
    setShapes((prev) => prev.slice(0, -1));
  }, []);

  const onClear = useCallback(() => {
    setShapes([]);
    draftRef.current = null;
    setDraft(null);
  }, []);

  const onSave = useCallback(() => {
    if (!uri || !natural) {
      router.back();
      return;
    }
    const doc: AnnotationDoc = {
      version: ANNOTATION_SCHEMA_VERSION,
      imageW: natural.w,
      imageH: natural.h,
      shapes,
      updatedAt: new Date().toISOString(),
    };
    setAnnotateResult({ uri, doc });
    router.back();
  }, [uri, natural, shapes, router]);

  const onCancel = useCallback(() => {
    // No result stashed, so the caller keeps whatever it had.
    router.back();
  }, [router]);

  // All committed shapes plus the in-progress draft, mapped to SVG specs.
  const specs: SvgElementSpec[] = useMemo(() => {
    const all = draft ? [...shapes, draft] : shapes;
    return all.flatMap((s) =>
      docToSvgElements({
        version: ANNOTATION_SCHEMA_VERSION,
        imageW: natural?.w ?? 1,
        imageH: natural?.h ?? 1,
        shapes: [s],
        updatedAt: '',
      }),
    );
  }, [shapes, draft, natural]);

  if (!uri) {
    return (
      <ScreenFrame>
        <ScreenHeader />
        <View style={styles.centered}>
          <ThemedText style={[styles.sub, { color: surface.muted }]}>
            No photo to annotate. Go back and pick a photo first.
          </ThemedText>
          <Button variant="secondary" label="Go back" onPress={() => router.back()} />
        </View>
      </ScreenFrame>
    );
  }

  const hasShapes = shapes.length > 0;
  const activeTool = TOOLS.find((t) => t.tool === tool);

  return (
    <View style={styles.cam}>
      {/* The studio is intentionally dark, so force light status-bar glyphs. */}
      <StatusBar style="light" />
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        {/* Dark nav header (contract .navhead over .cam): back X, title, inline
            Save pill. The pushed-screen back is an X here, not a chevron, because
            Save is the commit and the X is "leave without saving". */}
        <View style={styles.camHead}>
          <Pressable
            onPress={onCancel}
            hitSlop={14}
            style={styles.camBack}
            accessibilityRole="button"
            accessibilityLabel="Close without saving"
          >
            <Ionicons name="close" size={24} color={palette.white} />
          </Pressable>
          <ThemedText style={styles.camTitle}>Annotate</ThemedText>
          <View style={styles.fill} />
          <Button
            variant="primary"
            label="Save"
            onPress={onSave}
            style={styles.savePill}
          />
        </View>

        {/* Photo stage. The image is centered and letterboxed against the dark
            canvas, framed by the contract photo-area (radius, hairline border). */}
        <View style={styles.stage}>
          <View
            style={[
              styles.imageWrap,
              { borderRadius: radii.lg, borderColor: CAM.border },
              boxHeight ? { height: boxHeight } : { aspectRatio: natural ? natural.w / natural.h : 1 },
            ]}
            onLayout={onBoxLayout}
            {...panResponder.panHandlers}
          >
            <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
            {natural ? (
              <Svg
                style={StyleSheet.absoluteFill}
                viewBox={`0 0 ${natural.w} ${natural.h}`}
                pointerEvents="none"
              >
                {specs.map(renderSpec)}
              </Svg>
            ) : null}

            {/* Floating hint while the canvas is still blank (contract .hint-pill). */}
            {!hasShapes && !draft ? (
              <View style={styles.hintPill} pointerEvents="none">
                <Ionicons name="hand-left-outline" size={13} color={palette.white} />
                <ThemedText style={styles.hintText}>
                  {tool === 'text' ? 'Tap to drop a label' : `Drag to ${activeTool?.label.toLowerCase() ?? 'draw'}`}
                </ThemedText>
              </View>
            ) : null}
          </View>
        </View>

        {/* Toolbar panel, pinned at the bottom (contract .anno-toolbar). */}
        <View style={[styles.toolbar, { borderTopColor: CAM.border }]}>
          {/* Tool picker: contract .anno-tool tiles, sky fill when on. */}
          <View style={styles.toolRow}>
            {TOOLS.map((t) => {
              const on = tool === t.tool;
              return (
                <Pressable
                  key={t.tool}
                  onPress={() => setTool(t.tool)}
                  style={[
                    styles.annoTool,
                    {
                      backgroundColor: on ? palette.sky : CAM.toolBg,
                      borderColor: on ? palette.sky : CAM.toolBorder,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t.label}
                  accessibilityState={{ selected: on }}
                >
                  <Ionicons name={t.icon} size={20} color={on ? palette.white : CAM.text} />
                </Pressable>
              );
            })}

            <View style={styles.toolDivider} />

            {/* Undo / clear live in the same strip, as in the contract. */}
            <Pressable
              onPress={onUndo}
              disabled={!hasShapes}
              style={[styles.annoTool, { backgroundColor: CAM.toolBg, borderColor: CAM.toolBorder, opacity: hasShapes ? 1 : 0.35 }]}
              accessibilityRole="button"
              accessibilityLabel="Undo"
            >
              <Ionicons name="arrow-undo" size={19} color={CAM.text} />
            </Pressable>
            <Pressable
              onPress={onClear}
              disabled={!hasShapes}
              style={[styles.annoTool, { backgroundColor: CAM.toolBg, borderColor: CAM.toolBorder, opacity: hasShapes ? 1 : 0.35 }]}
              accessibilityRole="button"
              accessibilityLabel="Clear all"
            >
              <Ionicons name="trash-outline" size={19} color={palette.coral} />
            </Pressable>
          </View>

          {/* Color swatches (contract .swatch-dot) + stroke-width picker. */}
          <View style={styles.swatchRow}>
            {COLORS.map((c) => {
              const on = color === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => setColor(c)}
                  style={styles.swatchWrap}
                  accessibilityRole="button"
                  accessibilityLabel={`Color ${c}`}
                  accessibilityState={{ selected: on }}
                >
                  {/* Selected ring matches the brand sky; dot keeps a hairline so
                      white reads on the dark panel (contract swatch-dot ring). */}
                  <View
                    style={[
                      styles.swatchDot,
                      { backgroundColor: c },
                      on && styles.swatchDotOn,
                    ]}
                  />
                </Pressable>
              );
            })}

            <View style={styles.toolDivider} />

            {STROKES.map((s) => {
              const on = stroke === s.name;
              return (
                <Pressable
                  key={s.name}
                  onPress={() => setStroke(s.name)}
                  style={[
                    styles.strokeChip,
                    {
                      backgroundColor: on ? palette.skyDim : CAM.toolBg,
                      borderColor: on ? palette.skyBorder : CAM.toolBorder,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${s.name} stroke`}
                  accessibilityState={{ selected: on }}
                >
                  <View
                    style={{
                      width: 20,
                      height: s.width,
                      borderRadius: s.width,
                      backgroundColor: on ? palette.sky : CAM.muted,
                    }}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      </SafeAreaView>

      {/* Text entry modal (contract .dialog over a dark scrim). */}
      <Modal visible={textModal !== null} transparent animationType="fade" onRequestClose={() => setTextModal(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setTextModal(null)}>
          <Pressable
            style={[
              styles.modalCard,
              { backgroundColor: surface.surface, borderRadius: radii.lg, borderColor: surface.border, ...shadow.lg },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <ThemedText style={[styles.modalTitle, { color: surface.text }]}>Add a label</ThemedText>
            <TextInput
              value={textValue}
              onChangeText={setTextValue}
              placeholder="Type your label"
              placeholderTextColor={surface.placeholder}
              autoFocus
              style={[
                styles.modalInput,
                { backgroundColor: surface.surface2, borderColor: palette.sky, borderRadius: radii.md, color: surface.text },
              ]}
              onSubmitEditing={onConfirmText}
              returnKeyType="done"
            />
            <View style={styles.actions}>
              <View style={styles.actionItem}>
                <Button variant="secondary" label="Cancel" onPress={() => setTextModal(null)} />
              </View>
              <View style={styles.actionItem}>
                <Button variant="primary" label="Add" onPress={onConfirmText} />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Normalize a box shape so x/y is the top-left and w/h are positive, regardless
// of drag direction. Non-box shapes pass through unchanged.
function normalizeBox(shape: AnnotationShape): AnnotationShape {
  if (shape.type !== 'rect' && shape.type !== 'ellipse') return shape;
  const x = shape.w < 0 ? shape.x + shape.w : shape.x;
  const y = shape.h < 0 ? shape.y + shape.h : shape.y;
  return { ...shape, x, y, w: Math.abs(shape.w), h: Math.abs(shape.h) };
}

// True when a freshly drawn shape has no visible extent (a tap, not a drag).
function isDegenerate(shape: AnnotationShape): boolean {
  switch (shape.type) {
    case 'freehand':
      return shape.points.length < 4; // fewer than 2 points
    case 'polygon':
      return shape.points.length < 6; // fewer than 3 points
    case 'arrow':
    case 'line':
      return Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) < 2;
    case 'rect':
    case 'ellipse':
      return Math.abs(shape.w) < 2 && Math.abs(shape.h) < 2;
    case 'text':
      return shape.text.trim().length === 0;
    default:
      return false;
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  sub: { fontSize: 14, lineHeight: 20, textAlign: 'center' },

  // Dark full-focus studio canvas (contract .screen.cam).
  cam: { flex: 1, backgroundColor: CAM.bg },

  // Header (contract .navhead over .cam): X, title, inline Save pill.
  camHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 10,
  },
  camBack: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -4,
  },
  camTitle: { fontSize: 18, fontFamily: fonts.bold, fontWeight: '700', color: palette.white },
  savePill: { minHeight: 40, paddingVertical: 9, paddingHorizontal: 18 },

  // Photo stage: centered + letterboxed against the dark canvas.
  stage: { flex: 1, justifyContent: 'center', paddingHorizontal: 16 },
  imageWrap: {
    width: '100%',
    overflow: 'hidden',
    borderWidth: 1,
    backgroundColor: '#05070d',
  },

  // Floating hint pill over a blank canvas (contract .hint-pill).
  hintPill: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(8,12,20,0.66)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  hintText: { fontSize: 11.5, fontFamily: fonts.semibold, fontWeight: '600', color: palette.white },

  // Toolbar panel (contract .anno-toolbar).
  toolbar: {
    backgroundColor: CAM.panel,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
    gap: 12,
  },
  toolRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' },
  swatchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' },
  toolDivider: { width: 1, height: 24, backgroundColor: CAM.border, marginHorizontal: 2 },

  // Tool tile (contract .anno-tool: 42x42, radius 12, hairline border).
  annoTool: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Color swatch (contract .swatch-dot: 26 circle with a ring).
  swatchWrap: { padding: 2, alignItems: 'center', justifyContent: 'center' },
  swatchDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  swatchDotOn: {
    borderColor: palette.sky,
    borderWidth: 3,
  },

  // Stroke-width picker, sized like a compact tool tile.
  strokeChip: {
    width: 42,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  actions: { flexDirection: 'row', gap: 12, marginTop: 2 },
  actionItem: { flex: 1 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8,12,20,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: { width: '100%', maxWidth: 420, padding: 20, gap: 14, borderWidth: 1 },
  modalTitle: { fontSize: 17, fontFamily: fonts.extrabold, fontWeight: '800' },
  modalInput: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    fontFamily: fonts.ui,
    minHeight: 48,
  },
});
