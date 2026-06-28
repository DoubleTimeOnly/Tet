import { View, Text, StyleSheet } from "react-native";
import { rgbToHex } from "../lib/loot";
import { radius } from "./theme";

interface Props {
  r: number;
  g: number;
  b: number;
  /** Card width in px — height is auto-derived from playing-card ratio (5:7). */
  width?: number;
}

function darken(value: number, factor: number): number {
  return Math.round(value * factor);
}

export function LootCardView({ r, g, b, width = 160 }: Props) {
  const height = Math.round(width * 1.4); // 5:7 playing-card ratio
  const borderW = Math.round(width * 0.055); // ~5.5% border frame
  const hex = rgbToHex({ r, g, b });

  // Border color: darkened version of the card color for a TCG frame feel.
  const borderColor = `rgb(${darken(r, 0.45)}, ${darken(g, 0.45)}, ${darken(b, 0.45)})`;
  // Label strip background: slightly less dark.
  const stripColor = `rgb(${darken(r, 0.6)}, ${darken(g, 0.6)}, ${darken(b, 0.6)})`;

  const stripHeight = Math.round(height * 0.15);
  const innerRadius = Math.max(4, radius - borderW);
  const outerRadius = innerRadius + borderW;

  return (
    <View
      style={[
        styles.card,
        {
          width,
          height,
          borderRadius: outerRadius,
          backgroundColor: borderColor,
          padding: borderW,
        },
      ]}
    >
      {/* Art area — fills card minus label strip */}
      <View
        style={[
          styles.art,
          {
            backgroundColor: hex,
            borderRadius: innerRadius,
            marginBottom: borderW / 2,
          },
        ]}
      />

      {/* Label strip */}
      <View
        style={[
          styles.strip,
          {
            height: stripHeight,
            borderRadius: innerRadius,
            backgroundColor: stripColor,
          },
        ]}
      >
        <Text style={[styles.hexLabel, { fontSize: Math.round(width * 0.085) }]}>
          {hex.toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
  },
  art: {
    flex: 1,
  },
  strip: {
    alignItems: "center",
    justifyContent: "center",
  },
  hexLabel: {
    color: "#fff",
    fontWeight: "700",
    letterSpacing: 1,
    fontVariant: ["tabular-nums"],
  },
});
