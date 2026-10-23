import { useCallback, useState } from "react";
import { Platform, Alert, View, StyleSheet } from "react-native";
import { useFocusEffect } from "expo-router";
import { DateTime } from "luxon";
import { useStore } from "./StoreProvider";
import { Card, Subtitle, Body, Muted, Button } from "./components";
import { space } from "./theme";
import { driveBackup } from "../adapters/driveBackup";
import {
  listAutoBackups,
  restoreAutoBackup,
  runAutoBackup,
} from "../services/autoBackupService";
import { MAX_AUTO_BACKUPS, type AutoBackupFile } from "../lib/autoBackup";
import { DRIVE_FOLDER_NAME } from "../lib/driveApi";

function notify(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

/**
 * Settings card for the Google Drive copy of the daily snapshots. It sits
 * beside the local-folder card rather than replacing it: the local folder
 * survives being offline, Drive survives losing the phone.
 *
 * Signed out it is one button; signed in it mirrors AutoBackupSection (back up
 * now, a collapsible snapshot list with Restore) plus a sign-out.
 */
export function DriveBackupSection() {
  const { store, tz, reload } = useStore();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AutoBackupFile[]>([]);
  const [account, setAccount] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    let active = true;
    (async () => {
      const granted = await driveBackup.hasFolder();
      if (!active) return;
      setSignedIn(granted);
      setAccount(granted ? driveBackup.account() : null);
      if (!granted) {
        setItems([]);
        setProblem(null);
        return;
      }
      const list = await listAutoBackups(driveBackup);
      if (!active) return;
      setItems(list);
      setProblem(null);
    })().catch((e: Error) => {
      if (active) setProblem(e.message);
    });
    return () => {
      active = false;
    };
  }, [open]);

  useFocusEffect(load);

  /** Snapshot now, whether or not one is due — same reasoning as the folder card. */
  const backUpNow = async (): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await runAutoBackup(store, driveBackup, Date.now(), { force: true });
      load();
      if (!res.wrote) {
        setProblem(res.error ?? "Could not upload a snapshot.");
        notify("Drive backup failed", res.error ?? "Could not upload a snapshot.");
        return false;
      }
      setProblem(null);
      return true;
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    try {
      if (!(await driveBackup.chooseFolder())) return;
      // Upload one straight away: proves the whole chain works (consent, API
      // enabled, network) now rather than at tomorrow's silent attempt.
      if (await backUpNow()) {
        notify("Signed in", `A snapshot has been saved to the "${DRIVE_FOLDER_NAME}" folder in your Drive.`);
      }
    } catch (e) {
      notify("Couldn't sign in", (e as Error).message);
    }
  };

  const signOut = async () => {
    try {
      await driveBackup.signOut();
      load();
    } catch (e) {
      notify("Couldn't sign out", (e as Error).message);
    }
  };

  const restore = async (name: string) => {
    try {
      await restoreAutoBackup(store, driveBackup, name);
      reload();
      notify("Restored", "This instance now matches that snapshot.");
    } catch (e) {
      notify("Restore failed", (e as Error).message);
    }
  };

  if (!driveBackup.supported) return null;

  const newest = items[0];

  return (
    <Card>
      <Subtitle>Google Drive backup</Subtitle>
      {signedIn ? (
        <>
          <Muted>
            {`Signed in as ${account ?? "your Google account"}. Each daily snapshot is also uploaded to a "${DRIVE_FOLDER_NAME}" folder in your Drive, keeping the last ${MAX_AUTO_BACKUPS}. `}
            {newest ? `Most recent: ${formatWhen(newest.at, tz)}.` : "None yet."}
          </Muted>
          {problem && <Muted>{`Drive backups are failing: ${problem}`}</Muted>}
          <Button
            label={busy ? "Backing up…" : "Back up to Drive now"}
            kind="neutral"
            disabled={busy}
            onPress={() => void backUpNow()}
          />
          <Button
            label={open ? "Hide Drive snapshots" : `Show Drive snapshots (${items.length})`}
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
          <Button label="Sign out" kind="neutral" onPress={signOut} />
        </>
      ) : (
        <>
          <Muted>
            Keep a copy off this phone. Sign in with Google and each daily snapshot is
            also uploaded to your own Drive. Tet can only see the files it creates
            itself, and they appear in a normal &quot;{DRIVE_FOLDER_NAME}&quot; folder you can open or
            download.
          </Muted>
          {problem && <Muted>{problem}</Muted>}
          <Button label="Sign in with Google" onPress={signIn} />
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
});
