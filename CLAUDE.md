# Tet — Agent Instructions

## Running the web dev server

```bash
npx expo start --web --port 8081
```

The app is then at http://localhost:8081.

### Worktree note

This repo uses git worktrees for isolated agent branches. Worktrees don't get
their own `node_modules` — they share the parent repo's copy. Metro (the JS
bundler) won't traverse up through `.claude/worktrees/` to find it, so you'll
get a blank white screen with no obvious error.

Fix: symlink node_modules into the worktree before starting the server.

```bash
ln -sf /home/victor/repos/tet/node_modules \
       /home/victor/repos/tet/.claude/worktrees/<branch>/node_modules
```

(The symlink is gitignored via the `node_modules` entry in `.gitignore` so it
won't be tracked.)

### Bundle URL

The HTML page loads the bundle from:

```
/node_modules/expo-router/entry.bundle?platform=web&dev=true&...
```

Not `/index.bundle`. If you're smoke-testing the bundle with curl, use that URL
(visible in the `<script src>` tag of the served HTML).

### First load

The bundle is ~5.6 MB and compiles on first request. Expect 10–20 seconds before
the page renders. A white screen during this window is normal.

## Building the Android app

Builds are manual only (never on push). The `Android build` GitHub Actions
workflow (`.github/workflows/android-build.yml`) runs
`eas build --profile preview --platform android` and takes ~15 minutes. It
produces an installable APK.

To start a build when the user asks for one:

```bash
git push                                   # the branch must be on GitHub
gh workflow run android-build.yml --ref <branch>
gh run list --workflow android-build.yml --limit 1
gh run watch <run-id>                      # optional; or check back later
```

The run's job summary contains the EAS build page link and the APK URL; give
the user the build page link when it finishes. If `gh` isn't authenticated,
tell the user to run the workflow from the Actions tab (or GitHub mobile app).

Always build through EAS so the signing keystore stays the same. The Google
sign-in OAuth client is tied to its SHA-1, and Android only installs updates
signed with the same key. Requires the `EXPO_TOKEN` repo secret.
