import { useMemo, useState } from "react";
import { TextInput, View, StyleSheet } from "react-native";
import { useStore } from "./StoreProvider";
import { editCard, setCardIgnored } from "../services/learning";
import { updateNote } from "../services/authoring";
import { countClozeSpans, makeFields, noteFields, clozeText } from "../lib/notes";
import { Card as CardView, Subtitle, Muted, Button } from "./components";
import { MathText } from "./MathText";
import { colors, radius, space } from "./theme";
import {
  buildTaskMap,
  cardCategory,
  categoryCounts,
  sourceGroups,
  matchesQuery,
  CATEGORY_LABELS,
  type LibCategory,
} from "../lib/cardLibrary";
import type { Card, Note, Task } from "../db/schema";

/** Long lists are capped; the search bar is how you find a specific card. */
const LIST_LIMIT = 100;

/**
 * Hierarchical flashcard browser for the Library: Obsidian / YouTube / Readwise
 * at the top, drilling into a searchable card list (YouTube filters by source
 * video; Readwise first picks a per-document sub-deck). Cards can be edited and
 * soft-ignored in place. Ignored cards are hidden here — recover them from the
 * Library's "Ignored cards" section.
 */
export function CardBrowser({
  cards,
  tasks,
  onChanged,
}: {
  cards: Card[];
  tasks: Task[];
  onChanged: () => void;
}) {
  const [category, setCategory] = useState<LibCategory | null>(null);
  const [subdeck, setSubdeck] = useState<string | null>(null); // readwise document (task id)
  const [videoFilter, setVideoFilter] = useState<string | null>(null); // youtube source task id
  const [query, setQuery] = useState("");

  const taskById = useMemo(() => buildTaskMap(tasks), [tasks]);
  const active = useMemo(() => cards.filter((c) => !c.ignored), [cards]);
  const counts = useMemo(() => categoryCounts(active, taskById), [active, taskById]);

  const goRoot = () => {
    setCategory(null);
    setSubdeck(null);
    setVideoFilter(null);
    setQuery("");
  };
  const openCategory = (cat: LibCategory) => {
    setCategory(cat);
    setSubdeck(null);
    setVideoFilter(null);
    setQuery("");
  };

  // Top level: the three source categories.
  if (!category) {
    return (
      <>
        <Subtitle>Browse cards</Subtitle>
        {(Object.keys(CATEGORY_LABELS) as LibCategory[]).map((cat) => (
          <Button
            key={cat}
            kind="neutral"
            label={`${CATEGORY_LABELS[cat]} · ${counts[cat]} card${counts[cat] === 1 ? "" : "s"}`}
            onPress={() => openCategory(cat)}
          />
        ))}
      </>
    );
  }

  // Readwise, no document chosen yet: pick a sub-deck.
  if (category === "readwise" && !subdeck) {
    const docs = sourceGroups(active, taskById, "readwise");
    return (
      <>
        <BrowseHeader title="Readwise" onBack={goRoot} />
        {docs.length === 0 ? (
          <Muted>No Readwise cards yet.</Muted>
        ) : (
          docs.map((d) => (
            <Button
              key={d.taskId}
              kind="neutral"
              label={`${d.title} · ${d.count} card${d.count === 1 ? "" : "s"}`}
              onPress={() => setSubdeck(d.taskId)}
            />
          ))
        )}
      </>
    );
  }

  // Card list (Obsidian, YouTube, or a chosen Readwise document).
  let list = active.filter((c) => cardCategory(c, taskById) === category);
  let title = CATEGORY_LABELS[category];
  let back = goRoot;
  if (category === "readwise") {
    list = list.filter((c) => c.source_task_id === subdeck);
    title = taskById.get(subdeck!)?.title ?? "Readwise";
    back = () => setSubdeck(null);
  }
  if (category === "youtube" && videoFilter) {
    list = list.filter((c) => c.source_task_id === videoFilter);
  }

  const filtered = list.filter((c) => matchesQuery(c, query));
  const shown = filtered.slice(0, LIST_LIMIT);

  return (
    <>
      <BrowseHeader title={title} onBack={back} />

      {category === "youtube" && (
        <View style={styles.row}>
          <Button
            label="All videos"
            kind={videoFilter ? "neutral" : "primary"}
            onPress={() => setVideoFilter(null)}
          />
          {sourceGroups(active, taskById, "youtube").map((v) => (
            <Button
              key={v.taskId}
              label={v.title}
              kind={videoFilter === v.taskId ? "primary" : "neutral"}
              onPress={() => setVideoFilter(v.taskId)}
            />
          ))}
        </View>
      )}

      <TextInput
        placeholder="Search cards"
        placeholderTextColor={colors.muted}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        style={styles.input}
      />
      <Muted>
        {filtered.length} card{filtered.length === 1 ? "" : "s"}
        {filtered.length > shown.length ? ` · showing first ${shown.length}, refine with search` : ""}
      </Muted>

      {shown.map((c) => (
        <CardRow key={c.id} card={c} onChanged={onChanged} />
      ))}
    </>
  );
}

function BrowseHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={{ gap: space.sm }}>
      <Button label="← Back" kind="neutral" onPress={onBack} />
      <Subtitle>{title}</Subtitle>
    </View>
  );
}

function CardRow({ card, onChanged }: { card: Card; onChanged: () => void }) {
  const { store } = useStore();
  const [editing, setEditing] = useState(false);
  // The owning note (loaded on edit) — null for a standalone basic card.
  const [note, setNote] = useState<Note | null>(null);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [text, setText] = useState(""); // cloze shared source

  const startEdit = async () => {
    if (card.note_id) {
      const n = await store.getNote(card.note_id);
      setNote(n);
      if (n) {
        const f = noteFields(n);
        if (n.kind === "cloze") setText(clozeText(f));
        else {
          setFront((f as { front: string }).front);
          setBack((f as { back: string }).back);
        }
      }
    } else {
      setNote(null);
      setFront(card.front);
      setBack(card.back);
    }
    setEditing(true);
  };

  const isCloze = note?.kind === "cloze";
  const spanCount = countClozeSpans(text);
  const canSave = isCloze ? spanCount > 0 : Boolean(front.trim() && back.trim());

  const save = async () => {
    if (!canSave) return;
    if (note) {
      // Edit the shared source; every sibling card regenerates from it.
      const fields = isCloze
        ? makeFields("cloze", { text })
        : makeFields(note.kind, { front, back });
      await updateNote(store, note.id, fields);
    } else {
      await editCard(store, card.id, front, back);
    }
    setEditing(false);
    onChanged();
  };
  const ignore = async () => {
    await setCardIgnored(store, card.id, true);
    onChanged();
  };

  if (editing) {
    return (
      <CardView>
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
            <TextInput value={text} onChangeText={setText} multiline style={styles.input} />
          </>
        ) : (
          <>
            <Muted>Question</Muted>
            <TextInput value={front} onChangeText={setFront} multiline style={styles.input} />
            <Muted>Answer</Muted>
            <TextInput value={back} onChangeText={setBack} multiline style={styles.input} />
          </>
        )}
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Button label="Cancel" kind="neutral" onPress={() => setEditing(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Save" onPress={save} disabled={!canSave} />
          </View>
        </View>
      </CardView>
    );
  }

  return (
    <CardView>
      <MathText value={card.front} kind="subtitle" />
      <View style={styles.divider} />
      <MathText value={card.back} kind="body" />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button label="Edit" kind="neutral" onPress={startEdit} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Ignore" kind="neutral" onPress={ignore} />
        </View>
      </View>
    </CardView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: space.xs },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 16,
    minHeight: 44,
  },
});
