import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import {
  nextDailyTrigger,
  REMINDER_TITLE,
  REMINDER_BODY,
  DEFAULT_REMINDER_HOUR,
  type DailyTrigger,
} from "../lib/notifications";

/**
 * Schedules the static daily reminder. The body is fixed (see lib/notifications
 * for why); the app computes the live slice on open. No-op on web.
 */
export async function scheduleDailyReminder(
  tz: string,
  trigger: DailyTrigger = { hour: DEFAULT_REMINDER_HOUR, minute: 0 },
): Promise<boolean> {
  if (Platform.OS === "web") return false;

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") return false;

  // Replace any prior schedule so we never stack duplicate reminders.
  await Notifications.cancelAllScheduledNotificationsAsync();

  // Compute the first fire time, then repeat daily at that wall-clock time.
  const first = nextDailyTrigger(Date.now(), tz, trigger);
  await Notifications.scheduleNotificationAsync({
    content: { title: REMINDER_TITLE, body: REMINDER_BODY },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: first.getHours(),
      minute: first.getMinutes(),
    },
  });
  return true;
}

export async function cancelDailyReminder(): Promise<void> {
  if (Platform.OS === "web") return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}
