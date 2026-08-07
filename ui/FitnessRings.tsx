import { View } from "react-native";
import Svg, { Path, Circle } from "react-native-svg";

const toRad = (deg: number) => (deg * Math.PI) / 180;

function polarToCart(cx: number, cy: number, r: number, deg: number) {
  return {
    x: cx + r * Math.cos(toRad(deg)),
    y: cy + r * Math.sin(toRad(deg)),
  };
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = polarToCart(cx, cy, r, startDeg);
  const e = polarToCart(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

export interface RingConfig {
  color: string;
  /** 1 for binary tasks (YouTube/reading), N for dot-trail (flashcards) */
  totalSegments: number;
  filledSegments: number;
}

interface Props {
  rings: RingConfig[];
  size?: number;
  strokeWidth?: number;
  ringGap?: number;
}

const START_DEG = -90; // 12 o'clock
const ARC_SPAN = 358;  // leaves a 2° gap so the binary ring's cap dot is visible

export function FitnessRings({ rings, size = 200, strokeWidth = 16, ringGap = 8 }: Props) {
  const cx = size / 2;
  const cy = size / 2;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {rings.map((ring, ri) => {
          const r = cx - strokeWidth / 2 - ri * (strokeWidth + ringGap);
          if (r <= strokeWidth / 2) return null;

          // A 0/0 ring (e.g. a flashcard task with nothing due) is trivially
          // complete — show it full rather than empty.
          const ratio = ring.totalSegments > 0
            ? Math.min(ring.filledSegments, ring.totalSegments) / ring.totalSegments
            : 1;

          // Smooth arc for all ring types
          const cap = polarToCart(cx, cy, r, START_DEG);
          return [
            <Path
              key={`${ri}-shadow`}
              d={describeArc(cx, cy, r, START_DEG, START_DEG + ARC_SPAN)}
              stroke={ring.color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeOpacity={0.18}
              fill="none"
            />,
            ratio > 0 && (
              <Path
                key={`${ri}-fill`}
                d={describeArc(cx, cy, r, START_DEG, START_DEG + ratio * ARC_SPAN)}
                stroke={ring.color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                fill="none"
              />
            ),
            <Circle
              key={`${ri}-cap`}
              cx={cap.x}
              cy={cap.y}
              r={strokeWidth / 2}
              fill={ring.color}
            />,
          ];
        })}
      </Svg>
    </View>
  );
}

/** Ring colors per task type, Apple Watch-inspired for dark backgrounds */
export const RING_COLORS: Record<string, string> = {
  flashcard: "#ff453a",
  youtube:   "#30d158",
  reading:   "#ffd60a",
};
