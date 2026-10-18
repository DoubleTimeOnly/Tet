import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useStore } from "../../ui/StoreProvider";
import { cardFromExcerpts, returnToQueue } from "../../services/excerpts";
import { setAsidePile } from "../../lib/excerpts";
import { ActionScreen, Title, Muted, Button } from "../../ui/components";
import { ExcerptView, CardFields, ButtonRow, RowButton } from "../../ui/ExcerptView";
import { space } from "../../ui/theme";
import type { Excerpt } from "../../db/schema";

/**
 * The set-aside pile: tap excerpts to select them, then write one card from
 * all of them. Any excerpt can also go back to the queue uncarded.
 */
export default function SetAsidePileScreen() {
  const { store, tz } = useStore();
  const [pile, setPile] = useState<Excerpt[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [composing, setComposing] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    let active = true;
    store.listExcerpts().then((list) => {
      if (!active) return;
      const next = setAsidePile(list);
      setPile(next);
      // Drop selections that left the pile (e.g. deleted upstream by a sync).
      setSelected((sel) => new Set(next.filter((e) => sel.has(e.id)).map((e) => e.id)));
    });
    return () => {
      active = false;
    };
  }, [store]);
  useFocusEffect(load);

  if (!pile) return null;

  const toggle = (id: string) =>
    setSelected((sel) => {
      const next = new Set(sel);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const chosen = pile.filter((e) => selected.has(e.id));

  const save = () =>
    run(async () => {
      if (chosen.length === 0 || !front.trim() || !back.trim()) return;
      await cardFromExcerpts(store, chosen.map((e) => e.id), front, back, Date.now(), tz);
      setFront("");
      setBack("");
      setSelected(new Set());
      setComposing(false);
      load();
    });

  const putBack = (id: string) =>
    run(async () => {
      await returnToQueue(store, id);
      load();
    });

  if (composing && chosen.length > 0) {
    return (
      <ActionScreen
        footer={
          <ButtonRow>
            <RowButton label="Cancel" kind="neutral" onPress={() => setComposing(false)} />
            <RowButton label="Save card" onPress={save} disabled={busy || !front.trim() || !back.trim()} />
          </ButtonRow>
        }
      >
        <Muted>{`One card from ${chosen.length} excerpt${chosen.length === 1 ? "" : "s"}`}</Muted>
        {chosen.map((e) => (
          <ExcerptView key={e.id} excerpt={e} compact />
        ))}
        <CardFields front={front} back={back} onChangeFront={setFront} onChangeBack={setBack} />
      </ActionScreen>
    );
  }

  return (
    <ActionScreen
      footer={
        <Button
          label={
            chosen.length === 0
              ? "Select excerpts to combine"
              : `Make card from ${chosen.length} excerpt${chosen.length === 1 ? "" : "s"}`
          }
          onPress={() => setComposing(true)}
          disabled={chosen.length === 0}
        />
      }
    >
      <Title>Set aside</Title>
      {pile.length === 0 ? (
        <Muted>Nothing set aside. Use “Set aside” during excerpt review to park excerpts you want to combine.</Muted>
      ) : (
        <Muted>Tap to select. Write one card from several, or send one back to the queue.</Muted>
      )}
      {pile.map((e) => (
        <View key={e.id} style={{ gap: space.xs }}>
          <ExcerptView excerpt={e} compact selected={selected.has(e.id)} onPress={() => toggle(e.id)} />
          <Button label="Back to queue" kind="neutral" onPress={() => putBack(e.id)} disabled={busy} />
        </View>
      ))}
    </ActionScreen>
  );
}
