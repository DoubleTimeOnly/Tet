import { useCallback, useState } from "react";
import { Platform, Alert, View, StyleSheet } from "react-native";
import { useFocusEffect } from "expo-router";
import { DateTime } from "luxon";
import * as Sharing from "expo-sharing";
import { useStore } from "./StoreProvider";
import { Card, Subtitle, Body, Muted, Button } from "./components";
import { space } from "./theme";
import { backupFiles } from "../adapters/backupFiles";
import { listAutoBackups, restoreAutoBackup } from "../services/autoBackupService";
import { MAX_AUTO_BACKUPS, type AutoBackupFile } from "../lib/autoBackup";

function notify(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

/**
 * Settings card for the daily automatic snapshots. Collapsed by default —
 * these are a safety net you shouldn't have to think about, so the list only
 * appears when you go looking for it.
 */
export function AutoBackupSection() {
  const { store, tz, reload } = useStore();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AutoBackupFile[]>([]);

  const load = useCallback(() => {
    let active = true;
    listAutoBackups(backupFiles).then((list) => {
      if (active) setItems(list);
    });
    return () => {
      active = false;
    };
  }, [open]);

  useFocusEffect(load);

  const restore = async (name: string) => {
    try {
      await restoreAutoBackup(store, backupFiles, name);
      reload();
      notify("Restored", "This instance now matches that snapshot.");
    } catch (e) {
      notify("Restore failed", (e as Error).message);
    }
  };

  // Android keeps app documents private, so "save a copy" is how a snapshot
  // gets somewhere the Import picker (or another app) can reach it.
  const shareOut = async (name: string) => {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        notify("Not available", "Sharing isn't supported on this device.");
        return;
      }
      await Sharing.shareAsync(backupFiles.uriFor(name));
    } catch (e) {
      notify("Couldn't share", (e as Error).message);
    }
  };

  const newest = items[0];

  return (
    <Card>
      <Subtitle>Automatic backups</Subtitle>
      {!backupFiles.available ? (
        <Muted>
          Not available on web — the web preview keeps everything in memory, so
          there is nothing durable to snapshot.
        </Muted>
      ) : (
        <>
          <Muted>
            {`Tet snapshots itself when you open it, at most once a day, keeping the last ${MAX_AUTO_BACKUPS}. `}
            {newest
              ? `Most recent: ${formatWhen(newest.at, tz)}.`
              : "None yet — the first one is taken next time you open the app."}
          </Muted>
          <Button
            label={open ? "Hide snapshots" : `Show snapshots (${items.length})`}
            kind="neutral"
            onPress={() => setOpen((v) => !v)}
          />
          {open &&
            items.map((f) => (
              <View key={f.name} style={styles.row}>
                <Body>{formatWhen(f.at, tz)}</Body>
                <View style={styles.actions}>
                  <View style={{ flex: 1 }}>
                    <Button label="Restore" kind="neutral" onPress={() => restore(f.name)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="Save a copy" kind="neutral" onPress={() => shareOut(f.name)} />
                  </View>
                </View>
              </View>
            ))}
          {open && items.length === 0 && <Muted>No snapshots yet.</Muted>}
        </>
      )}
    </Card>
  );
}

function formatWhen(ms: number, tz: string): string {
  return DateTime.fromMillis(ms, { zone: tz }).toFormat("ccc d LLL yyyy · HH:mm");
}

const styles = StyleSheet.create({
  row: { gap: space.sm, paddingTop: space.sm },
  actions: { flexDirection: "row", gap: space.sm },
});
