import { useCallback, useState } from "react";
import { TextInput, View, StyleSheet } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useStore } from "../../ui/StoreProvider";
import { createHabit, logHabit } from "../../services/habits";
import { localDayKey } from "../../lib/dayKey";
import { Screen, Card, Title, Subtitle, Muted, Button } from "../../ui/components";
import { colors, radius, space } from "../../ui/theme";
import type { Habit, HabitLog } from "../../db/schema";

export default function HabitsScreen() {
  const { store, tz, reload, version } = useStore();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [todayLogs, setTodayLogs] = useState<HabitLog[]>([]);

  const load = useCallback(() => {
    let active = true;
    const dayKey = localDayKey(Date.now(), tz);
    Promise.all([
      store.listHabits({ activeOnly: true }),
      store.listHabitLogsForDay(dayKey),
    ]).then(([hs, logs]) => {
      if (!active) return;
      setHabits(hs);
      setTodayLogs(logs);
    });
    return () => {
      active = false;
    };
  }, [store, tz, version]);

  useFocusEffect(load);

  return (
    <Screen>
      <Title>Habits</Title>

      {habits.length === 0 && (
        <Muted>
          No habits yet. A habit is an identity you're voting for, plus one small
          action you can do today.
        </Muted>
      )}

      {habits.map((h) => (
        <HabitCard
          key={h.id}
          habit={h}
          doneToday={todayLogs.filter((l) => l.habit_id === h.id).length}
          onLogged={reload}
        />
      ))}

      <AddHabitForm onDone={reload} />
    </Screen>
  );
}

/** One habit: identity + name, the action as the log button, today's count. */
function HabitCard({
  habit,
  doneToday,
  onLogged,
}: {
  habit: Habit;
  doneToday: number;
  onLogged: () => void;
}) {
  const { store, tz } = useStore();
  const router = useRouter();
  // Non-null while the note composer is open (prompt_note habits only).
  const [note, setNote] = useState<string | null>(null);

  const commit = async (text: string | null) => {
    await logHabit(store, habit, { note: text }, Date.now(), tz);
    setNote(null);
    onLogged();
  };

  const onAction = () => {
    if (habit.prompt_note) setNote("");
    else void commit(null);
  };

  return (
    <Card>
      <Subtitle>{habit.name}</Subtitle>
      {habit.identity.length > 0 && <Muted>{habit.identity}</Muted>}
      <Button label={habit.action} onPress={onAction} />
      {note !== null && (
        <>
          <Field
            placeholder="How did it go? (optional)"
            value={note}
            onChangeText={setNote}
            multiline
            autoFocus
          />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Button label="Skip note" kind="neutral" onPress={() => void commit(null)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Save" kind="good" onPress={() => void commit(note)} />
            </View>
          </View>
        </>
      )}
      <Muted>
        {doneToday === 0 ? "not done today" : `${doneToday}× today`}
      </Muted>
      <Button
        label="View log"
        kind="neutral"
        onPress={() => router.push(`/habit?habitId=${habit.id}`)}
      />
    </Card>
  );
}

function AddHabitForm({ onDone }: { onDone: () => void }) {
  const { store } = useStore();
  const [identity, setIdentity] = useState("");
  const [name, setName] = useState("");
  const [action, setAction] = useState("");
  const [promptNote, setPromptNote] = useState(false);

  const canSubmit = Boolean(name.trim() && action.trim());

  const submit = async () => {
    if (!canSubmit) return;
    await createHabit(store, { identity, name, action, promptNote });
    setIdentity("");
    setName("");
    setAction("");
    setPromptNote(false);
    onDone();
  };

  return (
    <Card>
      <Subtitle>New habit</Subtitle>
      <Muted>Identity — who this makes you</Muted>
      <Field
        placeholder="I care about my health"
        value={identity}
        onChangeText={setIdentity}
      />
      <Muted>Habit — the overarching goal</Muted>
      <Field placeholder="Work out" value={name} onChangeText={setName} />
      <Muted>Action — the small thing you do today</Muted>
      <Field placeholder="Walk to the gym" value={action} onChangeText={setAction} />
      <Muted>Ask for a note when I log it</Muted>
      <View style={styles.row}>
        <Button
          label="No"
          kind={promptNote ? "neutral" : "primary"}
          onPress={() => setPromptNote(false)}
        />
        <Button
          label="Yes"
          kind={promptNote ? "primary" : "neutral"}
          onPress={() => setPromptNote(true)}
        />
      </View>
      <Button label="Add habit" onPress={submit} disabled={!canSubmit} />
    </Card>
  );
}

function Field(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={colors.muted} {...props} style={styles.input} />;
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
