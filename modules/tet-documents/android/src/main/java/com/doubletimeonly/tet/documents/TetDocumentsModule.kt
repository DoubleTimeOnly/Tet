package com.doubletimeonly.tet.documents

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.documentfile.provider.DocumentFile
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads and writes files inside a folder the user granted through the Storage
 * Access Framework, for any document provider (local storage, Google Drive,
 * Dropbox, ...).
 *
 * expo-file-system's SAF helpers only accept the built-in storage provider, and
 * they identify files by parsing the document uri, which cloud providers don't
 * make human-readable. This asks the provider for each file's real display name
 * instead, and says plainly when a provider won't let us write.
 */
class TetDocumentsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("TetDocuments")

    // Files (not sub-folders) directly inside the granted folder, as {name, uri}.
    AsyncFunction("list") { treeUri: String ->
      return@AsyncFunction tree(treeUri).listFiles()
        .filter { it.isFile }
        .mapNotNull { file ->
          val name = file.name ?: return@mapNotNull null
          Bundle().apply {
            putString("name", name)
            putString("uri", file.uri.toString())
          }
        }
    }

    // Proves the folder accepts writes by creating, writing and deleting a
    // throwaway file. Some providers list a folder happily but refuse to create
    // files in it; finding out here beats a backup that fails every day.
    AsyncFunction("probe") { treeUri: String ->
      val dir = tree(treeUri)
      val created: DocumentFile? = try {
        dir.createFile("text/plain", PROBE_NAME)
      } catch (e: Exception) {
        throw notWritable("could not create a file (${e.message})", e)
      }
      val file = created ?: throw notWritable("the provider refused to create a file", null)
      try {
        val out = context.contentResolver.openOutputStream(file.uri, "wt")
          ?: throw notWritable("the provider refused to open the file for writing", null)
        out.use { it.write(PROBE_BODY) }
      } catch (e: CodedException) {
        file.delete()
        throw e
      } catch (e: Exception) {
        file.delete()
        throw notWritable("could not write to a file (${e.message})", e)
      }
      file.delete()
      return@AsyncFunction true
    }

    // Create a new file and return the name the provider actually gave it
    // (providers de-duplicate clashes, and may adjust the extension). A write
    // that fails part-way removes the half-written file rather than leaving it
    // to be mistaken for a snapshot.
    AsyncFunction("write") { treeUri: String, name: String, mimeType: String, text: String ->
      val dir = tree(treeUri)
      val file = dir.createFile(mimeType, name)
        ?: throw CodedException("CREATE_FAILED", "The folder wouldn't let Tet create $name", null)
      try {
        val out = context.contentResolver.openOutputStream(file.uri, "wt")
          ?: throw CodedException("WRITE_FAILED", "The folder wouldn't let Tet write $name", null)
        // use{} closes the stream, which is where a provider that failed to
        // commit the data reports it.
        out.use { it.write(text.toByteArray(Charsets.UTF_8)) }
      } catch (e: CodedException) {
        file.delete()
        throw e
      } catch (e: Exception) {
        file.delete()
        throw CodedException("WRITE_FAILED", "Couldn't write $name: ${e.message}", e)
      }
      return@AsyncFunction file.name ?: name
    }

    AsyncFunction("read") { uri: String ->
      val stream = context.contentResolver.openInputStream(Uri.parse(uri))
        ?: throw CodedException("READ_FAILED", "The folder wouldn't let Tet open that file", null)
      return@AsyncFunction stream.use { String(it.readBytes(), Charsets.UTF_8) }
    }

    AsyncFunction("remove") { uri: String ->
      return@AsyncFunction DocumentFile.fromSingleUri(context, Uri.parse(uri))?.delete() ?: false
    }

    // Give back a folder grant we asked for but decided not to keep, so rejected
    // picks don't pile up against Android's cap on persisted grants.
    AsyncFunction("release") { treeUri: String ->
      try {
        context.contentResolver.releasePersistableUriPermission(
          Uri.parse(treeUri),
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
      } catch (e: SecurityException) {
        // Wasn't granted (or already released): nothing to give back.
      }
      return@AsyncFunction true
    }
  }

  private fun tree(treeUri: String): DocumentFile {
    val root = DocumentFile.fromTreeUri(context, Uri.parse(treeUri))
    if (root == null || !root.exists() || !root.isDirectory) {
      throw CodedException("FOLDER_UNAVAILABLE", "The backup folder is no longer available", null)
    }
    return root
  }

  private fun notWritable(detail: String, cause: Throwable?) =
    CodedException("FOLDER_NOT_WRITABLE", detail, cause)

  private companion object {
    const val PROBE_NAME = ".tet-write-test"
    val PROBE_BODY = "ok".toByteArray(Charsets.UTF_8)
  }
}
