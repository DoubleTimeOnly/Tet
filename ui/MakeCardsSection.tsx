import { useCallback, useEffect, useState } from "react";
import { TextInput, StyleSheet } from "react-native";
import { useStore } from "./StoreProvider";
import { addCardFromTask } from "../services/authoring";
import { Card, Subtitle, Muted, Button } from "./components";
import { colors, radius, space } from "./theme";
import type { Task } from "../db/schema";

/**
 * Inline card authoring tied to a source task. Lets you turn what you just
 * watched/read into flashcards without leaving the screen; each card carries
 * source_task_id so it counts toward the task's makes_cards_count gate.
 */
export function MakeCardsSection({
  task,
  onChange,
}: {
  task: Task;
  onChange?: () => void;
}) {
  const { store } = useStore();
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [made, setMade] = useState(0);

  const refresh = useCallback(() => {
    store.countCardsBySourceTask(task.id).then(setMade);
  }, [store, task.id]);

  useEffect(refresh, [refresh]);

  const add = async () => {
    if (!front.trim() || !back.trim()) return;
    await addCardFromTask(store, task, front.trim(), back.trim());
    setFront("");
    setBack("");
    refresh();
    onChange?.();
  };

  const goal = task.makes_cards_count;
  const remaining = Math.max(0, goal - made);

  return (
    <Card>
      <Subtitle>Make cards from this</Subtitle>
      <Muted>
        {goal > 0
          ? `${made}/${goal} made${remaining > 0 ? ` · ${remaining} to go` : " · done ✅"}`
          : `${made} card${made === 1 ? "" : "s"} made`}
      </Muted>
      <TextInput
        placeholder="Front"
        placeholderTextColor={colors.muted}
        value={front}
        onChangeText={setFront}
        style={styles.input}
      />
      <TextInput
        placeholder="Back"
        placeholderTextColor={colors.muted}
        value={back}
        onChangeText={setBack}
        style={styles.input}
      />
      <Button label="Add card" onPress={add} />
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
  },
});
