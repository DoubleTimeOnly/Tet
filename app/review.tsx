import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useStore } from "../ui/StoreProvider";
import { gradeCard, completeTask } from "../services/learning";
import { Screen, Card, Title, Subtitle, Body, Muted, Button } from "../ui/components";
import type { Card as CardRow, Rating } from "../db/schema";
import { space } from "../ui/theme";

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

  useEffect(() => {
    store.listDueCards(Date.now()).then(setQueue);
  }, [store]);

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
    setRevealed(false);
    setIndex((i) => i + 1);
  };

  return (
    <Screen>
      <Muted>{`Card ${index + 1} of ${queue.length}`}</Muted>
      <Card style={{ minHeight: 160, justifyContent: "center" }}>
        <Subtitle>{card.front}</Subtitle>
        {revealed && (
          <>
            <View style={{ height: space.md }} />
            <Body>{card.back}</Body>
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
    </Screen>
  );
}
