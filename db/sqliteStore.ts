import * as SQLite from "expo-sqlite";
import type { Store } from "./store";
import type {
  Deck,
  Task,
  Card,
  Review,
  Completion,
  CompletionEvidence,
} from "./schema";
import { SCHEMA_SQL } from "./schema";
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
      `INSERT INTO tasks (id, type, title, source_ref, cadence, makes_cards_count, reading_target, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.id, t.type, t.title, t.source_ref, t.cadence, t.makes_cards_count, t.reading_target, t.active ? 1 : 0, t.created_at],
    );
  }
  async setTaskActive(id: string, active: boolean): Promise<void> {
    await this.conn.runAsync("UPDATE tasks SET active = ? WHERE id = ?", [active ? 1 : 0, id]);
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

  async insertCard(c: Card): Promise<void> {
    await this.conn.runAsync(
      `INSERT INTO cards (id, deck_id, front, back, source_task_id, created_at, fsrs_state, due, state_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.id, c.deck_id, c.front, c.back, c.source_task_id, c.created_at, c.fsrs_state, c.due, c.state_label],
    );
  }
  async updateCardScheduling(c: Card): Promise<void> {
    await this.conn.runAsync(
      "UPDATE cards SET fsrs_state = ?, due = ?, state_label = ? WHERE id = ?",
      [c.fsrs_state, c.due, c.state_label, c.id],
    );
  }
  async getCard(id: string): Promise<Card | null> {
    return this.conn.getFirstAsync<Card>("SELECT * FROM cards WHERE id = ?", [id]);
  }
  async listDueCards(nowMs: number, limit?: number): Promise<Card[]> {
    const sql = "SELECT * FROM cards WHERE due <= ? ORDER BY due ASC" + (limit !== undefined ? " LIMIT ?" : "");
    const args = limit !== undefined ? [nowMs, limit] : [nowMs];
    return this.conn.getAllAsync<Card>(sql, args);
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
    const [decks, tasks, cards, reviews, completions] = await Promise.all([
      this.listDecks(),
      this.listTasks(),
      this.conn.getAllAsync<Card>("SELECT * FROM cards"),
      this.conn.getAllAsync<Review>("SELECT * FROM reviews"),
      this.listCompletions(),
    ]);
    return { decks, tasks, cards, reviews, completions };
  }
  async replaceAll(data: BackupData): Promise<void> {
    await this.conn.withTransactionAsync(async () => {
      for (const table of ["completions", "reviews", "cards", "tasks", "decks"]) {
        await this.conn.runAsync(`DELETE FROM ${table}`);
      }
      for (const d of data.decks) await this.insertDeck(d);
      for (const t of data.tasks) await this.insertTask(t);
      for (const c of data.cards) await this.insertCard(c);
      for (const r of data.reviews) await this.insertReview(r);
      for (const c of data.completions) await this.insertCompletion(c);
    });
  }
  async insertMany(decks: Deck[], cards: Card[]): Promise<void> {
    await this.conn.withTransactionAsync(async () => {
      for (const d of decks) await this.insertDeck(d);
      for (const c of cards) await this.insertCard(c);
    });
  }
}

// SQLite stores booleans as 0/1 and evidence as a JSON string; revive on read.
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
