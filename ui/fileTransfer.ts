import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

/**
 * Cross-platform "save a JSON file" / "pick a JSON file" used by the Settings
 * export & import actions. Web gets a real browser download / file input;
 * native writes to the cache dir and opens the share sheet, and reads the
 * picked file off disk.
 */

export async function saveJsonFile(filename: string, json: string): Promise<void> {
  if (Platform.OS === "web") {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const path = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(path, json);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path);
}

/** Returns the file's text, or null if the user cancelled the picker. */
export async function pickJsonText(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: "application/json" });
  if (res.canceled) return null;
  const uri = res.assets[0]!.uri;
  // On web the picked uri is a blob: URL that FileSystem can't read; fetch it.
  if (Platform.OS === "web") return (await fetch(uri)).text();
  return FileSystem.readAsStringAsync(uri);
}
