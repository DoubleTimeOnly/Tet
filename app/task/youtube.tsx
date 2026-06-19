import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { YoutubeEmbed } from "../../ui/YoutubeEmbed";
import { useStore } from "../../ui/StoreProvider";
import { MakeCardsSection } from "../../ui/MakeCardsSection";
import { completeTask } from "../../services/learning";
import { parseYouTubeId, parsePlaylistId, fetchPlaylistItems } from "../../lib/youtube";
import {
  emptyPlaylistState,
  needsRefresh,
  pickForDay,
  markWatched,
  pickedVideo,
  type PlaylistState,
} from "../../lib/playlist";
import { localDayKey } from "../../lib/dayKey";
import { createYoutubeApiKeyStore } from "../../adapters/tokenStore";
import { Screen, Card, Title, Subtitle, Body, Muted, Button } from "../../ui/components";
import { space } from "../../ui/theme";
import type { Task } from "../../db/schema";

const NEEDS_KEY = "Add a YouTube API key in Settings to load this playlist.";

function parsePlaylistState(meta: string | null, playlistId: string): PlaylistState {
  if (!meta) return emptyPlaylistState(playlistId);
  try {
    const s = JSON.parse(meta) as PlaylistState;
    return s.playlistId === playlistId ? s : emptyPlaylistState(playlistId);
  } catch {
    return emptyPlaylistState(playlistId);
  }
}

export default function YoutubeTaskScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const { store, tz, reload } = useStore();
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [cardsTick, setCardsTick] = useState(0);
  // Video length captured from the player; drives XP (1 XP per minute watched).
  const [durationSec, setDurationSec] = useState(0);
  const [ytKeyStore] = useState(createYoutubeApiKeyStore);

  // Playlist mode when source_ref carries a ?list=...; null for a single video.
  const playlistId = task?.source_ref ? parsePlaylistId(task.source_ref) : null;
  const [pstate, setPstate] = useState<PlaylistState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (taskId) store.getTask(taskId).then(setTask);
  }, [store, taskId]);

  const persist = useCallback(
    async (s: PlaylistState) => {
      if (task) await store.updateTaskMeta(task.id, JSON.stringify(s));
      setPstate(s);
    },
    [store, task],
  );

  // Initialize + once-a-day refresh of the playlist when the task loads.
  useEffect(() => {
    if (!task) return;
    const pid = task.source_ref ? parsePlaylistId(task.source_ref) : null;
    if (!pid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      let s = parsePlaylistState(task.meta, pid);
      const dayKey = localDayKey(Date.now(), tz);
      if (needsRefresh(s, dayKey)) {
        const key = await ytKeyStore.getToken();
        if (!key) {
          if (!cancelled) {
            setPstate(pickForDay(s, dayKey));
            setError(NEEDS_KEY);
            setLoading(false);
          }
          return;
        }
        try {
          const items = await fetchPlaylistItems(pid, key);
          s = { ...s, items, fetchedDay: dayKey, fetchedAt: Date.now() };
        } catch (e) {
          if (!cancelled) {
            setPstate(pickForDay(s, dayKey)); // keep any cached items
            setError((e as Error).message);
            setLoading(false);
          }
          return;
        }
      }
      s = pickForDay(s, dayKey);
      await store.updateTaskMeta(task.id, JSON.stringify(s));
      if (!cancelled) {
        setPstate(s);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, tz]);

  const refreshPlaylist = useCallback(async () => {
    if (!task || !playlistId) return;
    const key = await ytKeyStore.getToken();
    if (!key) {
      setError(NEEDS_KEY);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const items = await fetchPlaylistItems(playlistId, key);
      const dayKey = localDayKey(Date.now(), tz);
      const base = { ...(pstate ?? emptyPlaylistState(playlistId)), items, fetchedDay: dayKey, fetchedAt: Date.now() };
      await persist(pickForDay(base, dayKey));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [task, playlistId, ytKeyStore, pstate, tz, persist]);

  const shuffle = useCallback(async () => {
    if (!pstate) return;
    setBlocked(false);
    await persist(pickForDay({ ...pstate, pick: null }, localDayKey(Date.now(), tz)));
  }, [pstate, tz, persist]);

  const markDone = useCallback(async () => {
    if (!task) return;
    // A playlist task isn't completable with no available video — it needs an
    // unwatched pick. "Done" marks that video watched (never to replay) so the
    // next open samples a different one. Making cards stays optional.
    if (playlistId) {
      if (!pstate?.pick) return;
      await store.updateTaskMeta(task.id, JSON.stringify(markWatched(pstate, pstate.pick.id)));
    }
    const minutes = durationSec > 0 ? Math.max(1, Math.round(durationSec / 60)) : 0;
    await completeTask(store, task, { type: "youtube", manual: true, minutes }, Date.now(), tz);
    reload();
    router.back();
  }, [task, playlistId, pstate, store, tz, reload, router, durationSec]);

  if (!task) return null;

  // The video to show: a playlist's daily pick, or the single source video.
  const current = playlistId ? pickedVideo(pstate ?? emptyPlaylistState(playlistId)) : null;
  const videoId = playlistId
    ? current?.id ?? null
    : task.source_ref
      ? parseYouTubeId(task.source_ref)
      : null;
  const watchUrl = videoId ? `https://youtu.be/${videoId}` : task.source_ref ?? "";

  const watched = pstate?.watchedIds.length ?? 0;
  const total = pstate?.items.length ?? 0;
  // A playlist task has no video to do once every item is watched (or the
  // playlist is empty); it stays incompletable until new videos are added +
  // a refresh pulls them in. Never blocks a single-video task.
  const noPlaylistVideo = !!playlistId && !current;
  const allWatched = noPlaylistVideo && total > 0;

  return (
    <Screen>
      <Title>{task.title}</Title>

      {playlistId && (
        <Card>
          <Muted>
            Playlist · {total} video{total === 1 ? "" : "s"} · {watched} watched
            {pstate?.fetchedAt ? ` · refreshed ${new Date(pstate.fetchedAt).toLocaleTimeString()}` : ""}
          </Muted>
          {error && <Body>{error}</Body>}
          {current && <Subtitle>{current.title}</Subtitle>}
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button label={loading ? "Refreshing…" : "Refresh"} kind="neutral" onPress={refreshPlaylist} disabled={loading} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Shuffle" kind="neutral" onPress={shuffle} disabled={loading || total === 0} />
            </View>
          </View>
        </Card>
      )}

      {playlistId && loading && !current ? (
        <Card style={{ alignItems: "center" }}>
          <ActivityIndicator />
        </Card>
      ) : videoId && !blocked ? (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <YoutubeEmbed
            height={220}
            videoId={videoId}
            onError={() => setBlocked(true)}
            onDuration={setDurationSec}
          />
        </Card>
      ) : (
        <Card>
          <Subtitle>
            {blocked
              ? "Embedding blocked"
              : allWatched
                ? "All caught up 🎉"
                : playlistId
                  ? "No video to play"
                  : "No embeddable video"}
          </Subtitle>
          <Body>
            {allWatched
              ? `You've watched all ${total} video${total === 1 ? "" : "s"} in this playlist. Add more on YouTube, then tap Refresh.`
              : playlistId
                ? "This playlist is empty or couldn't be loaded. Add videos on YouTube, then tap Refresh."
                : "This video can't play inside the app. Watch it on YouTube, then mark it done."}
          </Body>
          {watchUrl && !noPlaylistVideo ? (
            <Button label="Open in YouTube" kind="neutral" onPress={() => Linking.openURL(watchUrl)} />
          ) : null}
        </Card>
      )}

      <MakeCardsSection key={cardsTick} task={task} onChange={() => setCardsTick((n) => n + 1)} />

      <View style={{ height: space.sm }} />
      <Button label="Done" kind="good" onPress={markDone} disabled={noPlaylistVideo} />
    </Screen>
  );
}
