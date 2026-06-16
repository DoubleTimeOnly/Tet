import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Platform, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { YoutubeEmbed } from "../../ui/YoutubeEmbed";
import { useStore } from "../../ui/StoreProvider";
import { MakeCardsSection } from "../../ui/MakeCardsSection";
import { completeTask } from "../../services/learning";
import { parseYouTubeId } from "../../lib/youtube";
import { Screen, Card, Title, Subtitle, Body, Muted, Button } from "../../ui/components";
import { space } from "../../ui/theme";
import type { Task } from "../../db/schema";

export default function YoutubeTaskScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const { store, tz, reload } = useStore();
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [cardsTick, setCardsTick] = useState(0);

  useEffect(() => {
    if (taskId) store.getTask(taskId).then(setTask);
  }, [store, taskId]);

  const markDone = useCallback(async () => {
    if (!task) return;
    const completion = await completeTask(store, task, { type: "youtube", manual: true }, Date.now(), tz);
    reload();
    if (!completion.verified && task.makes_cards_count > 0) {
      // Watched, but the make-cards gate is still open — keep them here to finish it.
      const msg = `Make ${task.makes_cards_count} card(s) from this video below to complete the task.`;
      if (Platform.OS === "web") globalThis.alert?.(msg);
      else Alert.alert("Almost there", msg);
    } else {
      router.back();
    }
  }, [task, store, tz, reload, router]);

  if (!task) return null;

  const videoId = task.source_ref ? parseYouTubeId(task.source_ref) : null;
  const watchUrl = task.source_ref ?? (videoId ? `https://youtu.be/${videoId}` : "");

  return (
    <Screen>
      <Title>{task.title}</Title>
      {task.makes_cards_count > 0 && (
        <Muted>After watching, make {task.makes_cards_count} card(s) to complete this task.</Muted>
      )}

      {videoId && !blocked ? (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <YoutubeEmbed height={220} videoId={videoId} onError={() => setBlocked(true)} />
        </Card>
      ) : (
        <Card>
          <Subtitle>{blocked ? "Embedding blocked" : "No embeddable video"}</Subtitle>
          <Body>This video can't play inside the app. Watch it on YouTube, then mark it done.</Body>
          <Button
            label="Open in YouTube"
            kind="neutral"
            onPress={() => watchUrl && Linking.openURL(watchUrl)}
          />
        </Card>
      )}

      {task.makes_cards_count > 0 && (
        <MakeCardsSection key={cardsTick} task={task} onChange={() => setCardsTick((n) => n + 1)} />
      )}

      <View style={{ height: space.sm }} />
      <Button label="Done" kind="good" onPress={markDone} />
    </Screen>
  );
}
