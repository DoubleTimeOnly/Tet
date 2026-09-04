import { useCallback, useState } from "react";
import { Pressable, Text, TextInput, View, StyleSheet } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useStore } from "../../ui/StoreProvider";
import { createHabit, logHabit, moveHabit } from "../../services/habits";
import { localDayKey } from "../../lib/dayKey";
import { isAtEdge } from "../../lib/habitOrder";
import { Screen, Card, Title, Subtitle, Muted, Button } from "../../ui/components";
import { colors, radius, space } from "../../ui/theme";
import type { Habit, HabitLog } from "../../db/schema";

export default function HabitsScreen() {
  const { store, tz, reload, version } = useStore();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [todayLogs, setTodayLogs] = useState<HabitLog[]>([]);
  const [adding, setAdding] = useState(false);

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

  const move = async (id: string, delta: -1 | 1) => {
    await moveHabit(store, id, delta);
    reload();
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Title>Habits</Title>
        <IconButton
          label="+ Add habit"
          accessibilityLabel="Add habit"
          onPress={() => setAdding((v) => !v)}
          active={adding}
          wide
        />
      </View>

      {adding && (
        <AddHabitForm
          onDone={() => {
            setAdding(false);
            reload();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {habits.length === 0 && !adding && (
        <Card>
          <Subtitle>No habits yet</Subtitle>
          <Muted>
            A habit is an identity you&apos;re voting for plus one small action you
            can do today. Tap &quot;+ Add habit&quot; to make your first one.
          </Muted>
        </Card>
      )}

      {habits.map((h, i) => (
        <HabitCard
          key={h.id}
          habit={h}
          doneToday={todayLogs.filter((l) => l.habit_id === h.id).length}
          canMoveUp={!isAtEdge(i, habits.length, -1)}
          canMoveDown={!isAtEdge(i, habits.length, 1)}
          onMove={(delta) => move(h.id, delta)}
          onLogged={reload}
        />
      ))}
    </Screen>
  );
}

/**
 * One habit. The top row carries the reorder handles on the left, the name and
 * identity in the middle, and the detail/log button on the right; the action
 * itself is the wide button below, since logging is the thing you came to do.
 */
function HabitCard({
  habit,
  doneToday,
  canMoveUp,
  canMoveDown,
  onMove,
  onLogged,
}: {
  habit: Habit;
  doneToday: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
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
      <View style={styles.topRow}>
        <View style={styles.handles}>
          <IconButton
            label="▲"
            accessibilityLabel={`Move ${habit.name} up`}
            onPress={() => onMove(-1)}
            disabled={!canMoveUp}
          />
          <IconButton
            label="▼"
            accessibilityLabel={`Move ${habit.name} down`}
            onPress={() => onMove(1)}
            disabled={!canMoveDown}
          />
        </View>
        <View style={styles.titleBlock}>
          <Subtitle>{habit.name}</Subtitle>
          {habit.identity.length > 0 && <Muted>{habit.identity}</Muted>}
        </View>
        <IconButton
          label="📋"
          accessibilityLabel={`${habit.name} log and settings`}
          onPress={() => router.push(`/habit?habitId=${habit.id}`)}
        />
      </View>

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

      <Muted>{doneToday === 0 ? "not done today" : `${doneToday}× today`}</Muted>
    </Card>
  );
}

function AddHabitForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { store } = useStore();
  const [identity, setIdentity] = useState("");
  const [name, setName] = useState("");
  const [action, setAction] = useState("");
  const [promptNote, setPromptNote] = useState(false);

  const canSubmit = Boolean(name.trim() && action.trim());

  const submit = async () => {
    if (!canSubmit) return;
    await createHabit(store, { identity, name, action, promptNote });
    onDone();
  };

  return (
    <Card>
      <Subtitle>New habit</Subtitle>
      <Muted>Identity — who this makes you</Muted>
      <Field placeholder="I care about my health" value={identity} onChangeText={setIdentity} />
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
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button label="Cancel" kind="neutral" onPress={onCancel} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Add habit" onPress={submit} disabled={!canSubmit} />
        </View>
      </View>
    </Card>
  );
}

/** Compact square button for the glyph controls (reorder, open detail, add). */
function IconButton({
  label,
  accessibilityLabel,
  onPress,
  disabled,
  active,
  wide,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  wide?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.icon,
        wide && styles.iconWide,
        active && { backgroundColor: colors.accent },
        pressed && { opacity: 0.6 },
        disabled && { opacity: 0.25 },
      ]}
    >
      <Text style={styles.iconText}>{label}</Text>
    </Pressable>
  );
}

function Field(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={colors.muted} {...props} style={styles.input} />;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  handles: { gap: space.xs },
  titleBlock: { flex: 1, gap: space.xs },
  row: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  icon: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    minWidth: 40,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWide: { paddingHorizontal: space.md, paddingVertical: space.sm },
  iconText: { color: colors.text, fontSize: 16, fontWeight: "600" },
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
