import { parseYouTubeId } from "./youtube";

describe("parseYouTubeId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/watch?list=x&v=dQw4w9WgXcQ&t=2", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("parses %s", (url, id) => {
    expect(parseYouTubeId(url)).toBe(id);
  });

  it("returns null for non-YouTube / malformed input", () => {
    expect(parseYouTubeId("https://example.com")).toBeNull();
    expect(parseYouTubeId("")).toBeNull();
    expect(parseYouTubeId("not a url")).toBeNull();
  });
});
