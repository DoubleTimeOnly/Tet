import { useCallback, useState } from "react";
import { TextInput, View, StyleSheet } from "react-native";
import { useFocusEffect } from "expo-router";
import { useStore } from "../../ui/StoreProvider";
import { addCard, createTask, createDeck } from "../../services/authoring";
import { Screen, Card, Title, Subtitle, Body, Muted, Button } from "../../ui/components";
import { colors, radius, space } from "../../ui/theme";
import type { Deck, Task, TaskType } from "../../db/schema";

export default function LibraryScreen() {
  const { store, reload, version } = useStore();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({});

  const load = useCallback(() => {
    let active = true;
    (async () => {
      const snap = await store.exportAll();
      if (!active) return;
      setDecks(snap.decks);
      setTasks(snap.tasks.filter((t) => t.active));
      const counts: Record<string, number> = {};
      for (const c of snap.cards) counts[c.deck_id] = (counts[c.deck_id] ?? 0) + 1;
      setCardCounts(counts);
    })();
    return () => {
      active = false;
    };
  }, [store, version]);

  useFocusEffect(load);

  return (
    <Screen>
      <Title>Library</Title>

      <Subtitle>Decks</Subtitle>
      {decks.map((d) => (
        <Card key={d.id}>
          <Body>{d.name}</Body>
          <Muted>{cardCounts[d.id] ?? 0} cards</Muted>
        </Card>
      ))}

      <AddCardForm decks={decks} onDone={reload} />

      <Subtitle>Tasks</Subtitle>
      {tasks.map((t) => (
        <Card key={t.id}>
          <Body>{t.title}</Body>
          <Muted>{`${t.type} · cadence ${t.cadence}${t.makes_cards_count ? ` · make ${t.makes_cards_count}` : ""}`}</Muted>
        </Card>
      ))}

      <AddTaskForm onDone={reload} />
    </Screen>
  );
}

function AddCardForm({ decks, onDone }: { decks: Deck[]; onDone: () => void }) {
  const { store } = useStore();
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [deckId, setDeckId] = useState<string | null>(null);

  const target = deckId ?? decks[0]?.id ?? null;

  const submit = async () => {
    if (!front.trim() || !back.trim()) return;
    let dest = target;
    if (!dest) dest = (await createDeck(store, "My deck")).id;
    await addCard(store, { deckId: dest, front: front.trim(), back: back.trim() });
    setFront("");
    setBack("");
    onDone();
  };

  return (
    <Card>
      <Subtitle>New flashcard</Subtitle>
      {decks.length > 1 && (
        <View style={styles.row}>
          {decks.map((d) => (
            <Button
              key={d.id}
              label={d.name}
              kind={d.id === target ? "primary" : "neutral"}
              onPress={() => setDeckId(d.id)}
            />
          ))}
        </View>
      )}
      <Field placeholder="Front" value={front} onChangeText={setFront} />
      <Field placeholder="Back" value={back} onChangeText={setBack} />
      <Button label="Add card" onPress={submit} />
    </Card>
  );
}

function AddTaskForm({ onDone }: { onDone: () => void }) {
  const { store } = useStore();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("youtube");
  const [sourceRef, setSourceRef] = useState("");
  const [cadence, setCadence] = useState("1");
  const [makes, setMakes] = useState("0");

  const submit = async () => {
    if (!title.trim()) return;
    await createTask(store, {
      type,
      title: title.trim(),
      sourceRef: sourceRef.trim() || null,
      cadence: Math.max(1, parseInt(cadence, 10) || 1),
      makesCardsCount: Math.max(0, parseInt(makes, 10) || 0),
      readingTarget: type === "reading" ? 0.9 : null,
    });
    setTitle("");
    setSourceRef("");
    onDone();
  };

  return (
    <Card>
      <Subtitle>New task</Subtitle>
      <View style={styles.row}>
        {(["flashcard", "youtube", "reading"] as TaskType[]).map((t) => (
          <Button key={t} label={t} kind={t === type ? "primary" : "neutral"} onPress={() => setType(t)} />
        ))}
      </View>
      <Field placeholder="Title" value={title} onChangeText={setTitle} />
      {type !== "flashcard" && (
        <Field
          placeholder={type === "youtube" ? "YouTube URL" : "Readwise document id"}
          value={sourceRef}
          onChangeText={setSourceRef}
        />
      )}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Muted>Cadence/day</Muted>
          <Field placeholder="1" value={cadence} onChangeText={setCadence} keyboardType="number-pad" />
        </View>
        {type !== "flashcard" && (
          <View style={{ flex: 1 }}>
            <Muted>Make N cards</Muted>
            <Field placeholder="0" value={makes} onChangeText={setMakes} keyboardType="number-pad" />
          </View>
        )}
      </View>
      <Button label="Add task" onPress={submit} />
    </Card>
  );
}

function Field(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      {...props}
      style={styles.input}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
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
});
