import { useState } from "react";
import { Text, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { hasMath, escapeHtml } from "../lib/mathText";
import { colors } from "./theme";

/**
 * Native LaTeX renderer. Cards without `$` take the cheap plain-Text path; the
 * rest render in a WebView with KaTeX auto-render (the only practical way to
 * typeset LaTeX in React Native). Web uses ui/MathText.web.tsx instead.
 */
export function MathText({
  value,
  kind = "body",
}: {
  value: string;
  kind?: "subtitle" | "body";
}) {
  const [height, setHeight] = useState(40);

  if (!hasMath(value)) {
    return <Text style={kind === "subtitle" ? styles.subtitle : styles.body}>{value}</Text>;
  }

  const fontSize = kind === "subtitle" ? 18 : 16;
  const fontWeight = kind === "subtitle" ? 600 : 400;
  const html = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
<style>
  body { margin:0; padding:0; background:transparent; color:${colors.text};
         font-size:${fontSize}px; font-weight:${fontWeight}; line-height:1.5;
         white-space:pre-wrap; font-family:-apple-system,Roboto,sans-serif; }
</style></head><body><div id="c">${escapeHtml(value)}</div>
<script>
  function post(){ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(String(document.body.scrollHeight)); }
  window.addEventListener('load', function(){
    try { renderMathInElement(document.body, { delimiters: [
      {left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}], throwOnError:false }); } catch(e){}
    post(); setTimeout(post, 300);
  });
</script></body></html>`;

  return (
    <WebView
      originWhitelist={["*"]}
      source={{ html }}
      style={{ height, backgroundColor: "transparent" }}
      scrollEnabled={false}
      onMessage={(e) => {
        const h = Number(e.nativeEvent.data);
        if (h > 0) setHeight(h);
      }}
    />
  );
}

const styles = StyleSheet.create({
  subtitle: { color: colors.text, fontSize: 18, fontWeight: "600", lineHeight: 27 },
  body: { color: colors.text, fontSize: 16, lineHeight: 24 },
});
