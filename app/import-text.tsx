import { useState } from "react";
import { Platform, Pressable, TextInput, View, StyleSheet, Alert } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useStore } from "../ui/StoreProvider";
import { findOrCreateDeck } from "../services/authoring";
import { parseFlashcardNote, importObsidian, type ObsidianExport, type ParsedCard } from "../lib/obsidianImport";
import { Screen, Card, Title, Subtitle, Body, Muted, Button } from "../ui/components";
import { colors, radius, space } from "../ui/theme";

/**
 * Cards the user has marked "REMOVE " in their own notes (a personal
 * retire-this-card convention, not part of the Obsidian plugin's syntax) start
 * unchecked in the preview and have the marker stripped before import.
 */
const REMOVE_PREFIX = /^REMOVE\s+/;

/** Matches the deck seeded by services/seedObsidian.ts, so pasted cards land alongside it. */
const DEFAULT_DECK_NAME = "Obsidian Flashcards";

interface PreviewItem {
  card: ParsedCard;
  front: string;
  accepted: boolean;
}

type Phase = { kind: "input" } | { kind: "preview"; items: PreviewItem[] } | { kind: "importing" };

function notify(title: string, message: string) {
  if (Platform.OS === "web") globalThis.alert?.(`${title}\n${message}`);
  else Alert.alert(title, message);
}

export default function ImportTextScreen() {
  const { store, reload } = useStore();
  const router = useRouter();
  const [text, setText] = useState("");
  const [deckName, setDeckName] = useState(DEFAULT_DECK_NAME);
  const [phase, setPhase] = useState<Phase>({ kind: "input" });

  const pasteFromClipboard = async () => {
    const clip = await Clipboard.getStringAsync();
    if (clip) setText(clip);
  };

  const parse = () => {
    if (!text.trim()) return;
    const name = deckName.trim() || DEFAULT_DECK_NAME;
    const cards = parseFlashcardNote(text, name);
    const items: PreviewItem[] = cards.map((card) => {
      const stripped = card.front.replace(REMOVE_PREFIX, "");
      return { card, front: stripped, accepted: stripped === card.front };
    });
    setPhase({ kind: "preview", items });
  };

  const toggle = (index: number) => {
    if (phase.kind !== "preview") return;
    const items = phase.items.map((it, i) => (i === index ? { ...it, accepted: !it.accepted } : it));
    setPhase({ kind: "preview", items });
  };

  const commit = async () => {
    if (phase.kind !== "preview") return;
    const accepted = phase.items.filter((it) => it.accepted);
    if (accepted.length === 0) return;
    setPhase({ kind: "importing" });
    const name = deckName.trim() || DEFAULT_DECK_NAME;
    const deck = await findOrCreateDeck(store, name);
    const data: ObsidianExport = {
      source: "paste",
      exportedAt: new Date().toISOString(),
      deckName: name,
      cards: accepted.map((it) => ({ ...it.card, front: it.front })),
    };
    // deck already exists in the store (found or just created above), so only
    // the cards/notes get inserted here — passing the deck again would violate
    // its primary key.
    const { cards, notes } = importObsidian(data, { deckId: deck.id, deckName: name });
    await store.insertMany([], cards, notes);
    reload();
    notify("Imported", `${cards.length} card${cards.length === 1 ? "" : "s"} added to "${name}".`);
    router.back();
  };

  if (phase.kind === "preview") {
    const acceptedCount = phase.items.filter((it) => it.accepted).length;
    return (
      <Screen>
        <Title>Review cards</Title>
        <Muted>
          {phase.items.length} card{phase.items.length === 1 ? "" : "s"} found — {acceptedCount} selected. Tap a
          card to include or exclude it.
        </Muted>
        {phase.items.map((it, i) => (
          <Pressable key={i} onPress={() => toggle(i)}>
            <Card style={!it.accepted ? styles.rejected : undefined}>
              <Body>{(it.accepted ? "☑ " : "☐ ") + it.front}</Body>
              <Muted>{it.card.back}</Muted>
            </Card>
          </Pressable>
        ))}
        <View style={styles.actions}>
          <Button label="Back" kind="neutral" onPress={() => setPhase({ kind: "input" })} />
          <Button
            label={`Import ${acceptedCount}`}
            onPress={commit}
            disabled={acceptedCount === 0}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Import from text</Title>
      <Muted>Paste notes written in the Obsidian Spaced Repetition format (Q::A, ==cloze==, etc).</Muted>

      <Card>
        <Subtitle>Deck</Subtitle>
        <TextInput
          value={deckName}
          onChangeText={setDeckName}
          placeholder="Deck name"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
      </Card>

      <Card>
        <Subtitle>Text</Subtitle>
        <Button label="Paste from clipboard" kind="neutral" onPress={pasteFromClipboard} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Paste flashcard markdown here…"
          placeholderTextColor={colors.muted}
          multiline
          style={styles.textarea}
        />
        <Button label="Parse" onPress={parse} disabled={phase.kind === "importing" || !text.trim()} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 16,
  },
  textarea: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 14,
    minHeight: 160,
    textAlignVertical: "top",
  },
  rejected: { opacity: 0.5 },
  actions: { flexDirection: "row", gap: space.md },
});
