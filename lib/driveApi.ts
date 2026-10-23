/**
 * Google Drive REST calls for automatic backups — pure logic over an injected
 * `fetch` and token source, so it is testable without the native sign-in
 * library (adapters/driveBackup wires in the real ones).
 *
 * Uses the `drive.file` scope: the app can only see files it created itself,
 * which is why a plain folder-name lookup is safe (it can't match someone
 * else's "Tet backups"). The folder and snapshots are ordinary Drive files, so
 * the user can open, download or delete them from the Drive app.
 */

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_FOLDER_NAME = "Tet backups";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const JSON_MIME = "application/json";

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

export interface DriveDeps {
  /** A currently-valid OAuth access token. */
  getToken(): Promise<string>;
  /** Drop a token Drive rejected, so the next getToken() fetches a fresh one. */
  invalidateToken(token: string): Promise<void>;
  fetch: typeof fetch;
}

export interface DriveFiles {
  list(): Promise<string[]>;
  read(name: string): Promise<string>;
  write(name: string, text: string): Promise<string>;
  remove(name: string): Promise<void>;
}

/** Escape a value for use inside a single-quoted Drive query string. */
function q(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function createDriveFiles(deps: DriveDeps): DriveFiles {
  let folderId: string | null = null;

  /** One authorised request; retries once with a fresh token on a 401. */
  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await deps.getToken();
      const res = await deps.fetch(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 && attempt === 0) {
        await deps.invalidateToken(token);
        continue;
      }
      if (!res.ok) {
        throw new DriveError(`Google Drive: ${res.status} ${await errorDetail(res)}`, res.status);
      }
      return res;
    }
  }

  async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
    return (await call(url, init)).json() as Promise<T>;
  }

  /** The backup folder's id, creating the folder the first time. */
  async function ensureFolder(): Promise<string> {
    if (folderId) return folderId;
    const query = `name='${q(DRIVE_FOLDER_NAME)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
    const found = await getJson<{ files: { id: string }[] }>(
      `${API}/files?${new URLSearchParams({ q: query, fields: "files(id)", pageSize: "1" })}`,
    );
    if (found.files[0]) return (folderId = found.files[0].id);
    const made = await getJson<{ id: string }>(`${API}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": JSON_MIME },
      body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: FOLDER_MIME }),
    });
    return (folderId = made.id);
  }

  /** name -> id for everything in the folder. */
  async function index(): Promise<Map<string, string>> {
    const parent = await ensureFolder();
    const out = new Map<string, string>();
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${q(parent)}' in parents and trashed=false`,
        fields: "nextPageToken,files(id,name)",
        pageSize: "1000",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await getJson<{
        files: { id: string; name: string }[];
        nextPageToken?: string;
      }>(`${API}/files?${params}`);
      for (const f of page.files) out.set(f.name, f.id);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  async function idFor(name: string): Promise<string> {
    const id = (await index()).get(name);
    if (!id) throw new Error(`Backup ${name} is no longer in Google Drive`);
    return id;
  }

  return {
    async list() {
      try {
        return [...(await index()).keys()];
      } catch (e) {
        // The folder was deleted out from under the cached id: forget it so the
        // next call finds or recreates it instead of failing forever.
        if (e instanceof DriveError && e.status === 404) folderId = null;
        throw e;
      }
    },

    async read(name) {
      return (await call(`${API}/files/${await idFor(name)}?alt=media`)).text();
    },

    async write(name, text) {
      const parent = await ensureFolder();
      const boundary = `tet-${Math.random().toString(36).slice(2)}`;
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify({ name, parents: [parent], mimeType: JSON_MIME })}\r\n` +
        `--${boundary}\r\nContent-Type: ${JSON_MIME}\r\n\r\n${text}\r\n--${boundary}--`;
      const made = await getJson<{ name: string }>(
        `${UPLOAD}/files?uploadType=multipart&fields=name`,
        {
          method: "POST",
          headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
          body,
        },
      );
      return made.name;
    },

    async remove(name) {
      const id = (await index()).get(name);
      if (id) await call(`${API}/files/${id}`, { method: "DELETE" });
    },
  };
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}
