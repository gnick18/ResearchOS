/**
 * BeakerBot vector mark. Geometry ported verbatim from brand/beakerbot-mark.svg
 * (which is itself derived from frontend/src/components/BeakerBot.tsx). Rendered
 * via react-native-svg so it scales crisply at any size.
 *
 * SVG viewBox from the master: "8 3 24 31" (24-wide, 31-tall).
 * Stroke color is sky #1AA0E6 (brand primary). Rainbow liquid gradient fills
 * the lower body. Eyes are solid sky discs. Mouth is an upward arc.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React from 'react';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Stop,
} from 'react-native-svg';

export interface BeakerBotProps {
  /** Overall height in dp. Width scales proportionally (24:31 aspect). */
  size?: number;
  /** Override the ink/stroke color. Defaults to brand sky #1AA0E6. */
  color?: string;
}

const SKY = '#1AA0E6';

// viewBox from the master SVG: x=8 y=3 w=24 h=31
const VB_X = 8;
const VB_Y = 3;
const VB_W = 24;
const VB_H = 31;
const ASPECT = VB_W / VB_H; // ~0.774

export function BeakerBot({ size = 80, color = SKY }: BeakerBotProps) {
  const width = size * ASPECT;
  const height = size;

  return (
    <Svg
      width={width}
      height={height}
      viewBox={`${VB_X} ${VB_Y} ${VB_W} ${VB_H}`}
      fill="none"
    >
      <Defs>
        {/* Pastel rainbow gradient identical to the SVG master (light-mode palette) */}
        <LinearGradient id="liq" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#FFD2B0" />
          <Stop offset="25%" stopColor="#FFF1A8" />
          <Stop offset="50%" stopColor="#B7EBB1" />
          <Stop offset="75%" stopColor="#A6D2F4" />
          <Stop offset="100%" stopColor="#D6B5F0" />
        </LinearGradient>
      </Defs>

      {/* Body fill (white behind the gradient so it shows through) */}
      <Path
        d="M 12 12 L 12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L 28 12 Z"
        fill="white"
      />

      {/* Rainbow liquid fill in the lower body */}
      <Path
        d="M 12 19 Q 14 17.8, 16 19 T 20 19 T 24 19 T 28 19 L 28 24 C 28 30, 24 32, 20 32 C 16 32, 12 30, 12 24 L 12 19 Z"
        fill="url(#liq)"
      />

      {/* Spout / nozzle arc at the top-right */}
      <Path
        d="M22 8 C 22 6, 24 4, 26 6"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Beaker outline */}
      <Path
        d="M12 12 L12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L28 12"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Top rim / neck */}
      <Path
        d="M11 12 L29 12"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Eyes */}
      <Circle cx={17} cy={18} r={1.2} fill={color} />
      <Circle cx={23} cy={18} r={1.2} fill={color} />

      {/* Smile */}
      <Path
        d="M18 22 Q 20 24, 22 22"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Shoulder tabs (decorative tick marks at the collar) */}
      <Path
        d="M14 26 L15.5 26"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M24.5 26 L26 26"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}
