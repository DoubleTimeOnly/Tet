import { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useStore } from "../../ui/StoreProvider";
import {
  dismissNewSource,
  hideSource,
  markSourceDone,
  moveSourceRank,
  uncheckSource,
  unhideSource,
} from "../../services/excerpts";
import { checkSourceNow, reopenSourceNow, syncExcerptsNow } from "../../services/readwiseService";
import { rankedSources, sourceStats, type SourceStats } from "../../lib/excerpts";
import { ReadwiseAuthError } from "../../lib/readwise";
import { Screen, Card, Title, Body, Muted, Button } from "../../ui/components";
import { colors, radius, space } from "../../ui/theme";
import type { ExcerptSource } from "../../db/schema";

type Tab = "active" | "available" | "done" | "hidden";
const TAB_LABELS: Record<Tab, string> = {
  active: "Active",
  available: "Available",
  done: "Done",
  hidden: "Hidden",
};
/** Long lists are capped; the search box is how you find a specific source. */
const LIST_LIMIT = 100;
const EMPTY: SourceStats = { undecided: 0, setAside: 0, carded: 0, ignored: 0 };

/**
 * Which Readwise sources feed excerpt review. Only checked (Active) sources
 * are synced; their order here is the daily queue's block order. Available
 * lists everything else, new ones first. Hidden and Done declutter.
 */
export default function SourcesScreen() {
  const { store, version, reload } = useStore();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.tab ?? "active");
  const [sources, setSources] = useState<ExcerptSource[] | null>(null);
  const [stats, setStats] = useState<Map<string, SourceStats>>(new Map());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The source whose "Done" is asking what to do with its undecided excerpts.
  const [confirmDone, setConfirmDone] = useState<string | null>(null);

  const load = useCallback(() => {
    let active = true;
    Promise.all([store.listExcerptSources(), store.listExcerpts()]).then(([s, e]) => {
      if (!active) return;
      setSources(s);
      setStats(sourceStats(e));
    });
    return () => {
      active = false;
    };
  }, [store, version]);
  useFocusEffect(load);

  const run = async (fn: () => Promise<unknown>, ok?: (r: unknown) => string | null) => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await fn();
      setStatus(ok ? ok(r) : null);
    } catch (e) {
      setStatus(
        e instanceof ReadwiseAuthError
          ? "Add your Readwise token in Settings first."
          : `Readwise: ${(e as Error).message}`,
      );
    } finally {
      setBusy(false);
      setConfirmDone(null);
      reload();
    }
  };

  const lists = useMemo(() => {
    const all = sources ?? [];
    const q = query.trim().toLowerCase();
    const match = (s: ExcerptSource) =>
      !q || s.title.toLowerCase().includes(q) || (s.author ?? "").toLowerCase().includes(q);
    const byCount = (a: ExcerptSource, b: ExcerptSource) =>
      b.num_highlights - a.num_highlights || a.title.localeCompare(b.title);
    return {
      active: rankedSources(all).filter(match),
      available: [
        ...all.filter((s) => s.state === "new").sort(byCount),
        ...all.filter((s) => s.state === "unchecked").sort(byCount),
      ].filter(match),
      done: all
        .filter((s) => s.state === "done")
        .sort((a, b) => (b.done_at ?? 0) - (a.done_at ?? 0))
        .filter(match),
      hidden: all.filter((s) => s.state === "hidden").sort(byCount).filter(match),
    };
  }, [sources, query]);

  if (!sources) return null;
  const newCount = sources.filter((s) => s.state === "new").length;
  const shown = lists[tab].slice(0, LIST_LIMIT);

  const refresh = () =>
    run(
      () => syncExcerptsNow(store),
      (r) => {
        const x = r as Awaited<ReturnType<typeof syncExcerptsNow>>;
        const parts = [
          x.newSources ? `${x.newSources} new source${x.newSources === 1 ? "" : "s"}` : null,
          x.added ? `${x.added} new excerpt${x.added === 1 ? "" : "s"}` : null,
          x.updated ? `${x.updated} updated` : null,
        ].filter(Boolean);
        return parts.length ? parts.join(" · ") : "Up to date.";
      },
    );

  const check = (s: ExcerptSource) =>
    run(
      () => checkSourceNow(store, s.id),
      (r) => {
        const added = (r as { added: number }).added;
        return `${s.title}: ${added} excerpt${added === 1 ? "" : "s"} added.`;
      },
    );

  const done = (s: ExcerptSource) => {
    if ((stats.get(s.id) ?? EMPTY).undecided > 0) setConfirmDone(s.id);
    else void run(() => markSourceDone(store, s.id, "leave"));
  };

  const focus = (s: ExcerptSource) => router.push(`/excerpts/review?sourceId=${s.id}`);

  return (
    <Screen>
      <Title>Sources</Title>
      <Muted>
        Only Active sources sync. The daily queue works through them top to bottom, one at a time.
      </Muted>
      <Button label={busy ? "Working…" : "Refresh from Readwise"} kind="neutral" onPress={refresh} disabled={busy} />
      {status && <Muted>{status}</Muted>}

      <View style={styles.tabs}>
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <Button
            key={t}
            small
            label={
              t === "available" && newCount > 0
                ? `${TAB_LABELS[t]} · ${newCount} new`
                : `${TAB_LABELS[t]} (${lists[t].length})`
            }
            kind={t === tab ? "primary" : "neutral"}
            onPress={() => setTab(t)}
          />
        ))}
      </View>

      {sources.length > 10 && (
        <TextInput
          placeholder="Search sources"
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          style={styles.input}
        />
      )}

      {shown.length === 0 && <Muted>{emptyText(tab, sources.length)}</Muted>}
      {lists[tab].length > shown.length && (
        <Muted>{`Showing ${shown.length} of ${lists[tab].length} — search to narrow.`}</Muted>
      )}

      {shown.map((s, i) => {
        const st = stats.get(s.id) ?? EMPTY;
        return (
          <Card key={s.id}>
            <View style={styles.titleRow}>
              {s.state === "new" && <Text style={styles.badge}>NEW</Text>}
              <Body>{s.title}</Body>
            </View>
            <Muted>{detailLine(s, st)}</Muted>

            {tab === "active" &&
              (confirmDone === s.id ? (
                <>
                  <Muted>{`${st.undecided} undecided excerpt${st.undecided === 1 ? "" : "s"} left.`}</Muted>
                  <Row>
                    <Button small label="Ignore all" kind="neutral" onPress={() => run(() => markSourceDone(store, s.id, "ignore"))} />
                    <Button small label="Leave them" kind="neutral" onPress={() => run(() => markSourceDone(store, s.id, "leave"))} />
                    <Button small label="Cancel" kind="neutral" onPress={() => setConfirmDone(null)} />
                  </Row>
                </>
              ) : (
                <Row>
                  <Button small label="↑" kind="neutral" disabled={busy || i === 0 || !!query} onPress={() => run(() => moveSourceRank(store, s.id, "up"))} />
                  <Button small label="↓" kind="neutral" disabled={busy || i === shown.length - 1 || !!query} onPress={() => run(() => moveSourceRank(store, s.id, "down"))} />
                  {st.undecided > 0 && <Button small label="Focus" kind="neutral" onPress={() => focus(s)} />}
                  <Button small label="Done" kind="neutral" disabled={busy} onPress={() => done(s)} />
                  <Button small label="Uncheck" kind="neutral" disabled={busy} onPress={() => run(() => uncheckSource(store, s.id))} />
                </Row>
              ))}

            {tab === "available" && (
              <Row>
                <Button small label="Check" disabled={busy} onPress={() => check(s)} />
                {s.state === "new" && (
                  <Button small label="Not now" kind="neutral" disabled={busy} onPress={() => run(() => dismissNewSource(store, s.id))} />
                )}
                <Button small label="Hide" kind="neutral" disabled={busy} onPress={() => run(() => hideSource(store, s.id))} />
                {st.undecided > 0 && <Button small label="Focus" kind="neutral" onPress={() => focus(s)} />}
              </Row>
            )}

            {tab === "done" && (
              <Row>
                {st.undecided > 0 && <Button small label="Focus" kind="neutral" onPress={() => focus(s)} />}
                <Button small label="Reopen" kind="neutral" disabled={busy} onPress={() => run(() => reopenSourceNow(store, s.id))} />
              </Row>
            )}

            {tab === "hidden" && (
              <Row>
                <Button small label="Unhide" kind="neutral" disabled={busy} onPress={() => run(() => unhideSource(store, s.id))} />
              </Row>
            )}
          </Card>
        );
      })}
    </Screen>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function detailLine(s: ExcerptSource, st: SourceStats): string {
  const meta = [s.author, s.category].filter(Boolean).join(" · ");
  if (s.state === "new" || s.state === "unchecked" || s.state === "hidden") {
    const n = `${s.num_highlights} highlight${s.num_highlights === 1 ? "" : "s"}`;
    return meta ? `${n} · ${meta}` : n;
  }
  const work = `${st.undecided} undecided · ${st.carded} carded · ${st.ignored} ignored${st.setAside ? ` · ${st.setAside} set aside` : ""}`;
  return meta ? `${work}\n${meta}` : work;
}

function emptyText(tab: Tab, total: number): string {
  if (total === 0) return "No sources yet. Add your Readwise token in Settings, then Refresh.";
  switch (tab) {
    case "active":
      return "Nothing checked. Check sources under Available to start syncing their highlights.";
    case "available":
      return "Nothing left to choose from.";
    case "done":
      return "Sources you mark done land here, with what you made of them.";
    case "hidden":
      return "Nothing hidden.";
  }
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  badge: {
    color: colors.text,
    backgroundColor: colors.accent,
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
  },
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
