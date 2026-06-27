import * as SQLite from "expo-sqlite";
import type { Store } from "./store";
import type {
  Deck,
  Task,
  Card,
  Note,
  Review,
  Completion,
  CompletionEvidence,
} from "./schema";
import { SCHEMA_SQL } from "./schema";
import { backfillNotes } from "../lib/notesBackfill";
import type { BackupData } from "../lib/backup";

/** Raw expo-sqlite Store (native dev build). Mirrors MemoryStore semantics. */
export class SqliteStore implements Store {
  private db: SQLite.SQLiteDatabase | null = null;

  constructor(private readonly dbName = "tet.db") {}

  private get conn(): SQLite.SQLiteDatabase {
    if (!this.db) throw new Error("SqliteStore.init() not called");
    return this.db;
  }

  async init(): Promise<void> {
    this.db = await SQLite.openDatabaseAsync(this.dbName);
    await this.db.execAsync("PRAGMA foreign_keys = ON;");
    await this.db.execAsync(SCHEMA_SQL);
    await this.migrate();
  }

  /** Additive migrations for DBs created before a column existed. */
  private async migrate(): Promise<void> {
    const cardCols = await this.conn.getAllAsync<{ name: string }>("PRAGMA table_info(cards)");
    if (!cardCols.some((c) => c.name === "ignored")) {
      await this.conn.execAsync(
        "ALTER TABLE cards ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0",
      );
    }
    const taskCols = await this.conn.getAllAsync<{ name: string }>("PRAGMA table_info(tasks)");
    if (!taskCols.some((c) => c.name === "meta")) {
      await this.conn.execAsync("ALTER TABLE tasks ADD COLUMN meta TEXT");
    }
    // Notes (sibling groups). On a DB that predates them, add the card columns
    // (no FK clause — SQLite only enforces FKs declared at table-create) then
    // backfill notes for existing cloze/reversed groups so they become
    // editable-as-one. SCHEMA_SQL already created the notes table on init.
    if (!cardCols.some((c) => c.name === "note_id")) {
      await this.conn.execAsync("ALTER TABLE cards ADD COLUMN note_id TEXT");
      await this.conn.execAsync("ALTER TABLE cards ADD COLUMN template INTEGER NOT NULL DEFAULT 0");
      await this.backfillNotes();
    }
  }

  /** Reconstruct notes for legacy sibling groups; preserves every schedule. */
  private async backfillNotes(): Promise<void> {
    const existing = await this.listAllCards();
    const { notes, cards } = backfillNotes(existing);
    if (notes.length === 0) return;
    const stamped = new Map(cards.map((c) => [c.id, c]));
    await this.conn.withTransactionAsync(async () => {
      for (const n of notes) await this.insertNote(n);
      for (const orig of existing) {
        const c = stamped.get(orig.id)!;
        if (c.note_id !== orig.note_id || c.template !== orig.template) {
          await this.conn.runAsync(
            "UPDATE cards SET note_id = ?, template = ? WHERE id = ?",
            [c.note_id, c.template, c.id],
          );
        }
      }
    });
  }

  async insertDeck(d: Deck): Promise<void> {
    await this.conn.runAsync(
      "INSERT INTO decks (id, name, created_at) VALUES (?, ?, ?)",
      [d.id, d.name, d.created_at],
    );
  }
  async listDecks(): Promise<Deck[]> {
    return this.conn.getAllAsync<Deck>("SELECT * FROM decks ORDER BY created_at");
  }

  async insertTask(t: Task): Promise<void> {
    await this.conn.runAsync(
      `INSERT INTO tasks (id, type, title, source_ref, cadence, makes_cards_count, reading_target, active, created_at, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.id, t.type, t.title, t.source_ref, t.cadence, t.makes_cards_count, t.reading_target, t.active ? 1 : 0, t.created_at, t.meta ?? null],
    );
  }
  async setTaskActive(id: string, active: boolean): Promise<void> {
    await this.conn.runAsync("UPDATE tasks SET active = ? WHERE id = ?", [active ? 1 : 0, id]);
  }
  async updateTaskMeta(id: string, meta: string | null): Promise<void> {
    await this.conn.runAsync("UPDATE tasks SET meta = ? WHERE id = ?", [meta, id]);
  }
  async listTasks(opts: { activeOnly?: boolean } = {}): Promise<Task[]> {
    const rows = await this.conn.getAllAsync<TaskRow>(
      opts.activeOnly ? "SELECT * FROM tasks WHERE active = 1" : "SELECT * FROM tasks",
    );
    return rows.map(rowToTask);
  }
  async getTask(id: string): Promise<Task | null> {
    const row = await this.conn.getFirstAsync<TaskRow>("SELECT * FROM tasks WHERE id = ?", [id]);
    return row ? rowToTask(row) : null;
  }

  async insertNote(n: Note): Promise<void> {
    await this.conn.runAsync(
      `INSERT INTO notes (id, deck_id, kind, fields, source_task_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [n.id, n.deck_id, n.kind, n.fields, n.source_task_id, n.created_at],
    );
  }
  async getNote(id: string): Promise<Note | null> {
    return (await this.conn.getFirstAsync<Note>("SELECT * FROM notes WHERE id = ?", [id])) ?? null;
  }
  async updateNoteFields(id: string, fields: string): Promise<void> {
    await this.conn.runAsync("UPDATE notes SET fields = ? WHERE id = ?", [fields, id]);
  }
  async listNotes(): Promise<Note[]> {
    return this.conn.getAllAsync<Note>("SELECT * FROM notes ORDER BY created_at");
  }

  async insertCard(c: Card): Promise<void> {
    await this.conn.runAsync(
      `INSERT INTO cards (id, deck_id, front, back, note_id, template, source_task_id, created_at, fsrs_state, due, state_label, ignored)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.id, c.deck_id, c.front, c.back, c.note_id, c.template, c.source_task_id, c.created_at, c.fsrs_state, c.due, c.state_label, c.ignored ? 1 : 0],
    );
  }
  async updateCardScheduling(c: Card): Promise<void> {
    await this.conn.runAsync(
      "UPDATE cards SET fsrs_state = ?, due = ?, state_label = ? WHERE id = ?",
      [c.fsrs_state, c.due, c.state_label, c.id],
    );
  }
  async updateCardContent(id: string, front: string, back: string): Promise<void> {
    await this.conn.runAsync(
      "UPDATE cards SET front = ?, back = ? WHERE id = ?",
      [front, back, id],
    );
  }
  async deleteCard(id: string): Promise<void> {
    await this.conn.runAsync("DELETE FROM cards WHERE id = ?", [id]);
  }
  async setCardIgnored(id: string, ignored: boolean): Promise<void> {
    await this.conn.runAsync(
      "UPDATE cards SET ignored = ? WHERE id = ?",
      [ignored ? 1 : 0, id],
    );
  }
  async getCard(id: string): Promise<Card | null> {
    const row = await this.conn.getFirstAsync<CardRow>("SELECT * FROM cards WHERE id = ?", [id]);
    return row ? rowToCard(row) : null;
  }
  async listDueCards(nowMs: number, limit?: number): Promise<Card[]> {
    const sql = "SELECT * FROM cards WHERE ignored = 0 AND due <= ? ORDER BY due ASC" + (limit !== undefined ? " LIMIT ?" : "");
    const args = limit !== undefined ? [nowMs, limit] : [nowMs];
    const rows = await this.conn.getAllAsync<CardRow>(sql, args);
    return rows.map(rowToCard);
  }
  async listCardsByNote(noteId: string): Promise<Card[]> {
    const rows = await this.conn.getAllAsync<CardRow>(
      "SELECT * FROM cards WHERE note_id = ? ORDER BY template",
      [noteId],
    );
    return rows.map(rowToCard);
  }
  async listAllCards(): Promise<Card[]> {
    const rows = await this.conn.getAllAsync<CardRow>("SELECT * FROM cards ORDER BY created_at");
    return rows.map(rowToCard);
  }
  async countCardsBySourceTask(taskId: string): Promise<number> {
    const row = await this.conn.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM cards WHERE source_task_id = ?",
      [taskId],
    );
    return row?.n ?? 0;
  }

  async insertReview(r: Review): Promise<void> {
    await this.conn.runAsync(
      "INSERT INTO reviews (id, card_id, rating, reviewed_at) VALUES (?, ?, ?, ?)",
      [r.id, r.card_id, r.rating, r.reviewed_at],
    );
  }
  async countReviews(): Promise<number> {
    const row = await this.conn.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM reviews",
    );
    return row?.n ?? 0;
  }

  async insertCompletion(c: Completion): Promise<void> {
    await this.conn.runAsync(
      "INSERT INTO completions (id, task_id, date, verified, evidence, completed_at) VALUES (?, ?, ?, ?, ?, ?)",
      [c.id, c.task_id, c.date, c.verified ? 1 : 0, JSON.stringify(c.evidence), c.completed_at],
    );
  }
  async listCompletionsForDay(dayKey: string): Promise<Completion[]> {
    const rows = await this.conn.getAllAsync<CompletionRow>("SELECT * FROM completions WHERE date = ?", [dayKey]);
    return rows.map(rowToCompletion);
  }
  async listCompletions(): Promise<Completion[]> {
    const rows = await this.conn.getAllAsync<CompletionRow>("SELECT * FROM completions");
    return rows.map(rowToCompletion);
  }

  async exportAll(): Promise<BackupData> {
    const [decks, tasks, notes, cards, reviews, completions] = await Promise.all([
      this.listDecks(),
      this.listTasks(),
      this.listNotes(),
      this.listAllCards(),
      this.conn.getAllAsync<Review>("SELECT * FROM reviews"),
      this.listCompletions(),
    ]);
    return { decks, tasks, notes, cards, reviews, completions };
  }
  async replaceAll(data: BackupData): Promise<void> {
    await this.conn.withTransactionAsync(async () => {
      // notes before cards (cards reference notes); reverse order on delete.
      for (const table of ["completions", "reviews", "cards", "notes", "tasks", "decks"]) {
        await this.conn.runAsync(`DELETE FROM ${table}`);
      }
      for (const d of data.decks) await this.insertDeck(d);
      for (const t of data.tasks) await this.insertTask(t);
      for (const n of data.notes ?? []) await this.insertNote(n);
      for (const c of data.cards) await this.insertCard(c);
      for (const r of data.reviews) await this.insertReview(r);
      for (const c of data.completions) await this.insertCompletion(c);
    });
  }
  async insertMany(decks: Deck[], cards: Card[], notes: Note[] = []): Promise<void> {
    await this.conn.withTransactionAsync(async () => {
      for (const d of decks) await this.insertDeck(d);
      for (const n of notes) await this.insertNote(n);
      for (const c of cards) await this.insertCard(c);
    });
  }
}

// SQLite stores booleans as 0/1 and evidence as a JSON string; revive on read.
interface CardRow extends Omit<Card, "ignored"> {
  ignored: number;
}
function rowToCard(r: CardRow): Card {
  return { ...r, ignored: r.ignored === 1 };
}

interface TaskRow extends Omit<Task, "active"> {
  active: number;
}
function rowToTask(r: TaskRow): Task {
  return { ...r, active: r.active === 1 };
}

interface CompletionRow extends Omit<Completion, "verified" | "evidence"> {
  verified: number;
  evidence: string;
}
function rowToCompletion(r: CompletionRow): Completion {
  return {
    ...r,
    verified: r.verified === 1,
    evidence: JSON.parse(r.evidence) as CompletionEvidence,
  };
}
