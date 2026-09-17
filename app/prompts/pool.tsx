import { useCallback, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useStore } from "../../ui/StoreProvider";
import { addPromptItems } from "../../services/prompts";
import { newItems, parseBulkItems } from "../../lib/prompts";
import { Screen, Card, Subtitle, Muted, Button } from "../../ui/components";
import { colors, radius, space } from "../../ui/theme";
import type { PromptItem } from "../../db/schema";

interface PreviewItem {
  text: string;
  accepted: boolean;
}

type Phase = { kind: "input" } | { kind: "preview"; items: PreviewItem[]; duplicates: number };

function notify(title: string, message: string) {
  if (Platform.OS === "web") globalThis.alert?.(`${title}\n${message}`);
  else Alert.alert(title, message);
}

/**
 * Pool editor: paste a list in bulk (one per line), review what's actually new,
 * then commit. Mirrors the flashcard text import — the preview step is there
 * because a pasted list is exactly where a stray header line shows up.
 */
export default function PoolScreen() {
  const { store, reload } = useStore();
  const params = useLocalSearchParams<{ kind?: string }>();
  const kind = params.kind === "role" ? "role" : "word";
  const noun = kind === "role" ? "roles" : "words";

  const [items, setItems] = useState<PromptItem[]>([]);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "input" });

  const load = useCallback(() => {
    let active = true;
    store.listPromptItems(kind).then((rows) => {
      if (active) setItems(rows);
    });
    return () => {
      active = false;
    };
  }, [store, kind]);

  useFocusEffect(load);

  const pasteFromClipboard = async () => {
    const clip = await Clipboard.getStringAsync();
    if (clip) setText(clip);
  };

  const parse = () => {
    const parsed = parseBulkItems(text);
    if (parsed.length === 0) return;
    const fresh = newItems(
      items.map((i) => i.text),
      parsed,
    );
    setPhase({
      kind: "preview",
      items: fresh.map((t) => ({ text: t, accepted: true })),
      duplicates: parsed.length - fresh.length,
    });
  };

  const toggle = (index: number) => {
    if (phase.kind !== "preview") return;
    setPhase({
      ...phase,
      items: phase.items.map((it, i) =>
        i === index ? { ...it, accepted: !it.accepted } : it,
      ),
    });
  };

  const commit = async () => {
    if (phase.kind !== "preview") return;
    const accepted = phase.items.filter((it) => it.accepted).map((it) => it.text);
    if (accepted.length === 0) return;
    const { added } = await addPromptItems(store, kind, accepted.join("\n"));
    setText("");
    setPhase({ kind: "input" });
    setItems(await store.listPromptItems(kind));
    reload();
    notify("Added", `${added.length} ${added.length === 1 ? "entry" : "entries"} added.`);
  };

  const remove = async (item: PromptItem) => {
    await store.deletePromptItem(item.id);
    setItems(await store.listPromptItems(kind));
    reload();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: kind === "role" ? "Roles" : "Words" }} />
      <Muted>
        {kind === "role"
          ? "Two of these are paired at random into a relationship. Write them as they should read in a sentence — \"a dentist\", \"an heiress\"."
          : "One of these is dealt at a time. Concrete beats abstract — \"escalator\" gives you more than \"freedom\"."}
      </Muted>

      {phase.kind === "input" ? (
        <Card>
          <Subtitle>{`Add ${noun}`}</Subtitle>
          <Muted>One per line.</Muted>
          <TextInput
            style={styles.paste}
            value={text}
            onChangeText={setText}
            placeholder={kind === "role" ? "a dentist\na stowaway" : "escalator\nfire drill"}
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="top"
            accessibilityLabel={`Paste ${noun}`}
          />
          <Button label="Paste from clipboard" kind="neutral" onPress={pasteFromClipboard} />
          <Button label="Review" onPress={parse} disabled={text.trim().length === 0} />
        </Card>
      ) : (
        <Card>
          <Subtitle>{`${phase.items.filter((i) => i.accepted).length} to add`}</Subtitle>
          {phase.duplicates > 0 && (
            <Muted>{`${phase.duplicates} already in the list — skipped.`}</Muted>
          )}
          {phase.items.length === 0 && <Muted>Nothing new in that paste.</Muted>}
          {phase.items.map((it, i) => (
            <Pressable
              key={`${it.text}-${i}`}
              onPress={() => toggle(i)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: it.accepted }}
              style={styles.previewRow}
            >
              <Text style={styles.check}>{it.accepted ? "☑" : "☐"}</Text>
              <Text style={[styles.entry, !it.accepted && styles.entryOff]}>{it.text}</Text>
            </Pressable>
          ))}
          <Button
            label="Add"
            onPress={commit}
            disabled={phase.items.every((i) => !i.accepted)}
          />
          <Button
            label="Back"
            kind="neutral"
            onPress={() => setPhase({ kind: "input" })}
          />
        </Card>
      )}

      <Card>
        <Subtitle>{`${items.length} ${noun}`}</Subtitle>
        {items.length === 0 && <Muted>{`No ${noun} yet.`}</Muted>}
        {items.map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <Text style={styles.entry}>{item.text}</Text>
            <Pressable
              onPress={() => void remove(item)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.text}`}
              style={({ pressed }) => [styles.removeButton, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.remove}>×</Text>
            </Pressable>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  paste: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    color: colors.text,
    padding: space.md,
    fontSize: 16,
    minHeight: 140,
  },
  previewRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.xs },
  check: { color: colors.text, fontSize: 18 },
  entry: { color: colors.text, fontSize: 16, flex: 1 },
  entryOff: { color: colors.muted, textDecorationLine: "line-through" },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.xs,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  removeButton: { paddingHorizontal: space.sm },
  remove: { color: colors.muted, fontSize: 22, fontWeight: "700" },
});
