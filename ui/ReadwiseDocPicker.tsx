import { useState } from "react";
import { TextInput, View, StyleSheet } from "react-native";
import { createReadwiseClient } from "../services/readwiseService";
import { ReadwiseAuthError, ReadwiseNetworkError, type ReadwiseDocument } from "../lib/readwise";
import { Muted, Button } from "./components";
import { colors, radius, space } from "./theme";

/**
 * Resolve a Readwise document id from its title, so a reading task can be set
 * up without hunting for the opaque id by hand. Searches the user's library
 * and lets them tap the right result; the chosen id flows back via onPick.
 */
export function ReadwiseDocPicker({
  selected,
  onPick,
}: {
  selected: { id: string; title: string } | null;
  onPick: (doc: ReadwiseDocument) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReadwiseDocument[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setNote(null);
    try {
      const matches = await createReadwiseClient().findDocumentsByTitle(query);
      setResults(matches);
      if (matches.length === 0) setNote("No matching documents in your Readwise library.");
    } catch (e) {
      setResults([]);
      if (e instanceof ReadwiseAuthError) setNote("Add your Readwise token in Settings first.");
      else if (e instanceof ReadwiseNetworkError) setNote("Network problem — try again.");
      else setNote((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      <Muted>Find your Readwise document by title</Muted>
      <TextInput
        placeholder="Document title"
        placeholderTextColor={colors.muted}
        value={query}
        onChangeText={setQuery}
        style={styles.input}
      />
      <Button label={searching ? "Searching…" : "Find document"} kind="neutral" onPress={search} />

      {results.map((doc) => (
        <Button
          key={doc.id}
          label={doc.title}
          kind={selected?.id === doc.id ? "primary" : "neutral"}
          onPress={() => onPick(doc)}
        />
      ))}

      {note && <Muted>{note}</Muted>}
      {selected && <Muted>Selected: {selected.title}</Muted>}
    </View>
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
