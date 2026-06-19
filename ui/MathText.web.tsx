import katex from "katex";
import "katex/dist/katex.min.css";
import { parseMath, escapeHtml } from "../lib/mathText";
import { colors } from "./theme";

/**
 * Web LaTeX renderer: react-native-web compiles to react-dom, so we render the
 * card text as HTML — plain runs escaped, `$…$`/`$$…$$` runs handed to KaTeX.
 * Mirrored on native by ui/MathText.tsx (a KaTeX WebView).
 */
export function MathText({
  value,
  kind = "body",
}: {
  value: string;
  kind?: "subtitle" | "body";
}) {
  const html = parseMath(value)
    .map((seg) => {
      if (seg.type === "text") return escapeHtml(seg.value);
      try {
        return katex.renderToString(seg.value, {
          displayMode: seg.type === "block",
          throwOnError: false,
        });
      } catch {
        // Unparseable math: show the source rather than crashing the card.
        return escapeHtml(`$${seg.value}$`);
      }
    })
    .join("");

  const style: React.CSSProperties = {
    color: colors.text,
    fontSize: kind === "subtitle" ? 18 : 16,
    fontWeight: kind === "subtitle" ? 600 : 400,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
  };

  return <div style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}
