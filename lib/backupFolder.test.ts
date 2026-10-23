import { folderProblem } from "./backupFolder";

describe("folderProblem", () => {
  it("explains a read-only provider and keeps the native detail", () => {
    const msg = folderProblem({
      code: "FOLDER_NOT_WRITABLE",
      message: "the provider refused to create a file",
    });
    expect(msg).toMatch(/can't write to that folder/);
    expect(msg).toMatch(/Dropbox/);
    expect(msg).toContain("the provider refused to create a file");
  });

  it("tells the user to re-pick a folder that has gone", () => {
    expect(folderProblem({ code: "FOLDER_UNAVAILABLE" })).toMatch(/Choose the backup folder again/);
  });

  it("falls back to the raw message for anything else", () => {
    expect(folderProblem({ code: "WRITE_FAILED", message: "disk full" })).toBe("disk full");
    expect(folderProblem({})).toBe("Couldn't use that folder.");
  });
});
