// Read-only annotation overlay. Renders a committed AnnotationDoc as a scaled
// react-native-svg layer, mirroring the web <AnnotatedImage>: a viewBox in the
// image's NATURAL pixel space so one stored doc renders correctly at any box
// size (full preview down to a thumbnail) with zero per-shape math. Drop it as
// an absolute-fill child over an <Image> that itself uses the same aspect ratio.
//
// The editor (app/annotate.tsx) keeps its own interactive renderer; this is the
// passive display used on the capture preview and the bulk grid. House style:
// no em-dashes, no emojis, no mid-sentence colons.
import { StyleSheet } from 'react-native';
import Svg, {
  Ellipse as SvgEllipse,
  Line as SvgLine,
  Polygon as SvgPolygon,
  Polyline as SvgPolyline,
  Rect as SvgRect,
  Text as SvgText,
} from 'react-native-svg';

import { docToSvgElements, type AnnotationDoc, type SvgElementSpec } from '@/lib/annotations';
import { fonts } from '@/lib/design';

// Text labels are stored with the generic web family ('sans-serif'). Map that
// to the contract UI typeface (Geist) so markup text reads in the app's own
// voice instead of the platform default, on both the passive preview and the
// editor, which share this renderer for zero display/edit drift. An explicitly
// chosen family (future) is respected as-is.
function resolveFontFamily(family: string | undefined): string {
  if (!family || family === 'sans-serif') return fonts.ui;
  return family;
}

export function AnnotationOverlay({ doc }: { doc: AnnotationDoc }) {
  if (!doc || doc.imageW <= 0 || doc.imageH <= 0) return null;
  const specs = docToSvgElements(doc);
  if (specs.length === 0) return null;
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      viewBox={`0 0 ${doc.imageW} ${doc.imageH}`}
      pointerEvents="none"
    >
      {specs.map(renderSpec)}
    </Svg>
  );
}

// Map one web-style SVG element spec (kebab-case attrs) to the react-native-svg
// primitives. Exported so the interactive editor (app/annotate.tsx) renders
// shapes the exact same way, no drift between display and edit.
export function renderSpec(spec: SvgElementSpec) {
  const a = spec.attrs;
  const common = {
    stroke: a.stroke as string | undefined,
    strokeWidth: a['stroke-width'] as number | undefined,
    strokeLinecap: a['stroke-linecap'] as 'round' | 'butt' | 'square' | undefined,
    strokeLinejoin: a['stroke-linejoin'] as 'round' | 'miter' | 'bevel' | undefined,
    fill: a.fill as string | undefined,
  };
  switch (spec.tag) {
    case 'line':
      return (
        <SvgLine
          key={spec.key}
          x1={a.x1 as number}
          y1={a.y1 as number}
          x2={a.x2 as number}
          y2={a.y2 as number}
          {...common}
        />
      );
    case 'rect':
      return (
        <SvgRect
          key={spec.key}
          x={a.x as number}
          y={a.y as number}
          width={a.width as number}
          height={a.height as number}
          {...common}
        />
      );
    case 'ellipse':
      return (
        <SvgEllipse
          key={spec.key}
          cx={a.cx as number}
          cy={a.cy as number}
          rx={a.rx as number}
          ry={a.ry as number}
          {...common}
        />
      );
    case 'polyline':
      return <SvgPolyline key={spec.key} points={a.points as string} {...common} />;
    case 'polygon':
      return <SvgPolygon key={spec.key} points={a.points as string} {...common} />;
    case 'text':
      return (
        <SvgText
          key={spec.key}
          x={a.x as number}
          y={a.y as number}
          fill={a.fill as string}
          fontSize={a['font-size'] as number}
          fontFamily={resolveFontFamily(a['font-family'] as string | undefined)}
        >
          {spec.text}
        </SvgText>
      );
    default:
      return null;
  }
}
