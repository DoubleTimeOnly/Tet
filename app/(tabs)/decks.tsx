import { useCallback, useState } from "react";
import { TextInput, View, StyleSheet } from "react-native";
import { useFocusEffect } from "expo-router";
import { useStore } from "../../ui/StoreProvider";
import { addCard, addNote, createTask, createDeck } from "../../services/authoring";
import { setCardIgnored } from "../../services/learning";
import { countClozeSpans, makeFields } from "../../lib/notes";
import { fetchYouTubeTitle, fetchPlaylistTitle, parsePlaylistId } from "../../lib/youtube";
import { createYoutubeApiKeyStore } from "../../adapters/tokenStore";
import { Screen, Card, Title, Subtitle, Body, Muted, Button } from "../../ui/components";
import { ReadwiseDocPicker } from "../../ui/ReadwiseDocPicker";
import { CardBrowser } from "../../ui/CardBrowser";
import { colors, radius, space } from "../../ui/theme";
import type { Deck, Task, TaskType, NoteKind, Card as CardRow } from "../../db/schema";

export default function LibraryScreen() {
  const { store, reload, version } = useStore();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [allCards, setAllCards] = useState<CardRow[]>([]);
  const [ignored, setIgnored] = useState<CardRow[]>([]);

  const load = useCallback(() => {
    let active = true;
    (async () => {
      const snap = await store.exportAll();
      if (!active) return;
      setDecks(snap.decks);
      setTasks(snap.tasks.filter((t) => t.active));
      setAllTasks(snap.tasks); // includes removed tasks, needed to label sources
      setAllCards(snap.cards);
      setIgnored(snap.cards.filter((c) => c.ignored));
    })();
    return () => {
      active = false;
    };
  }, [store, version]);

  const recover = async (id: string) => {
    await setCardIgnored(store, id, false);
    reload();
  };

  // Soft-remove: deactivate so it drops out of the Library and the daily slice
  // but its completion history (and your streak) stays intact.
  const removeTask = async (id: string) => {
    await store.setTaskActive(id, false);
    reload();
  };

  useFocusEffect(load);

  return (
    <Screen>
      <Title>Library</Title>

      <CardBrowser cards={allCards} tasks={allTasks} onChanged={reload} />

      <AddCardForm decks={decks} onDone={reload} />

      {ignored.length > 0 && (
        <>
          <Subtitle>Ignored cards</Subtitle>
          <Muted>Hidden from review but kept here — recover any time.</Muted>
          {ignored.map((c) => (
            <Card key={c.id}>
              <Body>{c.front}</Body>
              <Button label="Recover" kind="neutral" onPress={() => recover(c.id)} />
            </Card>
          ))}
        </>
      )}

      <Subtitle>Tasks</Subtitle>
      {tasks.map((t) => (
        <Card key={t.id}>
          <Body>{t.title}</Body>
          <Muted>{`${t.type} · cadence ${t.cadence}${t.makes_cards_count ? ` · make ${t.makes_cards_count}` : ""}`}</Muted>
          <Button label="Remove" kind="neutral" onPress={() => removeTask(t.id)} />
        </Card>
      ))}

      <AddTaskForm onDone={reload} />
    </Screen>
  );
}

const KIND_LABELS: Record<NoteKind, string> = {
  basic: "Basic",
  cloze: "Cloze",
  reversed: "Reversed",
};

function AddCardForm({ decks, onDone }: { decks: Deck[]; onDone: () => void }) {
  const { store } = useStore();
  const [kind, setKind] = useState<NoteKind>("basic");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [text, setText] = useState(""); // cloze shared source
  const [deckId, setDeckId] = useState<string | null>(null);

  const target = deckId ?? decks[0]?.id ?? null;

  const spanCount = countClozeSpans(text);
  const canSubmit =
    kind === "cloze" ? spanCount > 0 : Boolean(front.trim() && back.trim());

  const submit = async () => {
    if (!canSubmit) return;
    let dest = target;
    if (!dest) dest = (await createDeck(store, "My deck")).id;

    if (kind === "basic") {
      // A plain basic card stays note-less (its front/back are edited directly).
      await addCard(store, { deckId: dest, front: front.trim(), back: back.trim() });
    } else {
      await addNote(store, {
        deckId: dest,
        kind,
        fields:
          kind === "cloze"
            ? makeFields("cloze", { text })
            : makeFields("reversed", { front, back }),
      });
    }
    setFront("");
    setBack("");
    setText("");
    onDone();
  };

  return (
    <Card>
      <Subtitle>New flashcard</Subtitle>
      {decks.length > 1 && (
        <View style={styles.row}>
          {decks.map((d) => (
            <Button
              key={d.id}
              label={d.name}
              kind={d.id === target ? "primary" : "neutral"}
              onPress={() => setDeckId(d.id)}
            />
          ))}
        </View>
      )}
      <View style={styles.row}>
        {(Object.keys(KIND_LABELS) as NoteKind[]).map((k) => (
          <Button
            key={k}
            label={KIND_LABELS[k]}
            kind={k === kind ? "primary" : "neutral"}
            onPress={() => setKind(k)}
          />
        ))}
      </View>
      {kind === "cloze" ? (
        <>
          <Field
            placeholder="Sentence with ==blanks== wrapped in =="
            value={text}
            onChangeText={setText}
            multiline
          />
          <Muted>
            {spanCount === 0
              ? "Wrap each answer in ==…== to make a blank"
              : `${spanCount} blank${spanCount === 1 ? "" : "s"} → ${spanCount} card${spanCount === 1 ? "" : "s"}`}
          </Muted>
        </>
      ) : (
        <>
          <Field placeholder="Front" value={front} onChangeText={setFront} />
          <Field placeholder="Back" value={back} onChangeText={setBack} />
          {kind === "reversed" && <Muted>Asked both directions → 2 cards</Muted>}
        </>
      )}
      <Button label="Add card" onPress={submit} disabled={!canSubmit} />
    </Card>
  );
}

function AddTaskForm({ onDone }: { onDone: () => void }) {
  const { store } = useStore();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("youtube");
  const [sourceRef, setSourceRef] = useState("");
  const [pickedDoc, setPickedDoc] = useState<{ id: string; title: string } | null>(null);
  const [cadence, setCadence] = useState("1");
  const [makes, setMakes] = useState("0");
  const [ytKeyStore] = useState(createYoutubeApiKeyStore);

  // For reading tasks the source_ref is the Readwise doc id picked below.
  const resolvedSourceRef = type === "reading" ? (pickedDoc?.id ?? "") : sourceRef;

  const isPlaylist = type === "youtube" && parsePlaylistId(sourceRef) !== null;

  // Pull a title from the URL once it parses (YouTube tasks). A playlist needs
  // the API key to resolve its name; fall back to a generic label. Only fills an
  // empty title so a name you typed yourself isn't clobbered.
  const fillTitleFromUrl = async () => {
    if (title.trim()) return;
    const playlistId = parsePlaylistId(sourceRef);
    if (playlistId) {
      const key = await ytKeyStore.getToken();
      const name = key ? await fetchPlaylistTitle(playlistId, key) : null;
      setTitle(name ?? "YouTube playlist");
      return;
    }
    const fetched = await fetchYouTubeTitle(sourceRef);
    if (fetched) setTitle(fetched);
  };

  const submit = async () => {
    if (!title.trim()) return;
    await createTask(store, {
      type,
      title: title.trim(),
      sourceRef: resolvedSourceRef.trim() || null,
      cadence: Math.max(1, parseInt(cadence, 10) || 1),
      // Making cards is optional for YouTube; the make-N gate is reading-only.
      makesCardsCount: type === "reading" ? Math.max(0, parseInt(makes, 10) || 0) : 0,
      readingTarget: type === "reading" ? 0.9 : null,
    });
    setTitle("");
    setSourceRef("");
    setPickedDoc(null);
    onDone();
  };

  return (
    <Card>
      <Subtitle>New task</Subtitle>
      <View style={styles.row}>
        {(["flashcard", "youtube", "reading"] as TaskType[]).map((t) => (
          <Button key={t} label={t} kind={t === type ? "primary" : "neutral"} onPress={() => setType(t)} />
        ))}
      </View>
      <Field placeholder="Title" value={title} onChangeText={setTitle} />
      {type === "youtube" && (
        <>
          <Field
            placeholder="YouTube video or playlist URL"
            value={sourceRef}
            onChangeText={setSourceRef}
            onBlur={fillTitleFromUrl}
            autoCapitalize="none"
          />
          {isPlaylist && (
            <Muted>Playlist task — samples one unwatched video per day (needs a YouTube API key in Settings).</Muted>
          )}
        </>
      )}
      {type === "reading" && (
        <ReadwiseDocPicker
          selected={pickedDoc}
          onPick={(doc) => {
            setPickedDoc(doc);
            if (!title.trim()) setTitle(doc.title);
          }}
        />
      )}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Muted>Cadence/day</Muted>
          <Field placeholder="1" value={cadence} onChangeText={setCadence} keyboardType="number-pad" />
        </View>
        {type === "reading" && (
          <View style={{ flex: 1 }}>
            <Muted>Make N cards</Muted>
            <Field placeholder="0" value={makes} onChangeText={setMakes} keyboardType="number-pad" />
          </View>
        )}
      </View>
      <Button label="Add task" onPress={submit} />
    </Card>
  );
}

function Field(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      {...props}
      style={styles.input}
    />
  );
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
