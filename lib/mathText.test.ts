import { parseMath, hasMath, escapeHtml } from "./mathText";

describe("parseMath", () => {
  it("splits inline math from surrounding text", () => {
    expect(parseMath("what is $X$?")).toEqual([
      { type: "text", value: "what is " },
      { type: "inline", value: "X" },
      { type: "text", value: "?" },
    ]);
  });

  it("recognizes $$...$$ as block math", () => {
    expect(parseMath("$$a+b$$")).toEqual([{ type: "block", value: "a+b" }]);
  });

  it("handles multiple inline segments", () => {
    const segs = parseMath("$|0\\rangle$ and $|1\\rangle$");
    expect(segs.map((s) => s.type)).toEqual(["inline", "text", "inline"]);
    expect(segs[0]).toEqual({ type: "inline", value: "|0\\rangle" });
  });

  it("keeps a matrix body (with \\\\ row breaks) as one inline segment", () => {
    expect(parseMath("$\\begin{bmatrix}1 \\\\ 0\\end{bmatrix}$")).toEqual([
      { type: "inline", value: "\\begin{bmatrix}1 \\\\ 0\\end{bmatrix}" },
    ]);
  });

  it("returns plain text untouched when there is no math", () => {
    expect(parseMath("just words")).toEqual([{ type: "text", value: "just words" }]);
  });
});

describe("hasMath", () => {
  it("detects a dollar delimiter", () => {
    expect(hasMath("a $x$ b")).toBe(true);
    expect(hasMath("no math here")).toBe(false);
  });
});

describe("escapeHtml", () => {
  it("escapes HTML-significant characters", () => {
    expect(escapeHtml('<b> & "x"')).toBe("&lt;b&gt; &amp; &quot;x&quot;");
  });
});
