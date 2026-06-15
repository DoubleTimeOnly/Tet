import { useEffect, useState } from "react";
import { Alert, Platform, TextInput, StyleSheet } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useStore } from "../../ui/StoreProvider";
import { exportBackup, restoreBackup, importAnki } from "../../services/backupService";
import { scheduleDailyReminder } from "../../services/notifications";
import { createTokenStore } from "../../adapters/tokenStore";
import { createApkgReader } from "../../adapters/apkgReader";
import { Screen, Card, Title, Subtitle, Muted, Button } from "../../ui/components";
import { colors, radius, space } from "../../ui/theme";

export default function SettingsScreen() {
  const { store, tz, reload } = useStore();
  const [token, setToken] = useState("");
  const [tokenStore] = useState(createTokenStore);

  useEffect(() => {
    tokenStore.getToken().then((t) => t && setToken(t));
  }, [tokenStore]);

  const saveToken = async () => {
    await tokenStore.setToken(token.trim() || null);
    notify("Saved", "Readwise token updated.");
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
    const path = `${FileSystem.cacheDirectory}tet-backup.json`;
    await FileSystem.writeAsStringAsync(path, json);
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path);
    else notify("Exported", path);
  };

  const doImportJson = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: "application/json" });
    if (res.canceled) return;
    try {
      const json = await FileSystem.readAsStringAsync(res.assets[0]!.uri);
      await restoreBackup(store, json);
      reload();
      notify("Restored", "Backup imported.");
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
        <Subtitle>Daily reminder</Subtitle>
        <Muted>Static local notification at 9am; the slice is computed on open.</Muted>
        <Button label="Enable daily reminder" onPress={enableReminder} />
      </Card>

      <Card>
        <Subtitle>Backup</Subtitle>
        <Muted>Export/import everything as JSON so a reinstall keeps your streak.</Muted>
        <Button label="Export backup" onPress={doExport} />
        <Button label="Import backup" kind="neutral" onPress={doImportJson} />
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
