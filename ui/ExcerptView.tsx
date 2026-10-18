import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useStore } from "./StoreProvider";
import { Card, Muted, Button } from "./components";
import { colors, radius, space } from "./theme";
import type { Excerpt } from "../db/schema";

/** "Title · Author", the one line of source context an excerpt carries. */
export function sourceLine(e: Excerpt): string {
  return e.book_author ? `${e.book_title} · ${e.book_author}` : e.book_title;
}

/**
 * One excerpt: the highlight, your Readwise note if any, its source, and a
 * link out to the original on Readwise. No surrounding text — by design.
 */
export function ExcerptView({
  excerpt,
  compact = false,
  selected,
  onPress,
}: {
  excerpt: Excerpt;
  /** Smaller text, for the card composer and pile. */
  compact?: boolean;
  /** Pile selection state; renders a highlighted border when true. */
  selected?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <Card style={selected ? styles.selected : undefined}>
      <Text selectable style={compact ? styles.textCompact : styles.text}>
        {excerpt.text}
      </Text>
      {excerpt.note && <Text style={styles.note}>{`Note: ${excerpt.note}`}</Text>}
      <View style={styles.sourceRow}>
        <Text style={styles.source} numberOfLines={2}>
          {sourceLine(excerpt)}
        </Text>
        {excerpt.url && (
          <Pressable hitSlop={12} onPress={() => void Linking.openURL(excerpt.url!)}>
            <Text style={styles.link}>Open ↗</Text>
          </Pressable>
        )}
      </View>
      {excerpt.source_deleted && <Muted>Deleted in Readwise</Muted>}
    </Card>
  );
  if (!onPress) return body;
  return <Pressable onPress={onPress}>{body}</Pressable>;
}

/** The excerpt(s) a card was written from, loaded on demand. */
export function ExcerptSources({ cardId }: { cardId: string }) {
  const { store } = useStore();
  const [excerpts, setExcerpts] = useState<Excerpt[] | null>(null);
  useEffect(() => {
    let active = true;
    store.listExcerptsForCard(cardId).then((e) => active && setExcerpts(e));
    return () => {
      active = false;
    };
  }, [store, cardId]);
  if (!excerpts) return null;
  if (excerpts.length === 0) return <Muted>Not written from an excerpt.</Muted>;
  return (
    <View style={{ gap: space.sm }}>
      <Muted>{excerpts.length === 1 ? "Written from" : `Written from ${excerpts.length} excerpts`}</Muted>
      {excerpts.map((e) => (
        <ExcerptView key={e.id} excerpt={e} compact />
      ))}
    </View>
  );
}

/**
 * Front/back fields for writing a card from excerpts. Plain multiline inputs
 * with sentence capitalisation and autocorrect on, so the keyboard's own mic
 * (Gboard / iOS dictation) works for speaking a card instead of typing it.
 */
export function CardFields({
  front,
  back,
  onChangeFront,
  onChangeBack,
}: {
  front: string;
  back: string;
  onChangeFront: (v: string) => void;
  onChangeBack: (v: string) => void;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <TextInput
        value={front}
        onChangeText={onChangeFront}
        placeholder="Front — the question"
        placeholderTextColor={colors.muted}
        multiline
        autoFocus
        autoCapitalize="sentences"
        autoCorrect
        style={styles.input}
      />
      <TextInput
        value={back}
        onChangeText={onChangeBack}
        placeholder="Back — the answer"
        placeholderTextColor={colors.muted}
        multiline
        autoCapitalize="sentences"
        autoCorrect
        style={styles.input}
      />
      <Muted>Tip: the mic on your keyboard dictates into either field.</Muted>
    </View>
  );
}

/** Two buttons side by side — the bottom bars' common row. */
export function ButtonRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export function RowButton(props: React.ComponentProps<typeof Button>) {
  return (
    <View style={{ flex: 1 }}>
      <Button {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  text: { color: colors.text, fontSize: 18, lineHeight: 26 },
  textCompact: { color: colors.text, fontSize: 15, lineHeight: 21 },
  note: { color: colors.text, fontSize: 14, fontStyle: "italic" },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  source: { color: colors.muted, fontSize: 14, flex: 1 },
  link: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  selected: { borderColor: colors.accent, borderWidth: 2 },
  row: { flexDirection: "row", gap: space.sm },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 17,
    minHeight: 72,
    textAlignVertical: "top",
  },
});
