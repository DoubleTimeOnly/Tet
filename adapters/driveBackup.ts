import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import type { BackupFiles } from "./backupFiles";
import { createDriveFiles, DRIVE_FILE_SCOPE } from "../lib/driveApi";

/**
 * Automatic backups to the user's own Google Drive, as a second destination
 * alongside the local folder (adapters/backupFiles). Same BackupFiles shape, so
 * lib/autoBackup's schedule and retention apply unchanged.
 *
 * Sign-in is the native Google account picker; the library keeps the session
 * and mints short-lived access tokens on demand (getTokens refreshes them), so
 * there is nothing to store, paste or renew. The scope is `drive.file`: Tet
 * sees only the files it created, in a visible "Tet backups" folder.
 *
 * One-time setup lives in the Google Cloud console (an Android OAuth client for
 * this package name + signing key's SHA-1, consent screen set to "In
 * production" so sessions don't lapse after 7 days) — see README.
 */

export interface DriveBackupFiles extends BackupFiles {
  /** The signed-in account's email, or null. */
  account(): string | null;
  signOut(): Promise<void>;
}

let configured = false;
function configure(): void {
  if (configured) return;
  GoogleSignin.configure({ scopes: [DRIVE_FILE_SCOPE] });
  configured = true;
}

const drive = createDriveFiles({
  async getToken() {
    configure();
    return (await GoogleSignin.getTokens()).accessToken;
  },
  async invalidateToken(token) {
    await GoogleSignin.clearCachedAccessToken(token);
  },
  fetch: (url, init) => fetch(url, init),
});

function signedIn(): boolean {
  configure();
  return GoogleSignin.hasPreviousSignIn();
}

export const driveBackup: DriveBackupFiles = {
  supported: true,

  async describe() {
    return signedIn() ? `Google Drive · ${this.account() ?? "signed in"}` : null;
  },

  async hasFolder() {
    return signedIn();
  },

  /** Sign in (and consent to the Drive scope). Resolves true if the user did. */
  async chooseFolder() {
    configure();
    try {
      return isSuccessResponse(await GoogleSignin.signIn());
    } catch (e) {
      if (isErrorWithCode(e)) {
        if (e.code === statusCodes.SIGN_IN_CANCELLED) return false;
        // Android's DEVELOPER_ERROR: the OAuth client doesn't match this build.
        if (e.code === "10" || /DEVELOPER_ERROR/i.test(e.message)) {
          throw new Error(
            "Google rejected this build. The Android OAuth client must match the app's package name and signing-key SHA-1 (see README).",
          );
        }
      }
      throw e;
    }
  },

  account() {
    configure();
    return GoogleSignin.getCurrentUser()?.user.email ?? null;
  },

  async signOut() {
    configure();
    await GoogleSignin.signOut();
  },

  list: drive.list,
  read: drive.read,
  write: drive.write,
  remove: drive.remove,
};
