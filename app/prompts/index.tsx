import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useStore } from "../../ui/StoreProvider";
import { listRecentPractices, type PracticeSummary } from "../../services/prompts";
import {
  DEFAULT_N,
  MAX_SECONDS,
  minPoolSize,
  parseSeconds,
  poolKindFor,
} from "../../lib/prompts";
import { Screen, Card, Subtitle, Body, Muted, Button } from "../../ui/components";
import { colors, radius, space } from "../../ui/theme";
import type { PracticeKind } from "../../db/schema";

/** Quick picks that fill the seconds field; typing your own still wins. */
const PRESETS = [7, 15, 30];
const MAX_N = 20;

const KIND_LABEL: Record<PracticeKind, string> = {
  words: "Words",
  relationships: "Relationships",
};

/**
 * Improv practice setup: pick what to draw, how many, and whether prompts
 * advance on a tap or on a timer. Nothing here is scheduled or scored — a run
 * starts when you open it.
 */
export default function PromptsScreen() {
  const { store, version } = useStore();
  const router = useRouter();
  const [kind, setKind] = useState<PracticeKind>("words");
  const [n, setN] = useState(DEFAULT_N);
  const [secondsText, setSecondsText] = useState("");
  const [poolSize, setPoolSize] = useState<number | null>(null);
  const [history, setHistory] = useState<PracticeSummary[]>([]);

  const load = useCallback(() => {
    let active = true;
    Promise.all([
      store.listPromptItems(poolKindFor(kind)),
      listRecentPractices(store, 5),
    ]).then(([pool, recent]) => {
      if (!active) return;
      setPoolSize(pool.length);
      setHistory(recent);
    });
    return () => {
      active = false;
    };
  }, [store, kind, version]);

  useFocusEffect(load);

  const seconds = parseSeconds(secondsText);
  const needed = minPoolSize(kind);
  const tooSmall = poolSize !== null && poolSize < needed;

  const start = () => {
    const query = `kind=${kind}&n=${n}${seconds === null ? "" : `&seconds=${seconds}`}`;
    router.push(`/prompts/practice?${query}`);
  };

  return (
    <Screen>
      <Card>
        <Subtitle>Draw</Subtitle>
        <View style={styles.row}>
          {(Object.keys(KIND_LABEL) as PracticeKind[]).map((k) => (
            <Chip
              key={k}
              label={KIND_LABEL[k]}
              selected={kind === k}
              onPress={() => setKind(k)}
            />
          ))}
        </View>
        <Muted>
          {kind === "words"
            ? "A single word at a time — generate ideas off it."
            : "Two roles at a time — find the relationship between them."}
        </Muted>
      </Card>

      <Card>
        <Subtitle>How many</Subtitle>
        <View style={styles.stepper}>
          <Chip label="−" onPress={() => setN((v) => Math.max(1, v - 1))} wide />
          <Text style={styles.count}>{n}</Text>
          <Chip label="+" onPress={() => setN((v) => Math.min(MAX_N, v + 1))} wide />
        </View>
        <Muted>{`${n} prompt${n === 1 ? "" : "s"}, revealed one at a time.`}</Muted>
      </Card>

      <Card>
        <Subtitle>Pace</Subtitle>
        <View style={styles.row}>
          <Chip label="Tap" selected={seconds === null} onPress={() => setSecondsText("")} />
          {PRESETS.map((p) => (
            <Chip
              key={p}
              label={`${p}s`}
              selected={seconds === p}
              onPress={() => setSecondsText(String(p))}
            />
          ))}
        </View>
        <TextInput
          style={styles.input}
          value={secondsText}
          onChangeText={setSecondsText}
          placeholder="Custom seconds (blank = tap to advance)"
          placeholderTextColor={colors.muted}
          keyboardType="number-pad"
          accessibilityLabel="Auto-advance seconds"
        />
        <Muted>
          {seconds === null
            ? "Tap to advance — take as long as you want on each one."
            : `Advances every ${seconds}s (1–${MAX_SECONDS}). A tap still skips ahead.`}
        </Muted>
      </Card>

      {tooSmall ? (
        <Card>
          <Subtitle>Not enough to draw from</Subtitle>
          <Muted>
            {`${KIND_LABEL[kind]} needs at least ${needed} ${
              poolKindFor(kind) === "role" ? "roles" : "words"
            } in the list.`}
          </Muted>
          <Button
            label="Edit list"
            onPress={() => router.push(`/prompts/pool?kind=${poolKindFor(kind)}`)}
          />
        </Card>
      ) : (
        <Button label="Start" onPress={start} />
      )}

      <Card>
        <Subtitle>Your lists</Subtitle>
        <Muted>
          {poolSize === null
            ? " "
            : `${poolSize} ${poolKindFor(kind) === "role" ? "roles" : "words"} to draw from.`}
        </Muted>
        <Button
          label="Edit words"
          kind="neutral"
          onPress={() => router.push("/prompts/pool?kind=word")}
        />
        <Button
          label="Edit roles"
          kind="neutral"
          onPress={() => router.push("/prompts/pool?kind=role")}
        />
      </Card>

      {history.length > 0 && (
        <Card>
          <Subtitle>Recent practice</Subtitle>
          {history.map(({ practice, prompts }) => (
            <View key={practice.id} style={styles.historyRow}>
              <Muted>
                {`${KIND_LABEL[practice.kind as PracticeKind] ?? practice.kind} · ${
                  practice.n
                } · ${practice.seconds === null ? "tap" : `${practice.seconds}s`}`}
              </Muted>
              <Body>{prompts.join(" · ")}</Body>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

function Chip({
  label,
  onPress,
  selected = false,
  wide = false,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  wide?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        wide && styles.chipWide,
        selected && styles.chipSelected,
        pressed && { opacity: 0.6 },
      ]}
    >
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    backgroundColor: colors.bg,
  },
  chipWide: { minWidth: 56, alignItems: "center" },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  stepper: { flexDirection: "row", alignItems: "center", gap: space.lg },
  count: { color: colors.text, fontSize: 28, fontWeight: "700", minWidth: 48, textAlign: "center" },
  input: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    color: colors.text,
    padding: space.md,
    fontSize: 16,
  },
  historyRow: { gap: space.xs, paddingTop: space.sm },
});
