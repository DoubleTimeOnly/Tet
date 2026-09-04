import { useCallback, useState } from "react";
import { TextInput, View, StyleSheet } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { DateTime } from "luxon";
import { useStore } from "../ui/StoreProvider";
import { archiveHabit, updateHabit } from "../services/habits";
import { Screen, Card, Title, Subtitle, Body, Muted, Button } from "../ui/components";
import { colors, radius, space } from "../ui/theme";
import type { Habit, HabitLog } from "../db/schema";

/**
 * One habit's detail: edit the identity / name / action (the action is meant to
 * change as the habit scales up), and read the log — every time you did it,
 * newest first, with the action as it read then plus any note you left.
 */
export default function HabitScreen() {
  const { habitId } = useLocalSearchParams<{ habitId: string }>();
  const { store, tz, reload, version } = useStore();
  const [habit, setHabit] = useState<Habit | null>(null);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    let active = true;
    if (!habitId) return;
    Promise.all([store.getHabit(habitId), store.listHabitLogs(habitId)]).then(
      ([h, ls]) => {
        if (!active) return;
        setHabit(h);
        setLogs(ls);
      },
    );
    return () => {
      active = false;
    };
  }, [store, habitId, version]);

  useFocusEffect(load);

  if (!habit) return null;

  return (
    <Screen>
      <Title>{habit.name}</Title>
      {habit.identity.length > 0 && <Muted>{habit.identity}</Muted>}

      {editing ? (
        <HabitEditor
          habit={habit}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      ) : (
        <Card>
          <Muted>Current action</Muted>
          <Body>{habit.action}</Body>
          <Muted>
            {habit.prompt_note ? "Asks for a note when logged" : "Logs with one tap"}
          </Muted>
          <Button label="Edit habit" kind="neutral" onPress={() => setEditing(true)} />
        </Card>
      )}

      <Subtitle>Log</Subtitle>
      {logs.length === 0 ? (
        <Muted>Nothing logged yet.</Muted>
      ) : (
        <>
          <Muted>
            {logs.length} time{logs.length === 1 ? "" : "s"} total
          </Muted>
          {logs.map((l) => (
            <Card key={l.id}>
              <Body>{formatWhen(l.done_at, tz)}</Body>
              <Muted>{l.action}</Muted>
              {l.note && <Body>{l.note}</Body>}
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

function formatWhen(ms: number, tz: string): string {
  return DateTime.fromMillis(ms, { zone: tz }).toFormat("ccc d LLL yyyy · HH:mm");
}

/** Inline editor for a habit's fields, plus archiving. */
function HabitEditor({
  habit,
  onCancel,
  onSaved,
}: {
  habit: Habit;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { store } = useStore();
  const router = useRouter();
  const [identity, setIdentity] = useState(habit.identity);
  const [name, setName] = useState(habit.name);
  const [action, setAction] = useState(habit.action);
  const [promptNote, setPromptNote] = useState(habit.prompt_note);

  const save = async () => {
    if (!name.trim() || !action.trim()) return;
    await updateHabit(store, habit.id, { identity, name, action, promptNote });
    onSaved();
  };

  // Archiving keeps the log — it just drops out of the Habits list.
  const archive = async () => {
    await archiveHabit(store, habit.id);
    onSaved();
    router.back();
  };

  return (
    <Card>
      <Subtitle>Edit habit</Subtitle>
      <Muted>Identity</Muted>
      <Field placeholder="I care about my health" value={identity} onChangeText={setIdentity} />
      <Muted>Habit</Muted>
      <Field placeholder="Work out" value={name} onChangeText={setName} />
      <Muted>Action</Muted>
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
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button label="Cancel" kind="neutral" onPress={onCancel} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Save" onPress={save} />
        </View>
      </View>
      <Button label="Archive habit" kind="neutral" onPress={archive} />
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
