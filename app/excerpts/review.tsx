import { useCallback, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useStore } from "../../ui/StoreProvider";
import { excerptReviewsToday } from "../../services/learning";
import {
  decideExcerpt,
  undoExcerptDecision,
  cardFromExcerpts,
  type TriageAction,
  type UndoToken,
} from "../../services/excerpts";
import {
  canPass,
  cardPointsOf,
  excerptPoints,
  excerptQueue,
  excerptSlice,
  focusQueue,
  setAsidePile,
  withSkipsLast,
  MAX_PASSES,
} from "../../lib/excerpts";
import { ActionScreen, Screen, Title, Body, Muted, Button } from "../../ui/components";
import { ExcerptView, CardFields, ButtonRow, RowButton } from "../../ui/ExcerptView";
import type { Excerpt, Task } from "../../db/schema";

const UNDO_LABELS: Record<TriageAction, string> = {
  ignore: "Ignored",
  pass: "Later",
  set_aside: "Set aside",
};

/** Undo a stored decision, or (focus mode) a session-only skip. */
type Undo =
  | { kind: "decision"; token: UndoToken; label: string }
  | { kind: "skip"; excerptId: string };

interface Session {
  current: Excerpt | null;
  points: number;
  goal: number;
  /** Daily: excerpts in the daily queue now. Focus: undecided left in the source. */
  left: number;
  setAside: number;
  /** Focus mode: the source's title. */
  sourceTitle: string | null;
}

/**
 * Excerpt triage, one highlight at a time, in one of two modes:
 *
 *   - Daily (from the Today task, or uncapped "keep going"): the daily queue,
 *     block-ordered by source rank. The deferral button is Later (2/5/7 days).
 *   - Focus (?sourceId=…): every undecided excerpt of one source in book
 *     order, schedule and rank ignored. The deferral button is Skip: to the
 *     end of this session, nothing stored, no points.
 *
 * Actions sit in a footer under the thumb.
 */
export default function ExcerptReviewScreen() {
  const { store, tz } = useStore();
  const router = useRouter();
  const { taskId, sourceId } = useLocalSearchParams<{ taskId?: string; sourceId?: string }>();
  const focus = Boolean(sourceId);
  const [task, setTask] = useState<Task | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // Daily mode past today's goal: keep serving from the whole daily queue.
  const [keepGoing, setKeepGoing] = useState(!taskId);
  // Focus mode: excerpts skipped this session, in skip order.
  const [skipped, setSkipped] = useState<string[]>([]);
  const [composing, setComposing] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [undo, setUndo] = useState<Undo | null>(null);
  // After saving a card the excerpt stays up, so you can make another from it.
  const [carded, setCarded] = useState<{ excerpt: Excerpt; cards: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    async (t: Task | null, more: boolean, skips: string[]) => {
      const now = Date.now();
      const [list, sources, todays] = await Promise.all([
        store.listExcerpts(),
        store.listExcerptSources(),
        excerptReviewsToday(store, now, tz),
      ]);
      const points = excerptPoints(todays, cardPointsOf(t ?? (await store.listTasks()).find((x) => x.type === "excerpt")));
      const setAside = setAsidePile(list).length;
      if (sourceId) {
        const queue = withSkipsLast(focusQueue(list, sourceId), skips);
        setSession({
          current: queue[0] ?? null,
          points,
          goal: 0,
          left: queue.length,
          setAside,
          sourceTitle: sources.find((s) => s.id === sourceId)?.title ?? null,
        });
        return;
      }
      const ready = excerptQueue(list, sources, now);
      const slice = t ? excerptSlice(t, list, sources, todays, now) : null;
      setSession({
        current: (more || !slice ? ready[0] : slice.queue[0]) ?? null,
        points,
        goal: slice?.goal ?? 0,
        left: ready.length,
        setAside,
        sourceTitle: null,
      });
    },
    [store, tz, sourceId],
  );

  // On focus (so coming back from the pile refreshes its count) and whenever
  // "keep going" flips or a skip reorders the focus session.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const t = taskId ? await store.getTask(taskId) : null;
        if (!active) return;
        setTask(t);
        await refresh(t, keepGoing, skipped);
      })();
      return () => {
        active = false;
      };
    }, [store, taskId, refresh, keepGoing, skipped]),
  );

  if (!session) return null;
  const { current } = session;

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const decide = (action: TriageAction) =>
    run(async () => {
      if (!current) return;
      const token = await decideExcerpt(store, current.id, action, Date.now(), tz);
      setUndo({ kind: "decision", token, label: UNDO_LABELS[action] });
      await refresh(task, keepGoing, skipped);
    });

  // Focus mode only: to the back of this session. Re-skipping moves it back again.
  const skip = () => {
    if (!current) return;
    setSkipped((s) => [...s.filter((id) => id !== current.id), current.id]);
    setUndo({ kind: "skip", excerptId: current.id });
  };

  const undoLast = () =>
    run(async () => {
      if (!undo) return;
      if (undo.kind === "skip") {
        setSkipped((s) => s.filter((id) => id !== undo.excerptId));
      } else {
        await undoExcerptDecision(store, undo.token);
        await refresh(task, keepGoing, skipped);
      }
      setUndo(null);
    });

  const saveCard = () =>
    run(async () => {
      const target = carded?.excerpt ?? current;
      if (!target || !front.trim() || !back.trim()) return;
      await cardFromExcerpts(store, [target.id], front, back, Date.now(), tz);
      setFront("");
      setBack("");
      setComposing(false);
      setUndo(null);
      setCarded({ excerpt: target, cards: (carded?.cards ?? 0) + 1 });
    });

  // Leave the carded excerpt for the next one.
  const doneCarding = () =>
    run(async () => {
      setCarded(null);
      await refresh(task, keepGoing, skipped);
    });

  const undoLabel = undo ? (undo.kind === "skip" ? "Skipped" : undo.label) : "";
  const pts = `${session.points} point${session.points === 1 ? "" : "s"} today`;
  const progressLine = focus
    ? `${session.sourceTitle ?? "Focus"} · ${session.left} left · ${pts}`
    : keepGoing
      ? `${pts} · ${session.left} in queue`
      : `${Math.min(session.points, session.goal)} of ${session.goal} today`;

  if (carded && !composing) {
    return (
      <ActionScreen
        footer={
          <>
            <Button label="Another card from this excerpt" onPress={() => setComposing(true)} disabled={busy} />
            <Button label="Done" kind="neutral" onPress={doneCarding} disabled={busy} />
          </>
        }
      >
        <Muted>{`Saved · ${carded.cards} card${carded.cards === 1 ? "" : "s"} from this excerpt`}</Muted>
        <ExcerptView excerpt={carded.excerpt} />
      </ActionScreen>
    );
  }

  if (!current && !carded) {
    return (
      <Screen>
        <Title>
          {focus ? "Source finished 🎉" : session.left === 0 ? "Queue empty" : "Done for today 🎉"}
        </Title>
        <Body>
          {focus
            ? `Nothing undecided left in ${session.sourceTitle ?? "this source"}. ${pts}.`
            : session.left === 0
              ? "No excerpts are waiting. Check more sources in Library → Excerpts → Sources."
              : `${pts}. ${session.left} more excerpt${session.left === 1 ? "" : "s"} in the queue if you want them.`}
        </Body>
        {undo && <Button label={`Undo · ${undoLabel}`} kind="neutral" onPress={undoLast} />}
        {!focus && session.left > 0 && (
          <Button label="Keep going" kind="neutral" onPress={() => setKeepGoing(true)} />
        )}
        {session.setAside > 0 && (
          <Button
            label={`Set-aside pile (${session.setAside})`}
            kind="neutral"
            onPress={() => router.replace("/excerpts/pile")}
          />
        )}
        <Button label="Finish" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (composing) {
    const target = carded?.excerpt ?? current!;
    return (
      <ActionScreen
        footer={
          <ButtonRow>
            <RowButton label="Cancel" kind="neutral" onPress={() => setComposing(false)} />
            <RowButton
              label="Save card"
              onPress={saveCard}
              disabled={busy || !front.trim() || !back.trim()}
            />
          </ButtonRow>
        }
      >
        <ExcerptView excerpt={target} compact />
        <CardFields front={front} back={back} onChangeFront={setFront} onChangeBack={setBack} />
      </ActionScreen>
    );
  }

  if (!current) return null;
  const passable = canPass(current);
  return (
    <ActionScreen
      footer={
        <>
          {undo && <Button label={`Undo · ${undoLabel}`} kind="neutral" onPress={undoLast} />}
          <ButtonRow>
            <RowButton label="Ignore" kind="neutral" onPress={() => decide("ignore")} disabled={busy} />
            {focus ? (
              <RowButton label="Skip" kind="neutral" onPress={skip} disabled={busy} />
            ) : (
              <RowButton
                label="Later"
                kind="neutral"
                onPress={() => decide("pass")}
                disabled={busy || !passable}
              />
            )}
            <RowButton label="Set aside" kind="neutral" onPress={() => decide("set_aside")} disabled={busy} />
          </ButtonRow>
          <Button label="Make card" onPress={() => setComposing(true)} disabled={busy} />
        </>
      }
    >
      <Muted>{progressLine}</Muted>
      <ExcerptView excerpt={current} />
      {!focus && current.pass_count > 0 && (
        <Muted>
          {passable
            ? `Put off ${current.pass_count}× before.`
            : `Put off ${MAX_PASSES}× — time to decide: card it, set it aside, or ignore it.`}
        </Muted>
      )}
      {focus && skipped.includes(current.id) && <Muted>Skipped once this session.</Muted>}
      {session.setAside > 0 && (
        <Button
          label={`Set-aside pile (${session.setAside})`}
          kind="neutral"
          onPress={() => router.push("/excerpts/pile")}
        />
      )}
    </ActionScreen>
  );
}
