import { useEffect, useState } from "react";
import { Alert, Platform, TextInput, StyleSheet } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useStore } from "../../ui/StoreProvider";
import { exportBackup, restoreBackup, importAnki, exportFlashcardsJson, importFlashcardsJson } from "../../services/backupService";
import { saveJsonFile, pickJsonText } from "../../ui/fileTransfer";
import { scheduleDailyReminder } from "../../services/notifications";
import { createTokenStore, createYoutubeApiKeyStore } from "../../adapters/tokenStore";
import { createApkgReader } from "../../adapters/apkgReader";
import { Screen, Card, Title, Subtitle, Muted, Button } from "../../ui/components";
import { colors, radius, space } from "../../ui/theme";

export default function SettingsScreen() {
  const { store, tz, reload } = useStore();
  const [token, setToken] = useState("");
  const [tokenStore] = useState(createTokenStore);
  const [ytKey, setYtKey] = useState("");
  const [ytKeyStore] = useState(createYoutubeApiKeyStore);

  useEffect(() => {
    tokenStore.getToken().then((t) => t && setToken(t));
    ytKeyStore.getToken().then((k) => k && setYtKey(k));
  }, [tokenStore, ytKeyStore]);

  const saveToken = async () => {
    await tokenStore.setToken(token.trim() || null);
    notify("Saved", "Readwise token updated.");
  };

  const saveYtKey = async () => {
    await ytKeyStore.setToken(ytKey.trim() || null);
    notify("Saved", "YouTube API key updated.");
  };

  const enableReminder = async () => {
    const ok = await scheduleDailyReminder(tz);
    notify(
      ok ? "Reminder set" : "Not enabled",
      ok ? "Daily reminder scheduled." : "Permission denied or unsupported here.",
    );
  };

  const doExport = async () => {
    const json = await exportBackup(store);
    await saveJsonFile("tet-backup.json", json);
    notify("Exported", "Full backup saved as JSON.");
  };

  const doImportJson = async () => {
    try {
      const json = await pickJsonText();
      if (json === null) return;
      await restoreBackup(store, json);
      reload();
      notify("Restored", "Backup imported — this instance now matches the file.");
    } catch (e) {
      notify("Import failed", (e as Error).message);
    }
  };

  const doExportFlashcards = async () => {
    const json = await exportFlashcardsJson(store);
    await saveJsonFile("tet-flashcards.json", json);
    notify("Exported", "Flashcards saved as JSON.");
  };

  const doImportFlashcards = async () => {
    try {
      const json = await pickJsonText();
      if (json === null) return;
      const out = await importFlashcardsJson(store, json);
      reload();
      notify("Imported", `${out.cardsImported} cards in ${out.decksImported} deck(s).`);
    } catch (e) {
      notify("Import failed", (e as Error).message);
    }
  };

  const doImportApkg = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: "*/*" });
    if (res.canceled) return;
    try {
      const asset = res.assets[0]!;
      const reader = createApkgReader(asset.uri);
      const out = await importAnki(store, reader, { deckName: asset.name?.replace(/\.apkg$/i, "") });
      reload();
      notify("Imported", `${out.cardsImported} cards (${out.skipped} skipped).`);
    } catch (e) {
      notify("Import failed", (e as Error).message);
    }
  };

  return (
    <Screen>
      <Title>Settings</Title>

      <Card>
        <Subtitle>Readwise</Subtitle>
        <Muted>API token (stored in {Platform.OS === "web" ? "localStorage" : "secure storage"}).</Muted>
        <TextInput
          value={token}
          onChangeText={setToken}
          placeholder="Readwise API token"
          placeholderTextColor={colors.muted}
          secureTextEntry
          autoCapitalize="none"
          style={styles.input}
        />
        <Button label="Save token" onPress={saveToken} />
      </Card>

      <Card>
        <Subtitle>YouTube</Subtitle>
        <Muted>Data API key — needed for playlist tasks to read your playlist. See the in-app steps or console.cloud.google.com.</Muted>
        <TextInput
          value={ytKey}
          onChangeText={setYtKey}
          placeholder="YouTube Data API key"
          placeholderTextColor={colors.muted}
          secureTextEntry
          autoCapitalize="none"
          style={styles.input}
        />
        <Button label="Save API key" onPress={saveYtKey} />
      </Card>

      <Card>
        <Subtitle>Daily reminder</Subtitle>
        <Muted>Static local notification at 9am; the slice is computed on open.</Muted>
        <Button label="Enable daily reminder" onPress={enableReminder} />
      </Card>

      <Card>
        <Subtitle>Backup — full export</Subtitle>
        <Muted>
          Everything as one JSON file: decks, cards (+ schedule &amp; ignored), tasks, playlist
          progress, reviews, watched videos, completions &amp; streak. Importing REPLACES this
          instance, so you can recreate it elsewhere. API keys aren&apos;t included — re-enter them above.
        </Muted>
        <Button label="Export backup" onPress={doExport} />
        <Button label="Import backup" kind="neutral" onPress={doImportJson} />
      </Card>

      <Card>
        <Subtitle>Flashcards only</Subtitle>
        <Muted>Just decks + cards (schedule preserved), to share a deck. Imports are appended, not replaced — use the full backup to clone an instance.</Muted>
        <Button label="Export flashcards" onPress={doExportFlashcards} />
        <Button label="Import flashcards" kind="neutral" onPress={doImportFlashcards} />
      </Card>

      <Card>
        <Subtitle>Import Anki deck</Subtitle>
        <Muted>Creates fresh FSRS cards from an .apkg (no SM-2 history).</Muted>
        <Button label="Import .apkg" kind="neutral" onPress={doImportApkg} />
      </Card>
    </Screen>
  );
}

function notify(title: string, message: string) {
  if (Platform.OS === "web") globalThis.alert?.(`${title}\n${message}`);
  else Alert.alert(title, message);
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 16,
  },
});
