import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { colors, radius, space } from "./theme";

export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      {children}
    </ScrollView>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Subtitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.subtitle}>{children}</Text>;
}

export function Body({ children }: { children: React.ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

/** Level + XP progress bar for the Today screen's gamification header. */
export function XpBar({
  level,
  xpIntoLevel,
  xpForLevel,
}: {
  level: number;
  xpIntoLevel: number;
  xpForLevel: number;
}) {
  const pct = xpForLevel > 0 ? Math.min(1, xpIntoLevel / xpForLevel) : 0;
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.xpRow}>
        <Text style={styles.subtitle}>Level {level}</Text>
        <Text style={styles.muted}>
          {xpIntoLevel} / {xpForLevel} XP
        </Text>
      </View>
      <View style={styles.xpTrack}>
        <View style={[styles.xpFill, { width: `${pct * 100}%` }]} />
      </View>
    </View>
  );
}

type ButtonKind = "primary" | "neutral" | "good" | "warn" | "danger";

export function Button({
  label,
  onPress,
  kind = "primary",
  disabled,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
}) {
  const bg = {
    primary: colors.accent,
    neutral: colors.surface,
    good: colors.good,
    warn: colors.warn,
    danger: colors.danger,
  }[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderWidth: kind === "neutral" ? 1 : 0 },
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: space.lg, gap: space.md },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    padding: space.lg,
    gap: space.sm,
  },
  title: { color: colors.text, fontSize: 24, fontWeight: "700" },
  subtitle: { color: colors.text, fontSize: 18, fontWeight: "600" },
  body: { color: colors.text, fontSize: 16 },
  muted: { color: colors.muted, fontSize: 14 },
  button: {
    borderColor: colors.border,
    borderRadius: radius,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    alignItems: "center",
  },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  xpRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  xpTrack: {
    height: 10,
    backgroundColor: colors.border,
    borderRadius: radius,
    overflow: "hidden",
  },
  xpFill: { height: "100%", backgroundColor: colors.accent, borderRadius: radius },
});
