/**
 * What to tell the user when the folder they picked for automatic backups
 * can't be used. Pure so the wording is testable; adapters/backupFiles feeds it
 * the error code from modules/tet-documents.
 */

export interface FolderError {
  /** Native rejection code, e.g. "FOLDER_NOT_WRITABLE". */
  code?: string;
  message?: string;
}

export function folderProblem(err: FolderError): string {
  switch (err.code) {
    case "FOLDER_NOT_WRITABLE":
      return (
        "Tet can't write to that folder. Its storage provider (for example Dropbox) " +
        "lists the folder but won't let apps save files into it. Pick a folder on this " +
        `device, or one from a provider that allows writes such as Google Drive. (${err.message ?? "no detail"})`
      );
    case "FOLDER_UNAVAILABLE":
      return "That folder is no longer available. Choose the backup folder again.";
    default:
      return err.message ?? "Couldn't use that folder.";
  }
}
