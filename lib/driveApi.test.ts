import { createDriveFiles, DriveError, DRIVE_FOLDER_NAME } from "./driveApi";

type Call = { url: string; init: RequestInit };

/** A scripted fetch: each entry answers the next request in order. */
function scripted(responses: Array<{ status?: number; json?: unknown; text?: string }>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error(`unexpected request ${url}`);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: "status",
      json: async () => r.json,
      text: async () => r.text ?? "",
    } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function make(responses: Parameters<typeof scripted>[0]) {
  const { fn, calls } = scripted(responses);
  const invalidated: string[] = [];
  let n = 0;
  const files = createDriveFiles({
    getToken: async () => `tok${++n}`,
    invalidateToken: async (t) => void invalidated.push(t),
    fetch: fn,
  });
  return { files, calls, invalidated };
}

const dec = (u: string) => decodeURIComponent(u.replace(/\+/g, " "));
const auth = (c: Call) => (c.init.headers as Record<string, string>).Authorization;

describe("createDriveFiles", () => {
  it("finds an existing folder and lists its files by name", async () => {
    const { files, calls } = make([
      { json: { files: [{ id: "F" }] } },
      { json: { files: [{ id: "1", name: "a.json" }, { id: "2", name: "b.json" }] } },
    ]);
    expect(await files.list()).toEqual(["a.json", "b.json"]);
    expect(dec(calls[0]!.url)).toContain(`name='${DRIVE_FOLDER_NAME}'`);
    expect(dec(calls[1]!.url)).toContain("'F' in parents");
    expect(auth(calls[0]!)).toBe("Bearer tok1");
  });

  it("creates the folder when it doesn't exist yet", async () => {
    const { files, calls } = make([
      { json: { files: [] } },
      { json: { id: "NEW" } },
      { json: { files: [] } },
    ]);
    expect(await files.list()).toEqual([]);
    expect(calls[1]!.init.method).toBe("POST");
    expect(JSON.parse(calls[1]!.init.body as string).name).toBe(DRIVE_FOLDER_NAME);
    expect(dec(calls[2]!.url)).toContain("'NEW' in parents");
  });

  it("follows pagination", async () => {
    const { files } = make([
      { json: { files: [{ id: "F" }] } },
      { json: { files: [{ id: "1", name: "a.json" }], nextPageToken: "p2" } },
      { json: { files: [{ id: "2", name: "b.json" }] } },
    ]);
    expect(await files.list()).toEqual(["a.json", "b.json"]);
  });

  it("uploads multipart into the folder and returns the stored name", async () => {
    const { files, calls } = make([
      { json: { files: [{ id: "F" }] } },
      { json: { name: "tet-auto-x.json" } },
    ]);
    expect(await files.write("tet-auto-x.json", '{"a":1}')).toBe("tet-auto-x.json");
    const up = calls[1]!;
    expect(up.url).toContain("uploadType=multipart");
    const body = up.init.body as string;
    expect(body).toContain('"parents":["F"]');
    expect(body).toContain('{"a":1}');
  });

  it("reads and removes by looking the name up first", async () => {
    const { files, calls } = make([
      { json: { files: [{ id: "F" }] } },
      { json: { files: [{ id: "9", name: "a.json" }] } },
      { text: "contents" },
      { json: { files: [{ id: "9", name: "a.json" }] } },
      { status: 204 },
    ]);
    expect(await files.read("a.json")).toBe("contents");
    expect(calls[2]!.url).toContain("/files/9?alt=media");
    await files.remove("a.json");
    expect(calls[4]!.init.method).toBe("DELETE");
  });

  it("read of a vanished file explains itself", async () => {
    const { files } = make([{ json: { files: [{ id: "F" }] } }, { json: { files: [] } }]);
    await expect(files.read("gone.json")).rejects.toThrow(/no longer in Google Drive/);
  });

  it("retries once with a fresh token on 401", async () => {
    const { files, calls, invalidated } = make([
      { status: 401, json: { error: { message: "expired" } } },
      { json: { files: [{ id: "F" }] } },
      { json: { files: [] } },
    ]);
    await files.list();
    expect(invalidated).toEqual(["tok1"]);
    expect(auth(calls[1]!)).toBe("Bearer tok2");
  });

  it("surfaces Drive's message when a request fails", async () => {
    const { files } = make([{ status: 403, json: { error: { message: "API not enabled" } } }]);
    await expect(files.list()).rejects.toThrow(/403 API not enabled/);
  });

  it("forgets a deleted folder so the next call recreates it", async () => {
    const { files, calls } = make([
      { json: { files: [{ id: "OLD" }] } },
      { status: 404, json: { error: { message: "not found" } } },
      { json: { files: [] } },
      { json: { id: "NEW" } },
      { json: { files: [] } },
    ]);
    await expect(files.list()).rejects.toBeInstanceOf(DriveError);
    expect(await files.list()).toEqual([]);
    expect(dec(calls[4]!.url)).toContain("'NEW' in parents");
  });

  it("escapes quotes in queries", async () => {
    const { files, calls } = make([{ json: { files: [{ id: "F'x" }] } }, { json: { files: [] } }]);
    await files.list();
    expect(dec(calls[1]!.url)).toContain("'F\\'x' in parents");
  });
});
