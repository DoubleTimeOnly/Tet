import YoutubePlayer from "react-native-youtube-iframe";

/** Native embedded player. The .web variant avoids the webview dependency. */
export function YoutubeEmbed({
  videoId,
  height = 220,
  onError,
}: {
  videoId: string;
  height?: number;
  onError?: () => void;
}) {
  return <YoutubePlayer height={height} videoId={videoId} onError={() => onError?.()} />;
}
