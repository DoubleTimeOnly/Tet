import { useRef } from "react";
import YoutubePlayer, { type YoutubeIframeRef } from "react-native-youtube-iframe";

/** Native embedded player. The .web variant avoids the webview dependency. */
export function YoutubeEmbed({
  videoId,
  height = 220,
  onError,
  onDuration,
}: {
  videoId: string;
  height?: number;
  onError?: () => void;
  /** Reports the video's length (seconds) once the player is ready — used for XP. */
  onDuration?: (seconds: number) => void;
}) {
  const ref = useRef<YoutubeIframeRef>(null);
  return (
    <YoutubePlayer
      ref={ref}
      height={height}
      videoId={videoId}
      onError={() => onError?.()}
      onReady={async () => {
        try {
          const seconds = await ref.current?.getDuration();
          if (seconds && seconds > 0) onDuration?.(seconds);
        } catch {
          // Duration unavailable — XP just falls back to 0 for this video.
        }
      }}
    />
  );
}
