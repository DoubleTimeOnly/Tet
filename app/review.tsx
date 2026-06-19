import { useCallback, useEffect, useState } from "react";
import { TextInput, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useStore } from "../ui/StoreProvider";
import { getTodayView, gradeCard, completeTask, editCard, setCardIgnored } from "../services/learning";
import { Screen, Card, Title, Body, Muted, Button } from "../ui/components";
import { MathText } from "../ui/MathText";
import type { Card as CardRow, Rating } from "../db/schema";
import { colors, radius, space } from "../ui/theme";

const GRADES: { label: string; rating: Rating; kind: "danger" | "warn" | "good" | "primary" }[] = [
  { label: "Again", rating: "again", kind: "danger" },
  { label: "Hard", rating: "hard", kind: "warn" },
  { label: "Good", rating: "good", kind: "good" },
  { label: "Easy", rating: "easy", kind: "primary" },
];

export default function ReviewScreen() {
  const { store, tz } = useStore();
  const router = useRouter();
  const [queue, setQueue] = useState<CardRow[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    // Use the same slice the Today screen shows: capped and with sibling cards
    // (multi-cloze / reversed) buried so they don't appear back-to-back.
    getTodayView(store, Date.now(), tz).then((v) => setQueue(v.slice.reviewCards));
  }, [store, tz]);

  const advance = useCallback(() => {
    setRevealed(false);
    setEditing(false);
    setIndex((i) => i + 1);
  }, []);

  const finish = useCallback(async () => {
    // Credit any active flashcard task with the cards reviewed this session.
    const tasks = await store.listTasks({ activeOnly: true });
    const now = Date.now();
    await Promise.all(
      tasks
        .filter((t) => t.type === "flashcard")
        .map((t) => completeTask(store, t, { type: "flashcard", n: reviewed }, now, tz)),
    );
    router.back();
  }, [store, tz, reviewed, router]);

  if (queue.length === 0) {
    return (
      <Screen>
        <Title>Nothing due</Title>
        <Muted>No cards are due right now.</Muted>
        <Button label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (index >= queue.length) {
    return (
      <Screen>
        <Title>Session complete 🎉</Title>
        <Body>{reviewed} card{reviewed === 1 ? "" : "s"} reviewed.</Body>
        <Button label="Finish" onPress={finish} />
      </Screen>
    );
  }

  const card = queue[index]!;

  const onGrade = async (rating: Rating) => {
    await gradeCard(store, card.id, rating, Date.now());
    setReviewed((n) => n + 1);
    advance();
  };

  const onIgnore = async () => {
    await setCardIgnored(store, card.id, true);
    advance(); // not counted as reviewed; recoverable from Library
  };

  const onSaveEdit = async (front: string, back: string) => {
    await editCard(store, card.id, front, back);
    setQueue((q) =>
      q.map((c, i) => (i === index ? { ...c, front: front.trim(), back: back.trim() } : c)),
    );
    setEditing(false);
  };

  if (editing) {
    return (
      <Screen>
        <Muted>{`Editing card ${index + 1} of ${queue.length}`}</Muted>
        <EditCard
          initialFront={card.front}
          initialBack={card.back}
          onSave={onSaveEdit}
          onCancel={() => setEditing(false)}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Muted>{`Card ${index + 1} of ${queue.length}`}</Muted>
      <Card style={{ minHeight: 160, justifyContent: "center" }}>
        <MathText value={card.front} kind="subtitle" />
        {revealed && (
          <>
            <View style={{ height: space.md }} />
            <MathText value={card.back} kind="body" />
          </>
        )}
      </Card>

      {!revealed ? (
        <Button label="Show answer" onPress={() => setRevealed(true)} />
      ) : (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          {GRADES.map((g) => (
            <View key={g.rating} style={{ flex: 1 }}>
              <Button label={g.label} kind={g.kind} onPress={() => onGrade(g.rating)} />
            </View>
          ))}
        </View>
      )}

      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button label="Edit" kind="neutral" onPress={() => setEditing(true)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Ignore" kind="neutral" onPress={onIgnore} />
        </View>
      </View>
    </Screen>
  );
}

function EditCard({
  initialFront,
  initialBack,
  onSave,
  onCancel,
}: {
  initialFront: string;
  initialBack: string;
  onSave: (front: string, back: string) => void;
  onCancel: () => void;
}) {
  const [front, setFront] = useState(initialFront);
  const [back, setBack] = useState(initialBack);
  const canSave = front.trim().length > 0 && back.trim().length > 0;

  return (
    <Card>
      <Muted>Question</Muted>
      <TextInput
        value={front}
        onChangeText={setFront}
        multiline
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <Muted>Answer</Muted>
      <TextInput
        value={back}
        onChangeText={setBack}
        multiline
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button label="Cancel" kind="neutral" onPress={onCancel} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Save" onPress={() => onSave(front, back)} disabled={!canSave} />
        </View>
      </View>
    </Card>
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
    minHeight: 48,
  },
});
