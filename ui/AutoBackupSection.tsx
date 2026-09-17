import { useCallback, useState } from "react";
import { Platform, Alert, View, StyleSheet } from "react-native";
import { useFocusEffect } from "expo-router";
import { DateTime } from "luxon";
import { useStore } from "./StoreProvider";
import { Card, Subtitle, Body, Muted, Button } from "./components";
import { space } from "./theme";
import { backupFiles } from "../adapters/backupFiles";
import {
  listAutoBackups,
  restoreAutoBackup,
  runAutoBackup,
} from "../services/autoBackupService";
import { MAX_AUTO_BACKUPS, type AutoBackupFile } from "../lib/autoBackup";

function notify(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

/**
 * Settings card for the daily automatic snapshots. Collapsed by default —
 * these are a safety net you shouldn't have to think about, so the list only
 * appears when you go looking for it.
 *
 * The one thing it does surface unprompted is the folder: until you pick one,
 * snapshots sit in Tet's private storage where a file manager can't see them
 * and an uninstall would take them with it.
 */
export function AutoBackupSection() {
  const { store, tz, reload } = useStore();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AutoBackupFile[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [hasFolder, setHasFolder] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    let active = true;
    Promise.all([
      listAutoBackups(backupFiles),
      backupFiles.describe(),
      backupFiles.hasFolder(),
    ])
      .then(([list, where, granted]) => {
        if (!active) return;
        setItems(list);
        setFolder(where);
        setHasFolder(granted);
        setProblem(null);
      })
      .catch((e: Error) => {
        // An unreadable folder must say so rather than show an empty list.
        if (active) setProblem(e.message);
      });
    return () => {
      active = false;
    };
  }, [open]);

  useFocusEffect(load);

  /**
   * Snapshot now, whether or not one is due. Shared by "Back up now" and by
   * picking a folder: a newly chosen folder is empty, and waiting up to a day
   * to find out whether writing to it even works is how this went unnoticed.
   */
  const backUpNow = async (): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await runAutoBackup(store, backupFiles, Date.now(), { force: true });
      load();
      if (!res.wrote) {
        setProblem(res.error ?? "Could not write a snapshot.");
        notify("Backup failed", res.error ?? "Could not write a snapshot.");
        return false;
      }
      setProblem(null);
      return true;
    } finally {
      setBusy(false);
    }
  };

  const chooseFolder = async () => {
    try {
      if (!(await backupFiles.chooseFolder())) return;
      // Write one straight away: it proves the folder works and gives the user
      // something to see, instead of an empty list and a promise about tomorrow.
      if (await backUpNow()) {
        notify(
          "Folder set",
          "A snapshot has been saved there. Existing ones stay where they are.",
        );
      }
    } catch (e) {
      notify("Couldn't set folder", (e as Error).message);
    }
  };

  const restore = async (name: string) => {
    try {
      await restoreAutoBackup(store, backupFiles, name);
      reload();
      notify("Restored", "This instance now matches that snapshot.");
    } catch (e) {
      notify("Restore failed", (e as Error).message);
    }
  };

  const newest = items[0];

  if (!backupFiles.supported) {
    return (
      <Card>
        <Subtitle>Automatic backups</Subtitle>
        <Muted>
          Not available on web — the web preview keeps everything in memory, so
          there is nothing durable to snapshot.
        </Muted>
      </Card>
    );
  }

  return (
    <Card>
      <Subtitle>Automatic backups</Subtitle>
      <Muted>
        {`Tet snapshots itself when you open or return to it, at most once a day, keeping the last ${MAX_AUTO_BACKUPS}. `}
        {newest
          ? `Most recent: ${formatWhen(newest.at, tz)}.`
          : "None yet — use \u201cBack up now\u201d if you don't want to wait for the next one."}
      </Muted>

      {hasFolder ? (
        <Muted>{`Saving to ${folder}.`}</Muted>
      ) : (
        <Muted>
          Snapshots are in Tet&apos;s private storage right now — no file manager
          can see them, and uninstalling would take them with it. Pick a folder
          to keep them somewhere of your own.
        </Muted>
      )}
      {problem && <Muted>{`Snapshots are failing: ${problem}`}</Muted>}

      <Button
        label={hasFolder ? "Change backup folder" : "Choose backup folder"}
        kind={hasFolder ? "neutral" : "primary"}
        onPress={chooseFolder}
      />
      <Button
        label={busy ? "Backing up…" : "Back up now"}
        kind="neutral"
        disabled={busy}
        onPress={() => void backUpNow()}
      />

      <Button
        label={open ? "Hide snapshots" : `Show snapshots (${items.length})`}
        kind="neutral"
        onPress={() => setOpen((v) => !v)}
      />
      {open &&
        (items.length === 0 ? (
          <Muted>No snapshots yet.</Muted>
        ) : (
          items.map((f) => (
            <View key={f.name} style={styles.row}>
              <Body>{formatWhen(f.at, tz)}</Body>
              <Button label="Restore" kind="neutral" onPress={() => restore(f.name)} />
            </View>
          ))
        ))}
    </Card>
  );
}

function formatWhen(ms: number, tz: string): string {
  return DateTime.fromMillis(ms, { zone: tz }).toFormat("ccc d LLL yyyy · HH:mm");
}

const styles = StyleSheet.create({
  row: { gap: space.sm, paddingTop: space.sm },
});
