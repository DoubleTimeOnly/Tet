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
npm test           # jest — 427 tests
npm run typecheck  # tsc, whole app
```

The service-layer tests exercise the full read → make-cards → review loop, streak,
backup round-trip, and `.apkg` import against an in-memory store.

## Project layout

```
app/            expo-router screens (Today, Review, Library, Settings, task/*,
                prompts/*, excerpts/*)
ui/             React components (StoreProvider, shared widgets, theme)
services/       orchestration: Store + lib glue (learning, authoring, backup, notifications)
lib/            pure, tested logic (dayKey, dailySlice, fsrs, completion, streak,
                readwise, excerpts, backup, ankiImport, notifications, youtube,
                prompts)
db/             schema + Store interface; SqliteStore (native) / MemoryStore (web & tests)
adapters/       device plumbing (secure-store token, .apkg reader)
```

Persistence is behind a `Store` interface: `SqliteStore` on device, `MemoryStore` on
web and in tests — which is why the web preview and the test suite run without native
SQLite.

## Excerpt review (Readwise highlights → cards)

Incremental reading over your Readwise highlights. You choose which sources
(books, articles, …) feed it. Nothing is synced until you check a source.

**Sources** (**Library → Excerpts → Sources**, after adding your Readwise token
in Settings):

| Tab       | What's there |
|-----------|--------------|
| Active    | Checked sources. They sync, and the daily queue works through them top to bottom. Reorder with ↑/↓. |
| Available | Everything else, sorted by highlight count. Sources that appeared since your last refresh are flagged **NEW** (also shown on Today) until you **Check**, **Hide** or choose **Not now**. |
| Done      | Sources you finished, with what you made of them. **Reopen** to pick one back up. |
| Hidden    | Clutter you don't care about (one-line articles). Never flagged new again. **Unhide** returns it to Available. |

- **Refresh:** pulls only the list of sources. **Checking** a source fetches
  its highlights, and from then on each sync (app open, foreground, at most
  every 30 minutes, or **Sync now**) picks up its new highlights, edits and
  deletions.
- **Unchecking:** stops syncing. Imported excerpts are kept, so rechecking
  loses nothing.
- **Done:** when a source still has undecided excerpts, you're asked to
  **Ignore all** (no points), **Leave them** (out of the queue, still reachable
  by Focus), or **Cancel**.

The first check also adds a daily **Review excerpts** task (10/day; edit it
like any task).

There are two separate ways to work through excerpts:

- **Daily review** (the Today task): a points goal per day, drawn in **block
  order**. Every ready excerpt of your top Active source comes first, in book
  order, then the next source. Nothing is mixed.
- **Focus** (a source's **Focus** button): every undecided excerpt of that one
  source, in book order, including ones put off with Later. Rank and schedule
  don't apply. It ends when nothing is left.

Each excerpt is shown alone, with its source and an **Open ↗** link to
Readwise. The choices sit in a footer under your thumb:

- **Ignore**: never shown again.
- **Later** (daily review): comes back in 2, then 5, then 7 days (about two
  weeks in all). It slots back in by its source's rank, not ahead of it, so
  blocks stay intact. After 3 Laters it must be decided.
- **Skip** (focus mode): moves it to the end of this session. Nothing is
  stored and it earns no points.
- **Set aside**: parks it in the **set-aside pile**. There, tap several
  excerpts and write one card from all of them, or send one back to the queue.
- **Make card**: write a plain front/back card. It joins your normal
  flashcard reviews (deck "Readwise excerpts"), and the excerpt is done.

A mis-tap is one **Undo** away.

You write every card yourself. Nothing is generated or suggested. The card
fields are plain multiline inputs, so the keyboard's own mic dictates into
them. A card written from excerpts has a **Source** button (in review after
the answer is shown, and in **Library → Browse cards → Excerpts**) that shows
the excerpt(s) it came from.

Rules worth knowing:

- **Points:** each decision counts 1 and each card counts 3 (`CARD_POINTS`),
  so writing cards isn't penalised against quick deferrals. A combined card
  counts 3 once. Decisions in focus mode count too. Like flashcards, the
  daily goal is capped to what's available, so a thin queue completes at
  what's there.
- **Edited or deleted in Readwise:** an edit updates the stored excerpt in
  place. A card already written from it is never touched. A deleted highlight
  drops out of the queue and pile. If it was carded, the card stays and its
  source shows "Deleted in Readwise".
- **Duplicates:** the highlight id is unique, and the same text in the same
  book from a second source (e.g. Kindle and Reader) is skipped.

Logic is in `lib/excerpts.ts` (pure, tested), sync and source actions are in
`services/excerpts.ts`, and the Readwise v2 client (`/books/` and `/export/`)
is in `lib/readwiseHighlights.ts`.

## Improv practice

Separate from the flashcard system: **Today → Draw prompts**. It deals N random
prompts one at a time — either a single **word**, or a **relationship** composed
from two randomly paired roles ("A dentist and a stowaway") — to practise
generating ideas on the spot.

There is no schedule, no difficulty and no correct answer, so nothing here is
graded, scored, or counted toward XP or the streak. A prompt advances on a tap,
or on an optional auto-advance timer you can set to any interval (7s, 15s, 30s,
or type your own) when you want the pressure of not being able to stall.

Both lists ship with a curated default pool (`data/improv-prompts.json`) and can
be extended by pasting your own, one per line, the same way the flashcard text
import works. Draws are logged, so consecutive runs avoid repeating what you
just saw, and the pools + history are carried in the backup.

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
