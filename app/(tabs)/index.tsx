import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useStore } from "../../ui/StoreProvider";
import { getTodayView, type TodayView } from "../../services/learning";
import { Screen, Card, Title, Subtitle, Body, Muted, Button, XpBar } from "../../ui/components";
import { FitnessRings, RING_COLORS, type RingConfig } from "../../ui/FitnessRings";
import { LootCardView } from "../../ui/LootCardView";
import { randomRgb, type Rgb } from "../../lib/loot";
import { localDayKey } from "../../lib/dayKey";
import type { LootCard } from "../../db/schema";
import type { TaskSliceItem } from "../../lib/dailySlice";
import { newId } from "../../lib/id";

export default function TodayScreen() {
  const { store, tz, version } = useStore();
  const router = useRouter();
  const [view, setView] = useState<TodayView | null>(null);
  const [lootTakenToday, setLootTakenToday] = useState(false);
  const [pendingLoot, setPendingLoot] = useState<Rgb | null>(null);

  const load = useCallback(() => {
    let active = true;
    const dayKey = localDayKey(Date.now(), tz);
    Promise.all([
      getTodayView(store, Date.now(), tz),
      store.listLootCards(),
    ]).then(([v, loot]) => {
      if (!active) return;
      setView(v);
      setLootTakenToday(loot.some((c) => localDayKey(c.collected_at, tz) === dayKey));
      setPendingLoot(null);
    });
    return () => { active = false; };
  }, [store, tz, version]);

  useFocusEffect(load);

  if (!view) return null;

  const { slice, streak, maxStreak, xp, hasActiveTasks } = view;
  const allDone = hasActiveTasks && slice.tasks.length === 0;
  const showLootbox = allDone && !lootTakenToday;

  const openCard = () => setPendingLoot(randomRgb());

  const takeCard = async () => {
    if (!pendingLoot) return;
    const card: LootCard = {
      id: newId(),
      r: pendingLoot.r,
      g: pendingLoot.g,
      b: pendingLoot.b,
      collected_at: Date.now(),
    };
    await store.insertLootCard(card);
    setLootTakenToday(true);
    setPendingLoot(null);
  };

  const ringConfigs: RingConfig[] = view.allTaskProgress.map((item) => ({
    color: RING_COLORS[item.task.type] ?? "#1f6feb",
    totalSegments: item.totalSegments,
    filledSegments: item.filledSegments,
  }));

  return (
    <Screen>
      <Title>Today</Title>
      <Card>
        {ringConfigs.length > 0 && (
          <View style={{ alignItems: "center", paddingVertical: 8 }}>
            <FitnessRings rings={ringConfigs} size={180} strokeWidth={16} ringGap={8} />
          </View>
        )}
        <XpBar level={xp.level} xpIntoLevel={xp.xpIntoLevel} xpForLevel={xp.xpForLevel} />
        <Muted>
          {streak > 0 ? `🔥 ${streak}-day streak` : "Start a streak today"}
          {maxStreak > 0 ? ` · best ${maxStreak}` : ""}
        </Muted>
      </Card>

      {slice.tasks.map((item) => (
        <TaskRow key={item.task.id} item={item} />
      ))}

      {allDone && !showLootbox && !pendingLoot && (
        <Card>
          <Subtitle>All clear ✅</Subtitle>
          <Body>All tasks done for today.</Body>
        </Card>
      )}

      {!hasActiveTasks && slice.tasks.length === 0 && (
        <Card>
          <Subtitle>All clear ✅</Subtitle>
          <Body>Nothing left for today. Add tasks in Library.</Body>
        </Card>
      )}

      {pendingLoot && (
        <Card>
          <Muted>Your card for today</Muted>
          <View style={{ alignItems: "center", paddingVertical: 8 }}>
            <LootCardView r={pendingLoot.r} g={pendingLoot.g} b={pendingLoot.b} width={200} />
          </View>
          <Button label="Take Card" onPress={takeCard} />
        </Card>
      )}

      {showLootbox && !pendingLoot && (
        <Card>
          <Subtitle>Daily reward 🎁</Subtitle>
          <Body>You finished everything today. Open your card!</Body>
          <Button label="Open Card" onPress={openCard} />
        </Card>
      )}
    </Screen>
  );
}

function TaskRow({ item }: { item: TaskSliceItem }) {
  const router = useRouter();
  const { task, count, flashcards } = item;

  const go = () => {
    if (task.type === "youtube") router.push(`/task/youtube?taskId=${task.id}`);
    else if (task.type === "reading") router.push(`/task/reading?taskId=${task.id}`);
    else router.push(`/review?taskId=${task.id}`);
  };

  const noneDue = task.type === "flashcard" && (flashcards?.queue.length ?? 0) === 0;

  const subtitle =
    task.type === "flashcard"
      ? noneDue
        ? "no cards due right now"
        : `${count} card${count === 1 ? "" : "s"} left`
      : task.makes_cards_count > 0
        ? `then make ${task.makes_cards_count} card${task.makes_cards_count === 1 ? "" : "s"}`
        : "1 session";

  return (
    <Card>
      <Subtitle>{task.title}</Subtitle>
      <Muted>{`${labelFor(task.type)} · ${subtitle}`}</Muted>
      {flashcards && (
        <Muted>{`${flashcards.reviewedToday} of ${flashcards.goal} done today`}</Muted>
      )}
      <Button
        label={task.type === "flashcard" ? "Review" : "Open"}
        kind="neutral"
        onPress={go}
        disabled={noneDue}
      />
    </Card>
  );
}

function labelFor(type: string): string {
  return type === "youtube" ? "Watch" : type === "reading" ? "Read" : "Flashcards";
}
