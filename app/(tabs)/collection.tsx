import { useCallback, useState } from "react";
import { View, StyleSheet } from "react-native";
import { useFocusEffect } from "expo-router";
import { useStore } from "../../ui/StoreProvider";
import { Screen, Title, Muted } from "../../ui/components";
import { LootCardView } from "../../ui/LootCardView";
import { hsvSortKey } from "../../lib/loot";
import { space } from "../../ui/theme";
import type { LootCard } from "../../db/schema";

export default function CollectionScreen() {
  const { store } = useStore();
  const [cards, setCards] = useState<LootCard[]>([]);

  const load = useCallback(() => {
    let active = true;
    store.listLootCards().then((all) => {
      if (!active) return;
      setCards([...all].sort((a, b) => hsvSortKey(a) - hsvSortKey(b)));
    });
    return () => { active = false; };
  }, [store]);

  useFocusEffect(load);

  return (
    <Screen>
      <Title>Collection</Title>
      {cards.length === 0 ? (
        <Muted>No cards yet. Complete all your daily tasks to earn one!</Muted>
      ) : (
        <>
          <Muted>{cards.length} card{cards.length === 1 ? "" : "s"} collected</Muted>
          <View style={styles.grid}>
            {cards.map((card) => (
              <LootCardView key={card.id} r={card.r} g={card.g} b={card.b} width={110} />
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.lg,
  },
});
