import { useCallback, useEffect, useState } from "react";
import { TextInput, View, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useStore } from "../ui/StoreProvider";
import { getFlashcardQueue, gradeCard, creditFlashcardTasks, editCard, setCardIgnored } from "../services/learning";
import { updateNote } from "../services/authoring";
import { countClozeSpans, makeFields, noteFields, clozeText } from "../lib/notes";
import { Screen, Card, Title, Body, Muted, Button } from "../ui/components";
import { MathText } from "../ui/MathText";
import type { Card as CardRow, Note, Rating } from "../db/schema";
import { colors, radius, space } from "../ui/theme";

const GRADES: { label: string; rating: Rating; kind: "danger" | "warn" | "good" | "primary" }[] = [
  { label: "Again", rating: "again", kind: "danger" },
  { label: "Hard", rating: "hard", kind: "warn" },
  { label: "Good", rating: "good", kind: "good" },
  { label: "Easy", rating: "easy", kind: "primary" },
];

export default function ReviewScreen() {
  const { store, tz } = useStore();
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const router = useRouter();
  const [queue, setQueue] = useState<CardRow[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editNote, setEditNote] = useState<Note | null>(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [editText, setEditText] = useState(""); // cloze source

  useEffect(() => {
    // Pull this flashcard task's deck-scoped queue: due cards in its deck,
    // capped to today's remaining goal, with sibling cards (multi-cloze /
    // reversed) buried so they don't appear back-to-back.
    if (!taskId) {
      setQueue([]);
      return;
    }
    store.getTask(taskId).then((task) => {
      if (!task) return setQueue([]);
      getFlashcardQueue(store, task, Date.now(), tz).then((fc) =>
        setQueue(fc.queue),
      );
    });
  }, [store, tz, taskId]);

  const advance = useCallback(() => {
    setRevealed(false);
    setEditing(false);
    setEditNote(null);
    setIndex((i) => i + 1);
  }, []);

  const finish = useCallback(async () => {
    // Crediting already happens per-grade (creditFlashcardTasks in gradeCard);
    // run once more to cover the edge where the cadence was met exactly as the
    // queue emptied, then return to Today.
    await creditFlashcardTasks(store, Date.now(), tz);
    router.back();
  }, [store, tz, router]);

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
    if (rating === "again") {
      setQueue((q) => [...q, card]);
      advance();
      return;
    }
    await gradeCard(store, card.id, rating, Date.now(), tz);
    setReviewed((n) => n + 1);
    advance();
  };

  const onIgnore = async () => {
    await setCardIgnored(store, card.id, true);
    advance(); // not counted as reviewed; recoverable from Library
  };

  const startEdit = async () => {
    if (card.note_id) {
      const n = await store.getNote(card.note_id);
      setEditNote(n);
      if (n) {
        const f = noteFields(n);
        if (n.kind === "cloze") setEditText(clozeText(f));
        else {
          setEditFront((f as { front: string }).front);
          setEditBack((f as { back: string }).back);
        }
      }
    } else {
      setEditNote(null);
      setEditFront(card.front);
      setEditBack(card.back);
    }
    setEditing(true);
  };

  const onSaveEdit = async () => {
    const isCloze = editNote?.kind === "cloze";
    if (editNote) {
      const fields = isCloze
        ? makeFields("cloze", { text: editText })
        : makeFields(editNote.kind, { front: editFront, back: editBack });
      await updateNote(store, editNote.id, fields);
      const refreshed = await store.listCardsByNote(editNote.id);
      const byId = new Map(refreshed.map((c) => [c.id, c]));
      setQueue((q) => q.map((c) => byId.get(c.id) ?? c));
    } else {
      await editCard(store, card.id, editFront, editBack);
      setQueue((q) =>
        q.map((c, i) => (i === index ? { ...c, front: editFront.trim(), back: editBack.trim() } : c)),
      );
    }
    setEditing(false);
    setEditNote(null);
  };

  const isCloze = editNote?.kind === "cloze";
  const spanCount = countClozeSpans(editText);
  const canSave = isCloze ? spanCount > 0 : Boolean(editFront.trim() && editBack.trim());

  if (editing) {
    return (
      <Screen>
        <Muted>{`Editing card ${index + 1} of ${queue.length}`}</Muted>
        <EditCard
          note={editNote}
          front={editFront}
          back={editBack}
          text={editText}
          isCloze={isCloze}
          spanCount={spanCount}
          canSave={canSave}
          onChangeFront={setEditFront}
          onChangeBack={setEditBack}
          onChangeText={setEditText}
          onSave={onSaveEdit}
          onCancel={() => { setEditing(false); setEditNote(null); }}
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
          <Button label="Edit" kind="neutral" onPress={startEdit} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Ignore" kind="neutral" onPress={onIgnore} />
        </View>
      </View>
    </Screen>
  );
}

function EditCard({
  note,
  front,
  back,
  text,
  isCloze,
  spanCount,
  canSave,
  onChangeFront,
  onChangeBack,
  onChangeText,
  onSave,
  onCancel,
}: {
  note: Note | null;
  front: string;
  back: string;
  text: string;
  isCloze: boolean;
  spanCount: number;
  canSave: boolean;
  onChangeFront: (v: string) => void;
  onChangeBack: (v: string) => void;
  onChangeText: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Card>
      {note && (
        <Muted>
          {isCloze
            ? `Cloze note · ${spanCount} card${spanCount === 1 ? "" : "s"} · editing updates every blank`
            : `${note.kind === "reversed" ? "Reversed" : "Basic"} note · editing updates both directions`}
        </Muted>
      )}
      {isCloze ? (
        <>
          <Muted>Sentence (wrap blanks in ==…==)</Muted>
          <TextInput
            value={text}
            onChangeText={onChangeText}
            multiline
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
        </>
      ) : (
        <>
          <Muted>Question</Muted>
          <TextInput
            value={front}
            onChangeText={onChangeFront}
            multiline
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <Muted>Answer</Muted>
          <TextInput
            value={back}
            onChangeText={onChangeBack}
            multiline
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
        </>
      )}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button label="Cancel" kind="neutral" onPress={onCancel} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Save" onPress={onSave} disabled={!canSave} />
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
