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
