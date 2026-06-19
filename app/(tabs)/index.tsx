import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { useStore } from "../../ui/StoreProvider";
import { getTodayView, type TodayView } from "../../services/learning";
import { Screen, Card, Title, Subtitle, Body, Muted, Button, XpBar } from "../../ui/components";
import type { TaskSliceItem } from "../../lib/dailySlice";

export default function TodayScreen() {
  const { store, tz, version } = useStore();
  const router = useRouter();
  const [view, setView] = useState<TodayView | null>(null);

  const load = useCallback(() => {
    let active = true;
    getTodayView(store, Date.now(), tz).then((v) => active && setView(v));
    return () => {
      active = false;
    };
  }, [store, tz, version]);

  useFocusEffect(load);

  if (!view) return null;

  const { slice, streak, maxStreak, xp } = view;
  const reviewCount = slice.reviewCards.length;
  const nothingToDo = slice.tasks.length === 0 && reviewCount === 0;

  return (
    <Screen>
      <Title>Today</Title>
      <Card>
        <XpBar level={xp.level} xpIntoLevel={xp.xpIntoLevel} xpForLevel={xp.xpForLevel} />
        <Muted>
          {streak > 0 ? `🔥 ${streak}-day streak` : "Start a streak today"}
          {maxStreak > 0 ? ` · best ${maxStreak}` : ""}
        </Muted>
      </Card>

      {reviewCount > 0 && (
        <Card>
          <Subtitle>Flashcards due</Subtitle>
          <Body>
            {reviewCount} card{reviewCount === 1 ? "" : "s"} ready
            {slice.reviewOverflow.length > 0
              ? ` (+${slice.reviewOverflow.length} held for later)`
              : ""}
          </Body>
          <Button label="Review now" onPress={() => router.push("/review")} />
        </Card>
      )}

      {slice.tasks.map((item) => (
        <TaskRow key={item.task.id} item={item} />
      ))}

      {nothingToDo && (
        <Card>
          <Subtitle>All clear ✅</Subtitle>
          <Body>Nothing left for today. Add tasks in Library.</Body>
        </Card>
      )}
    </Screen>
  );
}

function TaskRow({ item }: { item: TaskSliceItem }) {
  const router = useRouter();
  const { task, count } = item;

  const go = () => {
    if (task.type === "youtube") router.push(`/task/youtube?taskId=${task.id}`);
    else if (task.type === "reading") router.push(`/task/reading?taskId=${task.id}`);
    else router.push("/review");
  };

  const subtitle =
    task.type === "flashcard"
      ? `${count} card${count === 1 ? "" : "s"}`
      : task.makes_cards_count > 0
        ? `then make ${task.makes_cards_count} card${task.makes_cards_count === 1 ? "" : "s"}`
        : "1 session";

  return (
    <Card>
      <Subtitle>{task.title}</Subtitle>
      <Muted>{`${labelFor(task.type)} · ${subtitle}`}</Muted>
      <Button label="Open" kind="neutral" onPress={go} />
    </Card>
  );
}

function labelFor(type: string): string {
  return type === "youtube" ? "Watch" : type === "reading" ? "Read" : "Flashcards";
}
