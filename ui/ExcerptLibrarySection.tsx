import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { useStore } from "./StoreProvider";
import { excerptCounts, type ExcerptCounts } from "../services/excerpts";
import { syncExcerptsNow } from "../services/readwiseService";
import { ReadwiseAuthError } from "../lib/readwise";
import { Card, Subtitle, Muted, Button } from "./components";

/** Library summary of the excerpt queue, with a manual sync and the pile. */
export function ExcerptLibrarySection() {
  const { store, version, reload } = useStore();
  const router = useRouter();
  const [counts, setCounts] = useState<ExcerptCounts | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    let active = true;
    excerptCounts(store).then((c) => active && setCounts(c));
    return () => {
      active = false;
    };
  }, [store, version]);
  useFocusEffect(load);

  const sync = async () => {
    setSyncing(true);
    setStatus(null);
    try {
      const r = await syncExcerptsNow(store);
      const parts = [
        r.newSources ? `${r.newSources} new source${r.newSources === 1 ? "" : "s"}` : null,
        r.added ? `${r.added} new excerpt${r.added === 1 ? "" : "s"}` : null,
        r.updated ? `${r.updated} updated` : null,
        r.removed ? `${r.removed} deleted in Readwise` : null,
      ].filter(Boolean);
      setStatus(parts.length ? parts.join(" · ") : "Up to date.");
      reload();
    } catch (e) {
      setStatus(
        e instanceof ReadwiseAuthError
          ? "Add your Readwise token in Settings first."
          : `Sync failed: ${(e as Error).message}`,
      );
    } finally {
      setSyncing(false);
    }
  };

  if (!counts) return null;

  return (
    <Card>
      <Subtitle>Excerpts</Subtitle>
      {counts.checkedSources === 0 ? (
        <Muted>Turn Readwise highlights into cards. Choose which books and articles to sync under Sources — nothing is synced until you check it.</Muted>
      ) : (
        <>
          <Muted>{`${counts.ready} in the daily queue · ${counts.waiting} put off until later`}</Muted>
          <Muted>{`${counts.carded} carded · ${counts.ignored} ignored · ${counts.setAside} set aside`}</Muted>
        </>
      )}
      {status && <Muted>{status}</Muted>}
      <Button
        label={`Sources · ${counts.checkedSources} active${counts.newSources ? ` · ${counts.newSources} new` : ""}`}
        kind={counts.newSources ? "primary" : "neutral"}
        onPress={() => router.push(counts.newSources ? "/excerpts/sources?tab=available" : "/excerpts/sources")}
      />
      <Button label={syncing ? "Syncing…" : "Sync now"} kind="neutral" onPress={sync} disabled={syncing} />
      {counts.ready > 0 && (
        <Button label="Review excerpts" kind="neutral" onPress={() => router.push("/excerpts/review")} />
      )}
      {counts.setAside > 0 && (
        <Button
          label={`Set-aside pile (${counts.setAside})`}
          kind="neutral"
          onPress={() => router.push("/excerpts/pile")}
        />
      )}
    </Card>
  );
}
