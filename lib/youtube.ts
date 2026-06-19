/** Extract an 11-char YouTube video id from the common URL shapes. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  // Bare id.
  if (/^[\w-]{11}$/.test(s)) return s;

  const patterns = [
    /[?&]v=([\w-]{11})/, // watch?v=ID
    /youtu\.be\/([\w-]{11})/, // youtu.be/ID
    /\/embed\/([\w-]{11})/, // /embed/ID
    /\/shorts\/([\w-]{11})/, // /shorts/ID
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1]!;
  }
  return null;
}

/**
 * Extract a playlist id from a URL (`...?list=PLxxxx`) or a bare playlist id.
 * Returns null for a plain single-video URL, which is how the task form tells a
 * playlist task apart from a single-video one.
 */
export function parsePlaylistId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/[?&]list=([\w-]+)/);
  if (m) return m[1]!;
  // Bare ids: user playlists (PL/UU/LL/FL/OL...) — exclude the Watch Later (WL)
  // and History (HL) ids, which the API can't read anyway.
  if (/^(PL|UU|LL|FL|OL|RD)[\w-]{10,}$/.test(s)) return s;
  return null;
}

export interface PlaylistVideo {
  id: string;
  title: string;
}

const YT_API = "https://www.googleapis.com/youtube/v3";

function ytApiError(status: number, body: unknown): string {
  const msg = (body as { error?: { message?: string } })?.error?.message;
  return msg ?? `HTTP ${status}`;
}

/**
 * Fetch a playlist's videos via the YouTube Data API (needs an API key).
 * Paginates (50/page) up to a cap, and drops private/deleted entries that can't
 * be watched. Throws Error with the API's message on failure (bad key, quota,
 * playlist not found). The googleapis endpoint sends CORS headers, so this works
 * from the web build too.
 */
export async function fetchPlaylistItems(
  playlistId: string,
  apiKey: string,
  maxPages = 6,
): Promise<PlaylistVideo[]> {
  const out: PlaylistVideo[] = [];
  let pageToken = "";
  for (let page = 0; page < maxPages; page++) {
    const url =
      `${YT_API}/playlistItems?part=snippet&maxResults=50` +
      `&playlistId=${encodeURIComponent(playlistId)}&key=${encodeURIComponent(apiKey)}` +
      (pageToken ? `&pageToken=${pageToken}` : "");
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(`YouTube API: ${ytApiError(res.status, body)}`);
    }
    const data = (await res.json()) as {
      items?: { snippet?: { title?: string; resourceId?: { videoId?: string } } }[];
      nextPageToken?: string;
    };
    for (const it of data.items ?? []) {
      const id = it.snippet?.resourceId?.videoId;
      const title = it.snippet?.title;
      if (!id || title === "Private video" || title === "Deleted video") continue;
      out.push({ id, title: title || id });
    }
    pageToken = data.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return out;
}

/** Resolve a playlist's title via the API; null if unavailable (used to name the task). */
export async function fetchPlaylistTitle(
  playlistId: string,
  apiKey: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${YT_API}/playlists?part=snippet&id=${encodeURIComponent(playlistId)}&key=${encodeURIComponent(apiKey)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: { snippet?: { title?: string } }[] };
    return data.items?.[0]?.snippet?.title ?? null;
  } catch {
    return null;
  }
}

/**
 * Look up a video's title via oEmbed (no API key). Tries YouTube's official
 * endpoint first — it works on native — then falls back to the CORS-friendly
 * noembed proxy so the web build (which YouTube's endpoint blocks via CORS) can
 * still resolve a title. Returns null on a bad URL or if both lookups fail.
 */
export async function fetchYouTubeTitle(input: string): Promise<string | null> {
  const id = parseYouTubeId(input);
  if (!id) return null;
  const watch = `https://www.youtube.com/watch?v=${id}`;
  const endpoints = [
    `https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`,
    `https://noembed.com/embed?url=${encodeURIComponent(watch)}`,
  ];
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep);
      if (!res.ok) continue;
      const data = (await res.json()) as { title?: string };
      if (data.title) return data.title;
    } catch {
      // CORS or network failure — try the next endpoint.
    }
  }
  return null;
}
