# Tet

All-in-one daily learning tasks with **verifiable** completion. One place that holds
your flashcards, YouTube watch tasks, and Readwise reading — and each day tells you
what to do and how much. Completion is checked, not self-reported:

- **Flashcards** self-verify (review + create in-app, scheduled with [FSRS](https://github.com/open-spaced-repetition/ts-fsrs)).
- **Reading** is verified against the Readwise Reader API (`reading_progress`).
- **YouTube** is watched in an embedded player and confirmed with a manual "Done".

The cross-task loop is the point: watch/read something → make cards from it → review
those cards over the following days.

Built with Expo (React Native) + expo-router + raw expo-sqlite. The day resets at
**local 4am**.

## Prerequisites

- **Node 18+** and npm (developed on Node 24).
- For device builds: the [Expo Go](https://expo.dev/go) app on your phone, or Xcode /
  Android Studio for a native dev build.
- Optional: a **Readwise** account + API token (only needed to test reading
  verification). Get one at https://readwise.io/access_token.

## Install

```bash
npm install
```

## Run

### Fastest — browser preview

```bash
npm run web        # opens http://localhost:8081
```

Click through the whole app in a browser. Data is **in-memory** (resets on refresh),
and a Starter deck is auto-seeded so it's not empty. Push notifications and the native
YouTube embed are stubbed on web — YouTube falls back to "Open in YouTube".

### On your phone — standalone install (no laptop required)

The fastest way to get a self-contained app on your phone that keeps working all week
without a dev server running.

Build it in the cloud with [EAS](https://docs.expo.dev/build/introduction/) (no Xcode /
Android Studio needed locally):

```bash
npm install -g eas-cli      # or: npx eas-cli@latest <cmd>
eas login                   # free Expo account
eas init                    # creates the EAS project id (first time only)

# Android — produces a direct-install APK (no account needed beyond Expo)
eas build --profile preview --platform android

# iOS — requires an Apple Developer account ($99/yr)
eas build --profile preview --platform ios
```

When the build finishes EAS prints a QR code / link. Open it on your phone and install
the app. No bundler needs to be running — the JS is bundled into the binary.

> **Android tip:** if your phone blocks installs from unknown sources, go to
> Settings → Apps → Special app access → Install unknown apps and allow your browser.

### On your phone — development build (for active development)

Use this if you want hot-reload while editing code. It requires keeping the bundler
running on your laptop.

```bash
npm install -g eas-cli
eas login
eas init

# Android
eas build --profile development --platform android
# iOS
eas build --profile development --platform ios
```

Install the app from the EAS link, then start the bundler and connect (scan the QR
from the installed dev app, not Expo Go):

```bash
npx expo start --dev-client
```

### Local native build (if you have the toolchains)

```bash
npm run ios        # needs Xcode
npm run android    # needs Android Studio / SDK
```

## Try the full loop

The thing Tet is built around — do this once to see it work end to end:

1. **Today → Review now** — grade the 3 seeded cards (Again / Hard / Good / Easy).
   They reschedule via FSRS and drop off "due."
2. **Library → New task** — add a **YouTube** task and set **Make N cards = 2**.
3. Open it from **Today**. Below the player, use **"Make cards from this"** to add 2
   cards (they're tied to the task). Watch the `0/2 made` counter, then tap **Done** —
   it verifies only once watched **and** the 2 cards exist.
4. Those new cards now show up in **Review** on a later day.

### Testing reading verification (optional, needs Readwise)

1. **Settings** → paste your Readwise API token → **Save token**.
2. **Library → New task → reading** → type a document title → **Find document** →
   tap the match (this resolves the Readwise doc id for you).
3. Open the task from Today → **Check Readwise**. It passes once your
   `reading_progress` for that document crosses the target (default 90%).

## Run the tests

All business logic is covered by a fast headless test suite (no device needed):

```bash
npm test           # jest — 112 tests
npm run typecheck  # tsc, whole app
```

The service-layer tests exercise the full read → make-cards → review loop, streak,
backup round-trip, and `.apkg` import against an in-memory store.

## Project layout

```
app/            expo-router screens (Today, Review, Library, Settings, task/*)
ui/             React components (StoreProvider, shared widgets, theme)
services/       orchestration: Store + lib glue (learning, authoring, backup, notifications)
lib/            pure, tested logic (dayKey, dailySlice, fsrs, completion, streak,
                readwise, backup, ankiImport, notifications, youtube)
db/             schema + Store interface; SqliteStore (native) / MemoryStore (web & tests)
adapters/       device plumbing (secure-store token, .apkg reader)
```

Persistence is behind a `Store` interface: `SqliteStore` on device, `MemoryStore` on
web and in tests — which is why the web preview and the test suite run without native
SQLite.

## Other features

- **Backup** (Settings): export/import everything as JSON so a reinstall mid-trial
  doesn't wipe your streak.
- **Anki import** (Settings): import an `.apkg` as fresh FSRS cards (Anki's SM-2
  scheduling history is intentionally not ported). Device builds only.
- **Obsidian import**: cards authored with the Obsidian "Spaced Repetition"
  plugin (notes tagged `#flashcardsv2`) are exported to
  `data/obsidian-flashcards.json` and imported into one "Obsidian Flashcards"
  deck **with their schedule preserved** — unlike Anki import, each card keeps
  its due date, interval→stability, and ease→difficulty (best-effort SM-2→FSRS;
  raw SM-2 values are kept verbatim in the JSON). See `lib/obsidianImport.ts`.

  ```sh
  # Re-export from a vault (writes data/obsidian-flashcards.json):
  OBSIDIAN_VAULT="/path/to/vault" npx jest exportObsidianFlashcards

  # Import the bundled JSON into a Store (one-shot, not auto-run):
  #   import { seedObsidianFlashcards } from "./services/seedObsidian";
  #   await seedObsidianFlashcards(store);
  ```
