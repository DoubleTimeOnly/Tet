import { parseYouTubeId, parsePlaylistId } from "./youtube";

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

describe("parsePlaylistId", () => {
  it.each([
    ["https://www.youtube.com/playlist?list=PLabc123def456", "PLabc123def456"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123def456", "PLabc123def456"],
    ["PLabc123def456", "PLabc123def456"],
  ])("parses %s", (url, id) => {
    expect(parsePlaylistId(url)).toBe(id);
  });

  it("returns null for a plain single-video URL", () => {
    expect(parsePlaylistId("https://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(parsePlaylistId("dQw4w9WgXcQ")).toBeNull();
  });
});
