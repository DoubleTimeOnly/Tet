# TODO — excerpt sources, ordering and focus mode

Design notes for the next round of excerpt review work. Not implemented. These
build on the shipped excerpt feature (see README, "Excerpt review").

## 1. Sources: sync only what you check

A **source** is one book/article/etc. in Readwise. Nothing is synced until you
check it.

| State   | Syncs | Appears in |
|---------|-------|------------|
| New     | no    | "New" list, with a badge until you act on it |
| Checked | yes   | Active list and the daily queue |
| Hidden  | no    | Hidden list only; never re-flagged as new |
| Done    | no    | Done list only; kept as a record of what you've processed |

- **Refresh** pulls only the list of sources (Readwise `/api/v2/books/`: title,
  author, category, highlight count, no highlights). Highlight counts let you
  judge a source before checking it.
- **Checking** a source fetches its highlights (export endpoint with `ids=`),
  then keeps syncing it incrementally (new highlights, edits, deletions).
- **Unchecking** stops syncing. Already-imported excerpts are kept; unresolved
  ones leave the queue. Rechecking loses nothing.
- Store Readwise's book id on each excerpt/source, not just the title, so a
  renamed title doesn't split a source in two.
- This replaces the first-sync backlog shuffle (`backlog` flag, 7-day grace):
  day one is empty until you check something.
- Existing excerpts have no source row yet: migration creates one per
  `book_title` and marks them Checked.

### Hide (declutter the list)
- Quick Hide button per row for new/unchecked sources; list sorted by highlight
  count so one-line articles are easy to clear.
- Hidden list lets you unhide; unhiding returns the source to unchecked.
- Hide is offered for new/unchecked sources only. A checked source leaves via Done.

### Done (declutter the checked list)
- Mark a checked source Done when you've finished it. Stops syncing, leaves the
  daily queue, stays visible in the Done list.
- Done list shows what you made of it (cards made, ignored, set aside — all
  derivable from existing rows).
- If undecided excerpts remain, prompt: **Ignore all** / **Leave them** /
  **Cancel**. "Leave them" keeps them out of the queue while the source is Done.
- A Done source can be reopened (back to Checked).

## 2. Daily review: two things change

**Pass becomes 2 / 5 / 7 days** (was 3 / 10 / 30). Roughly two weeks in total
instead of 43 days. After the third pass the excerpt must be decided. Counts as
1 point, like any decision. (`PASS_INTERVAL_DAYS` in `lib/excerpts.ts`; update
README and tests.)

**Block-style ordering by source rank.**
- Active sources have a manual rank (up/down controls on the Active list).
- The daily queue takes from the top-ranked source first, then the next. Strict
  priority, **no mixing**, so 10 points a day may all come from one book until
  it is empty.
- Within a source, excerpts go in the book's own order (Readwise `location`;
  fall back to `highlighted_at`).
- Passed excerpts that have come due slot in by **their source's rank**. They
  are not promoted, which would break up the block.
- Replaces the current order (fresh by due date, then shuffled backlog).

## 3. Focus mode (separate from the daily queue)

- Started by hand on one source. Independent of the daily queue, its schedule
  and the source ranking.
- Covers **every undecided excerpt** in that source: not carded, ignored or set
  aside. This includes excerpts passed earlier, even if their 2/5/7 date has not
  arrived. Book order, with a "37 of 120 left" counter. Ends when none are left.
- The button reads **Skip** here (daily mode: **Later**). Skip moves the excerpt
  to the end of the current session and nothing else: no schedule, no pass
  count, no limit on repeats.
- Skip earns **no points** (otherwise it could be farmed). Real decisions
  (ignore, card, set aside) earn points as usual, uncapped, so a focus session
  can count as the day's review.
- Leaving mid-session: skipped excerpts return in book order next time. Nothing
  persisted for skip position.

## Notes for whoever builds this

- Sources need their own table (id, readwise book id, title, author, category,
  highlight count, state, rank). Excerpts reference it by id.
- Sync cursor: today it is the newest stored `source_updated_at`. With
  per-source sync, a newly checked source needs a full fetch (no cursor);
  already-checked sources keep the incremental one.
- Add the source table to backup (bump `BACKUP_VERSION`) and `replaceAll`.
- Review screen: one button, label depends on mode; `decideExcerpt` needs a
  `skip` path that writes no `excerpt_reviews` row.
