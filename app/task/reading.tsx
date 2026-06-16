import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useStore } from "../../ui/StoreProvider";
import { completeTask } from "../../services/learning";
import { createReadwiseClient } from "../../services/readwiseService";
import { ReadwiseAuthError, ReadwiseNetworkError } from "../../lib/readwise";
import { MakeCardsSection } from "../../ui/MakeCardsSection";
import { Screen, Card, Title, Subtitle, Body, Muted, Button } from "../../ui/components";
import type { Task } from "../../db/schema";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "progress"; fraction: number; complete: boolean }
  | { kind: "auth" }
  | { kind: "error"; message: string };

export default function ReadingTaskScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const { store, tz, reload } = useStore();
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    if (taskId) store.getTask(taskId).then(setTask);
  }, [store, taskId]);

  const check = async () => {
    if (!task?.source_ref) return;
    setStatus({ kind: "checking" });
    try {
      const client = createReadwiseClient();
      const progress = await client.getProgress(task.source_ref, task.reading_target ?? undefined);
      setStatus({ kind: "progress", fraction: progress.fraction, complete: progress.isComplete });
      if (progress.isComplete) {
        await completeTask(store, task, { type: "reading", readwise_fraction: progress.fraction }, Date.now(), tz);
        reload();
      }
    } catch (e) {
      if (e instanceof ReadwiseAuthError) setStatus({ kind: "auth" });
      else if (e instanceof ReadwiseNetworkError) setStatus({ kind: "error", message: "Network problem — try again." });
      else setStatus({ kind: "error", message: (e as Error).message });
    }
  };

  if (!task) return null;
  const target = Math.round((task.reading_target ?? 0.9) * 100);

  return (
    <Screen>
      <Title>{task.title}</Title>
      <Muted>Verified against Readwise reading progress (target {target}%).</Muted>

      <Card>
        <Subtitle>Reading verification</Subtitle>
        {status.kind === "idle" && <Body>Read in Readwise, then check progress here.</Body>}
        {status.kind === "checking" && <Body>Checking…</Body>}
        {status.kind === "progress" && (
          <Body>
            {Math.round(status.fraction * 100)}% read —{" "}
            {status.complete ? "complete ✅" : "keep going"}
          </Body>
        )}
        {status.kind === "auth" && <Body>Readwise token missing or rejected. Add it in Settings.</Body>}
        {status.kind === "error" && <Body>{status.message}</Body>}
        <Button label="Check Readwise" onPress={check} />
      </Card>

      {task.makes_cards_count > 0 && <MakeCardsSection task={task} />}

      {status.kind === "auth" && (
        <Button label="Go to Settings" kind="neutral" onPress={() => router.replace("/settings")} />
      )}
    </Screen>
  );
}
