import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useStore } from "../../ui/StoreProvider";
import { startPractice, type PracticeResult } from "../../services/prompts";
import { DEFAULT_N, minPoolSize, poolKindFor } from "../../lib/prompts";
import { Screen, Card, Subtitle, Body, Muted, Button } from "../../ui/components";
import { colors, radius, space } from "../../ui/theme";
import type { PracticeKind } from "../../db/schema";

/**
 * One practice run, revealed one prompt at a time — only the current prompt is
 * on screen, so there is nothing to read ahead to. A tap always advances; when
 * an auto-advance interval is set it also advances on its own, which is the
 * point of the timer (you can't stall).
 */
export default function PracticeScreen() {
  const { store, reload } = useStore();
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string; n?: string; seconds?: string }>();

  const kind: PracticeKind = params.kind === "relationships" ? "relationships" : "words";
  const n = clampInt(params.n, DEFAULT_N, 1, 100);
  const seconds = params.seconds ? clampInt(params.seconds, 0, 1, 600) : null;

  const [result, setResult] = useState<PracticeResult | null>(null);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(seconds);

  const deal = useCallback(async () => {
    setResult(null);
    setIndex(0);
    setDone(false);
    setRemaining(seconds);
    const drawn = await startPractice(store, { kind, n, seconds });
    setResult(drawn);
    // A run writes prompt_draws rows, which the setup screen's history reads.
    if (drawn.ok) reload();
  }, [store, kind, n, seconds, reload]);

  // Deal once on mount. The ref guards against a double invoke (StrictMode /
  // Fast Refresh) writing two practice rows for one visit.
  const dealt = useRef(false);
  useEffect(() => {
    if (dealt.current) return;
    dealt.current = true;
    void deal();
  }, [deal]);

  const prompts = result?.ok ? result.prompts : [];
  const last = index >= prompts.length - 1;

  const advance = useCallback(() => {
    if (done || prompts.length === 0) return;
    if (last) setDone(true);
    else setIndex((i) => i + 1);
    setRemaining(seconds);
  }, [done, last, prompts.length, seconds]);

  // Auto-advance: one tick per second while a prompt is showing.
  useEffect(() => {
    if (seconds === null || done || prompts.length === 0) return;
    const id = setInterval(() => {
      setRemaining((r) => (r === null ? null : r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [seconds, done, prompts.length, index]);

  useEffect(() => {
    if (remaining !== null && remaining <= 0) advance();
  }, [remaining, advance]);

  if (result === null) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!result.ok) {
    const noun = poolKindFor(kind) === "role" ? "roles" : "words";
    return (
      <Screen>
        <Card>
          <Subtitle>Nothing to draw from</Subtitle>
          <Muted>
            {`This needs at least ${minPoolSize(kind)} ${noun} in the list — there ${
              result.poolSize === 1 ? "is 1" : `are ${result.poolSize}`
            }.`}
          </Muted>
          <Button
            label={`Add ${noun}`}
            onPress={() => router.replace(`/prompts/pool?kind=${poolKindFor(kind)}`)}
          />
        </Card>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen>
        <Card>
          <Subtitle>{`Done — ${prompts.length} prompt${prompts.length === 1 ? "" : "s"}`}</Subtitle>
          {prompts.map((text, i) => (
            <Body key={`${text}-${i}`}>{`${i + 1}. ${text}`}</Body>
          ))}
        </Card>
        <Button label="Practice again" onPress={() => void deal()} />
        <Button label="Done" kind="neutral" onPress={() => router.back()} />
      </Screen>
    );
  }

  const current = prompts[index] ?? "";

  return (
    <Screen>
      <View style={styles.meta}>
        <Muted>{`${index + 1} / ${prompts.length}`}</Muted>
        {remaining !== null && <Muted>{`${Math.max(0, remaining)}s`}</Muted>}
      </View>

      {seconds !== null && (
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${(Math.max(0, remaining ?? 0) / seconds) * 100}%` },
            ]}
          />
        </View>
      )}

      <Pressable
        onPress={advance}
        accessibilityRole="button"
        accessibilityLabel={`${current}. Tap for the next prompt.`}
        style={({ pressed }) => [styles.stage, pressed && { opacity: 0.8 }]}
      >
        <Text style={styles.prompt}>{current}</Text>
      </Pressable>

      <Muted>{last ? "Tap for the summary" : "Tap for the next prompt"}</Muted>

      {result.requested > prompts.length && (
        <Muted>
          {`Your list only had ${prompts.length} to give — you asked for ${result.requested}.`}
        </Muted>
      )}
    </Screen>
  );
}

/** A route param is a string (or absent); keep it in range before drawing. */
function clampInt(
  raw: string | string[] | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const text = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

const styles = StyleSheet.create({
  meta: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  track: { height: 6, backgroundColor: colors.border, borderRadius: radius, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.accent },
  stage: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    paddingVertical: space.xl * 3,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 260,
  },
  prompt: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 44,
  },
});
