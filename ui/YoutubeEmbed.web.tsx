import { useEffect } from "react";

/**
 * Web preview stub: react-native-youtube-iframe's web build needs an extra
 * webview dep we don't ship. Signal "can't embed" so the screen falls back to
 * its Open-in-YouTube path. (Embedded playback is a device feature.)
 */
export function YoutubeEmbed({
  onError,
}: {
  videoId: string;
  height?: number;
  onError?: () => void;
  onDuration?: (seconds: number) => void;
}) {
  useEffect(() => {
    onError?.();
  }, [onError]);
  return null;
}
