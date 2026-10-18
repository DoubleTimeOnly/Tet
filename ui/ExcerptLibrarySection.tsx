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
      setStatus(
        r.added === 0 && r.updated === 0
          ? "Up to date."
          : `${r.added} new · ${r.updated} updated${r.removed ? ` · ${r.removed} deleted in Readwise` : ""}`,
      );
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
  const total = counts.ready + counts.waiting + counts.setAside + counts.carded + counts.ignored;

  return (
    <Card>
      <Subtitle>Excerpts</Subtitle>
      {total === 0 ? (
        <Muted>Readwise highlights land here to triage into cards. They sync on their own once your token is in Settings.</Muted>
      ) : (
        <>
          <Muted>
            {`${counts.ready} ready${counts.backlog ? ` (${counts.backlog} from the backlog)` : ""} · ${counts.waiting} passed, coming back later`}
          </Muted>
          <Muted>{`${counts.carded} carded · ${counts.ignored} ignored · ${counts.setAside} set aside`}</Muted>
        </>
      )}
      {status && <Muted>{status}</Muted>}
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
