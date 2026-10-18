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
  excerptPoints,
  excerptQueue,
  excerptSlice,
  setAsidePile,
  MAX_PASSES,
} from "../../lib/excerpts";
import { ActionScreen, Screen, Title, Body, Muted, Button } from "../../ui/components";
import { ExcerptView, CardFields, ButtonRow, RowButton } from "../../ui/ExcerptView";
import type { Excerpt, Task } from "../../db/schema";

const UNDO_LABELS: Record<TriageAction, string> = {
  ignore: "Ignored",
  pass: "Passed",
  set_aside: "Set aside",
};

interface Session {
  current: Excerpt | null;
  points: number;
  goal: number;
  /** Queued excerpts ready now, beyond today's goal included. */
  ready: number;
  setAside: number;
}

/**
 * Daily excerpt triage: one highlight at a time, four choices. Opened from the
 * Today task (capped to the day's goal) or with no task from the Library
 * ("keep going" mode, uncapped). Actions sit in a footer under the thumb.
 */
export default function ExcerptReviewScreen() {
  const { store, tz } = useStore();
  const router = useRouter();
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // Past today's goal: keep serving from the whole ready queue.
  const [keepGoing, setKeepGoing] = useState(!taskId);
  const [composing, setComposing] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [undo, setUndo] = useState<{ token: UndoToken; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    async (t: Task | null, more: boolean) => {
      const now = Date.now();
      const [list, todays] = await Promise.all([
        store.listExcerpts(),
        excerptReviewsToday(store, now, tz),
      ]);
      const ready = excerptQueue(list, now);
      const slice = t ? excerptSlice(t, list, todays, now) : null;
      setSession({
        current: (more || !slice ? ready[0] : slice.queue[0]) ?? null,
        points: excerptPoints(todays),
        goal: slice?.goal ?? 0,
        ready: ready.length,
        setAside: setAsidePile(list).length,
      });
    },
    [store, tz],
  );

  // On focus (so coming back from the pile refreshes its count) and whenever
  // "keep going" flips.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const t = taskId ? await store.getTask(taskId) : null;
        if (!active) return;
        setTask(t);
        await refresh(t, keepGoing);
      })();
      return () => {
        active = false;
      };
    }, [store, taskId, refresh, keepGoing]),
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
      setUndo({ token, label: UNDO_LABELS[action] });
      await refresh(task, keepGoing);
    });

  const undoLast = () =>
    run(async () => {
      if (!undo) return;
      await undoExcerptDecision(store, undo.token);
      setUndo(null);
      await refresh(task, keepGoing);
    });

  const saveCard = () =>
    run(async () => {
      if (!current || !front.trim() || !back.trim()) return;
      await cardFromExcerpts(store, [current.id], front, back, Date.now(), tz);
      setFront("");
      setBack("");
      setComposing(false);
      setUndo(null);
      await refresh(task, keepGoing);
    });

  const progressLine = keepGoing
    ? `${session.points} point${session.points === 1 ? "" : "s"} today · ${session.ready} ready`
    : `${Math.min(session.points, session.goal)} of ${session.goal} today`;

  if (!current) {
    return (
      <Screen>
        <Title>{session.ready === 0 ? "Queue empty" : "Done for today 🎉"}</Title>
        <Body>
          {session.ready === 0
            ? "No excerpts are waiting. New Readwise highlights show up here on their own."
            : `${session.points} point${session.points === 1 ? "" : "s"} today. ${session.ready} more excerpt${session.ready === 1 ? "" : "s"} ready if you want them.`}
        </Body>
        {undo && <Button label={`Undo · ${undo.label}`} kind="neutral" onPress={undoLast} />}
        {session.ready > 0 && (
          <Button
            label="Keep going"
            kind="neutral"
            onPress={() => setKeepGoing(true)}
          />
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
        <ExcerptView excerpt={current} compact />
        <CardFields front={front} back={back} onChangeFront={setFront} onChangeBack={setBack} />
      </ActionScreen>
    );
  }

  const passable = canPass(current);
  return (
    <ActionScreen
      footer={
        <>
          {undo && <Button label={`Undo · ${undo.label}`} kind="neutral" onPress={undoLast} />}
          <ButtonRow>
            <RowButton label="Ignore" kind="neutral" onPress={() => decide("ignore")} disabled={busy} />
            <RowButton label="Pass" kind="neutral" onPress={() => decide("pass")} disabled={busy || !passable} />
            <RowButton label="Set aside" kind="neutral" onPress={() => decide("set_aside")} disabled={busy} />
          </ButtonRow>
          <Button label="Make card" onPress={() => setComposing(true)} disabled={busy} />
        </>
      }
    >
      <Muted>{progressLine}</Muted>
      <ExcerptView excerpt={current} />
      {current.pass_count > 0 && (
        <Muted>
          {passable
            ? `Passed ${current.pass_count}× before.`
            : `Passed ${MAX_PASSES}× — time to decide: card it, set it aside, or ignore it.`}
        </Muted>
      )}
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
