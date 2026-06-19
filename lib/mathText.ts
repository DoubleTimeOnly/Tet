/**
 * Split flashcard text into plain and LaTeX segments, matching Obsidian's
 * delimiters: `$$...$$` for display (block) math and `$...$` for inline. The
 * cards were authored in Obsidian, so e.g. "what is $X$?" or a `$\begin{bmatrix}
 * ...\end{bmatrix}$` answer must render as math, not literal dollar signs.
 *
 * Pure + framework-free so it's unit-tested and shared by both renderers
 * (ui/MathText.web renders with KaTeX; ui/MathText native renders in a WebView).
 */

export type MathSegment =
  | { type: "text"; value: string }
  | { type: "inline"; value: string }
  | { type: "block"; value: string };

// $$...$$ (display) is tried before $...$ (inline). Inline disallows newlines/$
// inside so a stray dollar can't swallow the rest of the card.
const MATH = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

export function parseMath(input: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MATH.lastIndex = 0;
  while ((m = MATH.exec(input)) !== null) {
    if (m.index > last) {
      segments.push({ type: "text", value: input.slice(last, m.index) });
    }
    if (m[1] !== undefined) segments.push({ type: "block", value: m[1] });
    else segments.push({ type: "inline", value: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < input.length) {
    segments.push({ type: "text", value: input.slice(last) });
  }
  return segments;
}

/** Does the text contain any LaTeX delimiters? Cheap gate before heavy rendering. */
export function hasMath(input: string): boolean {
  return input.includes("$");
}

/** Escape a string for safe interpolation into HTML text content. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
